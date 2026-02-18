import { Product, CartItem } from '../types';

// The Google Sheet ID provided by the user
const SPREADSHEET_ID = '1t0V0t5qpkL2zNZjHWPj_7ZRsxRXuzfrXikPGgqKDL_k';

// BASE_URL: Used for the main product database (Scan). Defaults to the first sheet.
const BASE_URL = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export?format=csv`;

// GVIZ_URL: Used for specific sheets like 'ServiceItems'. More reliable for sheet selection by name.
const GVIZ_URL = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv`;

// GAS Web App URL for logging unknown items directly to the Master Sheet (Product Reference)
const GAS_LOG_ENDPOINT = 'https://script.google.com/macros/s/AKfycbyu5qtOa8jxSGPkQigUI5ppm2a14nca6EK9IzYXBnvcuUD8gyv7hrd7LXes6pli8N1B/exec';

const SHEET_NAME_SERVICE = 'ServiceItems';

const CACHE_KEY = 'pixelpos_product_db';
const TIMESTAMP_KEY = 'pixelpos_db_timestamp';
const CACHE_TTL = 1000 * 60 * 5; // 5 minutes cache

// In-memory mirror for instant access
let memoryCache: Product[] = [];

// Levenshtein distance for fuzzy matching
const levenshtein = (s: string, t: string): number => {
  if (s === t) return 0;
  if (s.length === 0) return t.length;
  if (t.length === 0) return s.length;
  
  const d: number[][] = [];
  for (let i = 0; i <= s.length; i++) d[i] = [i];
  for (let j = 0; j <= t.length; j++) d[0][j] = j;

  for (let i = 1; i <= s.length; i++) {
    for (let j = 1; j <= t.length; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      d[i][j] = Math.min(
        d[i - 1][j] + 1,      // deletion
        d[i][j - 1] + 1,      // insertion
        d[i - 1][j - 1] + cost // substitution
      );
    }
  }
  return d[s.length][t.length];
};

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

// Helper to convert full-width numbers to half-width
const toHalfWidth = (str: string) => {
  return str.replace(/[０-９]/g, (s) => {
    return String.fromCharCode(s.charCodeAt(0) - 0xFEE0);
  });
};

// Custom Error Class for Sheet Operations
export class SheetError extends Error {
  constructor(public status: string, message: string) {
    super(message);
    this.name = 'SheetError';
  }
}

// Robust Fetch with Timeout and Retry
const fetchWithRetry = async (url: string, options: RequestInit = {}, retries = 1, timeout = 10000): Promise<Response> => {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    
    if (!res.ok) {
        throw new SheetError(res.status.toString(), `HTTP_${res.status}`);
    }
    return res;
  } catch (error: any) {
    clearTimeout(id);
    
    const isClientError = error instanceof SheetError && error.status.startsWith('4') && error.status !== '429' && error.status !== '408';
    const isAbort = error.name === 'AbortError';

    if (retries > 0 && !isClientError) {
      console.warn(`Fetch failed (${error.message}), retrying... (${retries} left)`);
      await new Promise(r => setTimeout(r, 1000));
      return fetchWithRetry(url, options, retries - 1, timeout);
    }
    
    if (isAbort) {
        throw new SheetError('TIMEOUT', 'Request timed out');
    }
    
    throw error;
  }
};

const loadFromLocal = (): Product[] => {
  try {
    const json = localStorage.getItem(CACHE_KEY);
    if (json) {
      const data = JSON.parse(json);
      return data;
    }
  } catch (e) {
    console.error("Failed to load local cache", e);
  }
  return [];
};

memoryCache = loadFromLocal();

const fetchDatabase = async (forceUpdate = false): Promise<Product[]> => {
  const now = Date.now();
  const lastFetch = parseInt(localStorage.getItem(TIMESTAMP_KEY) || '0', 10);

  if (!forceUpdate && memoryCache.length > 0 && (now - lastFetch < CACHE_TTL)) {
    return memoryCache;
  }

  try {
    const urlWithTimestamp = `${BASE_URL}&t=${now}`;
    const res = await fetchWithRetry(urlWithTimestamp, {}, 1, 10000);
    const text = await res.text();

    if (text.trim().startsWith('<!DOCTYPE html>') || text.includes('<html')) {
        throw new SheetError('403_HTML', 'Spreadsheet permission denied (Login page returned)');
    }

    const rows = parseCSV(text);
    const products: Product[] = [];
    
    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (row.length < 3) continue;

        const partNumber = row[0];
        const name = row[1];
        const priceClean = toHalfWidth(row[2]).replace(/[^0-9]/g, '');
        const price = parseInt(priceClean, 10);

        if (partNumber && !isNaN(price)) {
            products.push({ id: partNumber, partNumber, name, price });
        }
    }
    
    memoryCache = products;
    localStorage.setItem(CACHE_KEY, JSON.stringify(products));
    localStorage.setItem(TIMESTAMP_KEY, now.toString());
    
    console.log(`Updated cache with ${products.length} products.`);
    return products;
  } catch (e: any) {
    console.error("Sheet Service Error:", e);
    if (memoryCache.length > 0) {
        console.warn("Returning stale cache due to fetch error.");
        return memoryCache;
    }
    throw e;
  }
};

