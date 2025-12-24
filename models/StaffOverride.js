import mongoose from "mongoose";

const StaffOverrideSchema = new mongoose.Schema({
  staff: { type: mongoose.Schema.Types.ObjectId, ref: "Staff", required: true },
  date: { type: Date, required: true },
  shift: { type: String, enum: ["AM", "PM"], required: true },
  status: { type: String, enum: ["Available", "Unavailable"], required: true },
  reason: { type: String }
}, { timestamps: true });

export const StaffOverride = mongoose.model("StaffOverride", StaffOverrideSchema);
