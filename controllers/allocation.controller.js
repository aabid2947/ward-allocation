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

    // --- SIMPLIFIED ALLOCATION ENGINE LOGIC ---
    // 1. Get Available Staff
    const allStaff = await Staff.find({ active: true });
    const overrides = await StaffOverride.find({ date, shift });
    
    const availableStaff = allStaff.filter(s => {
      const override = overrides.find(o => o.staff.toString() === s._id.toString());
      if (override && override.status === "Unavailable") return false;
      // Check static availability if no override (assuming AM/PM boolean in Staff model)
      if (!override) {
        if (shift === "AM" && !s.availability.am) return false;
        if (shift === "PM" && !s.availability.pm) return false;
      }
      return true;
    });

    if (availableStaff.length === 0) {
      return res.status(400).json({ message: "No staff available for this shift" });
    }

    const assignments = [];
    let staffIndex = 0;

    // 2. Get Global Tasks
    const globalTasks = await GlobalTask.find({ active: true, shift });
    for (const task of globalTasks) {
      // Assign to staff (Round Robin for now)
      const staff = availableStaff[staffIndex % availableStaff.length];
      assignments.push({
        shiftDate: date,
        shift,
        staff: staff._id,
        staffName: staff.name, // For UI preview
        ward: staff.preferredWard, // Placeholder
        globalTask: task._id,
        taskName: task.name, // For UI preview
        minutesAllocated: task.durationMinutes,
        source: "GlobalTask"
      });
      staffIndex++;
    }

    // 3. Get Patient Care Tasks
    // Get active patients
    const patients = await Patient.find({ status: "Admitted" });
    for (const patient of patients) {
      // Get schedule for this patient/shift (simplified: assuming daily schedule)
      // In reality, we'd query PatientCareSchedule based on day of week
      const dayOfWeek = new Date(date).toLocaleDateString('en-US', { weekday: 'long' });
      const schedules = await PatientCareSchedule.find({ patient: patient._id, shift, dayOfWeek });
      
      for (const schedule of schedules) {
         const staff = availableStaff[staffIndex % availableStaff.length];
         assignments.push({
            shiftDate: date,
            shift,
            staff: staff._id,
            staffName: staff.name,
            ward: patient.currentWard,
            patient: patient._id,
            patientName: patient.name,
            minutesAllocated: schedule.durationMinutes,
            source: "PatientCare"
         });
         staffIndex++;
      }
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
