import mongoose from "mongoose";

const GlobalTaskSchema = new mongoose.Schema({
  name: { type: String, required: true },
  durationMinutes: { type: Number, required: true },
  requiredStaff: { type: Number, required: true },
  shift: { type: String, enum: ["AM", "PM"], required: true },
  // Constraints for the Engine
  latestStartBy: { type: String },    // "11:15"
  earliestStartAfter: { type: String }, // "21:00"
  fixedWindow: {
    start: { type: String }, // "19:00"
    end: { type: String }    // "19:30"
  },
  active: { type: Boolean, default: true }
}, { timestamps: true });

export const GlobalTask = mongoose.model("GlobalTask", GlobalTaskSchema);
