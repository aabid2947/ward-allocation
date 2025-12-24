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
  dischargePatient
} from "../controllers/patient.controller.js";

const router = express.Router();

router.get("/", getPatients);
router.post("/", createPatient); // Alias for admitPatient
router.post("/admit", admitPatient);
router.get("/:patientId", getPatientProfile);
router.put("/:patientId/clinical", updateClinicalStatus);
router.put("/:patientId/discharge", dischargePatient);
router.put("/:patientId/leave", setOnLeave);
router.put("/:patientId/return", returnFromLeave);
router.post("/validate-placement", validatePlacement);

export default router;

