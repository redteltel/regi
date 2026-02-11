import { GoogleGenAI, Type, Schema } from "@google/genai";
import { ScannedResult } from '../types';

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

// Using stable Gemini 2.0 Flash to ensure availability and fix 404 errors.
const MODEL_NAME = 'gemini-2.0-flash';

// Helper to strip Markdown code blocks (e.g. ```json ... ```) from the response
const cleanJsonString = (text: string): string => {
  let cleaned = text.trim();
  // Remove wrapping markdown code blocks if present
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(json)?\n?/, '').replace(/\n?```$/, '');
  }
  return cleaned;
};

export const extractPartNumber = async (base64Image: string): Promise<ScannedResult | null> => {
  try {
    // Clean base64 string if it contains metadata header
    const cleanBase64 = base64Image.replace(/^data:image\/(png|jpeg|jpg);base64,/, '');

    const responseSchema: Schema = {
      type: Type.OBJECT,
      properties: {
        partNumber: {
          type: Type.STRING,
          description: "The alphanumeric product code, model number, or SKU found in the image (e.g., CS-J285D-W).",
        },
        confidence: {
          type: Type.NUMBER,
          description: "Confidence score between 0 and 1.",
        },
      },
      required: ["partNumber"],
    };

    const result = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: 'image/jpeg',
              data: cleanBase64,
            },
          },
          {
            text: "Extract the main product part number (品番) or SKU from this image. Return just the code. If there are multiple, pick the most prominent model number.",
          },
        ],
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: responseSchema,
        temperature: 0.1,
      },
    });

    const rawText = result.text;
    if (!rawText) {
      console.warn("Gemini returned empty text response.");
      return null;
    }

    // Strip markdown to prevent JSON parse errors
    const jsonText = cleanJsonString(rawText);
    
    try {
      const data = JSON.parse(jsonText) as ScannedResult;
      return data;
    } catch (parseError) {
      console.error("JSON Parse Error. Raw text:", rawText);
      throw new Error("Failed to parse AI response. " + (parseError instanceof Error ? parseError.message : ""));
    }

  } catch (error: any) {
    console.error("Gemini Vision Error:", error);
    
    // Provide more user-friendly error messages
    if (error.message?.includes('404') || error.status === 404) {
       throw new Error(`Model ${MODEL_NAME} not found or access denied. Check API Key.`);
    }
    throw error;
  }
};