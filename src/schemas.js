// Shared input rules (zod). Worker sign-up arrives as multipart form data, so numbers/lists/booleans are coerced.
import { z } from "zod";
import { ID_TYPES, RATE_TYPES } from "./models.js";

export const str = (max, label = "This field") => z.string().trim().max(max, `${label} is too long`);
export const optStr = (max) => z.string().trim().max(max).optional().default("");

export const mobile = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s-]/g, "").replace(/^(\+91|91|0)(?=\d{10}$)/, ""))
  .refine((v) => /^[6-9]\d{9}$/.test(v), "Enter a valid 10-digit mobile number");

export const email = z.string().trim().toLowerCase().email("Enter a valid email address").max(120);
export const optEmail = z.union([email, z.literal("")]).optional().default("");

export const password = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128, "Password is too long")
  .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), "Use at least one letter and one number");

export const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date");
export const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Choose a time");

/** ["a","b"] | "a" | '["a","b"]' | "a, b" -> unique trimmed strings */
const list = (max = 30) =>
  z.preprocess((v) => {
    if (v == null || v === "") return [];
    if (Array.isArray(v)) return v;
    if (typeof v === "string" && v.trim().startsWith("[")) {
      try {
        return JSON.parse(v);
      } catch {
        return [];
      }
    }
    return String(v).split(",");
  }, z.array(z.string().trim().max(60)).max(max).transform((a) => [...new Set(a.filter(Boolean))]));

const bool = z.preprocess((v) => v === true || v === "true" || v === "1" || v === "on", z.boolean());
const money = (label) => z.coerce.number({ invalid_type_error: `Enter the ${label}` }).int(`Enter the ${label} in whole rupees`).min(0).max(1000000, `${label} looks too high`);

export const customerRegister = z.object({
  name: str(80, "Name").min(2, "Enter your full name"),
  mobile,
  email: optEmail,
  password,
  city: optStr(80),
});

export const customerProfile = z
  .object({
    name: str(80, "Name").min(2, "Enter your full name"),
    email: optEmail,
    city: str(80),
    address: str(300),
  })
  .partial();

const workerBase = {
  name: str(80, "Name").min(2, "Enter your full name"),
  email: optEmail,
  service: str(60, "Service").min(2, "Choose your main service"),
  skills: list(30),
  experience: z.coerce.number().int().min(0, "Experience can't be negative").max(60, "Experience looks too high").optional().default(0),
  languages: list(10),
  state: optStr(80),
  city: str(80, "City").min(2, "Enter your city"),
  area: optStr(120),
  address: optStr(300),
  hourlyRate: money("hourly rate"),
  dayRate: money("day rate"),
  about: optStr(1500),
  available: bool.optional(),
};

export const workerRegister = z
  .object({
    ...workerBase,
    mobile,
    password,
    idType: z.enum(ID_TYPES, { errorMap: () => ({ message: "Choose an ID type" }) }),
    idNumber: str(30, "ID number").min(4, "Enter the ID number"),
  })
  .refine((v) => v.dayRate >= v.hourlyRate, { message: "Day rate should not be lower than the hourly rate", path: ["dayRate"] });

export const workerProfile = z.object(workerBase).partial();

export const login = z.object({ id: z.string().trim().min(1, "Enter your login id").max(120), password: z.string().min(1, "Enter your password").max(128) });
export const changePassword = z.object({ currentPassword: z.string().min(1, "Enter your current password").max(128), newPassword: password });

export const booking = z.object({
  worker: z.string().regex(/^[a-f\d]{24}$/i, "Choose a worker"),
  service: optStr(80),
  description: str(1000, "Description").min(5, "Describe the work in a few words"),
  date,
  time,
  rateType: z.enum(RATE_TYPES),
  quantity: z.coerce.number().int().min(1, "At least 1").max(60, "Up to 60"),
  address: str(300, "Address").min(5, "Enter the address where the work is"),
  city: optStr(80),
});

export const review = z.object({ rating: z.coerce.number().int().min(1, "Choose 1 to 5 stars").max(5), comment: optStr(800) });

export const job = z.object({
  title: str(120, "Title").min(5, "Write a short title"),
  service: str(60, "Service").min(2, "Choose a service"),
  city: str(80, "City").min(2, "Enter the city"),
  area: optStr(120),
  address: optStr(300),
  budget: z.coerce.number().int().min(0).max(1000000).optional().default(0),
  rateType: z.enum([...RATE_TYPES, "fixed"]).optional().default("fixed"),
  date: z.union([date, z.literal("")]).optional().default(""),
  description: str(2000, "Description").min(10, "Describe the job in a few lines"),
});

export const interest = z.object({ message: optStr(500), quote: z.coerce.number().int().min(0).max(1000000).optional().default(0) });

export const enquiry = z.object({
  name: str(80, "Name").min(2, "Enter your name"),
  mobile: z.union([mobile, z.literal("")]).optional().default(""),
  email: optEmail,
  topic: z.enum(["general", "booking", "worker", "complaint", "other"]).optional().default("general"),
  message: str(3000, "Message").min(5, "Write a short message"),
});
