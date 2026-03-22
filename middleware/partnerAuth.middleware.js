import jwt from "jsonwebtoken";
import Partner from "../model/partner.model.js";

const protect = async (req, res, next) => {
  try {
    let token;

    // 1. Get token from cookies
    if (req.cookies?.accessToken) {
      token = req.cookies.accessToken;
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Not authorized. Please login.",
      });
    }

    // 2. Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // decoded contains:
    // { id, role }

    // 3. Find user
    const partner = await Partner.findById(decoded.id).select(
      "-password",
    );

    if (!partner) {
      return res.status(401).json({
        success: false,
        message: "User no longer exists",
      });
    }

    // 5. Block banned users
    if (partner.isBlocked) {
      return res.status(403).json({
        success: false,
        message: "Account blocked",
      });
    }

    //  Attach user to request
    req.partner = {
      _id: partner._id,
      role: partner.role,
    };

    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired token",
    });
  }
};

export default protect;
