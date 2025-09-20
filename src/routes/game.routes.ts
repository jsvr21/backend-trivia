import { Router } from "express";
import { getQuestions, checkAnswer } from "../controllers/game.controller.js";

const router = Router();

router.get("/questions", getQuestions);
router.post("/check", checkAnswer);

export default router;
