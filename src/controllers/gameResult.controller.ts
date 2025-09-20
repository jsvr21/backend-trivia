import { Request, Response } from "express";
import { GameResultModel } from "../models/GameResult.js";

// Guardar resultado
export const saveResult = async (req: Request, res: Response) => {
  try {
    const result = new GameResultModel(req.body);
    await result.save();
    res.status(201).json({ message: "Resultado guardado ✅", result });
  } catch (error) {
    res.status(500).json({ message: "Error al guardar resultado", error });
  }
};

// Obtener resultados de un usuario
export const getUserResults = async (req: Request, res: Response) => {
  try {
    const { email } = req.params;
    const results = await GameResultModel.find({ userEmail: email });
    res.json(results);
  } catch (error) {
    res.status(500).json({ message: "Error al obtener resultados", error });
  }
};
