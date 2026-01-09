import mongoose from "mongoose";

const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  name: { type: String, required: true },
  role: { type: String, enum: ["admin", "manager", "staff"], default: "staff" },
  active: { type: Boolean, default: true }
}, { timestamps: true });

export const User = mongoose.model("User", UserSchema);
