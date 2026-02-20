import { GoogleGenAI, Type } from "@google/genai";
import { ScannedResult } from '../types';

// Using gemini-3-flash-preview for speed
const MODEL_NAME = 'gemini-3-flash-preview';

// Helper to strip Markdown code blocks
const cleanJsonString = (text: string): string => {
  let cleaned = text.trim();
  // Remove markdown code blocks
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(json)?\n?/, '').replace(/\n?```$/, '');
  }
  return cleaned;
};

// Retry utility
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const extractPartNumber = async (base64Image: string): Promise<ScannedResult | null> => {
  // Retrieve API Key: Prioritize Vite env var
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;

  if (!apiKey) {
    console.error("Gemini API Key is missing. Please check .env file.");
    throw new Error("API Key is not configured (VITE_GEMINI_API_KEY).");
  }

  const ai = new GoogleGenAI({ apiKey });
  // Ensure we strip the prefix if present
  const cleanBase64 = base64Image.replace(/^data:image\/(png|jpeg|jpg|webp);base64,/, '');

  console.log(`Sending image to Gemini (${MODEL_NAME}), payload length: ${cleanBase64.length}`);

  const responseSchema = {
    type: Type.OBJECT,
    properties: {
      partNumber: {
        type: Type.STRING,
        description: "The alphanumeric product code or model number (品番) visible in the image. e.g. 'ABC-123', 'WHP1234'. Ignore barcodes.",
      },
      confidence: {
        type: Type.NUMBER,
        description: "Confidence score between 0 and 1.",
      },
    },
    required: ["partNumber"],
  };

  // Optimization: Reduce retries to 1 to fit within the frontend timeout (20s)
  let attempts = 0;
  const maxAttempts = 2; // Initial + 1 retry

  while (attempts < maxAttempts) {
    try {
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
              text: "Read the product model number (品番) from this label. Return JSON.",
            },
          ],
        },
        config: {
          responseMimeType: "application/json",
          responseSchema: responseSchema,
          temperature: 0, // 0 for max determinism and speed
        },
      });

      const rawText = result.text;
      if (!rawText) throw new Error("Empty response from AI");

      const jsonText = cleanJsonString(rawText);
      const data = JSON.parse(jsonText) as ScannedResult;
      
      console.log("Gemini Success:", data);
      return data;

    } catch (error: any) {
      attempts++;
      console.warn(`Gemini API Attempt ${attempts} failed:`, error);
      
      // If error is 400 (Invalid Key) or 403 (Referrer/Quota), do not retry.
      const msg = (error.message || "").toLowerCase();
      if (msg.includes('400') || msg.includes('403') || msg.includes('invalid api key')) {
          throw error;
      }
      
      if (attempts >= maxAttempts) {
        // If it's the last attempt, let the UI handle the error
        throw error;
      }
      
      // Short backoff
      await wait(1000);
    }
  }

  return null;
};