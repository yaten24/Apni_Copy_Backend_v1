import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    // 🔹 Basic Info
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
    },

    mobile: {
      type: String,
      required: [true, "Mobile number is required"],
      unique: true,
      trim: true,
    },

    email: {
      type: String,
      lowercase: true,
      trim: true,
      sparse: true,
    },

    password: {
      type: String,
      minlength: 6,
      select: false,
    },

    profilePic: {
      type: String,
      default: "",
    },

    // 🔹 Role (Important)
    role: {
      type: String,
      enum: ["user"],
      default: "user",
    },

    // 🔹 Location (VERY IMPORTANT for your platform)
    location: {
      city: {
        type: String,
      },
      state: String,
      country: {
        type: String,
        default: "India",
      },
      pincode: String,

      coordinates: {
        lat: Number,
        lng: Number,
      },
    },

    // // 🔹 Booking Related
    // bookings: [
    //   {
    //     type: mongoose.Schema.Types.ObjectId,
    //     ref: "Booking",
    //   },
    // ],

    // 🔹 Wallet (for payments)
    wallet: {
      balance: {
        type: Number,
        default: 0,
      },
      currency: {
        type: String,
        default: "INR",
      },
    },

    // 🔹 Verification
    isVerified: {
      type: Boolean,
      default: false,
    },

    otp: {
      type: String,
      select: false,
    },

    otpExpire: {
      type: Date,
      select: false,
    },

    // 🔹 Activity
    lastLogin: Date,

    isBlocked: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

// 🔹 Index (for fast search in cities)
userSchema.index({ "location.city": 1 });

export default mongoose.model("User", userSchema);