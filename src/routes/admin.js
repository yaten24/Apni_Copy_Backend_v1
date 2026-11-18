// /api/admin: everything the Apni Copy team manages. Admin only.
import path from "node:path";
import fs from "node:fs";
import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { Admin, Booking, Customer, Enquiry, Job, Worker, BOOKING_STATUSES, ENQUIRY_STATUSES, JOB_STATUSES, WORKER_STATUSES } from "../models.js";
import { allowedNext, changeStatus, createBooking } from "../bookings.js";
import { HttpError, auth, containsRe, paginate, paging, randomCode, todayIST, validId, validate } from "../util.js";
import { ID_DIR, PHOTO_DIR, removeFile } from "../uploads.js";
import * as S from "../schemas.js";

const router = Router();
router.use(auth("admin"));

const groupCount = async (Model, field, match = {}) =>
  Object.fromEntries((await Model.aggregate([{ $match: match }, { $group: { _id: `$${field}`, n: { $sum: 1 } } }])).map((r) => [r._id, r.n]));

// ---------------------------------------------------------------- dashboard
router.get("/stats", async (_req, res) => {
  const weekAgo = new Date(Date.now() - 7 * 864e5);
  const today = todayIST();
  const [customers, customersWeek, workers, bookings, bookingsToday, bookingsWeek, jobs, newEnquiries, pendingWorkers, recentBookings, value] = await Promise.all([
    Customer.countDocuments(),
    Customer.countDocuments({ createdAt: { $gte: weekAgo } }),
    groupCount(Worker, "status"),
    groupCount(Booking, "status"),
    Booking.countDocuments({ date: today }),
    Booking.countDocuments({ createdAt: { $gte: weekAgo } }),
    groupCount(Job, "status"),
    Enquiry.countDocuments({ status: "new" }),
    Worker.find({ status: "pending" }).sort({ createdAt: -1 }).limit(6).select("name service city photo createdAt").lean(),
    Booking.find().sort({ createdAt: -1 }).limit(8).select("bookingId customerName workerName service date time status estimate createdAt").lean(),
    Booking.aggregate([{ $match: { status: "completed" } }, { $group: { _id: null, sum: { $sum: "$estimate" } } }]),
  ]);
  res.json({
    customers,
    customersWeek,
    workers,
    bookings: { byStatus: bookings, total: Object.values(bookings).reduce((a, b) => a + b, 0), today: bookingsToday, week: bookingsWeek },
    completedValue: value[0]?.sum || 0,
    jobs,
    newEnquiries,
    pendingWorkers,
    recentBookings,
  });
});

// ---------------------------------------------------------------- workers
router.get("/workers", async (req, res) => {
  const p = paging(req.query);
  const filter = {};
  if (WORKER_STATUSES.includes(req.query.status)) filter.status = req.query.status;
  if (req.query.service) filter.service = new RegExp(`^${containsRe(req.query.service).source}$`, "i");
  if (p.q) {
    const re = containsRe(p.q);
    filter.$or = [{ name: re }, { mobile: re }, { email: re }, { workerId: re }, { city: re }, { service: re }];
  }
  const data = await paginate(Worker, filter, p, { select: "-passwordHash -idNumber" });
  data.counts = await groupCount(Worker, "status");
  res.json(data);
});

router.get("/workers/:id", validId, async (req, res) => {
  const w = await Worker.findById(req.params.id).select("-passwordHash").lean();
  if (!w) throw new HttpError(404, "Not found");
  w.bookings = await groupCount(Booking, "status", { worker: w._id });
  res.json(w);
});

/** Streams a worker's private ID document. which = front | back */
router.get("/workers/:id/id/:which", validId, async (req, res) => {
  const w = await Worker.findById(req.params.id).select("idFront idBack").lean();
  const name = w && (req.params.which === "front" ? w.idFront : req.params.which === "back" ? w.idBack : null);
  if (!name) throw new HttpError(404, "Document not found");
  const file = path.join(ID_DIR, path.basename(name));
  if (!fs.existsSync(file)) throw new HttpError(404, "Document file is missing");
  res.set("Cache-Control", "private, no-store");
  res.sendFile(file);
});

router.patch(
  "/workers/:id",
  validId,
  validate(S.workerProfile.extend({ mobile: S.mobile.optional(), password: S.password.optional(), idType: z.enum(["aadhaar", "pan", "driving_license", "voter_id"]).optional(), idNumber: S.optStr(30).optional() })),
  async (req, res) => {
    const w = await Worker.findById(req.params.id);
    if (!w) throw new HttpError(404, "Not found");
    const { password, ...data } = req.body;
    if (data.mobile && data.mobile !== w.mobile && (await Worker.exists({ mobile: data.mobile }))) throw new HttpError(409, "Another worker uses this mobile number", { errors: { mobile: "Already registered" } });
    Object.assign(w, data);
    if (w.dayRate < w.hourlyRate) throw new HttpError(400, "Day rate should not be lower than the hourly rate", { errors: { dayRate: "Too low" } });
    if (password) {
      w.passwordHash = await bcrypt.hash(password, 12);
      w.passwordChangedAt = new Date();
    }
    await w.save();
    res.json(w.toJSON());
  }
);

