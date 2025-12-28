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
  mobilityAid: { type: String }, // e.g., "LWF", "WC", "S.HOIST"
  acuityLevel: { type: String }, // e.g., "High", "Low"
  additionalTime: { type: Number, default: 0 }, // Extra minutes per shift
  
  // Weekly grid for base cares (to match the Mon-Sun columns)
  weeklyCares: [{
    day: { type: String, enum: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] },
    amDuration: { type: String }, // Stored as string to handle "15-20"
    pmDuration: { type: String },
    specialTime: { type: String }  // e.g., "8:40-9am"
  }],
  dailySchedule: [{
    startTime: String, // "HH:mm"
    endTime: String,   // "HH:mm"
    isFixedDuration: { type: Boolean, default: false },
    durationMinutes: Number,
    shift: { type: String, enum: ["AM", "PM"] }, // Derived from time or explicitly set
    activities: [{ type: String }] // e.g. ["Morning Cares", "Toileting"]
  }],
  currentWard: { type: mongoose.Schema.Types.ObjectId, ref: "Ward", required: true },
  currentRoom: { type: mongoose.Schema.Types.ObjectId, ref: "Room", required: true }
}, { timestamps: true });

export const Patient = mongoose.model("Patient", PatientSchema);
