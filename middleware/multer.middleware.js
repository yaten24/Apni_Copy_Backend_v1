import multer from "multer";
import path from "path";

// 🔹 Storage (local for now)
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "uploads/");
  },
  filename: function (req, file, cb) {
    const uniqueName = Date.now() + "-" + file.originalname;
    cb(null, uniqueName);
  },
});

// 🔹 File Filter (only PNG, JPG, PDF)
const fileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|pdf/;
  const ext = allowedTypes.test(
    path.extname(file.originalname).toLowerCase()
  );
  const mime = allowedTypes.test(file.mimetype);

  if (ext && mime) {
    return cb(null, true);
  } else {
    cb("Only PNG, JPG, JPEG, PDF allowed!");
  }
};

const upload = multer({ storage, fileFilter });

export default upload;