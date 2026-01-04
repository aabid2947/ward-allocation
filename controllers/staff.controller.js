import { Staff } from "../models/Staff.js";
import { StaffOverride } from "../models/StaffOverride.js";
import { ShiftAssignment } from "../models/ShiftAssignment.js";

// Get all staff
export const getStaff = async (req, res) => {
  try {
    const staff = await Staff.find();
    res.status(200).json(staff);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Create Staff
export const createStaff = async (req, res) => {
  try {
    const newStaff = new Staff(req.body);
    await newStaff.save();
    res.status(201).json(newStaff);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// Update Staff
export const updateStaff = async (req, res) => {
  const { staffId } = req.params;
  try {
    const updatedStaff = await Staff.findByIdAndUpdate(staffId, req.body, { new: true });
    if (!updatedStaff) return res.status(404).json({ message: "Staff not found" });
    res.status(200).json(updatedStaff);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// Delete Staff
export const deleteStaff = async (req, res) => {
  const { staffId } = req.params;
  console.log(staffId)
  try {
    // Check for existing assignments
    const assignmentCount = await ShiftAssignment.countDocuments({ staff: staffId });
    // if (assignmentCount > 0) {
    //   return res.status(400).json({ message: "Cannot delete staff with existing assignments. Please reallocate or remove assignments first." });
    // }

    const deletedStaff = await Staff.findByIdAndDelete(staffId);
    if (!deletedStaff) return res.status(404).json({ message: "Staff not found" });
    res.status(200).json({ message: "Staff deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Update Availability
export const updateAvailability = async (req, res) => {
  const { staffId } = req.params;
  const { am, pm } = req.body;

  try {
    const staff = await Staff.findById(staffId);
    if (!staff) return res.status(404).json({ message: "Staff not found" });

    if (am !== undefined) staff.availability.am = am;
    if (pm !== undefined) staff.availability.pm = pm;

    await staff.save();
    res.status(200).json(staff);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Get Available Staff
export const getAvailableStaff = async (req, res) => {
  const { shift } = req.query; // "AM" or "PM"

  try {
    const query = { active: true };
    if (shift === "AM") query["availability.am"] = true;
    if (shift === "PM") query["availability.pm"] = true;

    const staff = await Staff.find(query);
    res.status(200).json(staff);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
// Get Staff Assignments for a specific date/shift
export const getStaffAssignments = async (req, res) => {
  const { date, shift } = req.query;

  try {
    if (!date) return res.status(400).json({ message: "Date is required" });

    // 1. Get all active staff
    const allStaff = await Staff.find({ active: true }).lean();

    // 2. Get assignments for the date (and shift if provided)
    const query = { shiftDate: new Date(date) };
    if (shift) query.shift = shift;

    const assignments = await ShiftAssignment.find(query)
      .populate("ward")
      .populate("patient")
      .populate("globalTask")
      .lean();

    // 3. Map assignments to staff
    const staffWithAssignments = allStaff.map(staff => {
      const staffAssignments = assignments.filter(a => a.staff.toString() === staff._id.toString());
      
      // Group by shift if not filtered by shift
      const assignmentsByShift = {
        AM: staffAssignments.filter(a => a.shift === "AM"),
        PM: staffAssignments.filter(a => a.shift === "PM")
      };

      return {
        ...staff,
        assignments: shift ? staffAssignments : assignmentsByShift
      };
    });

    res.status(200).json(staffWithAssignments);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
// Set Availability Override
export const setAvailabilityOverride = async (req, res) => {
  const { staffId } = req.params;
  const { date, shift, status, reason } = req.body;

  try {
    const override = new StaffOverride({
      staff: staffId,
      date,
      shift,
      status,
      reason
    });
    await override.save();
    res.status(201).json(override);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};


// Toggle Staff Active
export const toggleStaffActive = async (req, res) => {
  const { staffId } = req.params;
  const { isActive } = req.body;

  try {
    const staff = await Staff.findById(staffId);
    if (!staff) return res.status(404).json({ message: "Staff not found" });

    staff.active = isActive;
    await staff.save();
    res.status(200).json(staff);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Get Fatigue Report
export const getFatigueReport = async (req, res) => {
  const { startDate, endDate } = req.query;

  try {
    // Find assignments in range
    const assignments = await ShiftAssignment.find({
      shiftDate: { $gte: new Date(startDate), $lte: new Date(endDate) }
    }).populate("staff");

    const staffLoad = {};

    assignments.forEach(assignment => {
      const staffId = assignment.staff._id.toString();
      if (!staffLoad[staffId]) {
        staffLoad[staffId] = {
          name: assignment.staff.name,
          maxMinutes: assignment.staff.maxMinutesPerShift,
          shifts: {}
        };
      }

      const dateKey = assignment.shiftDate.toISOString().split('T')[0] + '-' + assignment.shift;
      if (!staffLoad[staffId].shifts[dateKey]) {
        staffLoad[staffId].shifts[dateKey] = 0;
      }
      staffLoad[staffId].shifts[dateKey] += assignment.minutesAllocated;
    });

    const overworkedStaff = [];
    for (const staffId in staffLoad) {
      const data = staffLoad[staffId];
      for (const shift in data.shifts) {
        if (data.shifts[shift] > data.maxMinutes) {
          overworkedStaff.push({
            staffId,
            name: data.name,
            shift,
            minutesAllocated: data.shifts[shift],
            maxMinutes: data.maxMinutes
          });
        }
      }
    }

    res.status(200).json(overworkedStaff);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
