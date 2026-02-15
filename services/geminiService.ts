import { GoogleGenAI, Type } from "@google/genai";
import { ScannedResult } from '../types';

// Using gemini-3-flash-preview for speed and efficiency
const MODEL_NAME = 'gemini-3-flash-preview';

// Helper to strip Markdown code blocks
const cleanJsonString = (text: string): string => {
  let cleaned = text.trim();
  // Remove markdown code blocks if present
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(json)?\n?/, '').replace(/\n?```$/, '');
  }
  return cleaned;
};

// Robust Regex to find model numbers in raw text if JSON parsing fails
// Looks for patterns like: NA-LX129EL, MC-NS100K, DL-RQTK50, BQ-CC23
// Strategy: 1-5 letters, optional hyphen/space, 2+ alphanumeric characters
const FALLBACK_REGEX = /([A-Z]{1,5}[-\s]?[A-Z0-9]{2,}[A-Z0-9\-]*)(\b|$)/i;

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const extractPartNumber = async (base64Image: string): Promise<ScannedResult | null> => {
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
        description: "The product model number (品番). e.g., NA-LX129EL, MC-NS100K. Upper case, keep hyphens.",
      },
      confidence: {
        type: Type.NUMBER,
        description: "Confidence 0-1.",
      },
    },
    required: ["partNumber"],
  };

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
                mimeType: 'image/jpeg',
                data: cleanBase64,
              },
            },
            {
              text: "Find the product model number (品番) in this image. It is usually an alphanumeric code like 'NA-LX129EL' or 'MC-NS100K'. It often starts with letters followed by a hyphen. Ignore barcodes, price labels, and dates.",
            },
          ],
        },
        config: {
          responseMimeType: "application/json",
          responseSchema: responseSchema,
          temperature: 0.0,
        },
      });

      const rawText = result.text;
      if (!rawText) throw new Error("Empty response");

      let partNumber = "";

      // 1. Try strict JSON parse
      try {
        const jsonText = cleanJsonString(rawText);
        const data = JSON.parse(jsonText) as ScannedResult;
        if (data.partNumber) {
           partNumber = data.partNumber.trim();
        }
      } catch (jsonErr) {
        console.warn("JSON Parse failed, trying regex on raw text", rawText);
      }

      // 2. Fallback: Regex extraction if JSON failed or returned empty
      if (!partNumber || partNumber.length < 3) {
         const match = rawText.match(FALLBACK_REGEX);
         if (match && match[1]) {
             partNumber = match[1].trim();
             console.log("Regex recovered part number:", partNumber);
         }
      }

      // 3. Final cleanup and validation
      if (partNumber) {
          // Normalize: Upper case
          partNumber = partNumber.toUpperCase();
          
          // Remove trailing hyphens or weird chars
          partNumber = partNumber.replace(/[^A-Z0-9-]/g, ''); 

          // Sanity check: reasonable length
          if (partNumber.length >= 3) {
              return {
                  partNumber: partNumber,
                  confidence: 0.9 // Synthetic confidence for fallback
              };
          }
      }

      throw new Error("No valid part number found in response");

    } catch (error: any) {
      attempts++;
      console.warn(`Attempt ${attempts} failed:`, error);
      if (attempts >= maxAttempts) {
         return null;
      }
      await wait(1000);
    }
  }

  return null;
};