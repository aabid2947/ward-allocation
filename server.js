
import express from 'express';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import cors from 'cors';
import fs from 'fs';
import patientRoutes from './routes/patient.routes.js';
import wardRoutes from './routes/ward.routes.js';
import staffRoutes from './routes/staff.routes.js';
import taskRoutes from './routes/task.routes.js';
import allocationRoutes from './routes/allocation.routes.js';
import operationsRoutes from './routes/operations.routes.js';
import settingsRoutes from './routes/settings.routes.js';
import { PatientWardHistory } from './models/PatientWardHistory.js';

dotenv.config();
const app = express();
const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI;

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/patients', patientRoutes);
app.use('/api/wards', wardRoutes);
app.use('/api/staff', staffRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/allocation', allocationRoutes);
app.use('/api/operations', operationsRoutes);
app.use('/api/settings', settingsRoutes);

// Database Connection
mongoose.connect(MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('MongoDB connected to hospital_allocator'))

.catch(err => console.error('MongoDB connection error:', err));

// Routes
// app.use('/api', apiRoutes);

// fetch all db content 
app.use('/see', async (req, res) => {
  const { Staff } = await import('./models/Staff.js');
  const { Patient } = await import('./models/Patient.js');
  const { Ward } = await import('./models/Ward.js');
  // const { GlobalTask } = await import('./models/GlobalTask.js');
  // const { ShiftAssignment } = await import('./models/ShiftAssignment.js');
    const {GlobalTask} = await import('./models/GlobalTask.js');
    const {ShiftAssignment} = await import('./models/ShiftAssignment.js');
    const {ShiftLock} = await import('./models/ShiftLock.js');
    const {StaffOverride} = await import('./models/StaffOverride.js');
    const {Room} = await import('./models/Room.js');
    const {PatientWardHistory} = await import('./models/PatientWardHistory.js');
    const {PatientCareSchedule} = await import('./models/PatientCareSchedule.js');
  try {
    const staff = await Staff.find();
    const patients = await Patient.find();  
    const wards = await Ward.find();
    const tasks = await GlobalTask.find();
    const shifts = await ShiftAssignment.find();
    const shiftLocks = await ShiftLock.find();
    const staffOverrides = await StaffOverride.find();
    const rooms = await Room.find();
    const patientWardHistories = await PatientWardHistory.find();
    const patientCareSchedules = await PatientCareSchedule.find();

    // create a file on backend and save the result
    
    const data = { staff, patients, wards, tasks, shifts, shiftLocks, staffOverrides, rooms, patientWardHistories, patientCareSchedules };
    fs.writeFileSync('all_db_content.json', JSON.stringify(data, null, 2));
    res.status(200).json(data);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  } 
});

app.use('/delete-all-db', async (req, res) => {
  const { Staff } = await import('./models/Staff.js');
  const { Patient } = await import('./models/Patient.js');
  const { Ward } = await import('./models/Ward.js');
  const { GlobalTask } = await import('./models/GlobalTask.js');
  const { ShiftAssignment } = await import('./models/ShiftAssignment.js');
  const { ShiftLock } = await import('./models/ShiftLock.js');
  const { StaffOverride } = await import('./models/StaffOverride.js');
  const { Room } = await import('./models/Room.js');
  try {
    // await Staff.deleteMany({});
    await Patient.deleteMany({});
    // await Ward.deleteMany({});
    await GlobalTask.deleteMany({});  
    await ShiftAssignment.deleteMany({});
    await ShiftLock.deleteMany({});
    await StaffOverride.deleteMany({});

    // await Room.deleteMany({});

    res.status(200).json({ message: 'All database collections deleted.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
});
// curl -X GET http://localhost:5000/delete-all-db
// Start Server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
