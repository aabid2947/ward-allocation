import express from "express";
import {
  getWards,
  createWard,
  getIntegrityReport,
  moveResident,
  getWardControlCenter,
  getOccupancyStats,
  getMovementHistory
} from "../controllers/ward.controller.js";

const router = express.Router();

router.get("/", getWards);
router.post("/", createWard);
router.get("/integrity-report", getIntegrityReport);
router.post("/move-resident", moveResident);
router.get("/:wardId/control-center", getWardControlCenter);
router.get("/occupancy-stats", getOccupancyStats);
router.get("/:patientId/history", getMovementHistory);

export default router;

