import { Product, CartItem } from '../types';

// The Google Sheet ID provided by the user
const SPREADSHEET_ID = '1t0V0t5qpkL2zNZjHWPj_7ZRsxRXuzfrXikPGgqKDL_k';

// BASE_URL: Used for the main product database (Scan). Defaults to the first sheet.
const BASE_URL = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export?format=csv`;

// GVIZ_URL: Used for specific sheets like 'ServiceItems'. More reliable for sheet selection by name.
const GVIZ_URL = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv`;

// GAS Web App URL for logging unknown items directly to the Master Sheet (Product Reference)
// Updated to the new endpoint provided
const GAS_LOG_ENDPOINT = 'https://script.google.com/macros/s/AKfycbwTNFLC9WbUkebBONdw5oQgfZS1SkYtyTS5As4Pk_x4yVAQIyaD_KieZTxTkadwXkWP/exec'; 

const SHEET_NAME_SERVICE = 'ServiceItems';

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

// Helper to convert full-width numbers to half-width
const toHalfWidth = (str: string) => {
  return str.replace(/[０-９]/g, (s) => {
    return String.fromCharCode(s.charCodeAt(0) - 0xFEE0);
  });
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
    const urlWithTimestamp = `${BASE_URL}&t=${now}`;
    
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
        
        // Clean price string: Remove non-numeric, handle full-width
        const priceClean = toHalfWidth(row[2]).replace(/[^0-9]/g, '');
        const price = parseInt(priceClean, 10);

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

// Fetch Service Items from the separate "ServiceItems" sheet
export const fetchServiceItems = async (): Promise<Product[]> => {
  try {
      const now = Date.now();
      const encodedSheetName = encodeURIComponent(SHEET_NAME_SERVICE);
      // Use GVIZ URL to explicitly fetch the named sheet
      const url = `${GVIZ_URL}&sheet=${encodedSheetName}&t=${now}`;
      
      console.log(`Fetching Service Items from: ${url}`);
      
      const res = await fetch(url, { 
        cache: 'no-store',
        headers: { 'Pragma': 'no-cache', 'Cache-Control': 'no-cache' }
      });
      
      if (!res.ok) {
          console.error(`Service fetch failed: ${res.status} ${res.statusText}`);
          return [];
      }
      
      const text = await res.text();
      const rows = parseCSV(text);
      
      if (rows.length < 2) return [];

      // Flexible Header Detection
      const header = rows[0].map(c => c.toLowerCase());
      
      // Look for columns containing keywords
      let idxName = header.findIndex(h => h.includes('name') || h.includes('品名') || h.includes('項目') || h.includes('item'));
      let idxPrice = header.findIndex(h => h.includes('price') || h.includes('cost') || h.includes('単価') || h.includes('価格') || h.includes('金額'));
      let idxCategory = header.findIndex(h => h.includes('category') || h.includes('cat') || h.includes('note') || h.includes('memo') || h.includes('備考') || h.includes('分類'));

      // Defaults if not found (legacy support)
      if (idxName === -1) idxName = 0;
      if (idxPrice === -1) idxPrice = 1;
      // If category is not found, default to 2 if available, otherwise ignore
      if (idxCategory === -1 && rows[0].length > 2) {
          // Find a column that isn't name or price
          for(let i=0; i<rows[0].length; i++) {
              if (i !== idxName && i !== idxPrice) {
                  idxCategory = i;
                  break;
              }
          }
      }

      console.log(`Detected Columns - Name:${idxName}, Price:${idxPrice}, Cat:${idxCategory}`);

      const items: Product[] = [];
      // Skip Header (Row 0)
      for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          // Ensure row has enough columns
          const maxIdx = Math.max(idxName, idxPrice);
          if (row.length <= maxIdx) continue;
          
          const name = row[idxName]?.trim();
          
          // Robust Price Parsing
          let rawPrice = row[idxPrice] || "0";
          rawPrice = toHalfWidth(rawPrice).replace(/[¥,円\s]/g, '');
          const price = parseInt(rawPrice, 10);
          
          const category = (idxCategory !== -1 && row[idxCategory]) ? row[idxCategory].trim() : '';

          if (name && !isNaN(price)) {
              items.push({
                  id: `SVC-${i}-${now}`, // Unique temporary ID
                  partNumber: category || 'Service', // Use category as partNumber for display
                  name: name,
                  price: price
              });
          }
      }
      
      console.log(`Parsed ${items.length} service items from sheet '${SHEET_NAME_SERVICE}'.`);
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
  const candidates = db.filter(p => {
      const pNorm = normalize(p.partNumber);
      if (pNorm.length < 3 || target.length < 3) return false;
      if (pNorm.includes(target) || target.includes(pNorm)) return true;
      if (Math.abs(pNorm.length - target.length) <= 2) {
          const dist = levenshtein(pNorm, target);
          const threshold = target.length > 5 ? 2 : 1;
          if (dist <= threshold) return true;
      }
      return false;
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

// Check if a product ID exists in the current cache
export const isProductKnown = (id: string): boolean => {
    // If cache is empty, technically we don't know, but treating as unknown is safer
    if (memoryCache.length === 0) return false;
    
    // We check if any product in our DB has this ID (partNumber)
    // Note: IDs in memoryCache are partNumbers
    return memoryCache.some(p => p.id === id);
};

// Log unknown/manual items to Google Sheet via GAS
export const logUnknownItem = async (item: CartItem) => {
    if (!GAS_LOG_ENDPOINT) {
        console.warn("GAS_LOG_ENDPOINT is not configured. Skipping log.");
        return;
    }

    try {
        const payload = {
            // CRITICAL: Force the 'id' field to use the edited partNumber.
            // Even if item.id (the scanned value) is different, the partNumber (edited value)
            // is what we want to register as the new master ID.
            id: item.partNumber, 
            partNumber: item.partNumber,
            name: item.name,
            price: item.price,
            quantity: item.quantity
        };

        // Fire and forget using no-cors to avoid CORS errors with simple GAS setups
        // Note: 'no-cors' means we can't read the response, but it submits the data.
        await fetch(GAS_LOG_ENDPOINT, {
            method: 'POST',
            mode: 'no-cors', 
            headers: {
                'Content-Type': 'text/plain',
            },
            body: JSON.stringify(payload)
        });
        console.log(`Logged unknown item to Master Sheet (Reference): ${item.partNumber}`);
    } catch (e) {
        console.error("Failed to log unknown item:", e);
    }
};