import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const reviewSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    name: {
      type: String, // user name (for quick display)
      required: true,
    },
    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
    },
    comment: {
      type: String,
      required: true,
    },
  },
  {
    timestamps: true,
  },
);

const partnerSchema = new mongoose.Schema(
  {
    // 🔹 Basic Info
    name: {
      type: String,
      required: true,
      trim: true,
    },

    email: {
      type: String,
      trim: true,
      lowercase: true,
    },

    mobile: {
      type: String,
      required: true,
      unique: true,
    },

    password: {
      type: String,
      required: true,
      minlength: 6,
      select: false,
    },

    // 🔹 Service Info
    service: {
      type: String,
      required: true,
    },

    skills: [
      {
        type: String,
      },
    ],

    experience: {
      type: Number,
      default: 0,
    },

    // 🔹 Location
    city: {
      type: String,
      required: true,
    },

    address: String,

    // 🔹 Pricing
    hourlyRate: {
      type: Number,
      required: true,
    },

    dayRate: {
      type: Number, // 🔥 NEW FIELD (Full day pricing)
      required: true,
    },

    // 🔹 Profile
    profileImage: {
      type: String,
      default: "",
    },

    description: String,

    verification: {
      idType: {
        type: String,
        enum: ["aadhaar", "pan", "driving_license", "voter_id"],
      },

      idNumber: {
        type: String,
      },

      idDocumentFront: {
        type: String, // image URL
      },

      idDocumentBack: {
        type: String, // optional
      },

      isVerified: {
        type: Boolean,
        default: false,
      },

      verifiedAt: {
        type: Date,
      },
    },

    // 🔹 Availability
    isAvailable: {
      type: Boolean,
      default: true,
    },

    // 🔹 Reviews System
    reviews: [reviewSchema], // 🔥 NEW ARRAY

    rating: {
      type: Number,
      default: 0,
    },

    totalReviews: {
      type: Number,
      default: 0,
    },

    // 🔹 Verification
    isVerified: {
      type: Boolean,
      default: false,
    },

    role: {
      type: String,
      default: "partner",
    },
  },
  {
    timestamps: true,
  },
);

// // 🔐 Hash Password
// partnerSchema.pre("save", async function (next) {
//   if (!this.isModified("password")) return next();

//   const salt = await bcrypt.genSalt(10);
//   this.password = await bcrypt.hash(this.password, salt);
//   next();
// });

// // 🔐 Compare Password
// partnerSchema.methods.matchPassword = async function (enteredPassword) {
//   return await bcrypt.compare(enteredPassword, this.password);
// };

const Partner = mongoose.model("Partner", partnerSchema);

export default Partner;
