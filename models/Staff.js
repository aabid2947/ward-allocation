import mongoose from "mongoose";

const StaffSchema = new mongoose.Schema({
  name: { type: String, required: true },
  role: { type: String, enum: ["HCA", "RN", "EN"], required: true },
  employmentType: { type: String, enum: ["FullTime", "PartTime", "Casual"], required: true },
  availability: {
    am: { type: Boolean, default: false },
    pm: { type: Boolean, default: false }
  },
  maxMinutesPerShift: { type: Number, required: true },
  preferredWard: { type: mongoose.Schema.Types.ObjectId, ref: "Ward" },
  active: { type: Boolean, default: true }
}, { timestamps: true });

export const Staff = mongoose.model("Staff", StaffSchema);
