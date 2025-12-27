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
  getMovementHistory
} from "../controllers/ward.controller.js";

const router = express.Router();

router.get("/", getWards);
router.post("/", createWard);
router.put("/:id", updateWard);
router.post("/rooms", createRoom);
router.put("/rooms/:id", updateRoom);
router.delete("/rooms/:id", deleteRoom);
router.get("/integrity-report", getIntegrityReport);
router.post("/move-resident", moveResident);
router.get("/:wardId/control-center", getWardControlCenter);
router.get("/occupancy-stats", getOccupancyStats);
router.get("/:patientId/history", getMovementHistory);

export default router;

