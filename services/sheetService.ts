import { Product } from '../types';

// The Google Sheet ID provided by the user
const SPREADSHEET_ID = '1t0V0t5qpkL2zNZjHWPj_7ZRsxRXuzfrXikPGgqKDL_k';
const CSV_URL = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export?format=csv`;

const CACHE_KEY = 'pixelpos_product_db';
const TIMESTAMP_KEY = 'pixelpos_db_timestamp';
const CACHE_TTL = 1000 * 60 * 5; // Reduced cache to 5 minutes for freshness

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
    // Add timestamp to bypass browser/CDN cache
    const urlWithTimestamp = `${CSV_URL}&t=${now}`;
    
    // Explicitly set cache to no-store to ensure freshness
    const res = await fetch(urlWithTimestamp, { 
        cache: 'no-store',
        headers: { 'Pragma': 'no-cache', 'Cache-Control': 'no-cache' }
    });
    
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

export interface SearchResult {
  exact: Product | null;
  candidates: Product[];
}

export const searchProduct = async (query: string): Promise<SearchResult> => {
  // Ensure we have data (force update if cache is empty or very old)
  let db = memoryCache;
  if (db.length === 0) {
      db = await fetchDatabase(true);
  } else {
      // Background refresh if older than TTL
      fetchDatabase(); 
  }
  
  const normalize = (s: string) => s.trim().toUpperCase().replace(/[-\s]/g, '');
  const target = normalize(query);
  
  // 1. Exact match
  const exact = db.find(p => normalize(p.partNumber) === target);
  if (exact) {
      return { exact, candidates: [] };
  }

  // 2. Fuzzy/Candidate Search
  // Logic: 
  // - Matches if query is a substring of partNumber (or vice versa)
  // - OR if Levenshtein distance is small (<= 2 for strings > 4 chars)
  
  const candidates = db.filter(p => {
      const pNorm = normalize(p.partNumber);
      
      // Too short to be meaningful fuzzy match
      if (pNorm.length < 3 || target.length < 3) return false;

      // Substring match (strong candidate)
      if (pNorm.includes(target) || target.includes(pNorm)) return true;

      // Edit distance (typo candidate)
      // Only check if lengths are somewhat similar
      if (Math.abs(pNorm.length - target.length) <= 2) {
          const dist = levenshtein(pNorm, target);
          // Allow 1 error for short strings, 2 for longer
          const threshold = target.length > 5 ? 2 : 1;
          if (dist <= threshold) return true;
      }

      return false;
  })
  // Sort candidates: Starts with target > Includes > Edit Distance
  .sort((a, b) => {
      const aNorm = normalize(a.partNumber);
      const bNorm = normalize(b.partNumber);
      
      const aStarts = aNorm.startsWith(target);
      const bStarts = bNorm.startsWith(target);
      if (aStarts && !bStarts) return -1;
      if (!aStarts && bStarts) return 1;

      return 0;
  })
  .slice(0, 5); // Return top 5 candidates
  
  return { exact: null, candidates };
};