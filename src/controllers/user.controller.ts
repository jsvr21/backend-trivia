import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { User } from "../models/User.js";

// Registrar usuario
export const registerUser = async (req: Request, res: Response) => {
  try {
    const { email, name, password } = req.body;

    const existingUser = await User.findOne({ email });
    if (existingUser) return res.status(400).json({ message: "El usuario ya existe" });

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({ email, name, password: hashedPassword });
    await user.save();

    res.status(201).json({ message: "Usuario registrado con éxito", user });
  } catch (error) {
    res.status(500).json({ message: "Error en el servidor", error });
  }
};

// Login usuario
export const loginUser = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ message: "Credenciales inválidas" });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ message: "Credenciales inválidas" });

    const token = jwt.sign({ id: user._id, email: user.email }, process.env.JWT_SECRET || "supersecret", { expiresIn: "1h" });

    res.json({ message: "Login exitoso", token, user });
  } catch (error) {
    res.status(500).json({ message: "Error en el servidor", error });
  }
};
