import express from "express";
import {
  getGlobalTasks,
  createGlobalTask,
  getPatientCareSchedules,
  createPatientCareSchedule,
  setPatientSchedule,
  getDailyWorkload
} from "../controllers/task.controller.js";

const router = express.Router();

router.get("/global", getGlobalTasks);
router.post("/global", createGlobalTask);
router.get("/patient-schedule", getPatientCareSchedules);
router.post("/patient-schedule", createPatientCareSchedule);
router.post("/set-patient-schedule", setPatientSchedule); // Alias
router.get("/daily-workload", getDailyWorkload);

export default router;

