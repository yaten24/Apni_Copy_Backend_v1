import express from "express";
import {
  registerUserController,
  loginUserController,
} from "../controller/user.controller.js";

import { protectUser } from "../middleware/userAuth.middleware.js";

const router = express.Router();


// 🔹 Public Routes
router.post("/register", registerUserController);
router.post("/login", loginUserController);


// 🔹 Protected Routes
router.get("/profile", protectUser, (req, res) => {
  res.status(200).json({
    success: true,
    user: req.user,
  });
});


// 🔹 Update Profile
router.put("/update-profile", protectUser, async (req, res) => {
  try {
    const { name, mobile } = req.body;

    const user = req.user;

    if (name) user.name = name;
    if (mobile) user.mobile = mobile;

    await user.save();

    res.status(200).json({
      success: true,
      message: "Profile updated successfully",
      user,
    });
  } catch (error) {
    console.error("Update Profile Error:", error);

    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

export default router;