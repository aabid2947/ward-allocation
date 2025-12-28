import { Ward } from "../models/Ward.js";
import { Room } from "../models/Room.js";
import { Patient } from "../models/Patient.js";
import { PatientWardHistory } from "../models/PatientWardHistory.js";
import { PatientCareSchedule } from "../models/PatientCareSchedule.js";
import { ShiftAssignment } from "../models/ShiftAssignment.js";

// Get all wards with their rooms
export const getWards = async (req, res) => {
  try {
    const wards = await Ward.find().lean();
    const rooms = await Room.find({ active: true }).lean();

    const wardsWithRooms = wards.map(ward => ({
      ...ward,
      rooms: rooms.filter(room => room.ward.toString() === ward._id.toString())
    }));

    res.status(200).json(wardsWithRooms);
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

// Update Ward
export const updateWard = async (req, res) => {
  const { id } = req.params;
  try {
    const updatedWard = await Ward.findByIdAndUpdate(id, req.body, { new: true });
    if (!updatedWard) return res.status(404).json({ message: "Ward not found" });
    res.status(200).json(updatedWard);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// Create Room
export const createRoom = async (req, res) => {
  try {
    const newRoom = new Room(req.body);
    await newRoom.save();
    res.status(201).json(newRoom);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// Update Room
export const updateRoom = async (req, res) => {
  const { id } = req.params;
  try {
    const updatedRoom = await Room.findByIdAndUpdate(id, req.body, { new: true });
    if (!updatedRoom) return res.status(404).json({ message: "Room not found" });
    res.status(200).json(updatedRoom);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// Delete Room
export const deleteRoom = async (req, res) => {
  const { id } = req.params;
  try {
    // Check if room has patients
    const patientCount = await Patient.countDocuments({ currentRoom: id, status: "Admitted" });
    if (patientCount > 0) {
      return res.status(400).json({ message: "Cannot delete room with admitted patients" });
    }

    const deletedRoom = await Room.findByIdAndDelete(id);
    if (!deletedRoom) return res.status(404).json({ message: "Room not found" });
    res.status(200).json({ message: "Room deleted successfully" });
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
      }).select("name status mobilityLevel");
      
      const occupantsWithDetails = await Promise.all(occupants.map(async (patient) => {
        // Get schedules for this patient (Shower, Linen)
        // Assuming we want to show if they have these tasks TODAY or generally scheduled days
        // For the "Grid View", usually it shows the days they have these tasks.
        // Let's fetch all schedules for now and format them.
        const schedules = await PatientCareSchedule.find({ patient: patient._id });
        
        const showerDays = schedules
          .filter(s => s.taskType === "Shower")
          .map(s => s.dayOfWeek);
          
        const linenDays = schedules
          .filter(s => s.taskType === "Linen")
          .map(s => s.dayOfWeek);

        return {
          _id: patient._id,
          name: patient.name,
          status: patient.status,
          mobility: patient.mobilityLevel,
          isOnLeave: patient.status === "OnLeave",
          showerDays: [...new Set(showerDays)], // Unique days
          linenDays: [...new Set(linenDays)]    // Unique days
        };
      }));

      controlCenterData.push({
        room: room,
        occupants: occupantsWithDetails
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

// Get Ward Details (Full Schedule View)
export const getWardDetails = async (req, res) => {
  const { id } = req.params;
  const { date } = req.query;

  try {
    const ward = await Ward.findById(id);
    if (!ward) return res.status(404).json({ message: "Ward not found" });

    const rooms = await Room.find({ ward: id });
    
    // Fetch assignments if date is provided
    let assignments = [];
    if (date) {
       // Ensure we match the date correctly (ignoring time if needed, but usually exact match on YYYY-MM-DD stored as Date)
       // Assuming shiftDate is stored as UTC midnight or similar. 
       // Ideally we query by range or exact match. 
       // Let's assume exact match for now or simple day match.
       const queryDate = new Date(date);
       assignments = await ShiftAssignment.find({
         ward: id,
         shiftDate: queryDate
       }).populate('staff');
    }

    const roomSchedules = [];

    for (const room of rooms) {
      const patients = await Patient.find({ currentRoom: room._id, status: "Admitted" });
      
      for (const patient of patients) {
        // Find assignments for this patient
        const patientAssignments = assignments.filter(a => 
          a.patient && a.patient.toString() === patient._id.toString()
        );
        
        const assignedStaffAM = patientAssignments.filter(a => a.shift === "AM").map(a => a.staff?.name).join(", ");
        const assignedStaffPM = patientAssignments.filter(a => a.shift === "PM").map(a => a.staff?.name).join(", ");

        // Get Schedules (Legacy - Ignored for now)
        // const schedules = await PatientCareSchedule.find({ patient: patient._id });
        
        // Construct the row
        const row = {
          roomNo: room.roomNumber,
          patientName: patient.name,
          wardId: ward, 
          additionalTime: patient.additionalTime,
          complexity: patient.complexityScore,
          staffNeeded: patient.mobilityAid && (patient.mobilityAid.includes("HOIST") || patient.mobilityAid.includes("1-2")) ? "1-2 Staff" : "1 Staff",
          assignedStaff: { AM: assignedStaffAM, PM: assignedStaffPM },
          acuityLevel: patient.acuityLevel,
          mobilityAid: patient.mobilityAid,
          tasksTiming: "", 
        };

        // Populate days
        const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
        days.forEach(day => {
           const dayKey = day.toLowerCase();
           
           // 1. Weekly Cares
           const weekly = patient.weeklyCares?.find(c => c.day === day);
           
           // 2. Specific Schedules (Legacy - Ignored)
           // const daySchedules = schedules.filter(s => s.dayOfWeek === day);
           
           // Combine them
           const combined = [];
           if (weekly) {
             if (weekly.amDuration) combined.push({ taskType: "AM Care", durationMinutes: weekly.amDuration, shift: "AM", specialTime: weekly.specialTime });
             if (weekly.pmDuration) combined.push({ taskType: "PM Care", durationMinutes: weekly.pmDuration, shift: "PM" });
           }
           // daySchedules.forEach(s => combined.push(s));

           // 3. Daily Schedule (New)
           if (patient.dailySchedule) {
             patient.dailySchedule.forEach(ds => {
               const startHour = ds.startTime ? parseInt(ds.startTime.split(':')[0]) : 8;
               const shift = startHour < 14 ? "AM" : "PM";
               
               combined.push({
                 taskType: ds.activities.join(", "),
                 startTime: ds.startTime,
                 endTime: ds.endTime,
                 durationMinutes: ds.durationMinutes,
                 shift: shift
               });
             });
           }
           
           row[dayKey] = combined;
        });

        roomSchedules.push(row);
      }
    }

    res.status(200).json({ ward, roomSchedules });
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

