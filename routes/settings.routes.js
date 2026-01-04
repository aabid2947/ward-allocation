import express from "express";
import {
  getFacilityOverview,
  configureRooms,
  updateSystemConstraints,
  getWeeklyWorkload,
  getDetailedFacilityOverview
} from "../controllers/settings.controller.js";

const router = express.Router();

router.get("/overview", getFacilityOverview);
router.get("/detailed-overview", getDetailedFacilityOverview);
router.get("/weekly-workload", getWeeklyWorkload);
router.post("/configure-rooms", configureRooms);
router.put("/constraints", updateSystemConstraints);
router.delete("/delete-all-staff-overrrides", async (req, res) => {
  console.log(90);
  // WARNING: This route is for testing purposes only. Do not use in production.  
  const { StaffOverride } = await import("../models/StaffOverride.js")
  try {
    await StaffOverride.deleteMany({});
    res.status(200).json({ message: "All staff overrides deleted." });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
});
// curl -X DELETE http://localhost:5000/api/settings/delete-all-staff-overrrides
export default router;
