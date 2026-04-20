import { Product, CartItem } from '../types';
import Papa from 'papaparse';

// Use a unique key for the "regi" app to prevent conflict with other apps on same domain
const CACHE_KEY = 'pixelpos_regi_product_db';

// Extended Product type for internal optimization
interface CachedProduct extends Product {
  _norm: string; // Pre-calculated normalized part number for fast matching
}

// In-memory mirror
let memoryCache: CachedProduct[] = [];

// Helper: Normalize string (remove spaces, hyphens, uppercase)
const normalize = (s: string) => s.trim().toUpperCase().replace(/[-\s]/g, '');

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
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + cost
      );
    }
  }
  return d[s.length][t.length];
};

const parseCSV = (text: string): string[][] => {
  let cleanText = text.replace(/^\uFEFF/, '');
  cleanText = cleanText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const result = Papa.parse<string[]>(cleanText, {
    skipEmptyLines: true,
  });
  return result.data;
};

const toHalfWidth = (str: string) => {
  return str.replace(/[０-９]/g, (s) => {
    return String.fromCharCode(s.charCodeAt(0) - 0xFEE0);
  });
};

export class SheetError extends Error {
  constructor(public status: string, message: string) {
    super(message);
    this.name = 'SheetError';
  }
}

const fetchWithRetry = async (url: string, retries = 1, timeout = 15000): Promise<Response> => {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(url, { cache: 'no-store', signal: controller.signal });
    clearTimeout(id);
    if (!res.ok) {
      throw new SheetError(res.status.toString(), `HTTP_${res.status}`);
    }
    return res;
  } catch (error: any) {
    clearTimeout(id);
    if (retries > 0 && error.name !== 'AbortError') {
      console.warn(`Fetch failed (${error.message}), retrying...`);
      await new Promise(r => setTimeout(r, 1000));
      return fetchWithRetry(url, retries - 1, timeout);
    }
    if (error.name === 'AbortError') throw new SheetError('TIMEOUT', 'Request timed out');
    throw error;
  }
};

// Internal function to hydrate memory cache from raw product list
const hydrateCache = (products: Product[]) => {
  memoryCache = products.map(p => ({
    ...p,
    _norm: normalize(p.partNumber)
  }));
  console.log(`Hydrated memory cache with ${memoryCache.length} items.`);
};

export const clearCache = () => {
  console.log("Clearing product database cache...");
  memoryCache = [];
};

