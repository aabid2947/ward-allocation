import mongoose from "mongoose";

const GlobalTaskSchema = new mongoose.Schema({
  name: { type: String, required: true },
  category: { type: String }, 
  durationMinutes: { type: Number, required: true },
  requiredStaff: { type: Number, default: 1 },
  shift: { type: String, enum: ["AM", "PM"], required: true },
  
  // Consistency with Patient Model
  isPerPatient: { type: Boolean, default: true }, // Set to true for things like "Tea"
  isFixedDuration: { type: Boolean, default: true },
  
  // Time Windows
  fixedWindow: {
    start: { type: String }, // "08:00"
    end: { type: String }    // "08:30"
  },
  active: { type: Boolean, default: true }
}, { timestamps: true });

export const GlobalTask = mongoose.model("GlobalTask", GlobalTaskSchema);