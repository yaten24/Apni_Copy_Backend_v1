// /api/public: what visitors can see without logging in.
import { Router } from "express";
import { Booking, Enquiry, Job, Worker } from "../models.js";
import { containsRe, paging, validId, validate, writeLimiter } from "../util.js";
import * as S from "../schemas.js";

const router = Router();
// never public: mobile, email, address, ID details, status notes
export const PUBLIC_WORKER = "workerId name service skills experience languages state city area hourlyRate dayRate about photo available rating reviewCount jobsDone approvedAt createdAt";

const SORTS = { rating: { rating: -1, reviewCount: -1 }, price: { hourlyRate: 1 }, experience: { experience: -1 }, new: { approvedAt: -1 } };

/** GET /workers?service=&city=&q=&available=1&sort=rating|price|experience|new&page=&limit= (approved only) */
router.get("/workers", async (req, res) => {
  const p = paging(req.query, 60);
  const filter = { status: "approved" };
  if (req.query.service) filter.service = new RegExp(`^${containsRe(req.query.service).source}$`, "i");
  if (req.query.city) filter.city = new RegExp(`^${containsRe(req.query.city).source}$`, "i");
  if (req.query.available === "1") filter.available = true;
  if (p.q) {
    const re = containsRe(p.q);
    filter.$or = [{ name: re }, { service: re }, { skills: re }, { area: re }, { city: re }];
  }
  const sort = { ...(SORTS[req.query.sort] || SORTS.rating), _id: 1 };
  const [items, total] = await Promise.all([
    Worker.find(filter).select(PUBLIC_WORKER).sort(sort).skip(p.skip).limit(p.limit).lean(),
    Worker.countDocuments(filter),
  ]);
  res.json({ items, total, page: p.page, pages: Math.max(1, Math.ceil(total / p.limit)) });
});

/** One worker's public profile with their latest reviews */
router.get("/workers/:id", validId, async (req, res) => {
  const worker = await Worker.findOne({ _id: req.params.id, status: "approved" }).select(PUBLIC_WORKER).lean();
  if (!worker) return res.status(404).json({ message: "This worker was not found" });
  const reviews = await Booking.find({ worker: worker._id, "review.rating": { $gte: 1 } })
    .sort({ "review.at": -1 })
    .limit(20)
    .select("customerName service review")
    .lean();
  worker.reviews = reviews.map((b) => ({ name: (b.customerName || "Customer").split(" ")[0], service: b.service, ...b.review }));
  res.json(worker);
});

/** Services (with worker counts) and cities that approved workers cover */
router.get("/meta", async (_req, res) => {
  const [services, cities, workers, openJobs] = await Promise.all([
    Worker.aggregate([{ $match: { status: "approved" } }, { $group: { _id: "$service", n: { $sum: 1 } } }, { $sort: { n: -1, _id: 1 } }]),
    Worker.distinct("city", { status: "approved" }),
    Worker.countDocuments({ status: "approved" }),
    Job.countDocuments({ status: "open" }),
  ]);
  res.json({ services: services.map((s) => ({ name: s._id, workers: s.n })), cities: cities.sort((a, b) => a.localeCompare(b)), workers, openJobs });
});

/** Open job posts (no customer details or exact address) */
router.get("/jobs", async (req, res) => {
  const p = paging(req.query, 50);
  const filter = { status: "open" };
  if (req.query.service) filter.service = new RegExp(`^${containsRe(req.query.service).source}$`, "i");
  if (req.query.city) filter.city = new RegExp(`^${containsRe(req.query.city).source}$`, "i");
  if (p.q) filter.$or = [{ title: containsRe(p.q) }, { description: containsRe(p.q) }];
  const [items, total] = await Promise.all([
    Job.find(filter).select("jobId title service city area budget rateType date description createdAt interests").sort({ createdAt: -1 }).skip(p.skip).limit(p.limit).lean(),
    Job.countDocuments(filter),
  ]);
  res.json({ items: items.map(({ interests, ...j }) => ({ ...j, interestCount: interests?.length || 0 })), total, page: p.page, pages: Math.max(1, Math.ceil(total / p.limit)) });
});

router.post("/enquiries", writeLimiter, validate(S.enquiry), async (req, res) => {
  await Enquiry.create({ ...req.body, ip: req.ip });
  res.status(201).json({ ok: true });
});

export default router;
