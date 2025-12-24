import mongoose from "mongoose";

const PatientWardHistorySchema = new mongoose.Schema({
  patient: { type: mongoose.Schema.Types.ObjectId, ref: "Patient", required: true },
  ward: { type: mongoose.Schema.Types.ObjectId, ref: "Ward", required: true },
  room: { type: mongoose.Schema.Types.ObjectId, ref: "Room", required: true },
  fromDate: { type: Date, default: Date.now },
  toDate: { type: Date }, // Null if current location
  reason: { type: String }
}, { timestamps: true });

export const PatientWardHistory = mongoose.model("PatientWardHistory", PatientWardHistorySchema);
