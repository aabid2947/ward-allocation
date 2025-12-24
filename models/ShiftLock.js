import mongoose from "mongoose";

const ShiftLockSchema = new mongoose.Schema({
  shiftDate: { type: Date, required: true },
  shift: { type: String, enum: ["AM", "PM"], required: true },
  lockedAt: { type: Date, default: Date.now },
  lockedBy: { type: String } // Optional: User ID or Name
}, { timestamps: true });

export const ShiftLock = mongoose.model("ShiftLock", ShiftLockSchema);
