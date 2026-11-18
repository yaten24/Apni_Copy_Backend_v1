// Booking rules shared by customers, workers and admins.
import { Booking, Worker } from "./models.js";
import { HttpError, randomCode, todayIST, nowTimeIST } from "./util.js";

const MAX_DAYS_AHEAD = 60;

// Who may move a booking from one status to another.
const TRANSITIONS = {
  customer: { requested: ["cancelled"], accepted: ["cancelled"] },
  worker: { requested: ["accepted", "declined"], accepted: ["completed", "cancelled"] },
  admin: {
    requested: ["accepted", "declined", "cancelled"],
    accepted: ["completed", "cancelled", "requested"],
    completed: ["accepted"],
    cancelled: ["requested"],
    declined: ["requested"],
  },
};
export const allowedNext = (by, status) => TRANSITIONS[by]?.[status] || [];

const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);

/** Creates a booking request from `customer` (a Customer document). by: "customer" | "admin". extra: { job } */
export async function createBooking(customer, input, by = "customer", extra = {}) {
  const worker = await Worker.findById(input.worker).lean();
  if (!worker || worker.status !== "approved") throw new HttpError(400, "This worker is not taking bookings right now", { errors: { worker: "Not available" } });
  if (!worker.available) throw new HttpError(400, `${worker.name} is not available for new work at the moment`, { errors: { worker: "Not available" } });

  const today = todayIST();
  const ahead = daysBetween(today, input.date);
  if (Number.isNaN(ahead) || ahead < 0) throw new HttpError(400, "Choose today or a future date", { errors: { date: "Date is in the past" } });
  if (ahead > MAX_DAYS_AHEAD) throw new HttpError(400, `Bookings open up to ${MAX_DAYS_AHEAD} days ahead`, { errors: { date: "Too far ahead" } });
  if (ahead === 0 && input.time <= nowTimeIST()) throw new HttpError(400, "That time has already passed today", { errors: { time: "Time has passed" } });

  const dup = await Booking.exists({ customer: customer._id, worker: worker._id, date: input.date, status: { $in: ["requested", "accepted"] } });
  if (dup) throw new HttpError(409, "You already have a booking with this worker on that day");

  const rate = input.rateType === "day" ? worker.dayRate : worker.hourlyRate;
  const stamp = input.date.slice(2).replace(/-/g, "");
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await Booking.create({
        bookingId: `AC-${stamp}-${randomCode(4)}`,
        customer: customer._id,
        worker: worker._id,
        job: extra.job,
        customerName: customer.name,
        customerMobile: customer.mobile,
        workerName: worker.name,
        workerMobile: worker.mobile,
        service: input.service || worker.service,
        description: input.description,
        date: input.date,
        time: input.time,
        rateType: input.rateType,
        quantity: input.quantity,
        rate,
        estimate: rate * input.quantity,
        address: input.address,
        city: input.city || customer.city || worker.city,
        createdBy: by,
        history: [{ status: "requested", by, note: by === "admin" ? "Booked by Apni Copy support" : extra.job ? "Hired from a job post" : "" }],
      });
    } catch (err) {
      if (err.code !== 11000 || !String(err.message).includes("bookingId")) throw err;
    }
  }
  throw new HttpError(500, "Could not create the booking. Please try again.");
}

/** Changes the status of `booking` as `by`, enforcing the transition rules. Keeps the worker's job counter in sync. */
export async function changeStatus(booking, next, by, note = "") {
  if (booking.status === next) return booking;
  if (!allowedNext(by, booking.status).includes(next)) throw new HttpError(400, `A ${booking.status} booking cannot be marked ${next}`);
  const wasCompleted = booking.status === "completed";
  booking.status = next;
  if (by === "worker" && note) booking.workerNote = note;
  booking.history.push({ status: next, by, note });
  await booking.save();
  if (next === "completed") await Worker.updateOne({ _id: booking.worker }, { $inc: { jobsDone: 1 } });
  if (wasCompleted) await Worker.updateOne({ _id: booking.worker, jobsDone: { $gt: 0 } }, { $inc: { jobsDone: -1 } });
  return booking;
}

/** Recomputes a worker's average rating from all reviewed bookings. */
export async function refreshRating(workerId) {
  const [r] = await Booking.aggregate([
    { $match: { worker: workerId, "review.rating": { $gte: 1 } } },
    { $group: { _id: null, avg: { $avg: "$review.rating" }, n: { $sum: 1 } } },
  ]);
  await Worker.updateOne({ _id: workerId }, { rating: r ? Math.round(r.avg * 10) / 10 : 0, reviewCount: r ? r.n : 0 });
}
