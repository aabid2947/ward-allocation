import { Ward } from "../models/Ward.js";
import { Room } from "../models/Room.js";
import { Patient } from "../models/Patient.js";
import { PatientCareSchedule } from "../models/PatientCareSchedule.js";
import { GlobalTask } from "../models/GlobalTask.js";
// import { Ward } from "../models/Ward.js";
// import { Patient } from "../models/Patient.js";
import fs from "fs";
import path from "path";


// Get Facility Overview
export const getFacilityOverview = async (req, res) => {
  try {
    const wards = await Ward.find();
    const daysOfWeek = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
    const overview = [];

    for (const ward of wards) {
      const rooms = await Room.find({ ward: ward._id });
      const totalRooms = rooms.length;
      const totalCapacity = rooms.reduce((sum, r) => sum + (r.isDoubleRoom ? 2 : 1), 0);

      const occupants = await Patient.find({
        currentWard: ward._id,
        status: { $in: ["Admitted", "OnLeave"] }
      });

      // Calculate Total Care Minutes for this Ward for EACH day
      const weeklyLoad = {};

      for (const day of daysOfWeek) {
        let dailyMinutes = 0;
        for (const patient of occupants) {
          const schedules = await PatientCareSchedule.find({
            patient: patient._id,
            dayOfWeek: day
          });
          dailyMinutes += schedules.reduce((sum, s) => sum + s.durationMinutes, 0);
        }
        weeklyLoad[day] = dailyMinutes;
      }

      overview.push({
        ward: ward.name,
        wing: ward.wing,
        totalRooms,
        totalCapacity,
        occupants: occupants.length,
        occupancyRate: totalCapacity > 0 ? (occupants.length / totalCapacity) * 100 : 0,
        weeklyLoad // { Monday: 120, Tuesday: 140 ... }
      });
    }

    res.status(200).json(overview);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Configure Rooms (Bulk Create)
export const configureRooms = async (req, res) => {
  const { wardId, roomNumbers } = req.body; // roomNumbers is array of strings

  try {
    const ward = await Ward.findById(wardId);
    if (!ward) return res.status(404).json({ message: "Ward not found" });

    const createdRooms = [];
    for (const num of roomNumbers) {
      // Check if exists
      const exists = await Room.findOne({ ward: wardId, roomNumber: num });
      if (!exists) {
        const newRoom = new Room({
          ward: wardId,
          roomNumber: num,
          isDoubleRoom: false // Default, can be updated later
        });
        await newRoom.save();
        createdRooms.push(newRoom);
      }
    }

    res.status(201).json({ message: "Rooms configured", created: createdRooms.length, rooms: createdRooms });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Update System Constraints (Placeholder)
// In a real app, this might update a Settings document in DB
export const updateSystemConstraints = async (req, res) => {
  const settingsObject = req.body;
  try {
    // For now, just echo back. 
    // Implementation would involve a 'SystemSettings' model.
    console.log("Updating system constraints:", settingsObject);
    res.status(200).json({ message: "System constraints updated", settings: settingsObject });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// const parseDuration = (durationStr) => {
//   if (!durationStr) return 0;
//   if (typeof durationStr === 'number') return durationStr;
//   const numbers = durationStr.match(/\d+/g);
//   if (!numbers) return 0;
//   return Math.max(...numbers.map(Number)); 
// };

export const getWeeklyWorkload = async (req, res) => {
  try {
    const patients = await Patient.find({ status: "Admitted" }).populate('currentWard');
    const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

    const report = days.map(day => {
      let eastTotal = 0;
      let westTotal = 0;

      patients.forEach(p => {
        const care = p.weeklyCares?.find(c => c.day === day);
        const duration = parseDuration(care?.amDuration) + parseDuration(care?.pmDuration);

        if (p.currentWard && p.currentWard.wing === "East") eastTotal += duration;
        else if (p.currentWard && p.currentWard.wing === "West") westTotal += duration;
      });

      return { day, eastTotal, westTotal };
    });

    res.status(200).json(report);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Detailed Facility Overview
// export const getDetailedFacilityOverview = async (req, res) => {
//   try {
//     const wards = await Ward.find();
//     const daysOfWeek = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
//     const overview = [];

//     for (const ward of wards) {
//       const patients = await Patient.find({ currentWard: ward._id, status: "Admitted" });

//       const weeklyLoad = {};
//       daysOfWeek.forEach(day => weeklyLoad[day] = { am: 0, pm: 0 });

//       for (const patient of patients) {
//         // 1. Weekly Cares (Day specific)
//         if (patient.weeklyCares) {
//           patient.weeklyCares.forEach(care => {
//             const am = parseDuration(care.amDuration);
//             const pm = parseDuration(care.pmDuration);
//             if (weeklyLoad[care.day]) {
//               weeklyLoad[care.day].am += am;
//               weeklyLoad[care.day].pm += pm;
//             }
//           });
//         }

//         // 2. Daily Schedule (Applies to ALL days)
//         if (patient.dailySchedule) {
//           // Separate AM and PM total for daily schedule
//           let dailyAm = 0;
//           let dailyPm = 0;

//           patient.dailySchedule.forEach(slot => {
//             let duration = slot.durationMinutes || 0;
//             if (!slot.isFixedDuration && slot.startTime && slot.endTime) {
//                // Simple diff
//                const start = parseInt(slot.startTime.split(':')[0]) * 60 + parseInt(slot.startTime.split(':')[1]);
//                const end = parseInt(slot.endTime.split(':')[0]) * 60 + parseInt(slot.endTime.split(':')[1]);
//                duration = end - start;
//             }
//             duration = duration > 0 ? duration : 0;

//             // Determine shift if not set
//             const shift = slot.shift || (parseInt(slot.startTime?.split(':')[0]) < 13 ? 'AM' : 'PM');
//             if (shift === 'AM') dailyAm += duration;
//             else dailyPm += duration;
//           });

//           daysOfWeek.forEach(day => {
//             weeklyLoad[day].am += dailyAm;
//             weeklyLoad[day].pm += dailyPm;
//           });
//         }
//       }

//       overview.push({
//         wardId: ward._id,
//         wardName: ward.name,
//         wing: ward.wing,
//         patientCount: patients.length,
//         weeklyLoad
//       });
//     }

//     res.status(200).json(overview);
//   } catch (error) {
//     res.status(500).json({ message: error.message });
//   }
// };


// ============================================================================
// LOGGING INFRASTRUCTURE
// ============================================================================

const ensureLogDirectory = () => {
  const logDir = path.join(process.cwd(), "logs", "settings");
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
  return logDir;
};

const writeSettingsLog = (logData) => {
  try {
    // const logDir = ensureLogDirectory();
    // const filename = `workload_calculation_${Date.now()}.json`;
    // const filepath = path.join(logDir, filename);
    // fs.writeFileSync(filepath, JSON.stringify(logData, null, 2));
    // console.log(`Settings debug log written to: ${filepath}`);
    return '';
  } catch (err) {
    console.error("Failed to write settings log:", err);
  }
};

// ============================================================================
// UTILITIES
// ============================================================================

const parseDuration = (durationStr) => {
  if (!durationStr) return 0;
  if (typeof durationStr === 'number') return durationStr;
  const numbers = durationStr.match(/\d+/g);
  if (!numbers) return 0;
  return Math.max(...numbers.map(Number));
};

// ============================================================================
// CONTROLLER
// ============================================================================

export const getDetailedFacilityOverview = async (req, res) => {
  try {
    const wards = await Ward.find();
    const daysOfWeek = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
    const overview = [];

    // This object will store the step-by-step math for the log file
    const debugLog = {
      timestamp: new Date().toISOString(),
      wards: []
    };

    for (const ward of wards) {
      const patients = await Patient.find({ currentWard: ward._id, status: "Admitted" });

      const weeklyLoad = {};
      daysOfWeek.forEach(day => weeklyLoad[day] = { am: 0, pm: 0 });

      const wardDebug = {
        wardName: ward.name,
        patientCalculations: []
      };

      for (const patient of patients) {
        const complexity = patient.complexityScore || 1.0;
        const staffCount = patient.noOfStaff || 1;
        const additional = patient.additionalTime || 0;

        const patientMath = {
          patientName: patient.name,
          complexity,
          staffCount,
          additionalTime: additional,
          weeklyCaresBreakdown: [],
          dailyScheduleBreakdown: []
        };

        // 1. Weekly Cares Calculation
        if (patient.weeklyCares) {
          patient.weeklyCares.forEach(care => {
            const baseAm = parseDuration(care.amDuration);
            const basePm = parseDuration(care.pmDuration);

            let finalAm = 0;
            let finalPm = 0;

            if (baseAm > 0) {
              finalAm = Math.round((baseAm + additional) * complexity) * staffCount;
              weeklyLoad[care.day].am += finalAm;
            }
            if (basePm > 0) {
              finalPm = Math.round((basePm + additional) * complexity) * staffCount;
              weeklyLoad[care.day].pm += finalPm;
            }

            patientMath.weeklyCaresBreakdown.push({
              day: care.day,
              am: { base: baseAm, plusAdditional: baseAm + additional, result: finalAm },
              pm: { base: basePm, plusAdditional: basePm + additional, result: finalPm }
            });
          });
        }

        // 2. Daily Schedule Calculation
        if (patient.dailySchedule) {
          patient.dailySchedule.forEach(slot => {
            let duration = slot.durationMinutes || 0;

            if (!slot.isFixedDuration && slot.startTime && slot.endTime) {
              const start = parseInt(slot.startTime.split(':')[0]) * 60 + parseInt(slot.startTime.split(':')[1]);
              const end = parseInt(slot.endTime.split(':')[0]) * 60 + parseInt(slot.endTime.split(':')[1]);
              duration = end - start;
            }
            if (!slot.activities || slot.activities.length === 0 || (slot.activities.length === 1 && slot.activities[0] === "")) {
              return;
            }

            const adjustedDuration = Math.round(duration * complexity) * staffCount;
            const hour = parseInt(slot.startTime?.split(':')[0] || 0);
            const shift = slot.shift || (hour < 15 ? 'AM' : 'PM');

            daysOfWeek.forEach(day => {
              if (shift === 'AM') weeklyLoad[day].am += adjustedDuration;
              else weeklyLoad[day].pm += adjustedDuration;
            });

            patientMath.dailyScheduleBreakdown.push({
              activity: slot.activities.join(", "),
              duration,
              shift,
              complexityApplied: duration * complexity,
              finalWithStaff: adjustedDuration
            });
          });
        }

        wardDebug.patientCalculations.push(patientMath);
      }

      debugLog.wards.push(wardDebug);

      overview.push({
        wardId: ward._id,
        wardName: ward.name,
        wing: ward.wing,
        patientCount: patients.length,
        weeklyLoad
      });
    }

    // Write the breakdown to the logs folder before responding
    // writeSettingsLog(debugLog);

    res.status(200).json(overview);
  } catch (error) {
    console.error("Facility Overview Error:", error);
    res.status(500).json({ message: error.message });
  }
};