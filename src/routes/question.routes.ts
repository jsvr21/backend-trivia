import { Router } from "express";
import { getQuestions, checkAnswer } from "../controllers/question.controller.js";

const router = Router();

router.get("/", getQuestions);
router.post("/check", checkAnswer);

export default router;
