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

export default router;

