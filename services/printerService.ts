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
      if (type === 'BLUETOOTH') {
          // MP-B20: Web Bluetooth API
          if (!this.characteristic) {
              try {
                  await this.connectBluetooth();
              } catch (e) {
                  console.error("Bluetooth connection failed", e);
                  return;
              }
          }
          
          if (this.characteristic) {
              try {
                  // Write data in chunks to avoid MTU limits
                  const CHUNK_SIZE = 512; // Safe chunk size
                  for (let i = 0; i < data.byteLength; i += CHUNK_SIZE) {
                      const chunk = data.slice(i, i + CHUNK_SIZE);
                      await this.characteristic.writeValue(chunk);
                  }
              } catch (e) {
                  console.error("Bluetooth write failed", e);
                  // Attempt reconnect?
              }
          }
      }
      // SUNMI is handled via Intent in printReceipt directly, 
      // but if called here, we can fallback or ignore.
  }

  // Web Bluetooth Connection Logic (Restored for MP-B20)
  async connectBluetooth(): Promise<any> {
      try {
          this.device = await navigator.bluetooth.requestDevice({
              filters: [{ services: [SERVICE_UUID] }]
          });

          if (!this.device) throw new Error("No device selected");
          
          this.device.addEventListener('gattserverdisconnected', this.handleDisconnect.bind(this));

          const server = await this.device.gatt?.connect();
          if (!server) throw new Error("GATT server connection failed");

          const service = await server.getPrimaryService(SERVICE_UUID);
          this.characteristic = await service.getCharacteristic(CHAR_UUID);

          this.log(`Connected to ${this.device.name}`);
          return this.device;
      } catch (error) {
          this.log(`Connection error: ${error}`);
          throw error;
      }
  }

  private handleDisconnect() {
      this.log("Bluetooth disconnected");
      this.device = null;
      this.characteristic = null;
      if (this.onDisconnect) this.onDisconnect();
  }

  isConnected(): boolean {
      return !!this.characteristic;
  }
  
  disconnect() {
      if (this.device && this.device.gatt?.connected) {
          this.device.gatt.disconnect();
      }
  }
  
  restoreBluetoothConnection() {
      // Web Bluetooth requires user gesture for reconnection usually, 
      // but we can check if already connected.
      return Promise.resolve(this.isConnected());
  }

  private encode(text: string): number[] {
    // Both SUNMI and MP-B20 use Shift-JIS for this text-mode implementation
    // to support the requested Japanese mode switching commands.
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

  async printReceipt(
      items: CartItem[], 
      subTotal: number, 
      tax: number, 
      total: number,
      mode: 'RECEIPT' | 'FORMAL' | 'INVOICE' | 'ESTIMATION' = 'RECEIPT',
      recipientName: string = '',
      proviso: string = '',
      paymentDeadline: string = '',
      discount: number = 0,
      logoUrl: string | null = null,
      settings: StoreSettings,
      finalTax?: number,
      storeMemo?: string
  ) {
    this.setPrinterType(settings.printerType);
    this.log("Generating Receipt...");

    // --- Unified RawBT Printing (SUNMI & MP-B20) ---
    // We construct text content and send it via RawBT intent for both printer types.
    
    let text = "";

    const title = mode === 'FORMAL' ? "領 収 証" : 
                  mode === 'INVOICE' ? "請 求 書" : 
                  mode === 'ESTIMATION' ? "御 見 積 書" : "領収書";
    
    // Helper for visual length (simple approximation)
    const getLen = (str: string) => {
        let len = 0;
        for (let i = 0; i < str.length; i++) {
            len += (str.charCodeAt(i) > 255 ? 2 : 1);
        }
        return len;
    };

    // Helper for centering
    const center = (str: string) => {
        const spaces = Math.max(0, Math.floor((32 - getLen(str)) / 2));
        return " ".repeat(spaces) + str + "\n";
    };

    // Helper for right align
    const right = (str: string) => {
        const spaces = Math.max(0, 32 - getLen(str));
        return " ".repeat(spaces) + str + "\n";
    };

    // Header
    text += center(title + (false ? " (控え)" : "")); // Copy disabled
    text += "\n";
    text += right(new Date().toLocaleString());
    text += "\n";

    // Recipient / details
    if (mode === 'FORMAL' || mode === 'INVOICE' || mode === 'ESTIMATION') {
        text += (recipientName || "          ") + " 様\n\n";
        
        if (mode === 'INVOICE') text += right("下記の通りご請求申し上げます。");
        if (mode === 'ESTIMATION') text += right("下記の通り御見積申し上げます。");

        text += center(total.toLocaleString() + "円");
        text += "\n";
        
        if (mode === 'FORMAL') {
            text += `但 ${proviso || "お品代"}として\n`;
            text += "上記正に領収いたしました\n\n";
        }
        if (mode === 'INVOICE' && paymentDeadline) {
            text += right(`お支払期限: ${paymentDeadline}`);
            text += "\n";
        }
        if (mode === 'ESTIMATION') {
            const d = new Date();
            d.setMonth(d.getMonth() + 1);
            text += right(`有効期限: ${d.toLocaleDateString()}`);
            text += "\n";
        }
    }

    text += center("--------------------------------");

    // Items
    for (const item of items) {
        text += item.name + "\n";
        if (item.partNumber) {
            text += `  (品番: ${item.partNumber})\n`;
        }
        const line = `${item.quantity} x ${item.price.toLocaleString()}円`;
        const totalStr = `${(item.price * item.quantity).toLocaleString()}円`;
        
        const spaceLen = 32 - (getLen(line) + getLen(totalStr));
        const padding = " ".repeat(Math.max(1, spaceLen));
        text += line + padding + totalStr + "\n";
    }

    text += center("--------------------------------");

    // Totals
    text += right(`小計: ${subTotal.toLocaleString()}円`);
    const taxToDisplay = (discount > 0 && finalTax !== undefined) ? finalTax : tax;
    text += right(`消費税(10%): ${taxToDisplay.toLocaleString()}円`);

    if (discount > 0) {
        const initialTotal = subTotal + tax;
        text += right(`合計(値引前): ${initialTotal.toLocaleString()}円`);
        text += right(`値引(税込): - ${discount.toLocaleString()}円`);
    }

    if (mode === 'RECEIPT') {
        text += "\n";
        text += center(`合計: ${total.toLocaleString()}円`);
    }

    if (discount > 0 && finalTax !== undefined) {
        text += right(`(内消費税等: ${finalTax.toLocaleString()}円)`);
    }
    text += "\n";

    // Footer
    text += center(settings.storeName);
    text += center(`〒${settings.zipCode}`);
    text += center(settings.address1);
    if (settings.address2) text += center(settings.address2);
    text += center(`電話: ${settings.tel}`);
    text += center(`登録番号: ${settings.registrationNum}`);

    if (mode === 'FORMAL' || mode === 'INVOICE' || mode === 'ESTIMATION') {
        text += right("(印)");
    }

    if (mode === 'FORMAL' && total >= 50000) {
        text += "\n";
        text += right("----------");
        text += right("| 収入印紙 |");
        text += right("----------");
    }

    text += "\n";

    if (settings.bankName) {
        text += center("--------------------------------");
        text += "【お振込先】\n";
        text += `${settings.bankName} ${settings.branchName}\n`;
        text += `${settings.accountType} ${settings.accountNumber}\n`;
        text += `${settings.accountHolder}\n`;
        text += center("--------------------------------");
        text += "\n";
    }

    if (mode === 'INVOICE') text += "ご請求書を送付いたします。\n";
    else if (mode === 'ESTIMATION') {} 
    else text += "毎度ありがとうございます!\n";

    // Final Feed (User requested 4 lines to ensure print clears cutter/tear bar)
    text += "\n\n\n\n";

    // Convert text to Shift-JIS array
    const sjisData = Encoding.convert(text, {
        to: 'SJIS',
        from: 'UNICODE',
        type: 'array'
    });

    // Initialization Commands based on Printer Type
    let combinedData: number[] = [];
    
    if (settings.printerType === 'SUNMI') {
        // SUNMI: \x1C\x26 (Kanji Mode ON) + \x1B\x52\x08 (Japan) + Shift-JIS Data
        const initCmds = [0x1C, 0x26, 0x1B, 0x52, 0x08];
        combinedData = [...initCmds, ...sjisData];
    } else {
        // MP-B20 (and others): Pure Shift-JIS text, NO init commands
        // User reported content disappearance with commands, so we send pure text data.
        combinedData = [...sjisData];
    }

    // Percent-encode the binary data for URL
    let encodedStr = '';
    for (let i = 0; i < combinedData.length; i++) {
        let hex = combinedData[i].toString(16).toUpperCase();
        if (hex.length < 2) hex = '0' + hex;
        encodedStr += '%' + hex;
    }

    // Construct RawBT URL with encoded binary data
    // rawbt:http://localhost/print?text=...
    const intentUrl = `rawbt:http://localhost/print?text=${encodedStr}`;
    
    window.location.href = intentUrl;
    return;
  }
}

export const printerService = new PrinterService();