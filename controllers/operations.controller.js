import { ShiftLock } from "../models/ShiftLock.js";

// Lock Shift
export const lockShift = async (req, res) => {
  const { date, shift, userId } = req.body;

  try {
    const existingLock = await ShiftLock.findOne({ shiftDate: date, shift });
    if (existingLock) {
      return res.status(400).json({ message: "Shift is already locked" });
    }

    const lock = new ShiftLock({
      shiftDate: date,
      shift,
      lockedBy: userId // Optional
    });
    await lock.save();
    res.status(201).json(lock);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Unlock Shift (Optional, but good for admin)
export const unlockShift = async (req, res) => {
  const { date, shift } = req.body;

  try {
    await ShiftLock.deleteOne({ shiftDate: date, shift });
    res.status(200).json({ message: "Shift unlocked" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Get Lock Status
export const getLockStatus = async (req, res) => {
  const { date, shift } = req.query;

  try {
    const lock = await ShiftLock.findOne({ shiftDate: date, shift });
    res.status(200).json({ locked: !!lock, lockDetails: lock });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
