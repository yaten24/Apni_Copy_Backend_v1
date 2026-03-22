import dns from "node:dns";
// 🔥 Fix MongoDB Atlas DNS issues
dns.setServers(["8.8.8.8", "1.1.1.1"]);

import express from "express";
import cors from "cors"
import dotenv from "dotenv";
import connectDB from "./config/db.js";
import cookieParser from "cookie-parser";

import userRoutes from "./route/user.routes.js";
import partnerRoutes from "./route/partner.route.js";

dotenv.config();
connectDB();

const app = express();

app.use(
  cors({
    origin: "http://localhost:5173", // frontend ka exact origin
    credentials: true, // allow cookies
  })
);
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Routes
app.use("/api/users", userRoutes);
app.use("/api/partners", partnerRoutes);

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`🔥 Server running on port ${PORT}`);
});