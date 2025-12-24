import mongoose from "mongoose";

const PatientCareScheduleSchema = new mongoose.Schema({
  patient: { type: mongoose.Schema.Types.ObjectId, ref: "Patient", required: true },
  dayOfWeek: {
    type: String,
    enum: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
    required: true
  },
  shift: { type: String, enum: ["AM", "PM"], required: true },
  taskType: { type: String, enum: ["Shower", "Linen", "MorningCare", "EveningCare", "Toileting", "Other"], required: true },
  durationMinutes: { type: Number, required: true },
  isFixedTime: { type: Boolean, default: false },
  startTime: { type: String }, // Required if isFixedTime
  endTime: { type: String }
}, { timestamps: true });

export const PatientCareSchedule = mongoose.model("PatientCareSchedule", PatientCareScheduleSchema);
