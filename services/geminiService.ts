import { GoogleGenAI, Type } from "@google/genai";
import { ScannedResult } from '../types';

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

// Retry utility
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const extractPartNumber = async (base64Image: string): Promise<ScannedResult | null> => {
  // Retrieve API Key at runtime
  const apiKey = process.env.API_KEY;

  if (!apiKey) {
    console.error("Gemini API Key is missing.");
    throw new Error("Gemini API Key is not configured.");
  }

  const ai = new GoogleGenAI({ apiKey });
  
  // Normalize base64 string
  const cleanBase64 = base64Image.replace(/^data:image\/(png|jpeg|jpg|webp);base64,/, '');

  const responseSchema = {
    type: Type.OBJECT,
    properties: {
      partNumber: {
        type: Type.STRING,
        description: "The alphanumeric product model number (品番) found in the image. e.g., NA-LX129EL, BQ-CC23. Ignore barcodes and price labels.",
      },
      confidence: {
        type: Type.NUMBER,
        description: "Confidence score between 0 and 1.",
      },
    },
    required: ["partNumber"],
  };

  // Retry logic: Try up to 2 times
  let attempts = 0;
  const maxAttempts = 2;

  while (attempts < maxAttempts) {
    try {
      const result = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: {
          parts: [
            {
              inlineData: {
                mimeType: 'image/jpeg', // Camera.tsx now ensures this is sent as jpeg compatible data
                data: cleanBase64,
              },
            },
            {
              text: "Extract the main product model number (品番) from this image. It is usually an alphanumeric code (e.g., NA-LX129EL). Ignore pure barcodes. Return JSON.",
            },
          ],
        },
        config: {
          responseMimeType: "application/json",
          responseSchema: responseSchema,
          temperature: 0.0, // Low temperature for deterministic OCR
        },
      });

      const rawText = result.text;
      if (!rawText) throw new Error("Empty response from AI");

      const jsonText = cleanJsonString(rawText);
      const data = JSON.parse(jsonText) as ScannedResult;
      
      return data;

    } catch (error: any) {
      attempts++;
      console.warn(`Gemini API Attempt ${attempts} failed:`, error);
      
      if (attempts >= maxAttempts) {
        // Return null instead of throwing to allow the UI to show "Cannot read" instead of "Error"
        return null;
      }
      // Wait 1 second before retrying
      await wait(1000);
    }
  }

  return null;
};