import { ShiftAssignment } from "../models/ShiftAssignment.js";
import { ShiftLock } from "../models/ShiftLock.js";
import { Staff } from "../models/Staff.js";
import { Patient } from "../models/Patient.js";
import { GlobalTask } from "../models/GlobalTask.js";
import { PatientCareSchedule } from "../models/PatientCareSchedule.js";
import { StaffOverride } from "../models/StaffOverride.js";
import { Ward } from "../models/Ward.js";
import fs from "fs";
// Helper to parse duration strings like "15-20"
const parseDuration = (durationStr) => {
  if (!durationStr) return 0;
  if (typeof durationStr === 'number') return durationStr;
  const numbers = durationStr.match(/\d+/g);
  if (!numbers) return 0;
  // If "15-20", return 20 to be safe, or calculate average 
  return Math.max(...numbers.map(Number)); 
};

// Helper to check if shift is locked
const isShiftLocked = async (date, shift) => {
  const lock = await ShiftLock.findOne({ shiftDate: date, shift });
  return !!lock;
};




// Helper to check for time overlaps
const isOverlapping = (start1, end1, start2, end2) => {
  return Math.max(start1, start2) < Math.min(end1, end2);
};

// Helper to convert "HH:mm" to minutes from midnight
const timeToMins = (timeStr) => {
  if (!timeStr) return null;
  const [hrs, mins] = timeStr.split(':').map(Number);
  return hrs * 60 + mins;
};

// --- CORE ENGINE ---

