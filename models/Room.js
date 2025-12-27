import mongoose from "mongoose";

const RoomSchema = new mongoose.Schema({
  ward: { type: mongoose.Schema.Types.ObjectId, ref: "Ward", required: true },
  roomNumber: { type: String, required: true }, // e.g., "648"
  capacity: { type: Number, default: 1 },
  type: { type: String, enum: ["Standard", "Isolation", "ICU", "HighDependency"], default: "Standard" },
  features: [{ type: String }], // e.g., "Oxygen", "Hoist", "Ensuite"
  isDoubleRoom: { type: Boolean, default: false }, // Deprecated in favor of capacity, but kept for backward compat
  active: { type: Boolean, default: true }
}, { timestamps: true });

export const Room = mongoose.model("Room", RoomSchema);
