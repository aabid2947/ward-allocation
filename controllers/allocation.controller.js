import { ShiftAssignment } from "../models/ShiftAssignment.js";
import { ShiftLock } from "../models/ShiftLock.js";
import { Staff } from "../models/Staff.js";
import { Patient } from "../models/Patient.js";
import { GlobalTask } from "../models/GlobalTask.js";
import { PatientCareSchedule } from "../models/PatientCareSchedule.js";
import { StaffOverride } from "../models/StaffOverride.js";

// Helper to check if shift is locked
const isShiftLocked = async (date, shift) => {
  const lock = await ShiftLock.findOne({ shiftDate: date, shift });
  return !!lock;
};

// Dry Run Allocation
export const dryRunAllocation = async (req, res) => {
  const { date, shift } = req.body; // or query params

  try {
    if (await isShiftLocked(date, shift)) {
      return res.status(400).json({ message: "Shift is locked" });
    }

    // --- PRIORITY QUEUE ALLOCATION ENGINE LOGIC ---
    
    // 1. Get Available Staff
    const allStaff = await Staff.find({ active: true });
    const overrides = await StaffOverride.find({ date, shift });
    
    const availableStaff = allStaff.filter(s => {
      const override = overrides.find(o => o.staff.toString() === s._id.toString());
      if (override && override.status === "Unavailable") return false;
      if (!override) {
        if (shift === "AM" && !s.availability.am) return false;
        if (shift === "PM" && !s.availability.pm) return false;
      }
      return true;
    });

    if (availableStaff.length === 0) {
      return res.status(400).json({ message: "No staff available for this shift" });
    }

    // Initialize Staff Load
    const staffLoad = availableStaff.map(s => ({
      staff: s,
      minutesAllocated: 0,
      assignments: []
    }));

    // 2. Collect All Tasks
    let allTasks = [];

    // Global Tasks
    const globalTasks = await GlobalTask.find({ active: true, shift });
    globalTasks.forEach(task => {
      allTasks.push({
        type: "GlobalTask",
        data: task,
        priority: task.fixedWindow ? 1 : (task.latestStartBy || task.earliestStartAfter ? 2 : 3),
        duration: task.durationMinutes,
        name: task.name
      });
    });

    // Patient Care Tasks
    const patients = await Patient.find({ status: "Admitted" });
    const dayOfWeek = new Date(date).toLocaleDateString('en-US', { weekday: 'long' });
    
    for (const patient of patients) {
      const schedules = await PatientCareSchedule.find({ patient: patient._id, shift, dayOfWeek });
      schedules.forEach(schedule => {
        allTasks.push({
          type: "PatientCare",
          data: schedule,
          patient: patient,
          priority: schedule.isFixedTime ? 1 : 3, // Assuming patient care is flexible unless fixed
          duration: schedule.durationMinutes,
          name: `${schedule.taskType} for ${patient.name}`
        });
      });
    }

    // 3. Sort Tasks by Priority (1: Fixed Window, 2: Constraints, 3: Flexible)
    allTasks.sort((a, b) => a.priority - b.priority);

    // 4. Allocate Tasks
    const assignments = [];

    for (const task of allTasks) {
      // Find best staff member (Least loaded AND within max minutes)
      // In a real engine, we'd check time overlaps for fixed windows here.
      
      // Filter staff who have capacity
      const capableStaff = staffLoad.filter(s => 
        s.minutesAllocated + task.duration <= s.staff.maxMinutesPerShift
      );

      // If no one has capacity, we might need to over-allocate or flag it.
      // For now, let's fallback to all staff but prioritize those with capacity.
      const candidatePool = capableStaff.length > 0 ? capableStaff : staffLoad;

      candidatePool.sort((a, b) => a.minutesAllocated - b.minutesAllocated);
      const bestStaff = candidatePool[0];

      bestStaff.minutesAllocated += task.duration;
      
      const assignment = {
        shiftDate: date,
        shift,
        staff: bestStaff.staff._id,
        staffName: bestStaff.staff.name,
        minutesAllocated: task.duration,
        source: task.type
      };

      if (task.type === "GlobalTask") {
        assignment.globalTask = task.data._id;
        assignment.taskName = task.name;
        assignment.ward = bestStaff.staff.preferredWard; // Placeholder
      } else {
        assignment.patient = task.patient._id;
        assignment.patientName = task.patient.name;
        assignment.ward = task.patient.currentWard;
        assignment.taskName = task.name;
      }

      assignments.push(assignment);
      bestStaff.assignments.push(assignment);
    }

    res.status(200).json(assignments);


  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Alias for dryRunAllocation to match API contract
export const runAllocationEngine = dryRunAllocation;

// Get Shift Result Table
export const getShiftResultTable = async (req, res) => {
  const { date, shift } = req.query;

  try {
    const assignments = await ShiftAssignment.find({ shiftDate: date, shift })
      .populate("staff")
      .populate("patient")
      .populate("globalTask");

    // Group by Staff
    const resultTable = {};
    assignments.forEach(a => {
      const staffId = a.staff._id.toString();
      if (!resultTable[staffId]) {
        resultTable[staffId] = {
          staff: a.staff,
          assignments: [],
          totalMinutes: 0
        };
      }
      resultTable[staffId].assignments.push(a);
      resultTable[staffId].totalMinutes += a.minutesAllocated;
    });

    res.status(200).json(Object.values(resultTable));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Commit Allocation
export const commitAllocation = async (req, res) => {

  const { date, shift, data } = req.body;

  try {
    if (await isShiftLocked(date, shift)) {
      return res.status(400).json({ message: "Shift is locked" });
    }

    // Clear existing assignments for this shift (optional, or fail if exists)
    // Usually commit overwrites or we require reset first. Let's overwrite.
    await ShiftAssignment.deleteMany({ shiftDate: date, shift });

    const savedAssignments = await ShiftAssignment.insertMany(data.map(a => ({
      ...a,
      shiftDate: date, // Ensure date is set
      shift: shift
    })));

    res.status(201).json(savedAssignments);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Reset Allocation
export const resetAllocation = async (req, res) => {
  const { date, shift } = req.body;

  try {
    if (await isShiftLocked(date, shift)) {
      return res.status(400).json({ message: "Shift is locked" });
    }

    await ShiftAssignment.deleteMany({ shiftDate: date, shift });
    res.status(200).json({ message: "Allocation reset successfully" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Manual Override
export const manualOverride = async (req, res) => {
  const { assignmentId, newStaffId, reason } = req.body;

  try {
    const assignment = await ShiftAssignment.findById(assignmentId);
    if (!assignment) return res.status(404).json({ message: "Assignment not found" });

    if (await isShiftLocked(assignment.shiftDate, assignment.shift)) {
      return res.status(400).json({ message: "Shift is locked" });
    }

    // Store original if not already stored (to allow multiple overrides without losing original)
    if (!assignment.isManualOverride) {
      assignment.originalStaff = assignment.staff;
    }
    
    assignment.staff = newStaffId;
    assignment.isManualOverride = true;
    assignment.overrideReason = reason;

    await assignment.save();
    res.status(200).json(assignment);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