const fetchDatabase = async (): Promise<Product[]> => {
  const now = Date.now();
  console.log(`Fetching DB from /DATA.csv`);

  try {
    const url = `/regi/DATA.csv?v=${now}`;
    const res = await fetchWithRetry(url, 1, 15000);
    const text = await res.text();

    if (text.trim().startsWith('<!DOCTYPE html>') || text.includes('<html')) {
      throw new SheetError('404', 'DATA.csv not found');
    }

    const rows = parseCSV(text);
    const products: Product[] = [];

    // Header: 品番, 商品名, 金額
    let idxPartNum = 0;
    let idxName = 1;
    let idxPrice = 2;

    if (rows.length > 0) {
      const header = rows[0].map(c => c.replace(/[\uFEFF\u200B-\u200D]/g, '').trim());
      const foundPartNum = header.findIndex(h => h === '品番');
      const foundName = header.findIndex(h => h === '商品名');
      const foundPrice = header.findIndex(h => h === '金額');

      if (foundPartNum !== -1) idxPartNum = foundPartNum;
      if (foundName !== -1) idxName = foundName;
      if (foundPrice !== -1) idxPrice = foundPrice;
    }

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (row.length <= Math.max(idxPartNum, idxName, idxPrice)) continue;

      const partNumber = row[idxPartNum]?.trim();
      const name = row[idxName]?.trim();
      const priceClean = toHalfWidth(row[idxPrice]?.trim() || '0').replace(/[",]/g, '');
      const price = parseFloat(priceClean);

      if (partNumber && !isNaN(price)) {
        products.push({ id: partNumber, partNumber, name, price });
      }
    }

    hydrateCache(products);
    return products;
  } catch (e: any) {
    console.error("CSV Fetch Error:", e);
    if (memoryCache.length > 0) {
      console.warn("Using stale cache due to fetch error.");
      return memoryCache;
    }
    throw e;
  }
};

// Public method to trigger preload
export const preloadDatabase = async () => {
  return fetchDatabase();
};

export const fetchServiceItems = async (): Promise<Product[]> => {
  try {
    const now = Date.now();
    const url = `/regi/ServiceItems.csv?v=${now}`;

    const res = await fetchWithRetry(url, 1, 10000);
    const text = await res.text();

    const rows = parseCSV(text);
    if (rows.length < 2) return [];

    const headers = rows[0].map(h => h.toLowerCase().trim());

    let hasHeader = false;
    let idxName = headers.findIndex(h => ['name', 'サービス名', '商品名', '品名'].includes(h));
    let idxPrice = headers.findIndex(h => ['price', '金額', '価格', '単価'].includes(h));

    if (idxName !== -1 || idxPrice !== -1) hasHeader = true;
    if (idxName === -1) idxName = 0;
    if (idxPrice === -1) idxPrice = 1;

    const items: Product[] = [];
    const startIndex = hasHeader ? 1 : 0;

    for (let i = startIndex; i < rows.length; i++) {
      const cols = rows[i];
      if (cols.length <= Math.max(idxName, idxPrice)) continue;

      const name = cols[idxName]?.trim();
      let rawPrice = cols[idxPrice]?.trim() || '0';
      rawPrice = toHalfWidth(rawPrice).replace(/[",]/g, '');
      const price = parseFloat(rawPrice);

      if (name && !isNaN(price)) {
        items.push({ id: `SVC-${i}-${now}`, partNumber: 'Service', name, price });
      }
    }
    return items;
  } catch (e) {
    console.error("Failed to fetch service items", e);
    throw e;
  }
};

export interface SearchResult {
  exact: Product | null;
  candidates: Product[];
}

export const searchProduct = async (query: string): Promise<SearchResult> => {
  if (memoryCache.length === 0) {
    console.log("Cache empty during search, fetching synchronously...");
    await fetchDatabase();
  } else {
    console.log(`Searching in cache (${memoryCache.length} items)...`);
  }

  const target = normalize(query);
  const targetLen = target.length;

  // Exact match
  const exact = memoryCache.find(p => p._norm === target);
  if (exact) {
    const { _norm, ...cleanProduct } = exact;
    return { exact: cleanProduct, candidates: [] };
  }

  // Fuzzy candidates
  const potentialCandidates = memoryCache.filter(p => {
    const pLen = p._norm.length;
    if (Math.abs(pLen - targetLen) > 2) return false;
    if (pLen < 3 || targetLen < 3) return false;
    return true;
  });

  const candidates = potentialCandidates
    .filter(p => {
      if (p._norm.includes(target) || target.includes(p._norm)) return true;
      const dist = levenshtein(p._norm, target);
      return dist <= (targetLen > 5 ? 2 : 1);
    })
    .sort((a, b) => {
      const aStarts = a._norm.startsWith(target);
      const bStarts = b._norm.startsWith(target);
      if (aStarts && !bStarts) return -1;
      if (!aStarts && bStarts) return 1;
      return 0;
    })
    .slice(0, 5)
    .map(p => {
      const { _norm, ...rest } = p;
      return rest;
    });

  return { exact: null, candidates };
};

export const isProductKnown = (id: string): boolean => {
  return memoryCache.some(p => p.id === id);
};

// ローカルCSV運用のため、未登録商品はコンソールログのみ記録
export const logUnknownItem = (item: CartItem) => {
  console.log(`Unknown item scanned (not registered in DATA.csv): ${item.partNumber} / ${item.name}`);
};

// ローカルCSV運用のため、シート更新はメモリキャッシュのみ更新
// DATA.csvの編集はVPS上で直接行ってください
export const updateSheetItem = async (payload: {
  id: string;
  name: string;
  price: number;
  action: 'UPDATE';
}) => {
  const newItem: Product = {
    id: payload.id,
    partNumber: payload.id,
    name: payload.name,
    price: payload.price,
  };

  const existingIdx = memoryCache.findIndex(p => p.id === payload.id);
  if (existingIdx >= 0) {
    memoryCache[existingIdx] = { ...newItem, _norm: normalize(newItem.partNumber) };
  } else {
    memoryCache.push({ ...newItem, _norm: normalize(newItem.partNumber) });
  }

  console.log(`Cache updated for item: ${payload.id}. Note: DATA.csv on the VPS was NOT modified. Edit it manually if needed.`);
};