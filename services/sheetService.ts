import { Product } from '../types';

// The Google Sheet ID provided by the user
const SPREADSHEET_ID = '1t0V0t5qpkL2zNZjHWPj_7ZRsxRXuzfrXikPGgqKDL_k';
const CSV_URL = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export?format=csv`;

const CACHE_KEY = 'pixelpos_product_db';
const TIMESTAMP_KEY = 'pixelpos_db_timestamp';
const CACHE_TTL = 1000 * 60 * 60; // Cache for 1 hour (increased for performance)

// In-memory mirror for instant access
let memoryCache: Product[] = [];

// Robust CSV Parser
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
        i++;
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

// Load from LocalStorage on startup
const loadFromLocal = (): Product[] => {
  try {
    const json = localStorage.getItem(CACHE_KEY);
    if (json) {
      const data = JSON.parse(json);
      console.log(`Loaded ${data.length} products from LocalStorage.`);
      return data;
    }
  } catch (e) {
    console.error("Failed to load local cache", e);
  }
  return [];
};

// Initialize memory cache immediately
memoryCache = loadFromLocal();

const fetchDatabase = async (forceUpdate = false): Promise<Product[]> => {
  const now = Date.now();
  const lastFetch = parseInt(localStorage.getItem(TIMESTAMP_KEY) || '0', 10);

  // Use memory/local cache if valid and not forcing update
  if (!forceUpdate && memoryCache.length > 0 && (now - lastFetch < CACHE_TTL)) {
    return memoryCache;
  }

  try {
    // Background fetch if we have data but it's slightly old? 
    // For now, strict fetch logic:
    const res = await fetch(CSV_URL);
    if (!res.ok) throw new Error(`Sheet fetch failed: ${res.status}`);

    const text = await res.text();
    const rows = parseCSV(text);
    
    const products: Product[] = [];
    // Skip Header
    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (row.length < 3) continue;

        const partNumber = row[0];
        const name = row[1];
        const priceStr = row[2].replace(/[^0-9]/g, '');
        const price = parseInt(priceStr, 10);

        if (partNumber && !isNaN(price)) {
            products.push({ id: partNumber, partNumber, name, price });
        }
    }
    
    // Update caches
    memoryCache = products;
    localStorage.setItem(CACHE_KEY, JSON.stringify(products));
    localStorage.setItem(TIMESTAMP_KEY, now.toString());
    
    console.log(`Updated cache with ${products.length} products.`);
    return products;
  } catch (e) {
    console.error("Sheet Service Error:", e);
    // Fallback to existing memory cache even if expired
    return memoryCache;
  }
};

export const searchProduct = async (query: string): Promise<Product | null> => {
  // Ensure we have data (non-blocking if cached)
  let db = memoryCache;
  if (db.length === 0) {
      db = await fetchDatabase();
  } else {
      // Trigger background update if needed, but don't await
      fetchDatabase(); 
  }
  
  const normalize = (s: string) => s.trim().toUpperCase().replace(/[-\s]/g, '');
  const target = normalize(query);
  
  // High-performance lookup
  // 1. Exact match
  const exact = db.find(p => normalize(p.partNumber) === target);
  if (exact) return exact;

  // 2. Fuzzy/Contains match
  if (target.length >= 3) {
      const found = db.find(p => {
          const pNorm = normalize(p.partNumber);
          return pNorm.includes(target) || target.includes(pNorm);
      });
      if (found) return found;
  }
  
  return null;
};