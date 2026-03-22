import express from "express"
import { loginPartnerController, registerPartner, verifyPartner } from "../controller/partner.controller.js";
import upload from "../middleware/multer.middleware.js"
import protect from "../middleware/partnerAuth.middleware.js";

const router = express.Router();

router.post(
  "/register",
  upload.fields([
    { name: "idDocumentFront", maxCount: 1 },
    { name: "idDocumentBack", maxCount: 1 },
  ]),
  registerPartner
);

router.post("/login", loginPartnerController);
// 🔹 Protected Routes
router.get("/auth/me", protect, verifyPartner);

export default router;