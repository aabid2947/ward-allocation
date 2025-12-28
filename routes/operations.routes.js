import express from "express";
import {
  lockShift,
  unlockShift,
  getLockStatus
} from "../controllers/operations.controller.js";

const router = express.Router();

router.post("/lock-shift", lockShift);
router.post("/unlock-shift", unlockShift);
router.get("/lock-status", getLockStatus);
router.delete("/delete-all", async (req, res) => {
  console.log(90);
  // WARNING: This route is for testing purposes only. Do not use in production.  
  const { Staff } = await import("../models/Staff.js");
  const { Patient } = await import("../models/Patient.js");
  const { ShiftLock } = await import("../models/ShiftLock.js");
  const { ShiftAssignment } = await import("../models/ShiftAssignment.js");

  try {
    await Staff.deleteMany({});
    await Patient.deleteMany({});
    await ShiftLock.deleteMany({});
    await ShiftAssignment.deleteMany({});
    res.status(200).json({ message: "All staff, patients, and shifts deleted." });
  } catch (error) {   
    console.error(error);
    res.status(500).json({ message: error.message }); 
  }
});
// curl -X DELETE http://localhost:5000/api/operations/delete-all
export default router;
