import mongoose from "mongoose";

const WardSchema = new mongoose.Schema({
  name: { type: String, required: true }, // e.g., "East Wing 1"
  wing: { type: String, enum: ["East", "West"], required: true },
  subWing: { type: String, required: true }, // e.g., "1" or "2"
  active: { type: Boolean, default: true }
}, { timestamps: true });

export const Ward = mongoose.model("Ward", WardSchema);
