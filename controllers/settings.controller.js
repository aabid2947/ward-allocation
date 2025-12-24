import { Ward } from "../models/Ward.js";
import { Room } from "../models/Room.js";
import { Patient } from "../models/Patient.js";
import { PatientCareSchedule } from "../models/PatientCareSchedule.js";
import { GlobalTask } from "../models/GlobalTask.js";

// Get Facility Overview
export const getFacilityOverview = async (req, res) => {
  const { date } = req.query; // Allow passing a date
  try {
    const wards = await Ward.find();
    const overview = [];

    // Calculate total care time per wing for specific date or today
    const targetDate = date ? new Date(date) : new Date();
    const dayOfWeek = targetDate.toLocaleDateString('en-US', { weekday: 'long' });

    for (const ward of wards) {
      const rooms = await Room.find({ ward: ward._id });
      const totalRooms = rooms.length;
      const totalCapacity = rooms.reduce((sum, r) => sum + (r.isDoubleRoom ? 2 : 1), 0);
      
      const occupants = await Patient.find({
        currentWard: ward._id,
        status: { $in: ["Admitted", "OnLeave"] }
      });

      // Calculate Total Care Minutes for this Ward
      let totalCareMinutes = 0;
      
      // 1. Patient Care
      for (const patient of occupants) {
        const schedules = await PatientCareSchedule.find({ 
          patient: patient._id,
          dayOfWeek: dayOfWeek
        });
        totalCareMinutes += schedules.reduce((sum, s) => sum + s.durationMinutes, 0);
      }

      // 2. Global Tasks (Assuming some are ward-specific, but model doesn't link GlobalTask to Ward directly yet)
      // If GlobalTasks are facility-wide, we might split them or just ignore for ward-specific total.
      // Let's assume for now GlobalTasks are general overhead not specific to a ward unless we add a 'ward' field to GlobalTask.
      
      overview.push({
        ward: ward.name,
        wing: ward.wing,
        totalRooms,
        totalCapacity,
        occupants: occupants.length,
        occupancyRate: totalCapacity > 0 ? (occupants.length / totalCapacity) * 100 : 0,
        totalCareMinutes: totalCareMinutes
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
