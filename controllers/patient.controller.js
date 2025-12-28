import { Patient } from "../models/Patient.js";
import { Room } from "../models/Room.js";
import { Ward } from "../models/Ward.js";
import { PatientCareSchedule } from "../models/PatientCareSchedule.js";

// Helper: Process daily schedule to determine shift
const processDailySchedule = (scheduleItems) => {
  if (!Array.isArray(scheduleItems)) return [];
  
  return scheduleItems.map(item => {
    let shift = item.shift;
    
    // If timing is given (not fixed duration), decide AM/PM based on start time
    if (!item.isFixedDuration && item.startTime) {
      const hour = parseInt(item.startTime.split(':')[0], 10);
      // Cutoff: 13:00 (1 PM) starts PM shift. So < 13 is AM.
      shift = hour < 13 ? 'AM' : 'PM';
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
