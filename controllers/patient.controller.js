import { Patient } from "../models/Patient.js";
import { Room } from "../models/Room.js";
import { Ward } from "../models/Ward.js";
import { PatientCareSchedule } from "../models/PatientCareSchedule.js";
import { ShiftAssignment } from "../models/ShiftAssignment.js";
import { calculateAllocation } from "./allocation.controller.js";

// Helper: Process daily schedule to determine shift
const processDailySchedule = (scheduleItems) => {
  if (!Array.isArray(scheduleItems)) return [];
  
  return scheduleItems.map(item => {
    let shift = item.shift;
    
    // If timing is given (not fixed duration), decide AM/PM based on start time
    if (!item.isFixedDuration && item.startTime) {
      const hour = parseInt(item.startTime.split(':')[0], 10);
      // Cutoff: 15:00 (3 PM) starts PM shift. So < 15 is AM.
      shift = hour < 15 ? 'AM' : 'PM';
    }
    
    // If fixed duration, shift should be provided. If not, we can't infer it easily.
    // We'll leave it as is, or default if needed.
    
    return {
      ...item,
      shift
    };
  });
};

// Helper: Map frontend 'slots' to 'dailySchedule' structure
const mapSlotsToSchedule = (slots) => {
  if (!Array.isArray(slots)) return [];
  return slots.map(slot => {
    const activities = [];
    if (slot.isMorningCares) activities.push("Morning Cares");
    if (slot.isPostLunchCares) activities.push("Post Lunch Cares");
    if (slot.isAfternoonCares) activities.push("Afternoon Cares");
    if (slot.isToileting) activities.push("Toileting");
    
    return {
      startTime: slot.startTime,
      endTime: slot.endTime,
      isFixedDuration: slot.isFixedDuration,
      durationMinutes: slot.duration ? parseInt(slot.duration) : undefined,
      shift: slot.shift, 
      activities
    };
  });
};

