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
  const cleanBase64 = base64Image.replace(/^data:image\/(png|jpeg|jpg|webp);base64,/, '');

  const responseSchema = {
    type: Type.OBJECT,
    properties: {
      partNumber: {
        type: Type.STRING,
        description: "The alphanumeric product code, model number, or SKU found in the image. Ignore purely numeric barcodes if an alphanumeric code exists.",
      },
      confidence: {
        type: Type.NUMBER,
        description: "Confidence score between 0 and 1.",
      },
    },
    required: ["partNumber"],
  };

  // Retry logic: Try up to 3 times (Enhanced Stability)
  let attempts = 0;
  const maxAttempts = 3;

  while (attempts < maxAttempts) {
    try {
      const result = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: {
          parts: [
            {
              inlineData: {
                mimeType: 'image/jpeg', // API accepts 'image/jpeg' for generic image data
                data: cleanBase64,
              },
            },
            {
              text: "Extract the main product model number (品番) from this image. Return just the code in JSON.",
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
      if (!rawText) throw new Error("Empty response from AI");

      const jsonText = cleanJsonString(rawText);
      const data = JSON.parse(jsonText) as ScannedResult;
      
      return data;

    } catch (error: any) {
      attempts++;
      console.warn(`Gemini API Attempt ${attempts} failed:`, error);
      
      if (attempts >= maxAttempts) {
        console.error("Gemini Vision Error after retries:", error);
        // Return a user-friendly error message for the UI to display
        throw new Error("電波の良い場所でもう一度お試しください。");
      }
      
      // Exponential Backoff: Wait longer between retries (2s, 3s...)
      await wait(1000 + (attempts * 1000));
    }
  }

  return null;
};