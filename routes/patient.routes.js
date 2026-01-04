import express from "express";
import {
  getPatients,
  createPatient,
  setOnLeave,
  returnFromLeave,
  validatePlacement,
  admitPatient,
  getPatientProfile,
  updateClinicalStatus,
  dischargePatient,
  updatePatient,
  deletePatient,
  createDummyPatients
} from "../controllers/patient.controller.js";

const router = express.Router();

router.get("/", getPatients);
router.post("/", createPatient); // Alias for admitPatient
router.delete("/:id", deletePatient);
router.get("/delete-all", async (req, res) => {
  console.log(90)
  // WARNING: This route is for testing purposes only. Do not use in production.
  const { Patient } = await import("../models/Patient.js");
  try {
    await Patient.deleteMany({});
    res.status(200).json({ message: "All patients deleted." });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  } 
});
router.post("/admit", admitPatient);
router.get("/:patientId", getPatientProfile);
router.put("/:id", updatePatient);
router.put("/:patientId/clinical", updateClinicalStatus);
router.put("/:patientId/discharge", dischargePatient);
router.put("/:patientId/leave", setOnLeave);
router.put("/:patientId/return", returnFromLeave);
router.post("/validate-placement", validatePlacement);

// create dummy patient route for testing
router.post("/create-dummy", createDummyPatients);
export default router;

