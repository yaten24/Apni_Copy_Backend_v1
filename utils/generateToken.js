import jwt from "jsonwebtoken";

const generateToken = (res, userId) => {
  const token = jwt.sign(
    { id: userId }, // ✅ ONLY SIMPLE DATA
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );

  res.cookie("accessToken", token, {
    httpOnly: true,
    secure: false, // true in production
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
};

export default generateToken;