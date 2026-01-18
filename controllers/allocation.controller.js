import { ShiftAssignment } from "../models/ShiftAssignment.js";
import { ShiftLock } from "../models/ShiftLock.js";
import { Staff } from "../models/Staff.js";
import { Patient } from "../models/Patient.js";
import { GlobalTask } from "../models/GlobalTask.js";
import { StaffOverride } from "../models/StaffOverride.js";
import { Ward } from "../models/Ward.js";
import fs from "fs";

// --- HELPERS ---
const parseDuration = (durationStr) => {
  if (!durationStr) return 0;
  if (typeof durationStr === 'number') return durationStr;
  const numbers = durationStr.match(/\d+/g);
  return numbers ? Math.max(...numbers.map(Number)) : 0;
};

const isShiftLocked = async (date, shift) => {
  const lock = await ShiftLock.findOne({ shiftDate: date, shift });
  return !!lock;
};

const isOverlapping = (start1, end1, start2, end2) => Math.max(start1, start2) < Math.min(end1, end2);

const timeToMins = (timeStr) => {
  if (!timeStr) return null;
  const [hrs, mins] = timeStr.split(':').map(Number);
  return hrs * 60 + mins;
};

// Calculate standard deviation for workload balance measurement
const calculateStdDev = (values) => {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
  return Math.sqrt(variance);
};

