import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import rateLimit from "express-rate-limit";
import { Admin, Customer, Worker } from "./models.js";

// ---------------------------------------------------------------- errors / validation
export class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    Object.assign(this, extra);
  }
}

/** validate(zodSchema, 'body' | 'query') -> replaces req[part] with the parsed value */
export const validate = (schema, part = "body") => (req, res, next) => {
  const result = schema.safeParse(req[part] ?? {});
  if (!result.success) {
    const errors = {};
    for (const issue of result.error.issues) {
      const key = issue.path.join(".") || "form";
      if (!errors[key]) errors[key] = issue.message;
    }
    return res.status(400).json({ message: Object.values(errors)[0] || "Invalid input", errors });
  }
  if (part === "query") req.valid = result.data;
  else req[part] = result.data;
  next();
};

export const validId = (req, res, next) =>
  mongoose.isValidObjectId(req.params.id) ? next() : res.status(404).json({ message: "Not found" });

export const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export const containsRe = (s) => new RegExp(escapeRe(String(s).trim().slice(0, 80)), "i");

/** page / limit / q from the query string */
export function paging(query, max = 100) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(max, Math.max(1, parseInt(query.limit, 10) || 20));
  return { page, limit, skip: (page - 1) * limit, q: typeof query.q === "string" ? query.q.trim() : "" };
}
export async function paginate(Model, filter, { page, limit, skip }, { sort = { createdAt: -1 }, select = "", populate } = {}) {
  let cursor = Model.find(filter).select(select).sort(sort).skip(skip).limit(limit);
  if (populate) cursor = cursor.populate(populate);
  const [items, total] = await Promise.all([cursor.lean(), Model.countDocuments(filter)]);
  return { items, total, page, pages: Math.max(1, Math.ceil(total / limit)) };
}

// ---------------------------------------------------------------- ids
const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // no 0/O/1/I
export const randomCode = (n) => Array.from(crypto.randomBytes(n), (b) => ALPHABET[b % ALPHABET.length]).join("");

/** Today's date in India as YYYY-MM-DD */
export const todayIST = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
export const nowTimeIST = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(11, 16);

// ---------------------------------------------------------------- auth
const MODELS = { customer: Customer, worker: Worker, admin: Admin };

export function signToken(role, doc) {
  return jwt.sign({ sub: String(doc._id), role }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES || "7d" });
}

/**
 * auth('customer') / auth('worker') / auth('admin') / auth('customer','admin')
 * Reads "Authorization: Bearer <token>", loads the account into req.account and sets req.role.
 */
export const auth = (...roles) => async (req, res, next) => {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) throw new HttpError(401, "Please log in to continue");
    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      throw new HttpError(401, "Your session has expired. Please log in again.");
    }
    if (!roles.includes(payload.role) || !MODELS[payload.role]) throw new HttpError(403, "You do not have access to this");
    const account = await MODELS[payload.role].findById(payload.sub);
    if (!account) throw new HttpError(401, "Account not found. Please log in again.");
    if (account.passwordChangedAt && payload.iat * 1000 < account.passwordChangedAt.getTime() - 1000) {
      throw new HttpError(401, "Your password was changed. Please log in again.");
    }
    if (payload.role === "customer" && account.status === "blocked") throw new HttpError(403, "This account is blocked. Contact Apni Copy support.");
    if (payload.role === "worker" && account.status === "suspended") throw new HttpError(403, "This account is suspended. Contact Apni Copy support.");
    req.role = payload.role;
    req.account = account;
    next();
  } catch (err) {
    next(err);
  }
};

/** Optional auth: sets req.role/req.account when a valid token is sent, otherwise continues as a guest. */
export const optionalAuth = (req, res, next) => {
  if (!(req.headers.authorization || "").startsWith("Bearer ")) return next();
  return auth("customer", "worker", "admin")(req, res, () => next());
};

// ---------------------------------------------------------------- rate limits
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { message: "Too many attempts. Please wait 15 minutes and try again." },
});
export const writeLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { message: "Too many requests. Please try again later." },
});
