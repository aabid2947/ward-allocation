import express from "express";
import { login, getUsers, createUser } from "../controllers/auth.controller.js";

const router = express.Router();

router.post("/login", login);
router.get("/users", getUsers);
router.post("/users", createUser);

export default router;
