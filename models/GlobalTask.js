// models/GlobalTask.js
import mongoose from "mongoose";

const GlobalTaskSchema = new mongoose.Schema({
  name: { type: String, required: true },
  category: { type: String }, 
  durationMinutes: { type: Number, required: true }, // Now strictly necessary
  requiredStaff: { type: Number, default: 1 },
  shift: { type: String, enum: ["AM", "PM"], required: true },
  startTime: { type: String, required: true }, // Simplified: "Start time only"
  active: { type: Boolean, default: true }
}, { timestamps: true });

export const GlobalTask = mongoose.model("GlobalTask", GlobalTaskSchema);