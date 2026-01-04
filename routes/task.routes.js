import express from "express";
import {
  getGlobalTasks,
  createGlobalTask,
  updateGlobalTask,
  deleteGlobalTask,
  getPatientCareSchedules,
  createPatientCareSchedule,
  setPatientSchedule,
  getDailyWorkload
} from "../controllers/task.controller.js";

const router = express.Router();

router.get("/global", getGlobalTasks);
router.post("/global", createGlobalTask);
router.put("/global/:id", updateGlobalTask);
router.delete("/global/:id", deleteGlobalTask);
router.get("/patient-schedule", getPatientCareSchedules);
router.post("/patient-schedule", createPatientCareSchedule);
router.post("/set-patient-schedule", setPatientSchedule); // Alias
router.get("/daily-workload", getDailyWorkload);
router.delete("/delete-all", async (req, res) => {
  console.log(90);
  // WARNING: This route is for testing purposes only. Do not use in production.
  const { GlobalTask } = await import("../models/GlobalTask.js");
  const { PatientCareSchedule } = await import("../models/PatientCareSchedule.js"); 
  try {
    await GlobalTask.deleteMany({});
    await PatientCareSchedule.deleteMany({});
    res.status(200).json({ message: "All global tasks and patient care schedules deleted." });
  }
  catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  } 
});
// curl -X DELETE http://localhost:5000/api/tasks/delete-all
export default router;

