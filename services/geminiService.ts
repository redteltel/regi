import { GoogleGenAI, Type } from "@google/genai";
import { ScannedResult } from '../types';

// Trim the API key to remove accidental newlines or spaces that cause "String contains non ISO-8859-1 code point" errors.
const apiKey = (process.env.API_KEY || '').trim();
const ai = new GoogleGenAI({ apiKey: apiKey });

// Using gemini-3-flash-preview as recommended for basic text tasks
const MODEL_NAME = 'gemini-3-flash-preview';

// Helper to strip Markdown code blocks
const cleanJsonString = (text: string): string => {
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(json)?\n?/, '').replace(/\n?```$/, '');
  }
  return cleaned;
};

export const extractPartNumber = async (base64Image: string): Promise<ScannedResult | null> => {
  try {
    const cleanBase64 = base64Image.replace(/^data:image\/(png|jpeg|jpg);base64,/, '');

    const responseSchema = {
      type: Type.OBJECT,
      properties: {
        partNumber: {
          type: Type.STRING,
          description: "The alphanumeric product code, model number, or SKU found in the image.",
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
            text: "Extract the main product part number (品番) or SKU from this image. Return just the code.",
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
    if (!rawText) return null;

    const jsonText = cleanJsonString(rawText);
    
    try {
      const data = JSON.parse(jsonText) as ScannedResult;
      return data;
    } catch (parseError) {
      console.error("JSON Parse Error", parseError);
      throw new Error("Failed to parse AI response.");
    }

  } catch (error: any) {
    console.error("Gemini Vision Error:", error);
    throw error;
  }
};