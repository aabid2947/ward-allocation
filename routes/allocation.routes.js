import express from "express";
import {
  dryRunAllocation,
  commitAllocation,
  resetAllocation,
  manualOverride,
  runAllocationEngine,
  getShiftResultTable
} from "../controllers/allocation.controller.js";

const router = express.Router();

router.post("/dry-run", dryRunAllocation);
router.post("/run-engine", runAllocationEngine); // Alias
router.post("/commit", commitAllocation);
router.post("/reset", resetAllocation);
router.post("/override", manualOverride);
router.get("/result-table", getShiftResultTable);

export default router;

