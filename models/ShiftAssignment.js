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
  taskType: { type: String, enum: ["GlobalTask", "PatientCare", "DailySlot"] },
  taskSignature: { type: String }, // Unique identifier for the task instance
  taskName: { type: String },
  role: { type: String, enum: ["Primary", "Assistant 1", "Assistant 2", "Assistant 3"] },
  startTime: { type: String }, // "HH:mm" format
  endTime: { type: String }, // "HH:mm" format
  isManualOverride: { type: Boolean, default: false },
  originalStaff: { type: mongoose.Schema.Types.ObjectId, ref: "Staff" },
  overrideReason: { type: String }
}, { timestamps: true });

// Index for efficient querying
ShiftAssignmentSchema.index({ shiftDate: 1, shift: 1 });
ShiftAssignmentSchema.index({ staff: 1, shiftDate: 1 });
ShiftAssignmentSchema.index({ ward: 1, shiftDate: 1, shift: 1 });

export const ShiftAssignment = mongoose.model("ShiftAssignment", ShiftAssignmentSchema);
