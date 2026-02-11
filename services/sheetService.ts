import { Product } from '../types';

// The Google Sheet ID provided by the user
const SPREADSHEET_ID = '1t0V0t5qpkL2zNZjHWPj_7ZRsxRXuzfrXikPGgqKDL_k';
// Public CSV Export URL (Requires "Anyone with link can view" permission on the sheet)
const CSV_URL = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export?format=csv`;

let productCache: Product[] = [];
let lastFetchTime = 0;
const CACHE_TTL = 1000 * 60 * 5; // Cache for 5 minutes

// Robust CSV Parser handling quoted fields and newlines
const parseCSV = (text: string): string[][] => {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentVal = '';
  let insideQuote = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (char === '"') {
      if (insideQuote && nextChar === '"') {
        currentVal += '"';
        i++; // Skip escaped quote
      } else {
        insideQuote = !insideQuote;
      }
    } else if (char === ',' && !insideQuote) {
      currentRow.push(currentVal.trim());
      currentVal = '';
    } else if ((char === '\r' || char === '\n') && !insideQuote) {
      if (char === '\r' && nextChar === '\n') i++;
      currentRow.push(currentVal.trim());
      if (currentRow.length > 0 && (currentRow.length > 1 || currentRow[0] !== '')) {
        rows.push(currentRow);
      }
      currentRow = [];
      currentVal = '';
    } else {
      currentVal += char;
    }
  }
  if (currentVal) currentRow.push(currentVal.trim());
  if (currentRow.length > 0) rows.push(currentRow);
  
  return rows;
};

const fetchDatabase = async (): Promise<Product[]> => {
  const now = Date.now();
  // Return cached data if valid
  if (productCache.length > 0 && (now - lastFetchTime < CACHE_TTL)) {
    return productCache;
  }

  try {
    const res = await fetch(CSV_URL);
    if (!res.ok) {
        console.error("Failed to fetch sheet CSV. Status:", res.status);
        return [];
    }
    const text = await res.text();
    const rows = parseCSV(text);
    
    // Assume Row 0 is Header (品番, 品名, 価格), start processing from Row 1
    const products: Product[] = [];
    
    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (row.length < 3) continue;

        // Map columns: Col 0 -> PartNo, Col 1 -> Name, Col 2 -> Price
        const partNumber = row[0];
        const name = row[1];
        // Clean price string (remove ¥, commas, non-numeric chars)
        const priceStr = row[2].replace(/[^0-9]/g, '');
        const price = parseInt(priceStr, 10);

        if (partNumber && !isNaN(price)) {
            products.push({
                id: partNumber, 
                partNumber,
                name,
                price
            });
        }
    }
    
    console.log(`Loaded ${products.length} products from Google Sheet.`);
    productCache = products;
    lastFetchTime = now;
    return products;
  } catch (e) {
    console.error("Sheet Service Error:", e);
    return [];
  }
};

export const searchProduct = async (query: string): Promise<Product | null> => {
  // Ensure we have data
  const db = await fetchDatabase();
  
  // Normalize query for flexible matching
  const normalize = (s: string) => s.trim().toUpperCase().replace(/[-\s]/g, '');
  const target = normalize(query);
  
  // 1. Exact match (ignoring case/symbols)
  const exact = db.find(p => normalize(p.partNumber) === target);
  if (exact) return exact;

  // 2. Fuzzy/Contains match (only if target has enough characters to be specific)
  if (target.length >= 3) {
      const found = db.find(p => {
          const pNorm = normalize(p.partNumber);
          return pNorm.includes(target) || target.includes(pNorm);
      });
      if (found) return found;
  }
  
  return null;
};