// --- CORE ENGINE ---
export const calculateAllocation = async (date, shift) => {
  const allDetailsJson = {
    request: { date, shift, timestamp: new Date().toISOString() },
    wardAllocations: {},
    errors: []
  };

  try {
    if (await isShiftLocked(date, shift)) throw new Error("Shift is locked");

    const wards = await Ward.find({ active: true });
    const allStaff = await Staff.find({ active: true });
    const overrides = await StaffOverride.find({ date, shift });
    const patients = await Patient.find({ status: "Admitted" }).populate('currentRoom');
    const globalTasks = await GlobalTask.find({ active: true, shift });
    const dayOfWeek = new Date(date).toLocaleDateString('en-US', { weekday: 'long' });

    const availableStaff = allStaff.filter(s => {
      const override = overrides.find(o => o.staff.toString() === s._id.toString());
      if (override && override.status === "Unavailable") return false;
      if (!override) {
        if (shift === "AM" && !s.availability.am) return false;
        if (shift === "PM" && !s.availability.pm) return false;
      }
      return true;
    });

    const totalAssignments = [];

    for (const ward of wards) {
      const wardIdStr = ward._id.toString();
      allDetailsJson.wardAllocations[ward.name] = { 
        staffPool: [], 
        sortedQueue: [],
        allocationLog: [],
        rebalancingLog: []
      };

      const wardStaffPool = availableStaff
        .filter(s => s.assignedWard?.toString() === wardIdStr)
        .map(s => ({
          staff: { _id: s._id, name: s.name, maxMinutes: s.maxMinutesPerShift },
          minutesAllocated: 0,
          timeline: [],
          assignments: []
        }));

      if (wardStaffPool.length === 0) {
        allDetailsJson.wardAllocations[ward.name].allocationLog.push("⚠️ No staff assigned to this ward");
        continue;
      }

      allDetailsJson.wardAllocations[ward.name].allocationLog.push(
        `✓ Ward has ${wardStaffPool.length} staff members: ${wardStaffPool.map(s => s.staff.name).join(', ')}`
      );

      const wardPatients = patients.filter(p => p.currentWard?.toString() === wardIdStr);
      let wardTasks = [];

      // 1. Task Collection (Global + Patient Daily + Patient Weekly)
      globalTasks.forEach(gt => {
        const totalWardTime = (gt.durationMinutes || 10) * wardPatients.length;
        const chunks = Math.ceil(totalWardTime / 60);
        const chunkDuration = Math.ceil(totalWardTime / chunks);
        for (let i = 0; i < chunks; i++) {
          wardTasks.push({ 
            type: "GlobalTask", 
            duration: chunkDuration, 
            name: `${gt.name} (Grp ${i+1})`, 
            startTime: gt.startTime || null, 
            staffNeededCount: gt.requiredStaff || 1,
            priority: 1 // Lower priority for global tasks
          });
        }
      });

      for (const patient of wardPatients) {
        let hasDaily = false;
        if (patient.dailySchedule?.length > 0) {
          patient.dailySchedule.forEach(slot => {
            const slotShift = slot.shift || (slot.startTime && (parseInt(slot.startTime.split(':')[0]) < 15 ? 'AM' : 'PM'));
            if (slotShift === shift && (slot.activities?.length > 0 || slot.durationMinutes > 0)) {
              hasDaily = true;
              let dur = slot.isFixedDuration ? (slot.durationMinutes || 10) : (slot.startTime && slot.endTime ? (timeToMins(slot.endTime) - timeToMins(slot.startTime)) : 10);
              wardTasks.push({ 
                type: "DailySlot", 
                duration: Math.round(dur * (patient.complexityScore || 1.0)), 
                name: `${slot.activities.join(", ")}: ${patient.name}`, 
                patient, 
                startTime: slot.startTime, 
                endTime: slot.endTime || null, 
                staffNeededCount: patient.noOfStaff || 1,
                priority: 3 // Higher priority for timed patient care
              });
            }
          });
        }
        const weekly = patient.weeklyCares?.find(c => c.day === dayOfWeek);
        if (weekly) {
          const dur = parseDuration(shift === "AM" ? weekly.amDuration : weekly.pmDuration);
          if (dur > 0) {
            wardTasks.push({ 
              type: "PatientCare", 
              duration: Math.round((dur + (patient.additionalTime || 0)) * (patient.complexityScore || 1.0)), 
              name: `Base Care: ${patient.name}`, 
              patient, 
              startTime: weekly.specialTime?.split('-')[0] || null, 
              endTime: weekly.specialTime?.split('-')[1] || null, 
              staffNeededCount: patient.noOfStaff || 1,
              priority: 2 // Medium priority for weekly care
            });
          }
        }
      }

      // 2. Enhanced Sorting - PURE DURATION-BASED (Longest Processing Time First)
      // Remove priority-based sorting to ensure optimal bin-packing
      const wardQueue = wardTasks.sort((a, b) => {
        // Sort ONLY by duration (longer first - LPT algorithm)
        return b.duration - a.duration;
      });

      allDetailsJson.wardAllocations[ward.name].allocationLog.push(
        `✓ Total tasks to allocate: ${wardQueue.length}`,
        `✓ Total minutes: ${wardQueue.reduce((sum, t) => sum + t.duration * (t.staffNeededCount || 1), 0)}`,
        `✓ Task breakdown: ${wardQueue.map(t => `${t.name} (${t.duration}m)`).join(', ')}`
      );
      allDetailsJson.wardAllocations[ward.name].sortedQueue = wardQueue.map(t => ({
        name: t.name,
        duration: t.duration,
        type: t.type,
        priority: t.priority,
        staffNeeded: t.staffNeededCount || 1
      }));

      // 3. OPTIMIZED ALLOCATION with Balanced First-Fit
      let taskIndex = 0;
      const totalWorkload = wardQueue.reduce((sum, t) => sum + t.duration * (t.staffNeededCount || 1), 0);
      const targetLoadPerStaff = totalWorkload / wardStaffPool.length;
      
      allDetailsJson.wardAllocations[ward.name].allocationLog.push(
        `\n🎯 Target: ${targetLoadPerStaff.toFixed(1)}m per staff (Total: ${totalWorkload}m across ${wardStaffPool.length} staff)`
      );
      
      for (const task of wardQueue) {
        const allocationsNeeded = task.staffNeededCount || 1;
        
        allDetailsJson.wardAllocations[ward.name].allocationLog.push(
          `\n📋 Task ${taskIndex + 1}: ${task.name} (${task.duration}m) - Needs ${allocationsNeeded} staff`
        );
        
        for (let roleIndex = 0; roleIndex < allocationsNeeded; roleIndex++) {
          const role = roleIndex === 0 ? "Primary" : "Secondary";
          const duration = task.duration;
          const tStart = timeToMins(task.startTime);
          const tEnd = (tStart && !task.endTime) ? tStart + duration : timeToMins(task.endTime);

          // Find all eligible staff (capacity + no time conflicts)
          const eligibleStaff = wardStaffPool.filter(s => {
            if (s.minutesAllocated + duration > s.staff.maxMinutes) return false;
            if (tStart && tEnd) return !s.timeline.some(b => isOverlapping(b.start, b.end, tStart, tEnd));
            return true;
          });

          if (eligibleStaff.length === 0) {
            allDetailsJson.wardAllocations[ward.name].allocationLog.push(
              `  ❌ No eligible staff for ${role} (time conflict or capacity exceeded)`
            );
            continue;
          }

          allDetailsJson.wardAllocations[ward.name].allocationLog.push(
            `  → ${role}: ${eligibleStaff.length} eligible staff`
          );

          // ENHANCED SELECTION STRATEGY
          const scoredStaff = eligibleStaff.map(s => {
            const loadAfterAssignment = s.minutesAllocated + duration;
            
            // Calculate what the loads would be after this assignment
            const allLoadsAfter = wardStaffPool.map(staff => 
              staff.staff._id.toString() === s.staff._id.toString() 
                ? loadAfterAssignment 
                : staff.minutesAllocated
            );
            
            const maxLoadAfter = Math.max(...allLoadsAfter);
            const minLoadAfter = Math.min(...allLoadsAfter);
            const gapAfter = maxLoadAfter - minLoadAfter;
            
            // Distance from target load
            const distanceFromTarget = Math.abs(loadAfterAssignment - targetLoadPerStaff);
            
            // Calculate variance (measure of balance)
            const mean = allLoadsAfter.reduce((a, b) => a + b, 0) / allLoadsAfter.length;
            const variance = allLoadsAfter.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0);
            
            // NEW: Penalize if this would prevent future assignments
            // (i.e., if assigning here leaves no room for remaining large tasks)
            const remainingCapacity = s.staff.maxMinutes - loadAfterAssignment;
            const remainingTasks = wardQueue.slice(taskIndex + 1);
            const largestRemainingTask = remainingTasks.length > 0 
              ? Math.max(...remainingTasks.map(t => t.duration)) 
              : 0;
            const capacityPenalty = remainingCapacity < largestRemainingTask ? 1000000 : 0;
            
            // Score: minimize gap (most important), then distance from target, then variance
            const score = capacityPenalty + gapAfter * 10000 + distanceFromTarget * 100 + variance;
            
            return { 
              staff: s, 
              score, 
              loadAfter: loadAfterAssignment,
              gapAfter,
              distanceFromTarget: distanceFromTarget.toFixed(1),
              remainingCapacity
            };
          });

          // Select staff with best (lowest) score
          scoredStaff.sort((a, b) => a.score - b.score);
          const best = scoredStaff[0];
          const selectedStaff = best.staff;

          allDetailsJson.wardAllocations[ward.name].allocationLog.push(
            `  ✓ Assigned to ${selectedStaff.staff.name}: ${selectedStaff.minutesAllocated}m → ${best.loadAfter}m (gap will be ${best.gapAfter}m, target distance: ${best.distanceFromTarget}m, capacity left: ${best.remainingCapacity}m)`
          );

          selectedStaff.minutesAllocated += duration;
          if (tStart && tEnd) selectedStaff.timeline.push({ start: tStart, end: tEnd });
          
          const assignment = {
            staff: selectedStaff.staff._id, 
            staffName: selectedStaff.staff.name, 
            ward: ward._id, 
            wardName: ward.name,
            patient: task.patient?._id || null, 
            minutesAllocated: duration,
            taskName: task.name + (role === "Secondary" ? " (Assist)" : ""), 
            source: task.type === "GlobalTask" ? "GlobalTask" : "PatientCare"
          };
          
          selectedStaff.assignments.push(assignment);
          totalAssignments.push(assignment);
        }
        taskIndex++;
      }

      // Log initial allocation results
      allDetailsJson.wardAllocations[ward.name].allocationLog.push(
        `\n📊 Initial Allocation Complete:`,
        ...wardStaffPool.map(s => `  ${s.staff.name}: ${s.minutesAllocated}m (${s.assignments.length} tasks)`)
      );

      // 4. AGGRESSIVE MULTI-PASS RE-BALANCING
      const MAX_REBALANCE_ITERATIONS = 20;
      const TARGET_BALANCE_THRESHOLD = 3; // Tighter threshold
      
      allDetailsJson.wardAllocations[ward.name].rebalancingLog.push(
        `\n🔄 Starting Re-balancing (Target gap: ≤${TARGET_BALANCE_THRESHOLD}m)`
      );
      
      let improved = true;
      let iteration = 0;
      
      while (improved && iteration < MAX_REBALANCE_ITERATIONS) {
        improved = false;
        iteration++;
        
        wardStaffPool.sort((a, b) => b.minutesAllocated - a.minutesAllocated);
        
        const currentLoads = wardStaffPool.map(s => `${s.staff.name}:${s.minutesAllocated}m`).join(', ');
        allDetailsJson.wardAllocations[ward.name].rebalancingLog.push(
          `\n  Iteration ${iteration}: ${currentLoads}`
        );
        
        // Try to balance between most and least busy
        for (let i = 0; i < wardStaffPool.length; i++) {
          const busyStaff = wardStaffPool[i];
          
          for (let j = wardStaffPool.length - 1; j > i; j--) {
            const idleStaff = wardStaffPool[j];
            const currentGap = busyStaff.minutesAllocated - idleStaff.minutesAllocated;
            
            if (currentGap <= TARGET_BALANCE_THRESHOLD) {
              allDetailsJson.wardAllocations[ward.name].rebalancingLog.push(
                `    ✓ Balance achieved! Gap=${currentGap}m ≤ ${TARGET_BALANCE_THRESHOLD}m`
              );
              break;
            }
            
            allDetailsJson.wardAllocations[ward.name].rebalancingLog.push(
              `    Checking: ${busyStaff.staff.name}(${busyStaff.minutesAllocated}m) → ${idleStaff.staff.name}(${idleStaff.minutesAllocated}m), gap=${currentGap}m`
            );
            
            // Find tasks that can be moved to improve balance
            const candidateTasks = busyStaff.assignments
              .map((assignment, idx) => {
                const taskSize = assignment.minutesAllocated;
                const newBusyLoad = busyStaff.minutesAllocated - taskSize;
                const newIdleLoad = idleStaff.minutesAllocated + taskSize;
                const newGap = Math.abs(newBusyLoad - newIdleLoad);
                
                // Check capacity and improvement
                const canMove = newIdleLoad <= idleStaff.staff.maxMinutes && newGap < currentGap;
                
                return {
                  assignment,
                  idx,
                  taskSize,
                  newGap,
                  improvement: currentGap - newGap,
                  canMove
                };
              })
              .filter(t => t.canMove)
              .sort((a, b) => b.improvement - a.improvement);
            
            allDetailsJson.wardAllocations[ward.name].rebalancingLog.push(
              `      Found ${candidateTasks.length} movable tasks`
            );
            
            if (candidateTasks.length > 0) {
              // Move the task that gives best improvement
              const bestMove = candidateTasks[0];
              const taskToMove = bestMove.assignment;
              
              allDetailsJson.wardAllocations[ward.name].rebalancingLog.push(
                `      ✓ Moving "${taskToMove.taskName}" (${bestMove.taskSize}m): ${busyStaff.staff.name}(${busyStaff.minutesAllocated}m) → ${idleStaff.staff.name}(${idleStaff.minutesAllocated}m)`,
                `        New loads: ${busyStaff.staff.name}=${busyStaff.minutesAllocated - bestMove.taskSize}m, ${idleStaff.staff.name}=${idleStaff.minutesAllocated + bestMove.taskSize}m, gap=${bestMove.newGap}m`
              );
              
              // Update loads
              busyStaff.minutesAllocated -= bestMove.taskSize;
              idleStaff.minutesAllocated += bestMove.taskSize;
              
              // Update assignment
              taskToMove.staff = idleStaff.staff._id;
              taskToMove.staffName = idleStaff.staff.name;
              
              // Move to idle staff's assignments
              busyStaff.assignments.splice(bestMove.idx, 1);
              idleStaff.assignments.push(taskToMove);
              
              improved = true;
              break;
            }
          }
          
          if (improved) break; // Re-sort and try again
        }
        
        if (!improved) {
          allDetailsJson.wardAllocations[ward.name].rebalancingLog.push(
            `  ⚠️ No more improvements possible at iteration ${iteration}`
          );
        }
      }
      
      allDetailsJson.wardAllocations[ward.name].rebalancingLog.push(
        `\n✅ Re-balancing Complete after ${iteration} iterations`
      );

      // Log final balance metrics
      const finalLoads = wardStaffPool.map(s => s.minutesAllocated);
      const stdDev = calculateStdDev(finalLoads);
      const maxLoad = Math.max(...finalLoads);
      const minLoad = Math.min(...finalLoads);
      
      allDetailsJson.wardAllocations[ward.name].balanceMetrics = {
        standardDeviation: stdDev.toFixed(2),
        maxLoad,
        minLoad,
        loadGap: maxLoad - minLoad
      };
      
      allDetailsJson.wardAllocations[ward.name].staffPool = wardStaffPool.map(s => ({
        name: s.staff.name,
        totalMinutes: s.minutesAllocated,
        maxCapacity: s.staff.maxMinutes,
        utilizationPercent: ((s.minutesAllocated / s.staff.maxMinutes) * 100).toFixed(1),
        assignments: s.assignments.map(a => ({
          task: a.taskName,
          minutes: a.minutesAllocated
        }))
      }));
      
      allDetailsJson.wardAllocations[ward.name].allocationLog.push(
        `\n📈 Final Balance Metrics:`,
        `  Max Load: ${maxLoad}m`,
        `  Min Load: ${minLoad}m`,
        `  Gap: ${maxLoad - minLoad}m`,
        `  Std Dev: ${stdDev.toFixed(2)}`,
        `\n📋 Final Staff Assignments:`,
        ...wardStaffPool.map(s => 
          `  ${s.staff.name}: ${s.minutesAllocated}m / ${s.staff.maxMinutes}m (${((s.minutesAllocated / s.staff.maxMinutes) * 100).toFixed(1)}%) - ${s.assignments.length} tasks`
        )
      );
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

    await ShiftAssignment.deleteMany({ shiftDate: date, shift });

    const savedAssignments = await ShiftAssignment.insertMany(data.map(a => ({
      ...a,
      shiftDate: date,
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