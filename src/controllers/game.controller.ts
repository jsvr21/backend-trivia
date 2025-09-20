import { Request, Response } from "express";
import { QuestionModel } from "../models/Question.js"; // Modelo de MongoDB

// Obtener todas las preguntas
export const getQuestions = async (req: Request, res: Response) => {
  try {
    const questions = await QuestionModel.find({});
    res.json(questions);
  } catch (error) {
    res.status(500).json({ message: "Error al obtener preguntas", error });
  }
};

// Validar respuesta
export const checkAnswer = async (req: Request, res: Response) => {
  try {
    const { questionId, selectedOption } = req.body;

    // Buscar la pregunta en MongoDB
    const question = await QuestionModel.findOne({ id: questionId });
    if (!question) return res.status(404).json({ message: "Pregunta no encontrada" });

    const correct = question.correctAnswer === selectedOption;

    res.json({ correct });
  } catch (error) {
    res.status(500).json({ message: "Error al validar respuesta", error });
  }
};
