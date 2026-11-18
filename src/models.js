// Apni Copy data model.
// Customers hire verified workers (by the hour or by the day) or post a job that workers can respond to.
// Admins verify workers' ID documents and oversee everything.
import mongoose from "mongoose";

const { Schema, model } = mongoose;
const opts = { timestamps: true };

export const WORKER_STATUSES = ["pending", "approved", "rejected", "suspended"];
export const BOOKING_STATUSES = ["requested", "accepted", "declined", "completed", "cancelled"];
export const JOB_STATUSES = ["open", "assigned", "closed"];
export const ENQUIRY_STATUSES = ["new", "in-progress", "closed"];
export const ID_TYPES = ["aadhaar", "pan", "driving_license", "voter_id"];
export const RATE_TYPES = ["hour", "day"];

const hide = (fields) => ({
  transform(_doc, ret) {
    delete ret.__v;
    for (const f of fields) delete ret[f];
    return ret;
  },
});

// ---------------------------------------------------------------- customers
export const Customer = model(
  "Customer",
  new Schema(
    {
      name: { type: String, required: true, trim: true },
      mobile: { type: String, required: true, unique: true, trim: true }, // login id
      email: { type: String, trim: true, lowercase: true, default: "" },
      passwordHash: { type: String, required: true },
      city: { type: String, trim: true, default: "" },
      address: { type: String, trim: true, default: "" },
      status: { type: String, enum: ["active", "blocked"], default: "active", index: true },
      lastLoginAt: Date,
      passwordChangedAt: Date,
    },
    { ...opts, toJSON: hide(["passwordHash"]), toObject: hide(["passwordHash"]) }
  )
);

// ---------------------------------------------------------------- workers (partners)
const workerSchema = new Schema(
  {
    workerId: { type: String, unique: true }, // public id, e.g. AC-W-4K7Q2M
    name: { type: String, required: true, trim: true },
    mobile: { type: String, required: true, unique: true, trim: true }, // login id
    email: { type: String, trim: true, lowercase: true, default: "" },
    passwordHash: { type: String, required: true },
    service: { type: String, required: true, trim: true, index: true }, // main category, e.g. Electrician
    skills: { type: [String], default: [] },
    experience: { type: Number, default: 0, min: 0, max: 60 }, // years
    languages: { type: [String], default: [] },
    state: { type: String, trim: true, default: "" },
    city: { type: String, required: true, trim: true, index: true },
    area: { type: String, trim: true, default: "" }, // locality shown publicly
    address: { type: String, trim: true, default: "" }, // private, admin only
    hourlyRate: { type: Number, required: true, min: 0 },
    dayRate: { type: Number, required: true, min: 0 },
    about: { type: String, default: "" },
    photo: { type: String, default: "" }, // uploaded file name (public)
    available: { type: Boolean, default: true },
    // ID verification: documents are private files, only admins can open them
    idType: { type: String, enum: [...ID_TYPES, ""], default: "" },
    idNumber: { type: String, default: "" },
    idFront: { type: String, default: "" },
    idBack: { type: String, default: "" },
    status: { type: String, enum: WORKER_STATUSES, default: "pending", index: true },
    statusNote: { type: String, default: "" },
    approvedAt: Date,
    rating: { type: Number, default: 0 },
    reviewCount: { type: Number, default: 0 },
    jobsDone: { type: Number, default: 0 },
    lastLoginAt: Date,
    passwordChangedAt: Date,
  },
  { ...opts, toJSON: hide(["passwordHash"]), toObject: hide(["passwordHash"]) }
);
export const Worker = model("Worker", workerSchema);

// ---------------------------------------------------------------- admins
export const Admin = model(
  "Admin",
  new Schema(
    {
      name: { type: String, required: true, trim: true },
      email: { type: String, required: true, unique: true, lowercase: true, trim: true },
      passwordHash: { type: String, required: true },
      lastLoginAt: Date,
      passwordChangedAt: Date,
    },
    { ...opts, toJSON: hide(["passwordHash"]), toObject: hide(["passwordHash"]) }
  )
);

// ---------------------------------------------------------------- bookings (a customer hires one worker)
const bookingSchema = new Schema(
  {
    bookingId: { type: String, unique: true }, // e.g. AC-261119-7Q2M
    customer: { type: Schema.Types.ObjectId, ref: "Customer", required: true, index: true },
    worker: { type: Schema.Types.ObjectId, ref: "Worker", required: true, index: true },
    job: { type: Schema.Types.ObjectId, ref: "Job" }, // when hired from a job post
    // snapshots
    customerName: String,
    customerMobile: String,
    workerName: String,
    workerMobile: String,
    service: { type: String, trim: true, default: "" },
    description: { type: String, trim: true, default: "" },
    date: { type: String, required: true, index: true }, // YYYY-MM-DD (IST)
    time: { type: String, required: true }, // HH:mm start
    rateType: { type: String, enum: RATE_TYPES, required: true },
    quantity: { type: Number, required: true, min: 1, max: 60 }, // hours or days
    rate: { type: Number, required: true }, // ₹ per hour/day at booking time
    estimate: { type: Number, required: true }, // rate × quantity, paid to the worker directly
    address: { type: String, trim: true, required: true },
    city: { type: String, trim: true, default: "" },
    status: { type: String, enum: BOOKING_STATUSES, default: "requested", index: true },
    workerNote: { type: String, default: "" },
    history: [{ _id: false, status: String, by: String, note: String, at: { type: Date, default: Date.now } }],
    review: {
      rating: { type: Number, min: 1, max: 5 },
      comment: { type: String, default: "" },
      at: Date,
    },
    createdBy: { type: String, enum: ["customer", "admin"], default: "customer" },
  },
  opts
);
export const Booking = model("Booking", bookingSchema);

// ---------------------------------------------------------------- job posts (open requests workers can respond to)
const jobSchema = new Schema(
  {
    jobId: { type: String, unique: true }, // e.g. AC-J-7Q2M9X
    customer: { type: Schema.Types.ObjectId, ref: "Customer", required: true, index: true },
    customerName: String,
    title: { type: String, required: true, trim: true },
    service: { type: String, required: true, trim: true, index: true },
    city: { type: String, required: true, trim: true, index: true },
    area: { type: String, trim: true, default: "" },
    address: { type: String, trim: true, default: "" }, // shared with the hired worker only
    budget: { type: Number, default: 0 },
    rateType: { type: String, enum: [...RATE_TYPES, "fixed"], default: "fixed" },
    date: { type: String, default: "" }, // preferred start date
    description: { type: String, default: "" },
    status: { type: String, enum: JOB_STATUSES, default: "open", index: true },
    interests: [
      {
        _id: false,
        worker: { type: Schema.Types.ObjectId, ref: "Worker" },
        message: { type: String, default: "" },
        quote: { type: Number, default: 0 },
        at: { type: Date, default: Date.now },
      },
    ],
    hired: { type: Schema.Types.ObjectId, ref: "Worker" },
  },
  opts
);
export const Job = model("Job", jobSchema);

// ---------------------------------------------------------------- contact form
export const Enquiry = model(
  "Enquiry",
  new Schema(
    {
      name: { type: String, required: true, trim: true },
      mobile: { type: String, trim: true, default: "" },
      email: { type: String, trim: true, lowercase: true, default: "" },
      topic: { type: String, default: "general" },
      message: { type: String, required: true },
      status: { type: String, enum: ENQUIRY_STATUSES, default: "new", index: true },
      notes: { type: String, default: "" },
      ip: String,
    },
    opts
  )
);
