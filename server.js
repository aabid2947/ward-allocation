
import express from 'express';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import cors from 'cors';

import patientRoutes from './routes/patient.routes.js';
import wardRoutes from './routes/ward.routes.js';
import staffRoutes from './routes/staff.routes.js';
import taskRoutes from './routes/task.routes.js';
import allocationRoutes from './routes/allocation.routes.js';
import operationsRoutes from './routes/operations.routes.js';
import settingsRoutes from './routes/settings.routes.js';

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

// Start Server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
