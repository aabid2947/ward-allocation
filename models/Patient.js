import mongoose from "mongoose";

const PatientSchema = new mongoose.Schema({
  name: { type: String, required: true },
  primaryCondition: { type: String, required: true },
  careLevel: {
    type: String,
    enum: ["Low", "Medium", "High", "EndOfLife", "Hospital"],
    required: true
  },
  mobilityLevel: {
    type: String,
    enum: ["BedBound", "Assisted", "WalkingFrame", "Independent"],
    required: true
  },
  complexityScore: { type: Number, min: 1.0, max: 2.0, required: true },
  admissionDate: { type: Date, required: true },
  dischargeDate: { type: Date },
  status: {
    type: String,
    enum: ["Admitted", "OnLeave", "Transferred", "Discharged"],
    default: "Admitted"
  },
  dailySchedule: [{
    startTime: String, // "HH:mm"
    endTime: String,   // "HH:mm"
    isFixedDuration: { type: Boolean, default: false },
    durationMinutes: Number,
    activities: [{ type: String }] // e.g. ["Morning Cares", "Toileting"]
  }],
  currentWard: { type: mongoose.Schema.Types.ObjectId, ref: "Ward", required: true },
  currentRoom: { type: mongoose.Schema.Types.ObjectId, ref: "Room", required: true }
}, { timestamps: true });

export const Patient = mongoose.model("Patient", PatientSchema);
