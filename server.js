/**
 * Apni Copy API: Express + MongoDB.
 * Customers hire verified local workers or post jobs; workers manage requests; admins verify workers and oversee.
 */
import "dotenv/config";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { Admin } from "./src/models.js";
import { PHOTO_DIR } from "./src/uploads.js";
import authRoutes from "./src/routes/auth.js";
import publicRoutes from "./src/routes/public.js";
import customerRoutes from "./src/routes/customer.js";
import workerRoutes from "./src/routes/worker.js";
import adminRoutes from "./src/routes/admin.js";

for (const key of ["MONGODB_URI", "JWT_SECRET"]) {
  if (!process.env[key]) {
    console.error(`Missing ${key} in .env (see .env.example)`);
    process.exit(1);
  }
}

const app = express();
app.set("trust proxy", 1); // behind nginx
app.disable("x-powered-by");
app.use(helmet({ crossOriginResourcePolicy: { policy: "same-site" } }));
app.use(cors({ origin: (process.env.CLIENT_URL || "http://localhost:5173").split(",").map((s) => s.trim()).filter(Boolean) }));
app.use(express.json({ limit: "200kb" }));

app.get("/api/health", (_req, res) => res.json({ ok: true, db: mongoose.connection.readyState === 1 ? "connected" : "disconnected" }));
// worker profile photos are public; ID documents are only served through /api/admin
app.use("/api/files/photos", express.static(PHOTO_DIR, { maxAge: "30d", index: false, dotfiles: "deny" }));
app.use("/api/auth", authRoutes);
app.use("/api/public", publicRoutes);
app.use("/api/customer", customerRoutes);
app.use("/api/worker", workerRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api", (_req, res) => res.status(404).json({ message: "Not found" }));

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err.type === "entity.parse.failed") return res.status(400).json({ message: "Invalid request" });
  if (err.code === 11000) return res.status(409).json({ message: "That value is already in use" });
  if (err.status && err.status < 500) {
    const body = { message: err.message };
    if (err.errors) body.errors = err.errors;
    if (err.kind) body.kind = err.kind;
    return res.status(err.status).json(body);
  }
  console.error(err);
  res.status(500).json({ message: "Something went wrong. Please try again." });
});

async function ensureAdmin() {
  if (await Admin.exists({})) return;
  const { ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) return console.warn("No admin account yet: set ADMIN_EMAIL and ADMIN_PASSWORD in .env");
  await Admin.create({ name: "Apni Copy Admin", email: ADMIN_EMAIL.toLowerCase(), passwordHash: await bcrypt.hash(ADMIN_PASSWORD, 12) });
  console.log(`Created admin account ${ADMIN_EMAIL}`);
}

async function start() {
  await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.MONGODB_DB || "apnicopy", serverSelectionTimeoutMS: 15000 });
  console.log("MongoDB connected");
  await ensureAdmin();
  const port = Number(process.env.PORT) || 5100;
  app.listen(port, process.env.HOST || "127.0.0.1", () => console.log(`Apni Copy API on http://${process.env.HOST || "127.0.0.1"}:${port}`));
}

start().catch((err) => {
  console.error("Startup failed:", err.message);
  process.exit(1);
});
