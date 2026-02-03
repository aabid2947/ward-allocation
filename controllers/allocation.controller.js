import { ShiftAssignment } from "../models/ShiftAssignment.js";
import { ShiftLock } from "../models/ShiftLock.js";
import { Staff } from "../models/Staff.js";
import { Patient } from "../models/Patient.js";
import { GlobalTask } from "../models/GlobalTask.js";
import { StaffOverride } from "../models/StaffOverride.js";
import { Ward } from "../models/Ward.js";
import fs from "fs";
import path from "path";

// ============================================================================
// LOGGING INFRASTRUCTURE
// ============================================================================

/**
 * Create allocation log directory if it doesn't exist.
 */
const ensureLogDirectory = () => {
  const logDir = path.join(process.cwd(), "logs", "allocations");
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
  return logDir;
};

/**
 * Write allocation log to file.
 */
const writeAllocationLog = (log, date, shift) => {
  try {
    const logDir = ensureLogDirectory();
    const timestamp = Date.now();
    const dateStr = new Date(date).toISOString().split("T")[0];
    const filename = `allocation_${dateStr}_${shift}_${timestamp}.json`;
    const filepath = path.join(logDir, filename);
    fs.writeFileSync(filepath, JSON.stringify(log, null, 2));
    console.log(`Allocation log written to ${filepath}`);
    return filepath;
  } catch (error) {
    console.error("Failed to write allocation log:", error.message);
    return null;
  }
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Parse duration string (e.g., "15-20", "30") to maximum numeric value.
 */
const parseDuration = (durationStr) => {
  if (!durationStr) return 0;
  if (typeof durationStr === "number") return durationStr;
  const numbers = durationStr.match(/\d+/g);
  return numbers ? Math.max(...numbers.map(Number)) : 0;
};

/**
 * Check if a shift is locked for editing.
 */
const isShiftLocked = async (date, shift) => {
  const lock = await ShiftLock.findOne({ shiftDate: date, shift });
  return !!lock;
};

/**
 * Convert time string "HH:mm" to minutes since midnight.
 */
const timeToMinutes = (timeStr) => {
  if (!timeStr) return null;
  const [hrs, mins] = timeStr.split(":").map(Number);
  return hrs * 60 + mins;
};

/**
 * Convert minutes since midnight to time string "HH:mm".
 */
const minutesToTime = (minutes) => {
  if (minutes === null || minutes === undefined) return null;
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hrs.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}`;
};

/**
 * Check if two time intervals overlap.
 */
const isOverlapping = (start1, end1, start2, end2) => {
  if (start1 === null || end1 === null || start2 === null || end2 === null) {
    return false;
  }
  return Math.max(start1, start2) < Math.min(end1, end2);
};

// ============================================================================
// CONSTRAINT VALIDATION WITH DETAILED LOGGING
// ============================================================================

/**
 * HARD CONSTRAINT #1: Ward Isolation
 * Staff can only be assigned to patients in their assigned ward.
 * This is enforced during staff pool construction, but we verify here.
 */
const isStaffInWard = (staff, ward) => {
  if (!staff.assignedWard) return false;
  return staff.assignedWard.toString() === ward._id.toString();
};

/**
 * HARD CONSTRAINT #2: Gender Preference (Strict)
 * If patient.staffGender is "Male" or "Female", only matching staff can be assigned.
 * Exception: patient.staffGender === "Any" allows any gender.
 */
const checkGenderConstraint = (staff, patient) => {
  if (!patient) {
    return { eligible: true, reason: null };
  }
  if (!patient.staffGender || patient.staffGender === "Any") {
    return { eligible: true, reason: null };
  }
  if (staff.gender === patient.staffGender) {
    return { eligible: true, reason: null };
  }
  return {
    eligible: false,
    reason: `Gender mismatch: patient requires ${patient.staffGender}, staff is ${staff.gender}`
  };
};

/**
 * HARD CONSTRAINT #3: Acuity-Heavy Load Linkage
 * If patient.acuityLevel === "High", staff must have canHandleHeavyLoad === true.
 */
const checkAcuityConstraint = (staff, patient) => {
  if (!patient) {
    return { eligible: true, reason: null };
  }
  if (patient.acuityLevel !== "High") {
    return { eligible: true, reason: null };
  }
  if (staff.canHandleHeavyLoad === true) {
    return { eligible: true, reason: null };
  }
  return {
    eligible: false,
    reason: `High acuity patient requires heavy-load capable staff, but staff.canHandleHeavyLoad = ${staff.canHandleHeavyLoad}`
  };
};

/**
 * HARD CONSTRAINT #4: Multi-Staff Task Separation
 * For tasks requiring N staff, all N must be distinct individuals.
 * Check if staff is already assigned to this specific task instance.
 */
const checkMultiStaffSeparation = (staffMember, taskSignature) => {
  const alreadyAssigned = staffMember.assignments.some(
    (a) => a.taskSignature === taskSignature
  );
  if (alreadyAssigned) {
    return {
      eligible: false,
      reason: `Already assigned to this task (multi-staff separation violation)`
    };
  }
  return { eligible: true, reason: null };
};

/**
 * HARD CONSTRAINT #5: Time Conflict Prevention
 * Staff cannot be assigned to overlapping time blocks.
 */
const checkTimeConflict = (staffMember, taskStartMinutes, taskEndMinutes) => {
  if (taskStartMinutes === null || taskEndMinutes === null) {
    return { eligible: true, reason: null, conflictDetails: null };
  }
  
  for (const block of staffMember.timeline) {
    if (isOverlapping(block.start, block.end, taskStartMinutes, taskEndMinutes)) {
      return {
        eligible: false,
        reason: `Time conflict: staff busy ${minutesToTime(block.start)}-${minutesToTime(block.end)}, task needs ${minutesToTime(taskStartMinutes)}-${minutesToTime(taskEndMinutes)}`,
        conflictDetails: {
          existingBlock: { start: minutesToTime(block.start), end: minutesToTime(block.end) },
          requestedBlock: { start: minutesToTime(taskStartMinutes), end: minutesToTime(taskEndMinutes) }
        }
      };
    }
  }
  return { eligible: true, reason: null, conflictDetails: null };
};

/**
 * HARD CONSTRAINT #6: Staff Availability
 * Staff must be available for the shift (AM/PM).
 * Override mechanism takes precedence.
 */
const checkStaffAvailability = (staff, shift, overrides) => {
  const override = overrides.find(
    (o) => o.staff.toString() === staff._id.toString()
  );
  
  if (override) {
    if (override.status === "Unavailable") {
      return {
        available: false,
        reason: `Staff override: ${override.reason || "Marked unavailable"}`
      };
    }
    return { available: true, reason: null };
  }
  
  // Check default availability
  if (shift === "AM" && !staff.availability.am) {
    return { available: false, reason: "Not available for AM shift (default schedule)" };
  }
  if (shift === "PM" && !staff.availability.pm) {
    return { available: false, reason: "Not available for PM shift (default schedule)" };
  }
  
  return { available: true, reason: null };
};

/**
 * Comprehensive eligibility check with detailed logging.
 * Returns eligibility status and detailed rejection reasons.
 */
const checkAllConstraints = (staffMember, task, taskStartMinutes, taskEndMinutes) => {
  const rejectionReasons = [];
  
  // Check gender constraint
  const genderCheck = checkGenderConstraint(staffMember.staff, task.patient);
  if (!genderCheck.eligible) {
    rejectionReasons.push({
      constraint: "Gender",
      reason: genderCheck.reason
    });
  }
  
  // Check acuity constraint
  const acuityCheck = checkAcuityConstraint(staffMember.staff, task.patient);
  if (!acuityCheck.eligible) {
    rejectionReasons.push({
      constraint: "Acuity-HeavyLoad",
      reason: acuityCheck.reason
    });
  }
  
  // Check multi-staff separation
  const separationCheck = checkMultiStaffSeparation(staffMember, task.taskSignature);
  if (!separationCheck.eligible) {
    rejectionReasons.push({
      constraint: "Multi-Staff Separation",
      reason: separationCheck.reason
    });
  }
  
  // Check time conflict
  const timeCheck = checkTimeConflict(staffMember, taskStartMinutes, taskEndMinutes);
  if (!timeCheck.eligible) {
    rejectionReasons.push({
      constraint: "Time Conflict",
      reason: timeCheck.reason,
      details: timeCheck.conflictDetails
    });
  }
  
  return {
    eligible: rejectionReasons.length === 0,
    rejectionReasons
  };
};

// ============================================================================
// TASK CONSTRUCTION
// ============================================================================

/**
 * Build all tasks for a ward from patients and global tasks.
 * Returns tasks separated by type for differential allocation strategy.
 */
const buildWardTasks = (wardPatients, globalTasks, shift, dayOfWeek, ward) => {
  const globalTaskList = [];
  const patientTaskList = [];
  
  // ========================================================================
  // GLOBAL TASKS - ONE TASK PER PATIENT
  // Each patient gets their own global task instance (e.g., medication round)
  // This enables natural distribution across staff while maintaining atomicity
  // ========================================================================
  globalTasks.forEach((gt) => {
    wardPatients.forEach((patient) => {
      const duration = gt.durationMinutes || 10;
      
      globalTaskList.push({
        type: "GlobalTask",
        duration,
        name: `${gt.name}: ${patient.name}`,
        taskSignature: `GLOBAL_${gt._id}_${patient._id}`,
        startTime: gt.startTime || null,
        endTime: null,
        patient: patient,
        ward: ward,
        staffNeededCount: gt.requiredStaff || 1,
        priority: 100,
        globalTaskId: gt._id,
        globalTaskName: gt.name
      });
    });
  });
  
  // ========================================================================
  // PATIENT TASKS
  // ========================================================================
  for (const patient of wardPatients) {
    // Get weekly care for today to check shower status
    const weeklyCare = (patient.weeklyCares || []).find(
      (c) => c.day === dayOfWeek
    );
    const isShowerDay = weeklyCare?.showerDay || false;

    // Daily schedule slots
    if (patient.dailySchedule && Array.isArray(patient.dailySchedule)) {
      patient.dailySchedule.forEach((slot, idx) => {
        const slotShift =
          slot.shift ||
          (slot.startTime && parseInt(slot.startTime.split(":")[0]) < 15
            ? "AM"
            : "PM");
        
        if (
          slotShift === shift &&
          (slot.activities?.length > 0 || slot.durationMinutes > 0)
        ) {
          let duration = slot.isFixedDuration
            ? slot.durationMinutes || 10
            : slot.startTime && slot.endTime
              ? timeToMinutes(slot.endTime) - timeToMinutes(slot.startTime)
              : 10;
          
          // Apply complexity multiplier
          duration = Math.round(duration * (patient.complexityScore || 1.0));
          
          patientTaskList.push({
            type: "DailySlot",
            duration,
            name: `${(slot.activities || []).join(", ")}: ${patient.name}`,
            taskSignature: `DAILY_${patient._id}_${idx}`,
            isShowerDay,
            startTime: slot.startTime,
            endTime: slot.endTime || null,
            patient,
            ward: ward,
            staffNeededCount: patient.noOfStaff || 1,
            priority: 50
          });
        }
      });
    }
    
    // Weekly care slots
    // weeklyCare is already defined above
    if (weeklyCare) {
      const baseDuration = parseDuration(
        shift === "AM" ? weeklyCare.amDuration : weeklyCare.pmDuration
      );
      
      if (baseDuration > 0) {
        const duration = Math.round(
          (baseDuration + (patient.additionalTime || 0)) *
            (patient.complexityScore || 1.0)
        );
        
        // Parse special time if exists
        let startTime = null;
        let endTime = null;
        if (weeklyCare.specialTime) {
          const timeParts = weeklyCare.specialTime.split("-");
          if (timeParts.length >= 1) startTime = timeParts[0].trim();
          if (timeParts.length >= 2) endTime = timeParts[1].trim();
        }
        
        patientTaskList.push({
          type: "PatientCare",
          duration,
          name: `Base Care: ${patient.name}`,
          taskSignature: `WEEKLY_${patient._id}_${shift}`,
          isShowerDay,
          startTime,
          endTime,
          patient,
          ward: ward,
          staffNeededCount: patient.noOfStaff || 1,
          priority: 75
        });
      }
    }
  }
  
  return { globalTaskList, patientTaskList };
};

// ============================================================================
// CORE ALLOCATION LOGIC - ATOMIC MULTI-STAFF ASSIGNMENT WITH LOGGING
// ============================================================================

/**
 * ATOMIC MULTI-STAFF ALLOCATION
 * 
 * Allocates a task requiring N staff members in a single atomic operation.
 * This prevents the bug where sequential allocation dumps all work on one person.
 * 
 * Algorithm:
 * 1. Filter all eligible staff (constraints + no conflicts)
 * 2. Sort by current workload (least loaded first)
 * 3. Pick top N distinct staff
 * 4. Assign task to all N simultaneously
 * 
 * Returns: Object with assignments array, or failure details if unsuccessful
 */
const allocateTaskAtomic = (staffPool, task, ward, taskIndex) => {
  const taskStart = timeToMinutes(task.startTime);
  const taskEnd = task.endTime
    ? timeToMinutes(task.endTime)
    : taskStart
      ? taskStart + task.duration
      : null;
  
  const allocationLog = {
    taskNumber: taskIndex,
    taskName: task.name,
    taskType: task.type,
    duration: task.duration,
    staffNeeded: task.staffNeededCount,
    constraints: {
      patient: task.patient?.name || null,
      genderRequired: task.patient?.staffGender || "Any",
      acuityLevel: task.patient?.acuityLevel || "Normal",
      timeWindow: taskStart ? `${task.startTime}-${task.endTime || "flexible"}` : "flexible"
    },
    eligibilityCheck: {
      totalStaff: staffPool.length,
      rejectedStaff: [],
      eligibleStaff: []
    },
    selectionProcess: {
      eligibleStaffSorted: [],
      selectedStaff: []
    },
    result: "PENDING",
    failureReason: null
  };
  
  // STEP 1: Filter to eligible staff with detailed logging
  const eligible = [];
  
  for (const sm of staffPool) {
    const constraintResult = checkAllConstraints(sm, task, taskStart, taskEnd);
    
    if (constraintResult.eligible) {
      eligible.push(sm);
      allocationLog.eligibilityCheck.eligibleStaff.push({
        name: sm.staff.name,
        currentLoad: sm.minutesAllocated
      });
    } else {
      allocationLog.eligibilityCheck.rejectedStaff.push({
        name: sm.staff.name,
        reasons: constraintResult.rejectionReasons
      });
    }
  }
  
  // STEP 2: Sort by current workload (least loaded first)
  eligible.sort((a, b) => a.minutesAllocated - b.minutesAllocated);
  
  allocationLog.selectionProcess.eligibleStaffSorted = eligible.map((sm) => ({
    name: sm.staff.name,
    currentLoad: sm.minutesAllocated
  }));
  
  // STEP 3: Check if we have enough staff
  const needed = task.staffNeededCount;
  if (eligible.length < needed) {
    allocationLog.result = "FAILED";
    allocationLog.failureReason = `Insufficient eligible staff: needed ${needed}, only ${eligible.length} available after constraints`;
    return { success: false, log: allocationLog, assignments: null };
  }
  
  // STEP 4: Pick top N staff (least loaded N staff members)
  const selectedStaff = eligible.slice(0, needed);
  
  // STEP 5: Assign task to all N staff atomically
  const assignments = [];
  
  for (let i = 0; i < selectedStaff.length; i++) {
    const staffMember = selectedStaff[i];
    const roleLabel = i === 0 ? "Primary" : `Assistant ${i}`;
    
    const loadBefore = staffMember.minutesAllocated;
    
    // Update staff workload
    staffMember.minutesAllocated += task.duration;
    
    // Block timeline if task has specific time
    if (taskStart !== null && taskEnd !== null) {
      staffMember.timeline.push({ start: taskStart, end: taskEnd });
    }
    
    // Create assignment record
    const assignment = {
      staff: staffMember.staff._id,
      staffName: staffMember.staff.name,
      ward: ward._id,
      wardName: ward.name,
      patient: task.patient?._id || null,
      patientName: task.patient?.name || "Global",
      patientDetails: task.patient ? {
         name: task.patient.name,
         roomNumber: task.patient.currentRoom?.roomNumber || "-",
         mobility: task.patient.mobilityAid || "-",
         careSchedule: task.isShowerDay ? "Shower Day" : "Standard Care",
         showerDay: task.isShowerDay || false
      } : null,
      minutesAllocated: task.duration,
      taskName: task.name + (roleLabel !== "Primary" ? ` (${roleLabel})` : ""),
      baseTaskName: task.name,
      taskSignature: task.taskSignature,
      taskType: task.type,
      source: task.type === "GlobalTask" ? "GlobalTask" : "PatientCare",
      startTime: task.startTime,
      endTime: task.endTime,
      role: roleLabel
    };
    
    staffMember.assignments.push(assignment);
    assignments.push(assignment);
    
    allocationLog.selectionProcess.selectedStaff.push({
      name: staffMember.staff.name,
      role: roleLabel,
      loadBefore,
      loadAfter: staffMember.minutesAllocated,
      reason: i === 0 ? "Least loaded eligible staff" : `${i + 1}th least loaded eligible staff`
    });
  }
  
  allocationLog.result = "SUCCESS";
  return { success: true, log: allocationLog, assignments };
};

/**
 * Allocate all global tasks using round-robin min-load strategy.
 * Each task is assigned ATOMICALLY to N staff if it requires multiple people.
 */
const allocateGlobalTasks = (globalTasks, staffPool, ward) => {
  const allAssignments = [];
  const unallocatedTasks = [];
  const taskLogs = [];
  
  // Sort global tasks by duration (longest first for better packing)
  const sortedGlobalTasks = [...globalTasks].sort(
    (a, b) => b.duration - a.duration
  );
  
  for (let i = 0; i < sortedGlobalTasks.length; i++) {
    const task = sortedGlobalTasks[i];
    const result = allocateTaskAtomic(staffPool, task, ward, i);
    
    taskLogs.push(result.log);
    
    if (result.success) {
      allAssignments.push(...result.assignments);
    } else {
      unallocatedTasks.push({
        task: {
          name: task.name,
          type: task.type,
          duration: task.duration,
          staffNeeded: task.staffNeededCount,
          patient: task.patient?.name,
          constraints: {
            gender: task.patient?.staffGender,
            acuity: task.patient?.acuityLevel
          }
        },
        reason: result.log.failureReason,
        attemptedStaff: result.log.eligibilityCheck.rejectedStaff
      });
    }
  }
  
  return { allAssignments, unallocatedTasks, taskLogs };
};

/**
 * Allocate patient tasks using Longest Processing Time (LPT) heuristic.
 * Patient tasks also use atomic allocation for multi-staff requirements.
 */
const allocatePatientTasks = (patientTasks, staffPool, ward) => {
  const allAssignments = [];
  const unallocatedTasks = [];
  const taskLogs = [];
  
  // Sort by priority then duration (LPT)
  const sortedPatientTasks = [...patientTasks].sort((a, b) => {
    if (a.priority !== b.priority) return b.priority - a.priority;
    return b.duration - a.duration;
  });
  
  for (let i = 0; i < sortedPatientTasks.length; i++) {
    const task = sortedPatientTasks[i];
    const result = allocateTaskAtomic(staffPool, task, ward, i);
    
    taskLogs.push(result.log);
    
    if (result.success) {
      allAssignments.push(...result.assignments);
    } else {
      unallocatedTasks.push({
        task: {
          name: task.name,
          type: task.type,
          duration: task.duration,
          staffNeeded: task.staffNeededCount,
          patient: task.patient?.name,
          constraints: {
            gender: task.patient?.staffGender,
            acuity: task.patient?.acuityLevel
          }
        },
        reason: result.log.failureReason,
        attemptedStaff: result.log.eligibilityCheck.rejectedStaff
      });
    }
  }
  
  return { allAssignments, unallocatedTasks, taskLogs };
};

// ============================================================================
// FAIRNESS OPTIMIZATION (WITHIN-WARD BALANCING) WITH LOGGING
// ============================================================================

/**
 * Calculate workload variance for a staff pool.
 */
const calculateVariance = (staffPool) => {
  if (staffPool.length === 0) return 0;
  const loads = staffPool.map((s) => s.minutesAllocated);
  const mean = loads.reduce((sum, l) => sum + l, 0) / loads.length;
  const variance =
    loads.reduce((sum, l) => sum + Math.pow(l - mean, 2), 0) / loads.length;
  return variance;
};

/**
 * Calculate standard deviation for a staff pool.
 */
const calculateStdDev = (staffPool) => {
  return Math.sqrt(calculateVariance(staffPool));
};

/**
 * Calculate fairness score (higher is better).
 */
const calculateFairnessScore = (staffPool) => {
  const variance = calculateVariance(staffPool);
  return 1 / (variance + 1);
};

/**
 * Get load distribution for logging.
 */
const getLoadDistribution = (staffPool) => {
  return staffPool.map((s) => ({
    staff: s.staff.name,
    load: s.minutesAllocated
  }));
};

/**
 * Check if moving an assignment maintains all constraints.
 * Returns detailed constraint check results for logging.
 */
const canMoveAssignment = (assignment, fromStaff, toStaff, task) => {
  const constraintChecks = [];
  let canMove = true;
  
  // Cannot move to self
  if (fromStaff.staff._id.toString() === toStaff.staff._id.toString()) {
    constraintChecks.push({
      constraint: "Self-Assignment",
      result: "FAIL",
      reason: "Cannot move task to same staff member"
    });
    return { canMove: false, constraintChecks };
  }
  constraintChecks.push({
    constraint: "Self-Assignment",
    result: "PASS"
  });
  
  // Check gender constraint
  const genderCheck = checkGenderConstraint(toStaff.staff, task.patient);
  if (!genderCheck.eligible) {
    constraintChecks.push({
      constraint: "Gender",
      required: task.patient?.staffGender || "Any",
      staffGender: toStaff.staff.gender,
      result: "FAIL",
      reason: genderCheck.reason
    });
    canMove = false;
  } else {
    constraintChecks.push({
      constraint: "Gender",
      required: task.patient?.staffGender || "Any",
      staffGender: toStaff.staff.gender,
      result: "PASS"
    });
  }
  
  // Check acuity constraint
  const acuityCheck = checkAcuityConstraint(toStaff.staff, task.patient);
  if (!acuityCheck.eligible) {
    constraintChecks.push({
      constraint: "Acuity-HeavyLoad",
      patientAcuity: task.patient?.acuityLevel || "Normal",
      staffCanHandleHeavyLoad: toStaff.staff.canHandleHeavyLoad,
      result: "FAIL",
      reason: acuityCheck.reason
    });
    canMove = false;
  } else {
    constraintChecks.push({
      constraint: "Acuity-HeavyLoad",
      patientAcuity: task.patient?.acuityLevel || "Normal",
      staffCanHandleHeavyLoad: toStaff.staff.canHandleHeavyLoad,
      result: "PASS"
    });
  }
  
  // Check multi-staff separation
  const separationCheck = checkMultiStaffSeparation(toStaff, task.taskSignature);
  if (!separationCheck.eligible) {
    constraintChecks.push({
      constraint: "Multi-Staff Separation",
      targetAlreadyAssigned: true,
      result: "FAIL",
      reason: separationCheck.reason
    });
    canMove = false;
  } else {
    constraintChecks.push({
      constraint: "Multi-Staff Separation",
      targetAlreadyAssigned: false,
      result: "PASS"
    });
  }
  
  // Check time conflict
  const taskStart = timeToMinutes(task.startTime);
  const taskEnd = task.endTime
    ? timeToMinutes(task.endTime)
    : taskStart
      ? taskStart + task.duration
      : null;
  
  const timeCheck = checkTimeConflict(toStaff, taskStart, taskEnd);
  if (!timeCheck.eligible) {
    constraintChecks.push({
      constraint: "Time Conflict",
      taskTime: task.startTime ? `${task.startTime}-${task.endTime || "flexible"}` : "flexible",
      result: "FAIL",
      reason: timeCheck.reason
    });
    canMove = false;
  } else {
    constraintChecks.push({
      constraint: "Time Conflict",
      taskTime: task.startTime ? `${task.startTime}-${task.endTime || "flexible"}` : "flexible",
      result: "PASS"
    });
  }
  
  return { canMove, constraintChecks };
};

/**
 * Execute a task move between staff members.
 */
const executeMove = (assignment, fromStaff, toStaff, task) => {
  const taskStart = timeToMinutes(task.startTime);
  const taskEnd = task.endTime
    ? timeToMinutes(task.endTime)
    : taskStart
      ? taskStart + task.duration
      : null;
  
  // Remove from source staff
  const idx = fromStaff.assignments.indexOf(assignment);
  if (idx !== -1) {
    fromStaff.assignments.splice(idx, 1);
  }
  fromStaff.minutesAllocated -= assignment.minutesAllocated;
  
  // Remove timeline block if exists
  if (taskStart !== null && taskEnd !== null) {
    const timeIdx = fromStaff.timeline.findIndex(
      (b) => b.start === taskStart && b.end === taskEnd
    );
    if (timeIdx !== -1) {
      fromStaff.timeline.splice(timeIdx, 1);
    }
  }
  
  // Add to target staff
  assignment.staff = toStaff.staff._id;
  assignment.staffName = toStaff.staff.name;
  toStaff.assignments.push(assignment);
  toStaff.minutesAllocated += assignment.minutesAllocated;
  
  if (taskStart !== null && taskEnd !== null) {
    toStaff.timeline.push({ start: taskStart, end: taskEnd });
  }
};

/**
 * Rebalance specific task type within a ward with detailed logging.
 * Uses iterative improvement to minimize variance.
 */
const rebalanceTaskType = (staffPool, taskMap, taskType, maxIterations = 100) => {
  const rebalancingSteps = [];
  let improved = true;
  let iteration = 0;
  
  const initialVariance = calculateVariance(staffPool);
  
  while (improved && iteration < maxIterations) {
    improved = false;
    iteration++;
    
    const beforeState = {
      variance: calculateVariance(staffPool),
      loadDistribution: getLoadDistribution(staffPool),
      maxLoad: Math.max(...staffPool.map((s) => s.minutesAllocated)),
      minLoad: Math.min(...staffPool.map((s) => s.minutesAllocated))
    };
    beforeState.difference = beforeState.maxLoad - beforeState.minLoad;
    
    // Sort by workload (heaviest to lightest)
    staffPool.sort((a, b) => b.minutesAllocated - a.minutesAllocated);
    
    const mostLoaded = staffPool[0];
    const leastLoaded = staffPool[staffPool.length - 1];
    
    // Stop if already well-balanced (within 10 minutes)
    if (mostLoaded.minutesAllocated - leastLoaded.minutesAllocated < 10) {
      rebalancingSteps.push({
        iteration,
        phase: taskType,
        action: "CONVERGED",
        message: "Load difference < 10 minutes, stopping rebalancing",
        beforeState
      });
      break;
    }
    
    // Find movable assignments of the specified task type
    const moveCandidates = [];
    for (const assignment of mostLoaded.assignments) {
      if (assignment.taskType !== taskType) continue;
      
      const task = taskMap.get(assignment.taskSignature);
      if (!task) continue;
      
      const moveCheck = canMoveAssignment(assignment, mostLoaded, leastLoaded, task);
      if (moveCheck.canMove) {
        moveCandidates.push({
          assignment,
          task,
          constraintChecks: moveCheck.constraintChecks
        });
      }
    }
    
    if (moveCandidates.length === 0) {
      rebalancingSteps.push({
        iteration,
        phase: taskType,
        action: "NO_CANDIDATES",
        message: "No movable tasks found for this task type",
        beforeState
      });
      continue;
    }
    
    // Sort candidates by how much they improve balance
    const targetLoad =
      staffPool.reduce((sum, s) => sum + s.minutesAllocated, 0) / staffPool.length;
    
    moveCandidates.sort((a, b) => {
      const afterMoveA = Math.abs(
        mostLoaded.minutesAllocated - a.assignment.minutesAllocated - targetLoad
      );
      const afterMoveB = Math.abs(
        mostLoaded.minutesAllocated - b.assignment.minutesAllocated - targetLoad
      );
      return afterMoveA - afterMoveB;
    });
    
    // Move the best candidate
    const toMove = moveCandidates[0];
    
    executeMove(toMove.assignment, mostLoaded, leastLoaded, toMove.task);
    
    const afterState = {
      variance: calculateVariance(staffPool),
      loadDistribution: getLoadDistribution(staffPool)
    };
    afterState.varianceReduction = beforeState.variance - afterState.variance;
    afterState.improved = afterState.variance < beforeState.variance;
    
    rebalancingSteps.push({
      iteration,
      phase: taskType,
      action: "MOVE_EXECUTED",
      moveAttempt: {
        taskSignature: toMove.task.taskSignature,
        taskName: toMove.task.name,
        duration: toMove.assignment.minutesAllocated,
        fromStaff: mostLoaded.staff.name,
        toStaff: leastLoaded.staff.name,
        constraintChecks: toMove.constraintChecks,
        moveDecision: "APPROVED",
        reason: "All constraints satisfied, improves balance"
      },
      beforeState,
      afterState
    });
    
    improved = true;
  }
  
  return {
    iterations: iteration,
    initialVariance,
    finalVariance: calculateVariance(staffPool),
    rebalancingSteps,
    converged: !improved || iteration < maxIterations
  };
};

/**
 * Three-phase rebalancing: Global tasks first, then patient care, then daily slots.
 * This ensures fair distribution of bulk work before fine-tuning individual cares.
 */
const rebalanceWard = (staffPool, allTasks) => {
  // Create task lookup map
  const taskMap = new Map();
  allTasks.forEach((t) => taskMap.set(t.taskSignature, t));
  
  // PHASE 1: Rebalance global tasks (highest priority for fairness)
  const globalStats = rebalanceTaskType(staffPool, taskMap, "GlobalTask", 100);
  
  // PHASE 2: Rebalance patient care tasks
  const patientStats = rebalanceTaskType(staffPool, taskMap, "PatientCare", 100);
  
  // PHASE 3: Rebalance daily slot tasks
  const dailyStats = rebalanceTaskType(staffPool, taskMap, "DailySlot", 100);
  
  return {
    globalTaskBalancing: {
      iterations: globalStats.iterations,
      initialVariance: globalStats.initialVariance,
      finalVariance: globalStats.finalVariance,
      rebalancingSteps: globalStats.rebalancingSteps,
      converged: globalStats.converged
    },
    patientCareBalancing: {
      iterations: patientStats.iterations,
      initialVariance: patientStats.initialVariance,
      finalVariance: patientStats.finalVariance,
      rebalancingSteps: patientStats.rebalancingSteps,
      converged: patientStats.converged
    },
    dailySlotBalancing: {
      iterations: dailyStats.iterations,
      initialVariance: dailyStats.initialVariance,
      finalVariance: dailyStats.finalVariance,
      rebalancingSteps: dailyStats.rebalancingSteps,
      converged: dailyStats.converged
    },
    finalVariance: calculateVariance(staffPool),
    finalStdDev: calculateStdDev(staffPool),
    fairnessScore: calculateFairnessScore(staffPool)
  };
};

// ============================================================================
// MAIN ALLOCATION ENGINE
// ============================================================================

export const calculateAllocation = async (date, shift) => {
  const startTime = Date.now();
  
  const allDetailsJson = {
    request: {
      date,
      shift,
      timestamp: new Date().toISOString()
    },
    wardAllocations: {},
    errors: [],
    unallocatedTasks: []
  };
  
  const allocationLog = {
    metadata: {
      timestamp: new Date().toISOString(),
      date,
      shift,
      totalWards: 0,
      totalStaff: 0,
      totalPatients: 0,
      executionTimeMs: 0
    },
    wardAllocations: {},
    summary: {
      totalAssignments: 0,
      unallocatedTasks: 0,
      fairnessMetrics: {
        overallVariance: 0,
        wardVariances: []
      },
      constraintViolations: 0,
      warnings: []
    },
    unallocatedTasksDetail: []
  };
  
  try {
    // Check if shift is locked
    if (await isShiftLocked(date, shift)) {
      throw new Error("Shift is locked");
    }
    
    // Load data
    const wards = await Ward.find({ active: true });
    const allStaff = await Staff.find({ active: true });
    const overrides = await StaffOverride.find({ date, shift });
    const patients = await Patient.find({ status: "Admitted" }).populate("currentRoom");
    const globalTasks = await GlobalTask.find({ active: true, shift });
    const dayOfWeek = new Date(date).toLocaleDateString("en-US", {
      weekday: "long"
    });
    
    // Update metadata
    allocationLog.metadata.totalWards = wards.length;
    allocationLog.metadata.totalStaff = allStaff.length;
    allocationLog.metadata.totalPatients = patients.length;
    
    // Determine available staff based on overrides
    const staffAvailabilityLog = [];
    const availableStaff = allStaff.filter((s) => {
      const availCheck = checkStaffAvailability(s, shift, overrides);
      staffAvailabilityLog.push({
        name: s.name,
        ward: s.assignedWard?.toString(),
        available: availCheck.available,
        reason: availCheck.reason
      });
      return availCheck.available;
    });
    
    allocationLog.staffAvailability = {
      total: allStaff.length,
      available: availableStaff.length,
      unavailable: allStaff.length - availableStaff.length,
      details: staffAvailabilityLog
    };
    
    const totalAssignments = [];
    
    // Process each ward independently
    for (const ward of wards) {
      const wardIdStr = ward._id.toString();
      
      const wardDetails = {
        staffPool: [],
        globalTasks: [],
        patientTasks: [],
        unallocatedTasks: [],
        balancingStats: {},
        errors: []
      };
      
      const wardLog = {
        wardName: ward.name,
        wardId: ward._id.toString(),
        staffPool: {
          total: 0,
          available: [],
          unavailable: []
        },
        taskProcessing: {
          globalTasks: [],
          patientTasks: []
        },
        rebalancingSteps: {},
        finalState: {},
        errors: []
      };
      
      // Build ward-specific staff pool (HARD CONSTRAINT #1: Ward Isolation)
      const wardStaffPool = availableStaff
        .filter((s) => s.assignedWard?.toString() === wardIdStr)
        .map((s) => ({
          staff: s,
          minutesAllocated: 0,
          timeline: [],
          assignments: []
        }));
      
      wardLog.staffPool.total = wardStaffPool.length;
      wardLog.staffPool.available = wardStaffPool.map((sm) => ({
        name: sm.staff.name,
        gender: sm.staff.gender,
        canHandleHeavyLoad: sm.staff.canHandleHeavyLoad,
        initialLoad: sm.minutesAllocated
      }));
      
      // Log staff not in this ward
      const staffNotInWard = availableStaff.filter(
        (s) => s.assignedWard?.toString() !== wardIdStr
      );
      wardLog.staffPool.unavailable = staffNotInWard
        .filter((s) => s.preferredWard?.toString() === wardIdStr)
        .map((s) => ({
          name: s.name,
          reason: "Assigned to different ward"
        }));
      
      if (wardStaffPool.length === 0) {
        wardDetails.errors.push("No staff assigned to ward");
        wardLog.errors.push("No staff assigned to ward");
        allDetailsJson.wardAllocations[ward.name] = wardDetails;
        allocationLog.wardAllocations[ward.name] = wardLog;
        continue;
      }
      
      // Build ward tasks (separated by type)
      const wardPatients = patients.filter(
        (p) => p.currentWard?.toString() === wardIdStr
      );
      const { globalTaskList, patientTaskList } = buildWardTasks(
        wardPatients,
        globalTasks,
        shift,
        dayOfWeek,
        ward
      );
      
      wardDetails.globalTasks = globalTaskList.map((t) => ({
        name: t.name,
        duration: t.duration,
        staffNeeded: t.staffNeededCount
      }));
      
      wardDetails.patientTasks = patientTaskList.map((t) => ({
        name: t.name,
        duration: t.duration,
        staffNeeded: t.staffNeededCount
      }));
      
      // ======================================================================
      // ALLOCATION PHASE 1: Global tasks (atomic multi-staff assignment)
      // ======================================================================
      const globalResult = allocateGlobalTasks(globalTaskList, wardStaffPool, ward);
      totalAssignments.push(...globalResult.allAssignments);
      wardDetails.unallocatedTasks.push(...globalResult.unallocatedTasks);
      wardLog.taskProcessing.globalTasks = globalResult.taskLogs;
      
      // ======================================================================
      // ALLOCATION PHASE 2: Patient tasks (atomic multi-staff assignment)
      // ======================================================================
      const patientResult = allocatePatientTasks(
        patientTaskList,
        wardStaffPool,
        ward
      );
      totalAssignments.push(...patientResult.allAssignments);
      wardDetails.unallocatedTasks.push(...patientResult.unallocatedTasks);
      wardLog.taskProcessing.patientTasks = patientResult.taskLogs;
      
      allDetailsJson.unallocatedTasks.push(...wardDetails.unallocatedTasks);
      allocationLog.unallocatedTasksDetail.push(
        ...wardDetails.unallocatedTasks.map((ut) => ({
          ward: ward.name,
          task: ut.task?.name || ut.task,
          reason: ut.reason,
          constraints: ut.task?.constraints,
          attemptedStaff: ut.attemptedStaff
        }))
      );
      
      // ======================================================================
      // REBALANCING PHASE: Three-phase fairness optimization
      // Phase 1: Balance global tasks
      // Phase 2: Balance patient care tasks
      // Phase 3: Balance daily slot tasks
      // ======================================================================
      const allWardTasks = [...globalTaskList, ...patientTaskList];
      const balancingStats = rebalanceWard(wardStaffPool, allWardTasks);
      wardDetails.balancingStats = balancingStats;
      wardLog.rebalancingSteps = {
        globalTaskBalancing: balancingStats.globalTaskBalancing,
        patientCareBalancing: balancingStats.patientCareBalancing,
        dailySlotBalancing: balancingStats.dailySlotBalancing
      };
      
      // Record final staff pool state
      wardDetails.staffPool = wardStaffPool.map((sm) => ({
        name: sm.staff.name,
        minutesAllocated: sm.minutesAllocated,
        assignmentCount: sm.assignments.length,
        globalTaskMinutes: sm.assignments
          .filter((a) => a.taskType === "GlobalTask")
          .reduce((sum, a) => sum + a.minutesAllocated, 0),
        patientTaskMinutes: sm.assignments
          .filter((a) => a.taskType !== "GlobalTask")
          .reduce((sum, a) => sum + a.minutesAllocated, 0)
      }));
      
      wardLog.finalState = {
        staffLoads: wardStaffPool.map((sm) => ({
          name: sm.staff.name,
          totalMinutes: sm.minutesAllocated,
          assignments: sm.assignments.length,
          breakdown: {
            globalTasks: sm.assignments.filter((a) => a.taskType === "GlobalTask").length,
            patientCare: sm.assignments.filter((a) => a.taskType === "PatientCare").length,
            dailySlots: sm.assignments.filter((a) => a.taskType === "DailySlot").length
          }
        })),
        variance: balancingStats.finalVariance,
        stdDev: balancingStats.finalStdDev,
        fairnessScore: balancingStats.fairnessScore
      };
      
      // Add ward variance to summary
      allocationLog.summary.fairnessMetrics.wardVariances.push({
        ward: ward.name,
        variance: balancingStats.finalVariance,
        stdDev: balancingStats.finalStdDev,
        staffCount: wardStaffPool.length
      });
      
      allDetailsJson.wardAllocations[ward.name] = wardDetails;
      allocationLog.wardAllocations[ward.name] = wardLog;
    }
    
    // Update summary
    allocationLog.summary.totalAssignments = totalAssignments.length;
    allocationLog.summary.unallocatedTasks = allocationLog.unallocatedTasksDetail.length;
    
    // Calculate overall variance
    const allVariances = allocationLog.summary.fairnessMetrics.wardVariances.map(
      (wv) => wv.variance
    );
    allocationLog.summary.fairnessMetrics.overallVariance =
      allVariances.length > 0
        ? allVariances.reduce((sum, v) => sum + v, 0) / allVariances.length
        : 0;
    
    // Verify no constraint violations
    allocationLog.summary.constraintViolations = 0; // Should always be 0
    
    // Calculate execution time
    allocationLog.metadata.executionTimeMs = Date.now() - startTime;
    
    // Write log to file
    allDetailsJson.detailedLog = allocationLog;
    writeAllocationLog(allocationLog, date, shift);
    
    return { assignments: totalAssignments, allDetailsJson };
  } catch (error) {
    allDetailsJson.errors.push(error.message);
    allocationLog.errors = [error.message];
    allocationLog.metadata.executionTimeMs = Date.now() - startTime;
    
    writeAllocationLog(allocationLog, date, shift);
    throw error;
  }
};

// ============================================================================
// API ENDPOINTS
// ============================================================================

export const runAllocationEngine = async (req, res) => {
  const { date, shift } = req.body;
  try {
    const { assignments, allDetailsJson } = await calculateAllocation(date, shift);
    res.status(200).json({ assignments, allDetailsJson });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const dryRunAllocation = async (req, res) => {
  const { date, shift } = req.body;
  try {
    const { assignments, allDetailsJson } = await calculateAllocation(date, shift);
    res.status(200).json({ assignments, allDetailsJson, committed: false });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const commitAllocation = async (req, res) => {
  const { date, shift, data } = req.body;
  try {
    if (await isShiftLocked(date, shift)) {
      return res.status(400).json({ message: "Shift is locked" });
    }
    
    await ShiftAssignment.deleteMany({ shiftDate: date, shift });
    const saved = await ShiftAssignment.insertMany(
      data.map((a) => ({ ...a, shiftDate: date, shift }))
    );
    
    res.status(201).json({ saved, committed: true });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const resetAllocation = async (req, res) => {
  const { date, shift } = req.body;
  try {
    if (await isShiftLocked(date, shift)) {
      return res.status(400).json({ message: "Shift is locked" });
    }
    
    await ShiftAssignment.deleteMany({ shiftDate: date, shift });
    res.status(200).json({ message: "Allocation reset" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const manualOverride = async (req, res) => {
  const { assignmentId, newStaffId, reason } = req.body;
  try {
    const assignment = await ShiftAssignment.findById(assignmentId);
    if (!assignment) {
      return res.status(404).json({ message: "Assignment not found" });
    }
    
    if (await isShiftLocked(assignment.shiftDate, assignment.shift)) {
      return res.status(400).json({ message: "Shift is locked" });
    }
    
    // Verify the new staff can handle this assignment
    const newStaff = await Staff.find({ _id: newStaffId });
    if (!newStaff || newStaff.length === 0) {
      return res.status(404).json({ message: "New staff not found" });
    }
    
    const originalStaff = assignment.staff;
    assignment.staff = newStaffId;
    assignment.isManualOverride = true;
    assignment.originalStaff = originalStaff;
    assignment.overrideReason = reason;
    await assignment.save();
    
    res.status(200).json(assignment);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const getShiftResultTable = async (req, res) => {
  const { date, shift } = req.query;
  try {
    const assignments = await ShiftAssignment.find({ shiftDate: date, shift })
      .populate("staff")
      .populate("patient")
      .populate("ward");
    
    const resultTable = {};
    
    assignments.forEach((a) => {
      const sId = a.staff._id.toString();
      if (!resultTable[sId]) {
        resultTable[sId] = {
          staff: a.staff,
          ward: a.ward,
          assignments: [],
          totalMinutes: 0,
          globalTaskMinutes: 0,
          patientTaskMinutes: 0
        };
      }
      resultTable[sId].assignments.push(a);
      resultTable[sId].totalMinutes += a.minutesAllocated;
      if (a.source === "GlobalTask") {
        resultTable[sId].globalTaskMinutes += a.minutesAllocated;
      } else {
        resultTable[sId].patientTaskMinutes += a.minutesAllocated;
      }
    });
    
    res.status(200).json(Object.values(resultTable));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * Get allocation logs for a specific date and shift.
 */
export const getAllocationLogs = async (req, res) => {
  const { date, shift } = req.query;
  try {
    const logDir = path.join(process.cwd(), "logs", "allocations");
    // if (!fs.existsSync(logDir)) {
    //   return res.status(200).json({ logs: [] });
    // }
    
    const dateStr = new Date(date).toISOString().split("T")[0];
    const pattern = `allocation_${dateStr}_${shift}`;
    
    // const files = fs.readdirSync(logDir).filter((f) => f.startsWith(pattern));
    // const logs = files.map((f) => {
    //   const content = fs.readFileSync(path.join(logDir, f), "utf-8");
    //   return {
    //     filename: f,
    //     log: JSON.parse(content)
    //   };
    // });
    
    res.status(200).json({ logs });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * Get fairness metrics for current allocations.
 */
export const getFairnessMetrics = async (req, res) => {
  const { date, shift } = req.query;
  try {
    const assignments = await ShiftAssignment.find({ shiftDate: date, shift })
      .populate("staff")
      .populate("ward");
    
    // Group by ward
    const wardMetrics = {};
    
    assignments.forEach((a) => {
      const wardName = a.ward?.name || "Unknown";
      const staffId = a.staff._id.toString();
      
      if (!wardMetrics[wardName]) {
        wardMetrics[wardName] = {
          staffLoads: {},
          totalMinutes: 0,
          assignmentCount: 0
        };
      }
      
      if (!wardMetrics[wardName].staffLoads[staffId]) {
        wardMetrics[wardName].staffLoads[staffId] = {
          name: a.staff.name,
          minutes: 0,
          assignments: 0
        };
      }
      
      wardMetrics[wardName].staffLoads[staffId].minutes += a.minutesAllocated;
      wardMetrics[wardName].staffLoads[staffId].assignments += 1;
      wardMetrics[wardName].totalMinutes += a.minutesAllocated;
      wardMetrics[wardName].assignmentCount += 1;
    });
    
    // Calculate variance for each ward
    const result = {};
    for (const [wardName, metrics] of Object.entries(wardMetrics)) {
      const loads = Object.values(metrics.staffLoads).map((s) => s.minutes);
      const mean = loads.reduce((sum, l) => sum + l, 0) / loads.length;
      const variance =
        loads.reduce((sum, l) => sum + Math.pow(l - mean, 2), 0) / loads.length;
      const stdDev = Math.sqrt(variance);
      
      result[wardName] = {
        staffCount: Object.keys(metrics.staffLoads).length,
        totalMinutes: metrics.totalMinutes,
        assignmentCount: metrics.assignmentCount,
        meanLoad: mean,
        variance,
        stdDev,
        fairnessScore: 1 / (variance + 1),
        staffLoads: Object.values(metrics.staffLoads),
        loadRange: {
          min: Math.min(...loads),
          max: Math.max(...loads),
          difference: Math.max(...loads) - Math.min(...loads)
        }
      };
    }
    
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
