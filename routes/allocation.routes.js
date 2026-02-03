import express from "express";
import {
  dryRunAllocation,
  commitAllocation,
  resetAllocation,
  manualOverride,
  runAllocationEngine,
  getShiftResultTable,
  getAllocationLogs,
  getFairnessMetrics
} from "../controllers/allocation.controller.js";

const router = express.Router();

// Allocation engine endpoints
router.post("/dry-run", dryRunAllocation);
router.post("/run-engine", runAllocationEngine);
router.post("/commit", commitAllocation);
router.post("/reset", resetAllocation);
router.post("/override", manualOverride);

// Query endpoints
router.get("/result-table", getShiftResultTable);
router.get("/logs", getAllocationLogs);
router.get("/fairness", getFairnessMetrics);

export default router;

