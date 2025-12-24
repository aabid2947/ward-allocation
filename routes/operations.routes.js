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

export default router;
