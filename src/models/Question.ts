import { Schema, model } from "mongoose";

const questionSchema = new Schema(
  {
    id: { type: Number, required: true, unique: true },
    question: { type: String, required: true },
    options: [{ type: String, required: true }],
    correctAnswer: { type: Number, required: true },
    category: { type: String, required: true },
  },
  { timestamps: true }
);

export const QuestionModel = model("Question", questionSchema);