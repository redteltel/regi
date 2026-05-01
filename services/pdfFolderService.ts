const DB_NAME = 'pixelpos_pdf_folder';
const STORE_NAME = 'handles';
const HANDLE_KEY = 'root';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getStoredHandle(): Promise<any | null> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(HANDLE_KEY);
      req.onsuccess = () => { db.close(); resolve(req.result ?? null); };
      req.onerror = () => { db.close(); resolve(null); };
    });
  } catch {
    return null;
  }
}

async function storeHandle(handle: any): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(handle, HANDLE_KEY);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); resolve(); };
    });
  } catch {}
}

// Saves pdfBlob into <rootFolder>/YYYY-MM-DD/<receiptFileName>
// On first call, showDirectoryPicker lets the user choose the root folder (e.g. "PDF").
// The handle is persisted in IndexedDB and reused on subsequent calls.
export async function savePdfToFolder(pdfBlob: Blob, receiptFileName: string): Promise<string> {
  // @ts-ignore
  if (!('showDirectoryPicker' in window)) {
    throw new Error('このブラウザはフォルダ保存に対応していません（Chrome推奨）');
  }

  let rootHandle: any = await getStoredHandle();

  if (rootHandle) {
    try {
      const perm = await rootHandle.queryPermission({ mode: 'readwrite' });
      if (perm !== 'granted') {
        const newPerm = await rootHandle.requestPermission({ mode: 'readwrite' });
        if (newPerm !== 'granted') rootHandle = null;
      }
    } catch {
      rootHandle = null;
    }
  }

  if (!rootHandle) {
    // @ts-ignore
    rootHandle = await window.showDirectoryPicker({
      id: 'pdf-receipts',
      mode: 'readwrite',
      startIn: 'documents',
    });
    await storeHandle(rootHandle);
  }

  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const dateStr = `${y}-${m}-${d}`;

  const dateFolder = await rootHandle.getDirectoryHandle(dateStr, { create: true });
  const fileHandle = await dateFolder.getFileHandle(receiptFileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(pdfBlob);
  await writable.close();

  return `${dateStr}/${receiptFileName}`;
}

// Clear stored folder handle (user can re-select a different folder)
export async function clearStoredFolder(): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(HANDLE_KEY);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); resolve(); };
    });
  } catch {}
}
