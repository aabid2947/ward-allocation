import { Ward } from "../models/Ward.js";
import { Room } from "../models/Room.js";
import { Patient } from "../models/Patient.js";
import { PatientWardHistory } from "../models/PatientWardHistory.js";

// Get all wards
export const getWards = async (req, res) => {
  try {
    const wards = await Ward.find();
    res.status(200).json(wards);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Create Ward
export const createWard = async (req, res) => {
  try {
    const newWard = new Ward(req.body);
    await newWard.save();
    res.status(201).json(newWard);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// Get Integrity Report
export const getIntegrityReport = async (req, res) => {
  try {
    const violations = [];

    // Check for rooms over capacity
    const rooms = await Room.find();
    for (const room of rooms) {
      const occupants = await Patient.countDocuments({
        currentRoom: room._id,
        status: { $in: ["Admitted", "OnLeave"] }
      });
      const capacity = room.isDoubleRoom ? 2 : 1;
      if (occupants > capacity) {
        violations.push({
          type: "OverCapacity",
          message: `Room ${room.roomNumber} has ${occupants} patients but capacity is ${capacity}`,
          roomId: room._id
        });
      }
    }

    // Check for patients in non-existent rooms
    const patients = await Patient.find();
    for (const patient of patients) {
      const roomExists = await Room.exists({ _id: patient.currentRoom });
      if (!roomExists) {
        violations.push({
          type: "InvalidRoom",
          message: `Patient ${patient.name} is assigned to a non-existent room`,
          patientId: patient._id
        });
      }
    }

    res.status(200).json(violations);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Get Ward Control Center (Grid View)
export const getWardControlCenter = async (req, res) => {
  const { wardId } = req.params;
  try {
    const rooms = await Room.find({ ward: wardId });
    const controlCenterData = [];

    for (const room of rooms) {
      const occupants = await Patient.find({
        currentRoom: room._id,
        status: { $in: ["Admitted", "OnLeave"] }
      }).select("name status");
      
      controlCenterData.push({
        room: room,
        occupants: occupants
      });
    }

    res.status(200).json(controlCenterData);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Get Occupancy Stats
export const getOccupancyStats = async (req, res) => {
  try {
    const wards = await Ward.find();
    const stats = {};

    for (const ward of wards) {
      const rooms = await Room.find({ ward: ward._id });
      let totalCapacity = 0;
      let occupied = 0;

      for (const room of rooms) {
        totalCapacity += room.isDoubleRoom ? 2 : 1;
        const occupants = await Patient.countDocuments({
          currentRoom: room._id,
          status: { $in: ["Admitted", "OnLeave"] }
        });
        occupied += occupants;
      }

      if (!stats[ward.wing]) {
        stats[ward.wing] = { occupied: 0, total: 0 };
      }
      stats[ward.wing].occupied += occupied;
      stats[ward.wing].total += totalCapacity;
    }

    res.status(200).json(stats);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Get Movement History
export const getMovementHistory = async (req, res) => {
  const { patientId } = req.params;
  try {
    const history = await PatientWardHistory.find({ patient: patientId })
      .populate("ward")
      .populate("room")
      .sort({ fromDate: -1 });
    res.status(200).json(history);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Move Resident (Atomic-like with manual rollback if needed, or just sequential)
// Note: Mongoose transactions require a replica set. Assuming standalone for dev, we'll do sequential.
export const moveResident = async (req, res) => {
  const { patientId, newWardId, newRoomId, reason } = req.body;

  try {
    const patient = await Patient.findById(patientId);
    if (!patient) return res.status(404).json({ message: "Patient not found" });

    const newRoom = await Room.findById(newRoomId);
    if (!newRoom) return res.status(404).json({ message: "New room not found" });

    // Check availability
    const occupants = await Patient.countDocuments({
      currentRoom: newRoomId,
      status: { $in: ["Admitted", "OnLeave"] }
    });
    const capacity = newRoom.isDoubleRoom ? 2 : 1;

    if (occupants >= capacity) {
      return res.status(400).json({ message: "New room is fully occupied" });
    }

    // Record History
    const history = new PatientWardHistory({
      patient: patient._id,
      ward: patient.currentWard,
      room: patient.currentRoom,
      fromDate: patient.updatedAt, 
      toDate: new Date(),
      reason: reason || "Moved"
    });
    await history.save();

    // Update Patient
    patient.currentRoom = newRoom._id;
    patient.currentWard = newWardId || newRoom.ward; 
    await patient.save();

    res.status(200).json({ message: "Resident moved successfully", history });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

