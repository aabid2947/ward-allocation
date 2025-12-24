import mongoose from "mongoose";

const RoomSchema = new mongoose.Schema({
  ward: { type: mongoose.Schema.Types.ObjectId, ref: "Ward", required: true },
  roomNumber: { type: String, required: true }, // e.g., "648"
  isDoubleRoom: { type: Boolean, default: false },
  active: { type: Boolean, default: true }
}, { timestamps: true });

export const Room = mongoose.model("Room", RoomSchema);
