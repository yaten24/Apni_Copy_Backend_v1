import User from "../model/user.model.js";
import bcrypt from "bcryptjs";
import generateToken from "../utils/generateToken.js";

export const registerUserController = async (req, res) => {
  try {
    const { name, email, mobile, password } = req.body;

    // 🔹 Validation
    if (!name || !mobile || !password) {
      return res.status(400).json({
        success: false,
        message: "Name, mobile and password are required",
      });
    }

    // 🔹 Email optional but validate if provided
    if (email) {
      const emailRegex = /^\S+@\S+\.\S+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({
          success: false,
          message: "Invalid email format",
        });
      }
    }

    // 🔹 Password length check
    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters",
      });
    }

    // 🔹 Check existing user
    const existingUser = await User.findOne({
      $or: [{ email }, { mobile }],
    });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: "User already exists with this email or mobile",
      });
    }

    // 🔹 Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // 🔹 Create user
    const user = await User.create({
      name: name.trim(),
      email: email ? email.toLowerCase().trim() : undefined,
      mobile: mobile.trim(),
      password: hashedPassword,
    });

    // 🔹 Generate token
    const token = generateToken(user._id);

    // 🔹 Remove password from response
    user.password = undefined;

    // 🔹 Response
    return res.status(201).json({
      success: true,
      message: "User registered successfully",
      token,
      user,
    });

  } catch (error) {
    console.error("Register Error:", error);

    // 🔹 Mongo duplicate key error handling
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "Duplicate field value entered",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

export const loginUserController = async (req, res) => {
  try {
    const { email, mobile, password } = req.body;

    // 🔹 Validation
    if ((!email && !mobile) || !password) {
      return res.status(400).json({
        success: false,
        message: "Email/Mobile and password are required",
      });
    }

    // 🔹 Find user by email OR mobile
    const user = await User.findOne({
      $or: [{ email }, { mobile }],
    }).select("+password"); // password field hidden hota h normally

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // 🔹 Compare password
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    // 🔹 Generate JWT token
    const token = generateToken(user._id);

    // 🔹 Remove password before sending response
    user.password = undefined;

    res.cookie("accessToken", token, {
      httpOnly: true,
      secure: false, // true in production (HTTPS)
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    // 🔹 Response
    return res.status(200).json({
      success: true,
      message: "Login successful",
      token,
      user,
    });

  } catch (error) {
    console.error("Login Error:", error);

    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

export const verifyMe = async (req, res) => {
  const user = await User.findById(req.user._id).select("-password");

  res.json({
    success: true,
    user
  });
}