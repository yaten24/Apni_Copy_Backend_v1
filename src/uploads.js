// File uploads: worker photos are public, ID documents are private (only admins can open them).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import multer from "multer";
import { HttpError } from "./util.js";

export const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || "uploads");
export const PHOTO_DIR = path.join(UPLOAD_DIR, "photos");
export const ID_DIR = path.join(UPLOAD_DIR, "ids");
for (const d of [PHOTO_DIR, ID_DIR]) fs.mkdirSync(d, { recursive: true });

const TYPES = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "application/pdf": ".pdf",
};

const storage = multer.diskStorage({
  destination: (_req, file, cb) => cb(null, file.fieldname === "photo" ? PHOTO_DIR : ID_DIR),
  // random names: never trust or keep the original file name
  filename: (_req, file, cb) => cb(null, `${Date.now().toString(36)}-${crypto.randomBytes(9).toString("hex")}${TYPES[file.mimetype]}`),
});

const accept = (_req, file, cb) => {
  if (!TYPES[file.mimetype]) return cb(new HttpError(400, "Upload a JPG, PNG, WEBP or PDF file", { errors: { [file.fieldname]: "Unsupported file type" } }));
  if (file.fieldname === "photo" && file.mimetype === "application/pdf") return cb(new HttpError(400, "The profile photo must be an image", { errors: { photo: "Use JPG, PNG or WEBP" } }));
  cb(null, true);
};

const upload = multer({ storage, fileFilter: accept, limits: { fileSize: 4 * 1024 * 1024, files: 3 } });

/** photo (optional), idFront, idBack */
export const workerFiles = (req, res, next) =>
  upload.fields([
    { name: "photo", maxCount: 1 },
    { name: "idFront", maxCount: 1 },
    { name: "idBack", maxCount: 1 },
  ])(req, res, (err) => {
    if (!err) return next();
    if (err.code === "LIMIT_FILE_SIZE") return next(new HttpError(400, "Each file must be under 4 MB", { errors: { [err.field]: "File too large" } }));
    if (err instanceof multer.MulterError) return next(new HttpError(400, "Could not read the uploaded files"));
    next(err);
  });

export const photoOnly = (req, res, next) =>
  upload.single("photo")(req, res, (err) => {
    if (!err) return next();
    if (err.code === "LIMIT_FILE_SIZE") return next(new HttpError(400, "The photo must be under 4 MB", { errors: { photo: "File too large" } }));
    next(err instanceof multer.MulterError ? new HttpError(400, "Could not read the photo") : err);
  });

/** Removes uploaded files of a failed request */
export function discardFiles(req) {
  const files = [...Object.values(req.files || {}).flat(), ...(req.file ? [req.file] : [])];
  for (const f of files) fs.unlink(f.path, () => {});
}

export const removeFile = (dir, name) => name && fs.unlink(path.join(dir, path.basename(name)), () => {});
