import { CartItem, StoreSettings, PrinterType } from '../types';
import Encoding from 'encoding-japanese';

// ESC/POS Commands
const ESC = 0x1B;
const GS = 0x1D;
const FS = 0x1C;
const AT = 0x40; // Initialize
const LF = 0x0A; // Line Feed
const ALIGN_CENTER = [ESC, 0x61, 1];
const ALIGN_LEFT = [ESC, 0x61, 0];
const ALIGN_RIGHT = [ESC, 0x61, 2];
const EMPHASIS_ON = [ESC, 0x45, 1];
const EMPHASIS_OFF = [ESC, 0x45, 0];
const SIZE_NORMAL = [GS, 0x21, 0x00];
const SIZE_DOUBLE = [GS, 0x21, 0x11];
const SIZE_LARGE = [GS, 0x21, 0x11]; 

// MP-B20 / Japanese Specific
const KANJI_MODE_ON = [FS, 0x26]; // FS & - Select Kanji character mode
const JIS_CODE_SYSTEM = [FS, 0x43, 0x01]; // FS C 1 - Select Shift-JIS code system
const COUNTRY_JAPAN = [ESC, 0x52, 0x08]; // ESC R 8 - Select international character set (Japan)

// MP-B20 UUIDs
const SERVICE_UUID = '000018f0-0000-1000-8000-00805f9b34fb';
const CHAR_UUID = '00002af1-0000-1000-8000-00805f9b34fb';

export class PrinterService {
  public onLog: ((msg: string) => void) | null = null;
  public onDisconnect: (() => void) | null = null;
  
  private device: BluetoothDevice | null = null;
  private characteristic: BluetoothRemoteGATTCharacteristic | null = null;
  private currentType: PrinterType = 'BLUETOOTH';

  setLogger(logger: (msg: string) => void) { this.onLog = logger; }
  setOnDisconnect(callback: () => void) { this.onDisconnect = callback; }
  setPrinterType(type: PrinterType) { this.currentType = type; }
  log(msg: string) { if (this.onLog) this.onLog(msg); console.log(msg); }

  // --- RawBT (MP-B20 via Android Intent) ---
  // Instead of Web Bluetooth, we construct a rawbt: intent URL with base64 data.
  // This is more stable on Android devices.
  
  async print(data: Uint8Array, type: PrinterType) {
      if (type === 'BLUETOOTH' || type === 'SUNMI') {
          // Convert data to Base64
          let binary = '';
          const len = data.byteLength;
          for (let i = 0; i < len; i++) {
              binary += String.fromCharCode(data[i]);
          }
          const base64 = btoa(binary);

          // Construct RawBT Intent URL
          // scheme: rawbt:base64,
          const intentUrl = `rawbt:base64,${base64}`;
          
          // Open Intent
          window.location.href = intentUrl;
          
      }
  }

  // No connection needed for RawBT (Intent fires and forgets)
  async connectBluetooth(): Promise<any> {
      return Promise.resolve({ name: 'RawBT Printer' });
  }

  isConnected(): boolean {
      // Always true for RawBT as it's fire-and-forget via Intent
      return true;
  }
  
  disconnect() {
      // No-op
  }
  
  restoreBluetoothConnection() {
      return Promise.resolve(true);
  }

  private encode(text: string): number[] {
    // SUNMI: Use UTF-8 for RawBT Image Mode
    if (this.currentType === 'SUNMI') {
        const encoder = new TextEncoder();
        return Array.from(encoder.encode(text));
    }

    // MP-B20: Default Shift-JIS conversion
    const sjisData = Encoding.convert(text, {
      to: 'SJIS',
      from: 'UNICODE',
      type: 'array'
    });
    return sjisData;
  }

  // Convert Image (URL or Base64) to ESC/POS Raster Bit Image (GS v 0)
  private async convertImageToEscPos(url: string): Promise<number[]> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "Anonymous"; // Enable CORS for local/remote images
        img.src = url;
        img.onload = () => {
            // Max width for MP-B20 is usually 384 dots (58mm)
            const MAX_WIDTH = 384;
            let width = img.width;
            let height = img.height;

            // Resize logic
            if (width > MAX_WIDTH) {
                height = Math.floor(height * (MAX_WIDTH / width));
                width = MAX_WIDTH;
            }
            
            // Ensure width is a multiple of 8
            if (width % 8 !== 0) {
                width = Math.floor(width / 8) * 8;
            }

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                reject(new Error("Canvas context not available"));
                return;
            }

            // Draw white background then image
            ctx.fillStyle = 'white';
            ctx.fillRect(0, 0, width, height);
            ctx.drawImage(img, 0, 0, width, height);

            const imageData = ctx.getImageData(0, 0, width, height);
            const data = imageData.data;
            const rasterData: number[] = [];

            // Convert to monochrome (1 bit per pixel)
            // ESC/POS GS v 0 format:
            // xL xH yL yH (Little Endian)
            // x = number of bytes in horizontal direction (width / 8)
            // y = number of dots in vertical direction
            
            const xBytes = width / 8;
            
            // Header: GS v 0 m xL xH yL yH
            rasterData.push(0x1D, 0x76, 0x30, 0x00);
            rasterData.push(xBytes & 0xFF, (xBytes >> 8) & 0xFF);
            rasterData.push(height & 0xFF, (height >> 8) & 0xFF);

            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x += 8) {
                    let byte = 0;
                    for (let b = 0; b < 8; b++) {
                        if (x + b < width) {
                            const offset = ((y * width) + (x + b)) * 4;
                            // Luminance formula
                            const r = data[offset];
                            const g = data[offset + 1];
                            const b_val = data[offset + 2];
                            const brightness = (r * 0.299 + g * 0.587 + b_val * 0.114);
                            
                            // If dark enough, set bit to 1
                            if (brightness < 128) {
                                byte |= (1 << (7 - b));
                            }
                        }
                    }
                    rasterData.push(byte);
                }
            }
            resolve(rasterData);
        };
        img.onerror = (e) => reject(new Error("Failed to load image for printing"));
    });
  }

  async printReceipt(imageDataUrl: string, settings: StoreSettings) {
    this.setPrinterType(settings.printerType);
    this.log("Generating Receipt Image...");
    
    const cmds: number[] = [];
    const add = (data: number[]) => {
        cmds.push(...data);
    };
    
    // Header & Initialization
    add([ESC, AT]); // Initialize
    
    // Convert Image to ESC/POS
    try {
        const imageCmds = await this.convertImageToEscPos(imageDataUrl);
        add(ALIGN_CENTER);
        add(imageCmds);
    } catch (e) {
        console.error("Image conversion failed", e);
        throw e;
    }

    // Final Feed and Cut
    add([LF, LF, LF]);
    add([0x1D, 0x56, 0x42, 0x00]); // GS V B 0 (Cut)

    // Send to Printer
    await this.print(new Uint8Array(cmds), settings.printerType);
  }
}

export const printerService = new PrinterService();