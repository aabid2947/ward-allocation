import { Ward } from "../models/Ward.js";
import { Room } from "../models/Room.js";
import { Patient } from "../models/Patient.js";
import { PatientCareSchedule } from "../models/PatientCareSchedule.js";
import { GlobalTask } from "../models/GlobalTask.js";

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

const parseDuration = (durationStr) => {
  if (!durationStr) return 0;
  if (typeof durationStr === 'number') return durationStr;
  const numbers = durationStr.match(/\d+/g);
  if (!numbers) return 0;
  return Math.max(...numbers.map(Number)); 
};

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
