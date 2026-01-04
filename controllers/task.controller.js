import { GlobalTask } from "../models/GlobalTask.js";
import { Patient } from "../models/Patient.js";

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

export const updateGlobalTask = async (req, res) => {
  const { id } = req.params;
  try {
    const updatedTask = await GlobalTask.findByIdAndUpdate(id, req.body, { new: true });
    if (!updatedTask) return res.status(404).json({ message: "Task not found" });
    res.status(200).json(updatedTask);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

export const deleteGlobalTask = async (req, res) => {
  const { id } = req.params;
  try {
    const deletedTask = await GlobalTask.findByIdAndDelete(id);
    if (!deletedTask) return res.status(404).json({ message: "Task not found" });
    res.status(200).json({ message: "Task deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// --- Patient Care Schedules ---
// (Legacy support kept, but getDailyWorkload updated)

export const getPatientCareSchedules = async (req, res) => {
  try {
    // const schedules = await PatientCareSchedule.find().populate("patient");
    // res.status(200).json(schedules);
    res.status(200).json([]); // Deprecated
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const createPatientCareSchedule = async (req, res) => {
  try {
    // const newSchedule = new PatientCareSchedule(req.body);
    // await newSchedule.save();
    // res.status(201).json(newSchedule);
    res.status(201).json({}); // Deprecated
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// Alias for createPatientCareSchedule to match API contract
export const setPatientSchedule = createPatientCareSchedule;

// Helper to parse duration strings like "15-20"
const parseDuration = (durationStr) => {
  if (!durationStr) return 0;
  if (typeof durationStr === 'number') return durationStr;
  const numbers = durationStr.match(/\d+/g);
  if (!numbers) return 0;
  return Math.max(...numbers.map(Number)); 
};

// Get Daily Workload
export const getDailyWorkload = async (req, res) => {
  const { date, shift } = req.query;

  try {
    // 1. Global Tasks
    const globalTasks = await GlobalTask.find({ active: true, shift });
    let totalMinutes = globalTasks.reduce((sum, task) => sum + task.durationMinutes, 0);
    let taskCount = globalTasks.length;

    // 2. Patient Care (From Patient Model)
    const dayOfWeek = new Date(date).toLocaleDateString('en-US', { weekday: 'long' });
    const patients = await Patient.find({ status: "Admitted" });

    patients.forEach(patient => {
      // A. Weekly Cares for this day
      const weeklyCare = patient.weeklyCares?.find(c => c.day === dayOfWeek);
      if (weeklyCare) {
        const durationStr = shift === "AM" ? weeklyCare.amDuration : weeklyCare.pmDuration;
        const duration = parseDuration(durationStr);
        if (duration > 0) {
          totalMinutes += duration;
          taskCount++;
        }
      }

      // B. Daily Schedule
      if (patient.dailySchedule) {
        patient.dailySchedule.forEach(slot => {
          // Determine slot shift
          let slotShift = slot.shift;
          if (!slotShift && slot.startTime) {
            const hour = parseInt(slot.startTime.split(':')[0], 10);
            slotShift = hour < 15 ? 'AM' : 'PM';
          }

          if (slotShift === shift) {
            let duration = slot.durationMinutes || 0;
            if (!slot.isFixedDuration && slot.startTime && slot.endTime) {
               const start = parseInt(slot.startTime.split(':')[0]) * 60 + parseInt(slot.startTime.split(':')[1]);
               const end = parseInt(slot.endTime.split(':')[0]) * 60 + parseInt(slot.endTime.split(':')[1]);
               duration = end - start;
            }
            if (duration > 0) {
              totalMinutes += duration;
              taskCount++;
            }
          }
        });
      }
    });

    res.status(200).json({ totalMinutes, taskCount });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

