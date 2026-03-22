import Partner from "../model/partner.model.js";
import generateToken from "../utils/generateToken.js";

export const registerPartner = async (req, res) => {
  try {
    const {
      name,
      email,
      mobile,
      password,
      service,
      experience,
      state,
      city,
      address,
      hourlyRate,
      dayRate,
      description,
      idType,
      idNumber,
    } = req.body;

    // ✅ Handle skills (FormData → array)
    let skills = req.body.skills;
    if (skills && !Array.isArray(skills)) {
      skills = [skills]; // convert single → array
    }

    // ✅ File handling (Multer)
    const idFront = req.files?.idDocumentFront?.[0]?.path;
    const idBack = req.files?.idDocumentBack?.[0]?.path;

    // 🔴 Validation
    if (
      !name ||
      !mobile ||
      !password ||
      !service ||
      !state ||
      !city ||
      !hourlyRate ||
      !dayRate
    ) {
      return res.status(400).json({
        success: false,
        message: "Please fill all required fields",
      });
    }

    if (!skills || skills.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Please select at least one skill",
      });
    }

    if (!idFront || !idBack) {
      return res.status(400).json({
        success: false,
        message: "Both ID documents are required",
      });
    }

    // 🔸 Check existing partner
    const existingPartner = await Partner.findOne({ mobile });

    if (existingPartner) {
      return res.status(400).json({
        success: false,
        message: "Partner already exists with this mobile",
      });
    }

    // 🔸 Create partner
    const partner = await Partner.create({
      name,
      email,
      mobile,
      password,
      service,
      skills,
      experience,
      state, // ✅ new field
      city,
      address,
      hourlyRate,
      dayRate,
      description,

      verification: {
        idType,
        idNumber,
        idDocumentFront: idFront,
        idDocumentBack: idBack,
      },
    });

    // 🔸 Generate Token
    generateToken(res, partner._id);

    // 🔸 Response
    res.status(201).json({
      success: true,
      message: "Partner registered successfully",
      data: {
        _id: partner._id,
        name: partner.name,
        mobile: partner.mobile,
        service: partner.service,
        state: partner.state,
        city: partner.city,
        isVerified: partner.verification?.isVerified || false,
      },
    });

  } catch (error) {
    console.error("Register Partner Error:", error);

    res.status(500).json({
      success: false,
      message: error.message || "Server error",
    });
  }
};

// controllers/partner.controller.js

import bcrypt from "bcryptjs";

export const loginPartnerController = async (req, res) => {
  try {
    const { email, mobile, password } = req.body;

    // 🔹 1. Validation
    if ((!email && !mobile) || !password) {
      return res.status(400).json({
        success: false,
        message: "Email/Mobile and password are required",
      });
    }

    // 🔹 2. Find partner
    const partner = await Partner.findOne({
      $or: [{ email }, { mobile }],
    }).select("+password");

    if (!partner) {
      return res.status(404).json({
        success: false,
        message: "Partner not found",
      });
    }

    // 🔹 3. Password match
    const isMatch = await bcrypt.compare(password, partner.password);

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    // 🔹 4. Generate token
    const token = generateToken(partner._id);

    // 🔹 5. Remove password
    partner.password = undefined;

    // 🔹 6. Set cookie
    res.cookie("accessToken", token, {
      httpOnly: true,
      secure: false, // 🔥 production → true
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    // 🔹 7. Response
    return res.status(200).json({
      success: true,
      message: "Partner login successful",
      token,
      partner,
    });

  } catch (error) {
    console.error("Partner Login Error:", error);

    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};


// controllers/partner.controller.j
export const verifyPartner = async (req, res) => {
  try {
    const partner = await Partner.findById(req.partner._id).select("-password");

    if (!partner) {
      return res.status(404).json({
        success: false,
        message: "Partner not found",
      });
    }

    res.status(200).json({
      success: true,
      partner,
    });

  } catch (error) {
    console.error("Verify Partner Error:", error);

    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};