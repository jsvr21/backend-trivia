import mongoose from "mongoose";

const GameResultSchema = new mongoose.Schema({
  userEmail: { type: String, required: true },
  userName: { type: String, required: true },
  won: { type: Boolean, required: true },
  position: { type: Number, required: true },
  totalPlayers: { type: Number, required: true },
  questionsAnswered: { type: Number, required: true },
  correctAnswers: { type: Number, required: true },
  gameTime: { type: String, required: true },
}, { timestamps: true });

export const GameResultModel = mongoose.model("GameResult", GameResultSchema);
