import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export interface RoadHazardAnalysis {
  hazard_type: "pothole" | "crack" | "waterlogging" | "obstacle" | "debris" | "damaged road";
  severity: "low" | "medium" | "high";
  confidence: number;
  explanation: string;
}

export const analyzeRoadImage = async (base64Image: string): Promise<RoadHazardAnalysis> => {
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: [
      {
        parts: [
          {
            text: "Analyze this road image and identify any hazards (pothole, crack, waterlogging, obstacle, debris, or damaged road). Provide the hazard type, severity (low, medium, or high), a confidence score (0-100), and a brief explanation.",
          },
          {
            inlineData: {
              mimeType: "image/jpeg",
              data: base64Image.split(",")[1] || base64Image,
            },
          },
        ],
      },
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          hazard_type: { 
            type: Type.STRING, 
            enum: ["pothole", "crack", "waterlogging", "obstacle", "debris", "damaged road"],
            description: "The type of road hazard found." 
          },
          severity: { 
            type: Type.STRING, 
            enum: ["low", "medium", "high"], 
            description: "The severity of the hazard." 
          },
          confidence: { 
            type: Type.NUMBER, 
            description: "Confidence score from 0 to 100." 
          },
          explanation: { 
            type: Type.STRING, 
            description: "A brief explanation of the hazard found." 
          },
        },
        required: ["hazard_type", "severity", "confidence", "explanation"],
      },
    },
  });

  try {
    const result = JSON.parse(response.text || "{}");
    return result as RoadHazardAnalysis;
  } catch (error) {
    console.error("Failed to parse Gemini response:", error);
    throw new Error("Invalid response from AI");
  }
};
