import mongoose from "mongoose";

const ShiftAssignmentSchema = new mongoose.Schema({
  shiftDate: { type: Date, required: true },
  shift: { type: String, enum: ["AM", "PM"], required: true },
  staff: { type: mongoose.Schema.Types.ObjectId, ref: "Staff", required: true },
  ward: { type: mongoose.Schema.Types.ObjectId, ref: "Ward", required: true },
  patient: { type: mongoose.Schema.Types.ObjectId, ref: "Patient" }, // Null for Global Tasks
  globalTask: { type: mongoose.Schema.Types.ObjectId, ref: "GlobalTask" }, // Null for Patient Care
  minutesAllocated: { type: Number, required: true },
  source: { type: String, enum: ["PatientCare", "GlobalTask"], required: true },
  isManualOverride: { type: Boolean, default: false },
  originalStaff: { type: mongoose.Schema.Types.ObjectId, ref: "Staff" },
  overrideReason: { type: String }
}, { timestamps: true });

export const ShiftAssignment = mongoose.model("ShiftAssignment", ShiftAssignmentSchema);
