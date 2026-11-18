// /api/customer: a logged-in customer's bookings, reviews and job posts.
import { Router } from "express";
import { z } from "zod";
import { Booking, Job, Worker } from "../models.js";
import { changeStatus, createBooking, refreshRating } from "../bookings.js";
import { HttpError, auth, randomCode, todayIST, validId, validate, writeLimiter } from "../util.js";
import { PUBLIC_WORKER } from "./public.js";
import * as S from "../schemas.js";

const router = Router();
router.use(auth("customer"));

// ---------------------------------------------------------------- bookings
/** -> { active: [...], past: [...] }; the worker's mobile is shared once they accept */
router.get("/bookings", async (req, res) => {
  const items = await Booking.find({ customer: req.account._id }).populate("worker", "name service photo city area rating mobile").sort({ date: -1, time: -1 }).limit(200).lean();
  const today = todayIST();
  const active = [];
  const past = [];
  for (const b of items) {
    if (b.worker && b.status !== "accepted" && b.status !== "completed") delete b.worker.mobile;
    if (!["accepted", "completed"].includes(b.status)) delete b.workerMobile;
    (["requested", "accepted"].includes(b.status) && b.date >= today ? active : past).push(b);
  }
  active.reverse();
  res.json({ active, past });
});

router.post("/bookings", writeLimiter, validate(S.booking), async (req, res) => {
  res.status(201).json(await createBooking(req.account, req.body, "customer"));
});

router.post("/bookings/:id/cancel", validId, validate(z.object({ reason: S.optStr(300) })), async (req, res) => {
  const b = await Booking.findOne({ _id: req.params.id, customer: req.account._id });
  if (!b) throw new HttpError(404, "Booking not found");
  await changeStatus(b, "cancelled", "customer", req.body.reason);
  res.json(b);
});

router.post("/bookings/:id/review", validId, validate(S.review), async (req, res) => {
  const b = await Booking.findOne({ _id: req.params.id, customer: req.account._id });
  if (!b) throw new HttpError(404, "Booking not found");
  if (b.status !== "completed") throw new HttpError(400, "You can review a worker after the job is completed");
  if (b.review?.rating) throw new HttpError(400, "You have already reviewed this booking");
  b.review = { rating: req.body.rating, comment: req.body.comment, at: new Date() };
  await b.save();
  await refreshRating(b.worker);
  res.json(b);
});

// ---------------------------------------------------------------- job posts
router.get("/jobs", async (req, res) => {
  const jobs = await Job.find({ customer: req.account._id }).sort({ createdAt: -1 }).limit(100).populate("interests.worker", PUBLIC_WORKER).populate("hired", "name service photo").lean();
  res.json(jobs);
});

router.post("/jobs", writeLimiter, validate(S.job), async (req, res) => {
  const open = await Job.countDocuments({ customer: req.account._id, status: "open" });
  if (open >= 10) throw new HttpError(400, "You can have up to 10 open job posts. Close one first.");
  let jobId;
  do jobId = `AC-J-${randomCode(6)}`;
  while (await Job.exists({ jobId }));
  const job = await Job.create({ ...req.body, jobId, customer: req.account._id, customerName: req.account.name });
  res.status(201).json(job);
});

router.patch("/jobs/:id", validId, validate(S.job.partial()), async (req, res) => {
  const job = await Job.findOne({ _id: req.params.id, customer: req.account._id });
  if (!job) throw new HttpError(404, "Job not found");
  if (job.status !== "open") throw new HttpError(400, "Only open jobs can be edited");
  Object.assign(job, req.body);
  await job.save();
  res.json(job);
});

router.post("/jobs/:id/close", validId, async (req, res) => {
  const job = await Job.findOneAndUpdate({ _id: req.params.id, customer: req.account._id }, { status: "closed" }, { new: true }).lean();
  if (!job) throw new HttpError(404, "Job not found");
  res.json(job);
});

/** Hire one of the interested workers: creates a booking request and marks the job assigned. */
router.post(
  "/jobs/:id/hire",
  validId,
  validate(S.booking.omit({ worker: true }).extend({ worker: z.string().regex(/^[a-f\d]{24}$/i, "Choose a worker") })),
  async (req, res) => {
    const job = await Job.findOne({ _id: req.params.id, customer: req.account._id });
    if (!job) throw new HttpError(404, "Job not found");
    if (job.status !== "open") throw new HttpError(400, "This job is no longer open");
    if (!job.interests.some((i) => String(i.worker) === req.body.worker)) throw new HttpError(400, "Choose a worker who responded to this job");
    const booking = await createBooking(req.account, { ...req.body, service: req.body.service || job.service }, "customer", { job: job._id });
    job.status = "assigned";
    job.hired = booking.worker;
    await job.save();
    res.status(201).json(booking);
  }
);

/** Public profile of a worker who responded to one of my jobs (includes rates; mobile only after hiring) */
router.get("/workers/:id", validId, async (req, res) => {
  const w = await Worker.findOne({ _id: req.params.id, status: "approved" }).select(PUBLIC_WORKER).lean();
  if (!w) throw new HttpError(404, "Worker not found");
  res.json(w);
});

export default router;
