import express from "express";
import {
  getFacilityOverview,
  configureRooms,
  updateSystemConstraints
} from "../controllers/settings.controller.js";

const router = express.Router();

router.get("/overview", getFacilityOverview);
router.post("/configure-rooms", configureRooms);
router.put("/constraints", updateSystemConstraints);

export default router;
