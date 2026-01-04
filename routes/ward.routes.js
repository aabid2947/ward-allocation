import express from "express";
import {
  getWards,
  createWard,
  updateWard,
  createRoom,
  updateRoom,
  deleteRoom,
  getIntegrityReport,
  moveResident,
  getWardControlCenter,
  getOccupancyStats,
  getMovementHistory,
  getWardDetails,
  assignStaffToWard,
  removeStaffFromWard
} from "../controllers/ward.controller.js";

const router = express.Router();

router.get("/", getWards);
router.get("/:id", getWardDetails); // Specific ward details
router.post("/", createWard);
router.put("/:id", updateWard);
router.post("/:wardId/staff", assignStaffToWard);
router.delete("/:wardId/staff/:staffId", removeStaffFromWard);
router.post("/rooms", createRoom);
router.put("/rooms/:id", updateRoom);
router.delete("/rooms/:id", deleteRoom);
router.get("/integrity-report", getIntegrityReport);
router.post("/move-resident", moveResident);
router.get("/:wardId/control-center", getWardControlCenter);
router.get("/occupancy-stats", getOccupancyStats);
router.get("/:patientId/history", getMovementHistory);
router.delete("/delete-all", async (req, res) => {
  console.log(90)
  // WARNING: This route is for testing purposes only. Do not use in production.
  const { Ward } = await import("../models/Ward.js");
  const { Room } = await import("../models/Room.js"); 
  try {
    await Ward.deleteMany({});
    await Room.deleteMany({});
    res.status(200).json({ message: "All wards and rooms deleted." });
  }
  catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
}); 

export default router;