router.post("/workers/:id/status", validId, validate(z.object({ status: z.enum(WORKER_STATUSES), note: S.optStr(500) })), async (req, res) => {
  const w = await Worker.findById(req.params.id);
  if (!w) throw new HttpError(404, "Not found");
  w.status = req.body.status;
  w.statusNote = req.body.status === "approved" ? "" : req.body.note;
  if (req.body.status === "approved" && !w.approvedAt) w.approvedAt = new Date();
  await w.save();
  res.json(w.toJSON());
});

router.delete("/workers/:id", validId, async (req, res) => {
  const w = await Worker.findById(req.params.id);
  if (!w) throw new HttpError(404, "Not found");
  const active = await Booking.countDocuments({ worker: w._id, status: { $in: ["requested", "accepted"] } });
  if (active) throw new HttpError(400, `This worker has ${active} active booking(s). Suspend them instead, or cancel those bookings first.`);
  await Booking.deleteMany({ worker: w._id });
  await Job.updateMany({}, { $pull: { interests: { worker: w._id } } });
  removeFile(PHOTO_DIR, w.photo);
  removeFile(ID_DIR, w.idFront);
  removeFile(ID_DIR, w.idBack);
  await w.deleteOne();
  res.json({ ok: true });
});

// ---------------------------------------------------------------- customers
router.get("/customers", async (req, res) => {
  const p = paging(req.query);
  const filter = {};
  if (req.query.status === "active" || req.query.status === "blocked") filter.status = req.query.status;
  if (p.q) {
    const re = containsRe(p.q);
    filter.$or = [{ name: re }, { mobile: re }, { email: re }, { city: re }];
  }
  const data = await paginate(Customer, filter, p, { select: "-passwordHash" });
  const counts = await Booking.aggregate([{ $match: { customer: { $in: data.items.map((c) => c._id) } } }, { $group: { _id: "$customer", n: { $sum: 1 } } }]);
  const byId = Object.fromEntries(counts.map((c) => [String(c._id), c.n]));
  data.items = data.items.map((c) => ({ ...c, bookings: byId[String(c._id)] || 0 }));
  res.json(data);
});

router.get("/customers/lookup", async (req, res) => {
  const m = S.mobile.safeParse(String(req.query.q || ""));
  if (!m.success) throw new HttpError(400, "Enter a 10-digit mobile number");
  const c = await Customer.findOne({ mobile: m.data }).select("-passwordHash").lean();
  if (!c) throw new HttpError(404, "No customer with that mobile number");
  res.json(c);
});

router.post(
  "/customers",
  validate(z.object({ name: S.customerRegister.shape.name, mobile: S.mobile, email: S.optEmail, city: S.optStr(80), address: S.optStr(300) })),
  async (req, res) => {
    if (await Customer.exists({ mobile: req.body.mobile })) throw new HttpError(409, "A customer with this mobile number already exists", { errors: { mobile: "Already registered" } });
    const tempPassword = `Ac${randomCode(6)}7`;
    const c = await Customer.create({ ...req.body, passwordHash: await bcrypt.hash(tempPassword, 12) });
    res.status(201).json({ customer: c.toJSON(), tempPassword });
  }
);

router.patch(
  "/customers/:id",
  validId,
  validate(S.customerProfile.extend({ mobile: S.mobile.optional(), status: z.enum(["active", "blocked"]).optional(), password: S.password.optional() })),
  async (req, res) => {
    const c = await Customer.findById(req.params.id);
    if (!c) throw new HttpError(404, "Not found");
    const { password, ...data } = req.body;
    if (data.mobile && data.mobile !== c.mobile && (await Customer.exists({ mobile: data.mobile }))) throw new HttpError(409, "Another customer uses this mobile number", { errors: { mobile: "Already registered" } });
    Object.assign(c, data);
    if (password) {
      c.passwordHash = await bcrypt.hash(password, 12);
      c.passwordChangedAt = new Date();
    }
    await c.save();
    res.json(c.toJSON());
  }
);

router.delete("/customers/:id", validId, async (req, res) => {
  const c = await Customer.findById(req.params.id);
  if (!c) throw new HttpError(404, "Not found");
  await Booking.deleteMany({ customer: c._id });
  await Job.deleteMany({ customer: c._id });
  await c.deleteOne();
  res.json({ ok: true });
});

