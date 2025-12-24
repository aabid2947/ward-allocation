import { Ward } from "../models/Ward.js";
import { Room } from "../models/Room.js";
import { Patient } from "../models/Patient.js";

// Get Facility Overview
export const getFacilityOverview = async (req, res) => {
  try {
    const wards = await Ward.find();
    const overview = [];

    for (const ward of wards) {
      const rooms = await Room.find({ ward: ward._id });
      const totalRooms = rooms.length;
      const totalCapacity = rooms.reduce((sum, r) => sum + (r.isDoubleRoom ? 2 : 1), 0);
      
      const occupants = await Patient.countDocuments({
        currentWard: ward._id,
        status: { $in: ["Admitted", "OnLeave"] }
      });

      overview.push({
        ward: ward.name,
        wing: ward.wing,
        totalRooms,
        totalCapacity,
        occupants,
        occupancyRate: totalCapacity > 0 ? (occupants / totalCapacity) * 100 : 0
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
