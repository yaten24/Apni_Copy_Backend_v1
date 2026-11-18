// /api/auth: sign-up and login for customers and workers, admin login, and "my account" for every role.
import { Router } from "express";
import bcrypt from "bcryptjs";
import { Admin, Customer, Worker } from "../models.js";
import { HttpError, auth, loginLimiter, randomCode, signToken, validate, writeLimiter } from "../util.js";
import { PHOTO_DIR, discardFiles, photoOnly, removeFile, workerFiles } from "../uploads.js";
import * as S from "../schemas.js";

const router = Router();
const hash = (pw) => bcrypt.hash(pw, 12);
const DUMMY = bcrypt.hashSync("not-a-real-password", 12); // equal timing whether or not the account exists

const session = (role, doc) => ({ token: signToken(role, doc), role, account: doc.toJSON() });

async function newWorkerId() {
  for (;;) {
    const id = `AC-W-${randomCode(6)}`;
    if (!(await Worker.exists({ workerId: id }))) return id;
  }
}

/** Validates multipart bodies after multer has run; cleans up files on failure. */
const validateForm = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.body || {});
  if (!result.success) {
    discardFiles(req);
    const errors = {};
    for (const i of result.error.issues) errors[i.path.join(".") || "form"] ??= i.message;
    return res.status(400).json({ message: Object.values(errors)[0], errors });
  }
  req.body = result.data;
  next();
};

// ---------------------------------------------------------------- customers
router.post("/customer/register", writeLimiter, validate(S.customerRegister), async (req, res) => {
  const { password, ...data } = req.body;
  if (await Customer.exists({ mobile: data.mobile })) {
    throw new HttpError(409, "An account with this mobile number already exists. Please log in.", { errors: { mobile: "Already registered" } });
  }
  const customer = await Customer.create({ ...data, passwordHash: await hash(password), lastLoginAt: new Date() });
  res.status(201).json(session("customer", customer));
});

router.post("/customer/login", loginLimiter, validate(S.login), async (req, res) => {
  const m = S.mobile.safeParse(req.body.id);
  const customer = m.success ? await Customer.findOne({ mobile: m.data }) : null;
  const ok = await bcrypt.compare(req.body.password, customer?.passwordHash || DUMMY);
  if (!customer || !ok) {
    if (m.success && !customer && (await Worker.exists({ mobile: m.data }))) {
      throw new HttpError(403, "This number belongs to a worker account. Please use the worker login.", { kind: "worker" });
    }
    throw new HttpError(401, "Wrong mobile number or password");
  }
  if (customer.status === "blocked") throw new HttpError(403, "This account is blocked. Contact Apni Copy support.");
  customer.lastLoginAt = new Date();
  await customer.save();
  res.json(session("customer", customer));
});

// ---------------------------------------------------------------- workers
// multipart/form-data: fields of S.workerRegister + files photo (optional), idFront, idBack
router.post("/worker/register", writeLimiter, workerFiles, validateForm(S.workerRegister), async (req, res) => {
  const files = req.files || {};
  if (!files.idFront?.[0] || !files.idBack?.[0]) {
    discardFiles(req);
    throw new HttpError(400, "Upload both sides of your ID document", { errors: { [!files.idFront?.[0] ? "idFront" : "idBack"]: "Required" } });
  }
  const { password, ...data } = req.body;
  if (await Worker.exists({ mobile: data.mobile })) {
    discardFiles(req);
    throw new HttpError(409, "A worker with this mobile number already exists. Please log in.", { errors: { mobile: "Already registered" } });
  }
  const worker = await Worker.create({
    ...data,
    workerId: await newWorkerId(),
    passwordHash: await hash(password),
    photo: files.photo?.[0]?.filename || "",
    idFront: files.idFront[0].filename,
    idBack: files.idBack[0].filename,
    status: "pending",
    lastLoginAt: new Date(),
  });
  res.status(201).json(session("worker", worker));
});

router.post("/worker/login", loginLimiter, validate(S.login), async (req, res) => {
  const m = S.mobile.safeParse(req.body.id);
  const worker = m.success ? await Worker.findOne({ mobile: m.data }) : null;
  const ok = await bcrypt.compare(req.body.password, worker?.passwordHash || DUMMY);
  if (!worker || !ok) {
    if (m.success && !worker && (await Customer.exists({ mobile: m.data }))) {
      throw new HttpError(403, "This number belongs to a customer account. Please use the customer login.", { kind: "customer" });
    }
    throw new HttpError(401, "Wrong mobile number or password");
  }
  if (worker.status === "suspended") throw new HttpError(403, "This account is suspended. Contact Apni Copy support.");
  worker.lastLoginAt = new Date();
  await worker.save();
  res.json(session("worker", worker)); // pending / rejected workers can log in to see their status
});

// ---------------------------------------------------------------- admins
router.post("/admin/login", loginLimiter, validate(S.login), async (req, res) => {
  const admin = await Admin.findOne({ email: req.body.id.toLowerCase() });
  const ok = await bcrypt.compare(req.body.password, admin?.passwordHash || DUMMY);
  if (!admin || !ok) throw new HttpError(401, "Wrong email or password");
  admin.lastLoginAt = new Date();
  await admin.save();
  res.json(session("admin", admin));
});

// ---------------------------------------------------------------- my account (any role)
const ROLES = ["customer", "worker", "admin"];
router.get("/me", auth(...ROLES), (req, res) => res.json({ role: req.role, account: req.account.toJSON() }));

router.patch("/me", auth(...ROLES), async (req, res) => {
  const schema = req.role === "customer" ? S.customerProfile : req.role === "worker" ? S.workerProfile : S.customerProfile.pick({ name: true });
  const parsed = schema.safeParse(req.body || {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new HttpError(400, issue.message, { errors: { [issue.path.join(".") || "form"]: issue.message } });
  }
  const next = { ...req.account.toObject(), ...parsed.data };
  if (req.role === "worker" && next.dayRate < next.hourlyRate) throw new HttpError(400, "Day rate should not be lower than the hourly rate", { errors: { dayRate: "Too low" } });
  Object.assign(req.account, parsed.data);
  await req.account.save();
  res.json({ role: req.role, account: req.account.toJSON() });
});

/** Workers: replace the profile photo (multipart field "photo") */
router.post("/me/photo", auth("worker"), photoOnly, async (req, res) => {
  if (!req.file) throw new HttpError(400, "Choose a photo", { errors: { photo: "Required" } });
  const old = req.account.photo;
  req.account.photo = req.file.filename;
  await req.account.save();
  removeFile(PHOTO_DIR, old);
  res.json({ role: req.role, account: req.account.toJSON() });
});

router.post("/me/password", auth(...ROLES), validate(S.changePassword), async (req, res) => {
  if (!(await bcrypt.compare(req.body.currentPassword, req.account.passwordHash))) {
    throw new HttpError(400, "Current password is wrong", { errors: { currentPassword: "Wrong password" } });
  }
  req.account.passwordHash = await hash(req.body.newPassword);
  req.account.passwordChangedAt = new Date();
  await req.account.save();
  res.json({ ok: true, token: signToken(req.role, req.account) });
});

export default router;