// ---------------------------------------------------------------- bookings
router.get("/bookings", async (req, res) => {
  const p = paging(req.query);
  const filter = {};
  if (BOOKING_STATUSES.includes(req.query.status)) filter.status = req.query.status;
  const today = todayIST();
  if (req.query.when === "today") filter.date = today;
  else if (req.query.when === "upcoming") filter.date = { $gte: today };
  else if (req.query.when === "past") filter.date = { $lt: today };
  if (p.q) {
    const re = containsRe(p.q);
    filter.$or = [{ bookingId: re }, { customerName: re }, { customerMobile: re }, { workerName: re }, { workerMobile: re }, { service: re }];
  }
  const sort = req.query.when === "upcoming" || req.query.when === "today" ? { date: 1, time: 1 } : { createdAt: -1 };
  const data = await paginate(Booking, filter, p, { sort });
  data.items = data.items.map((b) => ({ ...b, next: allowedNext("admin", b.status) }));
  data.counts = await groupCount(Booking, "status");
  res.json(data);
});

router.post("/bookings", validate(S.booking.extend({ customer: z.string().regex(/^[a-f\d]{24}$/i, "Choose a customer") })), async (req, res) => {
  const c = await Customer.findById(req.body.customer);
  if (!c) throw new HttpError(404, "Customer not found");
  res.status(201).json(await createBooking(c, req.body, "admin"));
});

router.post("/bookings/:id/status", validId, validate(z.object({ status: z.enum(BOOKING_STATUSES), note: S.optStr(500) })), async (req, res) => {
  const b = await Booking.findById(req.params.id);
  if (!b) throw new HttpError(404, "Booking not found");
  await changeStatus(b, req.body.status, "admin", req.body.note);
  res.json({ ...b.toObject(), next: allowedNext("admin", b.status) });
});

// ---------------------------------------------------------------- job posts
router.get("/jobs", async (req, res) => {
  const p = paging(req.query);
  const filter = {};
  if (JOB_STATUSES.includes(req.query.status)) filter.status = req.query.status;
  if (p.q) {
    const re = containsRe(p.q);
    filter.$or = [{ jobId: re }, { title: re }, { service: re }, { city: re }, { customerName: re }];
  }
  const data = await paginate(Job, filter, p, { populate: [{ path: "interests.worker", select: "name service city" }, { path: "hired", select: "name service" }] });
  data.counts = await groupCount(Job, "status");
  res.json(data);
});

router.post("/jobs/:id/status", validId, validate(z.object({ status: z.enum(JOB_STATUSES) })), async (req, res) => {
  const job = await Job.findByIdAndUpdate(req.params.id, { status: req.body.status }, { new: true }).lean();
  if (!job) throw new HttpError(404, "Not found");
  res.json(job);
});

router.delete("/jobs/:id", validId, async (req, res) => {
  if (!(await Job.findByIdAndDelete(req.params.id))) throw new HttpError(404, "Not found");
  res.json({ ok: true });
});

// ---------------------------------------------------------------- enquiries
router.get("/enquiries", async (req, res) => {
  const p = paging(req.query);
  const filter = {};
  if (ENQUIRY_STATUSES.includes(req.query.status)) filter.status = req.query.status;
  if (p.q) {
    const re = containsRe(p.q);
    filter.$or = [{ name: re }, { mobile: re }, { email: re }, { message: re }];
  }
  const data = await paginate(Enquiry, filter, p);
  data.counts = await groupCount(Enquiry, "status");
  res.json(data);
});

router.patch("/enquiries/:id", validId, validate(z.object({ status: z.enum(ENQUIRY_STATUSES).optional(), notes: S.optStr(3000).optional() })), async (req, res) => {
  const doc = await Enquiry.findByIdAndUpdate(req.params.id, req.body, { new: true }).lean();
  if (!doc) throw new HttpError(404, "Not found");
  res.json(doc);
});

router.delete("/enquiries/:id", validId, async (req, res) => {
  if (!(await Enquiry.findByIdAndDelete(req.params.id))) throw new HttpError(404, "Not found");
  res.json({ ok: true });
});

// ---------------------------------------------------------------- admins
router.get("/admins", async (_req, res) => res.json(await Admin.find().select("-passwordHash").sort({ createdAt: 1 }).lean()));

router.post("/admins", validate(z.object({ name: S.customerRegister.shape.name, email: S.email, password: S.password })), async (req, res) => {
  if (await Admin.exists({ email: req.body.email })) throw new HttpError(409, "An admin with this email already exists", { errors: { email: "Already exists" } });
  const a = await Admin.create({ name: req.body.name, email: req.body.email, passwordHash: await bcrypt.hash(req.body.password, 12) });
  res.status(201).json(a.toJSON());
});

router.delete("/admins/:id", validId, async (req, res) => {
  if (String(req.params.id) === String(req.account._id)) throw new HttpError(400, "You cannot delete your own account");
  if ((await Admin.countDocuments()) <= 1) throw new HttpError(400, "At least one admin must remain");
  if (!(await Admin.findByIdAndDelete(req.params.id))) throw new HttpError(404, "Not found");
  res.json({ ok: true });
});

export default router;