export const calculateAllocation = async (date, shift) => {
  const allDetailsJson = {
    request: { date, shift, timestamp: new Date().toISOString() },
    staffFiltering: [],
    wardAllocations: {},
    errors: []
  };

  try {
    if (await isShiftLocked(date, shift)) throw new Error("Shift is locked");

    const wards = await Ward.find({ active: true });
    const allStaff = await Staff.find({ active: true });
    const overrides = await StaffOverride.find({ date, shift });
    const patients = await Patient.find({ status: "Admitted" });
    // Fetch all active global tasks for the current shift
    const globalTasks = await GlobalTask.find({ active: true, shift });
    const dayOfWeek = new Date(date).toLocaleDateString('en-US', { weekday: 'long' });

    // 1. Availability Filter
    const availableStaff = allStaff.filter(s => {
      const override = overrides.find(o => o.staff.toString() === s._id.toString());
      let reason = "Available", isAvailable = true;
      if (override && override.status === "Unavailable") { reason = "Override: Unavailable"; isAvailable = false; }
      else if (!override) {
        if (shift === "AM" && !s.availability.am) { reason = "Availability: AM False"; isAvailable = false; }
        if (shift === "PM" && !s.availability.pm) { reason = "Availability: PM False"; isAvailable = false; }
      }
      allDetailsJson.staffFiltering.push({ staffName: s.name, decision: reason, status: isAvailable });
      return isAvailable;
    });

    const totalAssignments = [];

    // 2. Ward-Wise Loop
    for (const ward of wards) {
      const wardIdStr = ward._id.toString();
      allDetailsJson.wardAllocations[ward.name] = { staffPool: [], sortedQueue: [], steps: [] };

      const wardStaffPool = availableStaff
        .filter(s => s.assignedWard?.toString() === wardIdStr)
        .map(s => ({
          staff: { _id: s._id, name: s.name, maxMinutes: s.maxMinutesPerShift },
          minutesAllocated: 0,
          timeline: []
        }));

      if (wardStaffPool.length === 0) continue;

      const wardPatients = patients.filter(p => p.currentWard?.toString() === wardIdStr);
      let wardTasks = [];

      // 3. Task Collection: Individual + Global Distribution
      for (const patient of wardPatients) {
        // --- A. Inject Global Tasks for EVERY patient ---
        globalTasks.forEach(gt => {
          wardTasks.push({
            type: "GlobalTask",
            duration: gt.durationMinutes,
            name: `${gt.name} for ${patient.name}`,
            patient: patient,
            startTime: gt.fixedWindow?.start || null,
            endTime: gt.fixedWindow?.end || null,
            staffNeeded: gt.requiredStaff > 1 ? "1-2staff" : "1staff"
          });
        });

        // --- B. Patient Specific: Daily Slots ---
        let hasDailySlots = false;
        if (patient.dailySchedule?.length > 0) {
          patient.dailySchedule.forEach(slot => {
            let slotShift = slot.shift || (slot.startTime && (parseInt(slot.startTime.split(':')[0]) < 15 ? 'AM' : 'PM'));
            if (slotShift === shift) {
              hasDailySlots = true;
              let duration = slot.isFixedDuration ? slot.durationMinutes : (slot.startTime && slot.endTime ? (timeToMins(slot.endTime) - timeToMins(slot.startTime)) : 30);
              wardTasks.push({
                type: "DailySlot",
                duration: Math.round(duration * (patient.complexityScore || 1.0)),
                name: `${slot.activities.join(", ")} for ${patient.name}`,
                patient: patient,
                startTime: slot.startTime,
                endTime: slot.endTime || null
              });
            }
          });
        }

        // --- C. Patient Specific: Weekly Cares (Base Care) ---
        if (!hasDailySlots) {
          const weeklyCare = patient.weeklyCares?.find(c => c.day === dayOfWeek);
          if (weeklyCare) {
            const durationStr = (shift === "AM") ? weeklyCare.amDuration : weeklyCare.pmDuration;
            const duration = parseDuration(durationStr);
            if (duration > 0) {
              wardTasks.push({
                type: "PatientCare",
                duration: Math.round((duration + (patient.additionalTime || 0)) * (patient.complexityScore || 1.0)),
                staffNeeded: (patient.mobilityAid?.includes("HOIST") || patient.mobilityAid?.includes("1-2")) ? "1-2staff" : "1staff",
                name: `Base Care: ${patient.name}`,
                patient: patient,
                startTime: weeklyCare.specialTime ? weeklyCare.specialTime.split('-')[0] : null,
                endTime: weeklyCare.specialTime ? weeklyCare.specialTime.split('-')[1] : null
              });
            }
          }
        }
      }

      // Sort tasks: Prioritize Global and long-duration tasks
      const wardQueue = wardTasks.sort((a, b) => b.duration - a.duration);
      allDetailsJson.wardAllocations[ward.name].sortedQueue = wardQueue.map(t => `${t.name} (${t.duration}m)`);

      // 4. Allocation Logic
      const allocateInWard = (task, duration, role = "Primary") => {
        wardStaffPool.sort((a, b) => a.minutesAllocated - b.minutesAllocated);

        const tStart = timeToMins(task.startTime);
        const tEnd = timeToMins(task.endTime) || (tStart ? tStart + duration : null);

        const bestStaff = wardStaffPool.find(s => {
          const capacityOk = s.minutesAllocated + duration <= s.staff.maxMinutes;
          let collisionOk = true;
          if (tStart !== null && tEnd !== null) {
            collisionOk = !s.timeline.some(booked => isOverlapping(booked.start, booked.end, tStart, tEnd));
          }
          return capacityOk && collisionOk;
        });

        if (bestStaff) {
          bestStaff.minutesAllocated += duration;
          if (tStart !== null && tEnd !== null) {
            bestStaff.timeline.push({ start: tStart, end: tEnd });
          }
          
          totalAssignments.push({
            shiftDate: date, shift, staff: bestStaff.staff._id, staffName: bestStaff.staff.name,
            ward: ward._id, wardName: ward.name, patient: task.patient?._id || null,
            minutesAllocated: duration, taskName: task.name + (role === "Secondary" ? " (Assist)" : ""),
            source: (task.type === "GlobalTask") ? "GlobalTask" : "PatientCare"
          });
        }
      };

      for (const task of wardQueue) {
        if (task.staffNeeded === "1-2staff") {
          allocateInWard(task, task.duration, "Primary");
          allocateInWard(task, Math.ceil(task.duration * 0.5), "Secondary"); // Assume secondary needs 50% time
        } else {
          allocateInWard(task, task.duration);
        }
      }
    }

    // fs.writeFileSync(`./data/allDetails.json`, JSON.stringify(allDetailsJson, null, 2));
    return { assignments: totalAssignments, allDetailsJson };
  } catch (error) {
    allDetailsJson.errors.push(error.message);
    throw error;
  }
};

// Dry Run Allocation
export const dryRunAllocation = async (req, res) => {
  const { date, shift } = req.body;
  try {
    const { assignments } = await calculateAllocation(date, shift);
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
