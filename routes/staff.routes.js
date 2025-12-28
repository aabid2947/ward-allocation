import express from "express";
import {
  getStaff,
  createStaff,
  setAvailabilityOverride,
  toggleStaffActive,
  getFatigueReport,
  updateAvailability,
  getAvailableStaff,
  getStaffAssignments
} from "../controllers/staff.controller.js";

const router = express.Router();

router.get("/", getStaff);
router.get("/assignments", getStaffAssignments);
router.post("/", createStaff);
router.get("/available", getAvailableStaff);
router.put("/:staffId/availability", updateAvailability);
router.post("/:staffId/override", setAvailabilityOverride);
router.put("/:staffId/active", toggleStaffActive);
router.get("/fatigue-report", getFatigueReport);
router.delete("/delete-all", async (req, res) => {
  console.log(90) 
  // WARNING: This route is for testing purposes only. Do not use in production.
  const { Staff } = await import("../models/Staff.js");
  try {
    await Staff.deleteMany({});
    res.status(200).json({ message: "All staff deleted." });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
});

export default router;

