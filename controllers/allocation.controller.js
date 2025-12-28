import { ShiftAssignment } from "../models/ShiftAssignment.js";
import { ShiftLock } from "../models/ShiftLock.js";
import { Staff } from "../models/Staff.js";
import { Patient } from "../models/Patient.js";
import { GlobalTask } from "../models/GlobalTask.js";
import { PatientCareSchedule } from "../models/PatientCareSchedule.js";
import { StaffOverride } from "../models/StaffOverride.js";
import { Ward } from "../models/Ward.js";

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

    // --- Calculate Weekly Load for Balancing ---
    const currentShiftDate = new Date(date);
    const getStartOfWeek = (d) => {
      const date = new Date(d);
      const day = date.getDay();
      const diff = date.getDate() - day + (day === 0 ? -6 : 1);
      const monday = new Date(date.setDate(diff));
      monday.setHours(0,0,0,0);
      return monday;
    };
    
    const startOfWeek = getStartOfWeek(currentShiftDate);
    
    // Fetch assignments from start of week up to current date
    const weeklyAssignments = await ShiftAssignment.find({
      shiftDate: { $gte: startOfWeek, $lte: currentShiftDate }
    });

    const weeklyMinutesMap = {};
    weeklyAssignments.forEach(a => {
      // Exclude current shift being allocated
      const isCurrentShift = a.shiftDate.toISOString().split('T')[0] === currentShiftDate.toISOString().split('T')[0] 
                             && a.shift === shift;
                             
      if (!isCurrentShift) {
        const sId = a.staff.toString();
        weeklyMinutesMap[sId] = (weeklyMinutesMap[sId] || 0) + a.minutesAllocated;
      }
    });

    // Initialize Staff Load
    const staffLoad = availableStaff.map(s => ({
      staff: s,
      minutesAllocated: 0,
      weeklyMinutes: weeklyMinutesMap[s._id.toString()] || 0,
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
      // 0. Weekly Cares (New CSV Format)
      const weeklyCare = patient.weeklyCares?.find(c => c.day === dayOfWeek);
      if (weeklyCare) {
        const durationStr = shift === "AM" ? weeklyCare.amDuration : weeklyCare.pmDuration;
        let duration = parseDuration(durationStr);
        
        if (duration > 0) {
           // Add additional time if specified
           duration += (patient.additionalTime || 0);

           // Determine staff needed
           let staffNeeded = "1staff";
           if (patient.mobilityAid && (patient.mobilityAid.includes("HOIST") || patient.mobilityAid.includes("1-2"))) {
             staffNeeded = "1-2staff";
           }

           const complexity = patient.complexityScore || 1.0;
           const adjustedDuration = Math.round(duration * complexity);

           allTasks.push({
             type: "PatientCare",
             data: weeklyCare,
             patient: patient,
             priority: weeklyCare.specialTime ? 1 : 3, // Prioritize if special time is set
             duration: adjustedDuration,
             baseDuration: duration,
             complexity: complexity,
             name: `Base Care for ${patient.name}`,
             staffNeeded: staffNeeded,
             specialTime: weeklyCare.specialTime
           });
        }
      }

      // 1. Legacy/Specific Schedules (IGNORED)
      // const schedules = await PatientCareSchedule.find({ patient: patient._id, shift, dayOfWeek });
      // schedules.forEach(schedule => {
      //   // Calculate adjusted duration based on complexity
      //   const complexity = patient.complexityScore || 1.0;
      //   const adjustedDuration = Math.round(schedule.durationMinutes * complexity);

      //   allTasks.push({
      //     type: "PatientCare",
      //     data: schedule,
      //     patient: patient,
      //     priority: schedule.isFixedTime ? 1 : 3, // Assuming patient care is flexible unless fixed
      //     duration: adjustedDuration,
      //     baseDuration: schedule.durationMinutes,
      //     complexity: complexity,
      //     name: `${schedule.taskType} for ${patient.name}`
      //   });
      // });

      // 2. New Daily Schedule Slots
      if (patient.dailySchedule && patient.dailySchedule.length > 0) {
        patient.dailySchedule.forEach(slot => {
          // Determine if this slot falls within the current shift
          // Assuming AM shift is 07:00-15:00, PM is 14:00-22:00 (overlap?)
          // For simplicity, we'll include it if it's relevant. 
          // Ideally, we check slot.startTime against shift times.
          
          // Calculate duration
          let duration = slot.durationMinutes;
          if (!slot.isFixedDuration && slot.startTime && slot.endTime) {
             const start = new Date(`1970-01-01T${slot.startTime}:00`);
             const end = new Date(`1970-01-01T${slot.endTime}:00`);
             duration = (end - start) / 60000; // minutes
          }
          if (!duration) duration = 30; // Default fallback

          const complexity = patient.complexityScore || 1.0;
          const adjustedDuration = Math.round(duration * complexity);
          const activityNames = slot.activities.join(", ");

          allTasks.push({
            type: "PatientCare",
            data: slot,
            patient: patient,
            priority: slot.isFixedDuration ? 3 : 1, // Fixed Duration = Flexible Time (3), Specific Time = Fixed (1)
            duration: adjustedDuration,
            baseDuration: duration,
            complexity: complexity,
            name: `${activityNames} for ${patient.name}`,
            startTime: slot.startTime,
            endTime: slot.endTime
          });
        });
      }
    }

    // 3. Sort Tasks by Priority (1: Fixed Window, 2: Constraints, 3: Flexible)
    allTasks.sort((a, b) => a.priority - b.priority);

    // Fallback ward for Global Tasks if staff has no preference
    const fallbackWard = await Ward.findOne();

    // 4. Allocate Tasks
    const assignments = [];

    const allocateTaskToStaff = (task, duration, role = "Primary") => {
       // Find best staff member (Least loaded AND within max minutes)
      const capableStaff = staffLoad.filter(s => 
        s.minutesAllocated + duration <= s.staff.maxMinutesPerShift
      );

      const candidatePool = capableStaff.length > 0 ? capableStaff : staffLoad;
      
      // Sort by Total Weekly Load (Historical + Current) to ensure even distribution
      candidatePool.sort((a, b) => {
         const loadA = a.weeklyMinutes + a.minutesAllocated;
         const loadB = b.weeklyMinutes + b.minutesAllocated;
         return loadA - loadB;
      });
      
      const bestStaff = candidatePool[0];

      if (bestStaff) {
        bestStaff.minutesAllocated += duration;
        
        const assignment = {
          shiftDate: date,
          shift: shift,
          staff: bestStaff.staff._id,
          staffName: bestStaff.staff.name,
          ward: task.patient ? task.patient.currentWard : (task.data.ward || fallbackWard._id),
          patient: task.patient ? task.patient._id : null,
          globalTask: task.type === "GlobalTask" ? task.data._id : null,
          minutesAllocated: duration,
          source: task.type,
          isManualOverride: false,
          taskName: task.name + (role === "Secondary" ? " (Assist)" : "")
        };

        bestStaff.assignments.push(assignment);
        assignments.push(assignment);
      }
    };

    for (const task of allTasks) {
      if (task.staffNeeded === "1-2staff") {
        // 1. Assign primary carer for the full duration
        allocateTaskToStaff(task, task.duration, "Primary");
        
        // 2. Assign a second staff member for exactly 5 minutes (Transfer Assistance)
        allocateTaskToStaff(task, 5, "Secondary");
      } else {
        // Standard allocation
        allocateTaskToStaff(task, task.duration);
      }
    }

    // Return the plan
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
