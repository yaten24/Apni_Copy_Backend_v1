// /api/worker: a logged-in worker's bookings and the job feed.
import { Router } from "express";
import { z } from "zod";
import { Booking, Job, BOOKING_STATUSES } from "../models.js";
import { allowedNext, changeStatus } from "../bookings.js";
import { HttpError, auth, containsRe, paginate, paging, todayIST, validId, validate } from "../util.js";
import * as S from "../schemas.js";

const router = Router();
router.use(auth("worker"));

const approvedOnly = (req, _res, next) =>
  req.account.status === "approved" ? next() : next(new HttpError(403, "Your profile is waiting for verification by Apni Copy"));

/** The customer's mobile and exact address are shared only once the worker accepts. */
function forWorker(b) {
  const shared = ["accepted", "completed"].includes(b.status);
  return { ...b, customerMobile: shared ? b.customerMobile : "", next: allowedNext("worker", b.status) };
}

router.get("/stats", async (req, res) => {
  const me = req.account._id;
  const today = todayIST();
  const [byStatus, todayCount, upcoming, earnings] = await Promise.all([
    Booking.aggregate([{ $match: { worker: me } }, { $group: { _id: "$status", n: { $sum: 1 } } }]),
    Booking.countDocuments({ worker: me, date: today, status: { $in: ["requested", "accepted"] } }),
    Booking.countDocuments({ worker: me, date: { $gte: today }, status: { $in: ["requested", "accepted"] } }),
    Booking.aggregate([{ $match: { worker: me, status: "completed" } }, { $group: { _id: null, sum: { $sum: "$estimate" } } }]),
  ]);
  const counts = Object.fromEntries(BOOKING_STATUSES.map((s) => [s, (byStatus.find((x) => x._id === s) || {}).n || 0]));
  res.json({
    counts,
    total: Object.values(counts).reduce((a, b) => a + b, 0),
    today: todayCount,
    upcoming,
    earnings: earnings[0]?.sum || 0,
    rating: req.account.rating,
    reviewCount: req.account.reviewCount,
  });
});

/** GET /bookings?status=&when=today|upcoming|past&q=&page= */
router.get("/bookings", async (req, res) => {
  const p = paging(req.query, 100);
  const filter = { worker: req.account._id };
  if (BOOKING_STATUSES.includes(req.query.status)) filter.status = req.query.status;
  const today = todayIST();
  if (req.query.when === "today") filter.date = today;
  else if (req.query.when === "upcoming") filter.date = { $gte: today };
  else if (req.query.when === "past") filter.date = { $lt: today };
  if (p.q) {
    const re = containsRe(p.q);
    filter.$or = [{ bookingId: re }, { customerName: re }, { service: re }, { description: re }];
  }
  const data = await paginate(Booking, filter, p, { sort: req.query.when === "past" ? { date: -1, time: -1 } : { date: 1, time: 1 } });
  data.items = data.items.map(forWorker);
  res.json(data);
});

router.post(
  "/bookings/:id/status",
  approvedOnly,
  validId,
  validate(z.object({ status: z.enum(BOOKING_STATUSES), note: S.optStr(500) })),
  async (req, res) => {
    const b = await Booking.findOne({ _id: req.params.id, worker: req.account._id });
    if (!b) throw new HttpError(404, "Booking not found");
    await changeStatus(b, req.body.status, "worker", req.body.note);
    res.json(forWorker(b.toObject()));
  }
);

// ---------------------------------------------------------------- job feed
/** Open jobs for my service in my city first. ?scope=mine (my service+city) | all, &q= */
router.get("/jobs", async (req, res) => {
  const p = paging(req.query, 50);
  const filter = { status: "open" };
  if (req.query.scope !== "all") {
    filter.service = new RegExp(`^${containsRe(req.account.service).source}$`, "i");
    filter.city = new RegExp(`^${containsRe(req.account.city).source}$`, "i");
  }
  if (p.q) filter.$or = [{ title: containsRe(p.q) }, { description: containsRe(p.q) }, { service: containsRe(p.q) }];
  const data = await paginate(Job, filter, p, { select: "jobId title service city area budget rateType date description createdAt interests customerName" });
  const me = String(req.account._id);
  data.items = data.items.map(({ interests, customerName, ...j }) => {
    const mine = (interests || []).find((i) => String(i.worker) === me);
    return { ...j, customerName: (customerName || "").split(" ")[0], interestCount: interests?.length || 0, myInterest: mine || null };
  });
  res.json(data);
});

router.post("/jobs/:id/interest", approvedOnly, validId, validate(S.interest), async (req, res) => {
  const job = await Job.findById(req.params.id);
  if (!job || job.status !== "open") throw new HttpError(404, "This job is no longer open");
  const me = String(req.account._id);
  const existing = job.interests.find((i) => String(i.worker) === me);
  if (existing) Object.assign(existing, { message: req.body.message, quote: req.body.quote, at: new Date() });
  else {
    if (job.interests.length >= 50) throw new HttpError(400, "This job already has many responses");
    job.interests.push({ worker: req.account._id, message: req.body.message, quote: req.body.quote });
  }
  await job.save();
  res.json({ ok: true, interestCount: job.interests.length });
});

router.delete("/jobs/:id/interest", validId, async (req, res) => {
  await Job.updateOne({ _id: req.params.id, status: "open" }, { $pull: { interests: { worker: req.account._id } } });
  res.json({ ok: true });
});

export default router;
