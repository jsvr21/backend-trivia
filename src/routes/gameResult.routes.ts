import express from "express";
import { saveResult, getUserResults } from "../controllers/gameResult.controller.js";

const router = express.Router();

// Cambiar de "/save" a "/save-result"
router.post("/save-result", saveResult);

// Obtener resultados de un usuario
router.get("/:email", getUserResults);

export default router;