export const fetchServiceItems = async (): Promise<Product[]> => {
  try {
      const now = Date.now();
      const encodedSheetName = encodeURIComponent(SHEET_NAME_SERVICE);
      const url = `${GVIZ_URL}&sheet=${encodedSheetName}&t=${now}`;
      
      const res = await fetchWithRetry(url, {}, 1, 10000);
      const text = await res.text();
      const rows = parseCSV(text);
      
      if (rows.length < 2) return [];

      const header = rows[0].map(c => c.toLowerCase());
      let idxName = header.findIndex(h => h.includes('name') || h.includes('品名') || h.includes('項目') || h.includes('item'));
      let idxPrice = header.findIndex(h => h.includes('price') || h.includes('cost') || h.includes('単価') || h.includes('価格') || h.includes('金額'));
      let idxCategory = header.findIndex(h => h.includes('category') || h.includes('cat') || h.includes('note') || h.includes('memo') || h.includes('備考') || h.includes('分類'));

      if (idxName === -1) idxName = 0;
      if (idxPrice === -1) idxPrice = 1;
      if (idxCategory === -1 && rows[0].length > 2) {
          for(let i=0; i<rows[0].length; i++) {
              if (i !== idxName && i !== idxPrice) {
                  idxCategory = i;
                  break;
              }
          }
      }

      const items: Product[] = [];
      for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          const maxIdx = Math.max(idxName, idxPrice);
          if (row.length <= maxIdx) continue;
          
          const name = row[idxName]?.trim();
          let rawPrice = row[idxPrice] || "0";
          rawPrice = toHalfWidth(rawPrice).replace(/[¥,円\s]/g, '');
          const price = parseInt(rawPrice, 10);
          const category = (idxCategory !== -1 && row[idxCategory]) ? row[idxCategory].trim() : '';

          if (name && !isNaN(price)) {
              items.push({
                  id: `SVC-${i}-${now}`,
                  partNumber: category || 'Service',
                  name: name,
                  price: price
              });
          }
      }
      return items;
  } catch (e) {
      console.error("Failed to fetch service items", e);
      return [];
  }
}

export interface SearchResult {
  exact: Product | null;
  candidates: Product[];
}

export const searchProduct = async (query: string): Promise<SearchResult> => {
  let db = memoryCache;
  
  if (db.length === 0) {
      db = await fetchDatabase(true);
  } else {
      fetchDatabase(); 
  }
  
  const normalize = (s: string) => s.trim().toUpperCase().replace(/[-\s]/g, '');
  const target = normalize(query);
  const targetLen = target.length;
  
  // 1. Exact Match (Fastest)
  const exact = db.find(p => normalize(p.partNumber) === target);
  if (exact) {
      return { exact, candidates: [] };
  }

  // 2. Optimized Candidates Search
  // Avoid running Levenshtein on everything.
  // First, filter by simple heuristics (length & includes)
  const potentialCandidates = db.filter(p => {
      const pNorm = normalize(p.partNumber);
      const pLen = pNorm.length;

      // Filter out items that are too different in length
      if (Math.abs(pLen - targetLen) > 2) return false;
      if (pLen < 3 || targetLen < 3) return false;

      // Check simple inclusion
      if (pNorm.includes(target) || target.includes(pNorm)) return true;

      return true; // Pass to Levenshtein check
  });

  // Now apply detailed scoring on smaller subset
  const candidates = potentialCandidates.filter(p => {
      const pNorm = normalize(p.partNumber);
      // Already checked length and inclusion above, verify distance for others
      if (pNorm.includes(target) || target.includes(pNorm)) return true;
      
      const dist = levenshtein(pNorm, target);
      const threshold = targetLen > 5 ? 2 : 1;
      return dist <= threshold;
  })
  .sort((a, b) => {
      const aNorm = normalize(a.partNumber);
      const bNorm = normalize(b.partNumber);
      const aStarts = aNorm.startsWith(target);
      const bStarts = bNorm.startsWith(target);
      if (aStarts && !bStarts) return -1;
      if (!aStarts && bStarts) return 1;
      return 0;
  })
  .slice(0, 5); 
  
  return { exact: null, candidates };
};

export const isProductKnown = (id: string): boolean => {
    if (memoryCache.length === 0) return false;
    return memoryCache.some(p => p.id === id);
};

export const logUnknownItem = async (item: CartItem) => {
    if (!GAS_LOG_ENDPOINT) {
        console.warn("GAS_LOG_ENDPOINT is not configured.");
        return;
    }

    try {
        const payload = {
            sheetName: "品番参照", 
            id: item.partNumber, 
            name: item.name,     
            partNumber: item.partNumber,
            price: item.price,
            quantity: item.quantity
        };

        await fetch(GAS_LOG_ENDPOINT, {
            method: 'POST',
            mode: 'no-cors', 
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify(payload)
        });
        console.log(`Logged unknown item: ${item.partNumber}`);
    } catch (e) {
        console.error("Failed to log unknown item:", e);
    }
};