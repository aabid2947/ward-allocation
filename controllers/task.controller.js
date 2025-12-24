import { GlobalTask } from "../models/GlobalTask.js";
import { PatientCareSchedule } from "../models/PatientCareSchedule.js";

// --- Global Tasks ---

export const getGlobalTasks = async (req, res) => {
  try {
    const tasks = await GlobalTask.find();
    res.status(200).json(tasks);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const createGlobalTask = async (req, res) => {
  try {
    const newTask = new GlobalTask(req.body);
    await newTask.save();
    res.status(201).json(newTask);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// --- Patient Care Schedules ---

export const getPatientCareSchedules = async (req, res) => {
  try {
    const schedules = await PatientCareSchedule.find().populate("patient");
    res.status(200).json(schedules);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const createPatientCareSchedule = async (req, res) => {
  try {
    const newSchedule = new PatientCareSchedule(req.body);
    await newSchedule.save();
    res.status(201).json(newSchedule);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// Alias for createPatientCareSchedule to match API contract
export const setPatientSchedule = createPatientCareSchedule;

// Get Daily Workload
export const getDailyWorkload = async (req, res) => {
  const { date, shift } = req.query;

  try {
    // 1. Global Tasks
    const globalTasks = await GlobalTask.find({ active: true, shift });
    let totalMinutes = globalTasks.reduce((sum, task) => sum + task.durationMinutes, 0);
    let taskCount = globalTasks.length;

    // 2. Patient Care
    // Simplified: Assuming daily schedule based on day of week
    const dayOfWeek = new Date(date).toLocaleDateString('en-US', { weekday: 'long' });
    // In a real scenario, we'd filter by active patients only
    const patientSchedules = await PatientCareSchedule.find({ shift, dayOfWeek });
    
    totalMinutes += patientSchedules.reduce((sum, task) => sum + task.durationMinutes, 0);
    taskCount += patientSchedules.length;

    res.status(200).json({ totalMinutes, taskCount });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