// Get all patients
export const getPatients = async (req, res) => {

  try {
    const patients = await Patient.find()
      .populate("currentWard")
      .populate("currentRoom");
    res.status(200).json(patients);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Create a new patient (Admit Patient)
export const admitPatient = async (req, res) => {
  let { 
    name, primaryCondition, careLevel, mobilityLevel, complexityScore, 
    admissionDate, currentWard, currentRoom,
    mobilityAid, acuityLevel, additionalTime, weeklyCares, 
    schedules, 
    dailySchedule,
    slots // Frontend might send this
  } = req.body;

  try {
    // Handle slots -> dailySchedule mapping if dailySchedule is missing
    if (!dailySchedule && slots) {
      dailySchedule = mapSlotsToSchedule(slots);
    }

    // Process schedule to assign shifts
    if (dailySchedule) {
      dailySchedule = processDailySchedule(dailySchedule);
    }

    // 1. Create Patient
    const newPatient = new Patient({
      name, primaryCondition, careLevel, mobilityLevel, complexityScore,
      admissionDate, currentWard, currentRoom,
      mobilityAid, acuityLevel, additionalTime, weeklyCares: weeklyCares || [],
      dailySchedule: dailySchedule || []
    });
    await newPatient.save();

    // 2. Create Schedules if provided (Legacy support or specific overrides)
    if (schedules && Array.isArray(schedules)) {
      const scheduleDocs = schedules.map(s => ({
        ...s,
        patient: newPatient._id
      }));
      await PatientCareSchedule.insertMany(scheduleDocs);
    }

    res.status(201).json(newPatient);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// Update Patient
export const updatePatient = async (req, res) => {
  const { id } = req.params;
  let updateData = { ...req.body };

  try {
    // Handle slots -> dailySchedule mapping
    if (!updateData.dailySchedule && updateData.slots) {
      updateData.dailySchedule = mapSlotsToSchedule(updateData.slots);
      delete updateData.slots; // Clean up
    }

    // Process schedule
    if (updateData.dailySchedule) {
      updateData.dailySchedule = processDailySchedule(updateData.dailySchedule);
    }

    const updatedPatient = await Patient.findByIdAndUpdate(id, updateData, { new: true });
    if (!updatedPatient) return res.status(404).json({ message: "Patient not found" });
    res.status(200).json(updatedPatient);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// Delete Patient
export const deletePatient = async (req, res) => {
  const { id } = req.params;
  try {
    // 1. Find assignments to identify affected shifts
    const assignments = await ShiftAssignment.find({ patient: id });
    
    // Get unique shifts (date + shift)
    const shiftsToUpdate = [];
    const seen = new Set();
    
    assignments.forEach(a => {
      const key = `${a.shiftDate.toISOString()}-${a.shift}`;
      if (!seen.has(key)) {
        seen.add(key);
        shiftsToUpdate.push({ date: a.shiftDate, shift: a.shift });
      }
    });

    // 2. Delete assignments for this patient
    await ShiftAssignment.deleteMany({ patient: id });

    // 3. Delete the patient
    const deletedPatient = await Patient.findByIdAndDelete(id);
    if (!deletedPatient) return res.status(404).json({ message: "Patient not found" });
    
    // Optionally delete associated schedules
    await PatientCareSchedule.deleteMany({ patient: id });

    // 4. Reallocate for affected shifts
    for (const { date, shift } of shiftsToUpdate) {
      try {
        // Run allocation logic
        const { assignments: newAssignments } = await calculateAllocation(date, shift);
        
        // Commit: Delete all for that shift and insert new
        await ShiftAssignment.deleteMany({ shiftDate: date, shift });
        
        // Ensure date/shift are set correctly in new assignments
        const assignmentsToSave = newAssignments.map(a => ({
          ...a,
          shiftDate: date,
          shift: shift
        }));
        
        await ShiftAssignment.insertMany(assignmentsToSave);
        
      } catch (allocError) {
        console.error(`Failed to reallocate for ${date} ${shift}:`, allocError);
        // Continue to next shift even if one fails. 
        // The patient's tasks are already removed, so the schedule is valid but has gaps.
      }
    }
    
    res.status(200).json({ message: "Patient deleted and schedules updated successfully" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Alias for createPatient to match API contract
export const createPatient = admitPatient;

// Get Patient Profile
export const getPatientProfile = async (req, res) => {
  const { patientId } = req.params;
  try {
    const patient = await Patient.findById(patientId)
      .populate("currentWard")
      .populate("currentRoom");
    if (!patient) return res.status(404).json({ message: "Patient not found" });
    res.status(200).json(patient);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Update Clinical Status
export const updateClinicalStatus = async (req, res) => {
  const { patientId } = req.params;
  const { mobilityLevel, complexityScore } = req.body;

  try {
    const patient = await Patient.findById(patientId);
    if (!patient) return res.status(404).json({ message: "Patient not found" });

    if (mobilityLevel) patient.mobilityLevel = mobilityLevel;
    if (complexityScore) patient.complexityScore = complexityScore;

    await patient.save();
    res.status(200).json(patient);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Discharge Patient
export const dischargePatient = async (req, res) => {
  const { patientId } = req.params;
  const { dischargeDate } = req.body;

  try {
    const patient = await Patient.findById(patientId);
    if (!patient) return res.status(404).json({ message: "Patient not found" });

    patient.status = "Discharged";
    patient.dischargeDate = dischargeDate || new Date();
    // Optionally clear room assignment if needed, but keeping history is good
    // patient.currentRoom = null; 
    
    await patient.save();
    res.status(200).json({ message: "Patient discharged successfully" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};


// Set patient status to OnLeave
export const setOnLeave = async (req, res) => {
  const { patientId } = req.params;
  // startDate and expectedReturn could be used for logging or future scheduling
  const { startDate, expectedReturn } = req.body; 

  try {
    const patient = await Patient.findById(patientId);
    if (!patient) return res.status(404).json({ message: "Patient not found" });

    patient.status = "OnLeave";
    // We might want to store leave dates in a separate collection or fields if needed
    // For now, just updating status as per requirement
    await patient.save();

    res.status(200).json(patient);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Return patient from leave
export const returnFromLeave = async (req, res) => {
  const { patientId } = req.params;

  try {
    const patient = await Patient.findById(patientId);
    if (!patient) return res.status(404).json({ message: "Patient not found" });

    patient.status = "Admitted";
    await patient.save();

    res.status(200).json(patient);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Validate placement
export const validatePlacement = async (req, res) => {
  const { wardId, roomId } = req.body;

  try {
    const room = await Room.findById(roomId);
    if (!room) return res.status(404).json({ available: false, message: "Room not found" });

    if (room.ward.toString() !== wardId) {
      return res.status(400).json({ available: false, message: "Room does not belong to this ward" });
    }

    // Check current occupancy
    // Patients who are Admitted or OnLeave occupy the room
    const occupants = await Patient.countDocuments({
      currentRoom: roomId,
      status: { $in: ["Admitted", "OnLeave"] }
    });

    const capacity = room.isDoubleRoom ? 2 : 1;

    if (occupants >= capacity) {
      return res.status(200).json({ available: false, message: "Room is full" });
    }

    res.status(200).json({ available: true });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Create Dummy Patients (Up to 4)
export const createDummyPatients = async (req, res) => {
  try {
    // Get a ward and room to assign
    console.log("Creating dummy patients...");
    const ward = await Ward.findOne();
    if (!ward) return res.status(400).json({ message: "No wards found. Create a ward first." });
    
    const room = await Room.findOne({ ward: ward._id });
    if (!room) return res.status(400).json({ message: "No rooms found in the ward." });

    const dummyData = [
      {
        name: "Alice Smith",
        primaryCondition: "Post-Op Recovery",
        careLevel: "High",
        mobilityLevel: "Assisted",
        complexityScore: 1.5,
        admissionDate: new Date(),
        currentWard: ward._id,
        currentRoom: room._id,
        mobilityAid: "WalkingFrame",
        acuityLevel: "High",
        weeklyCares: [
            { day: "Monday", amDuration: "30", pmDuration: "20" },
            { day: "Thursday", amDuration: "30", pmDuration: "20" }
        ],
         dailySchedule: [
          {
            startTime: "15:00",
            endTime: "15:30",
            isFixedDuration: false,
            shift: "PM",
            activities: ["Afternoon Cares"]
          },
        ]
      },
      {
        name: "Bob Jones",
        primaryCondition: "Dementia",
        careLevel: "Medium",
        mobilityLevel: "Independent",
        complexityScore: 1.2,
        admissionDate: new Date(),
        currentWard: ward._id,
        currentRoom: room._id,
        mobilityAid: "None",
        acuityLevel: "Low",
         weeklyCares: [
            { day: "Monday", amDuration: "20", pmDuration: "15" },
            { day: "Thursday", amDuration: "20", pmDuration: "15" }
        ],
         dailySchedule: [
          {
            startTime: "09:00",
            endTime: "09:30",
            isFixedDuration: false,
            shift: "AM",
            activities: ["Morning Cares"]
          },
        ]
      },
      {
        name: "Charlie Brown",
        primaryCondition: "Stroke",
        careLevel: "High",
        mobilityLevel: "BedBound",
        complexityScore: 1.8,
        admissionDate: new Date(),
        currentWard: ward._id,
        currentRoom: room._id,
        mobilityAid: "Hoist",
        acuityLevel: "High",
         weeklyCares: [
            { day: "Thursday", amDuration: "45", pmDuration: "30" }
        ],
        dailySchedule: [
          {
            startTime: "09:00",
            endTime: "09:30",
            isFixedDuration: false,
            shift: "AM",
            activities: ["Morning Cares"]
          },
        ]
      },
      {
        name: "Diana Prince",
        primaryCondition: "Frailty",
        careLevel: "Low",
        mobilityLevel: "WalkingFrame",
        complexityScore: 1.1,
        admissionDate: new Date(),
        currentWard: ward._id,
        currentRoom: room._id,
        mobilityAid: "WalkingFrame",
        acuityLevel: "Low",
         weeklyCares: [
            { day: "Thursday", amDuration: "15", pmDuration: "10" }
        ],
        dailySchedule: [
          {
            startTime: "15:00",
            endTime: "15:30",
            isFixedDuration: false,
            shift: "PM",
            activities: ["Afternoon Cares"]
          },
        ]
      }
    ];

    const createdPatients = await Patient.insertMany(dummyData);
    res.status(201).json(createdPatients);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
