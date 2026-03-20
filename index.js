import dns from "node:dns";
// 🔥 Fix MongoDB Atlas DNS issues
dns.setServers(["8.8.8.8", "1.1.1.1"]);

import express from "express";
import dotenv from "dotenv";
import connectDB from "./config/db.js";
import userRoutes from "./route/user.routes.js";

dotenv.config();
connectDB();

const app = express();

app.use(express.json());

// Routes
app.use("/api/users", userRoutes);

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`🔥 Server running on port ${PORT}`);
});