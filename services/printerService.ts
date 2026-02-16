import { CartItem } from '../types';
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

export class PrinterService {
  public onLog: ((msg: string) => void) | null = null;
  public onDisconnect: (() => void) | null = null;
  private buffer: number[] = [];
  private timer: any = null;

  setLogger(logger: (msg: string) => void) { this.onLog = logger; }
  setOnDisconnect(callback: () => void) { this.onDisconnect = callback; }
  log(msg: string) { if (this.onLog) this.onLog(msg); console.log(msg); }

  async connect(): Promise<any> {
    return new Promise((resolve) => {
      this.buffer = [];
      this.log("SUCCESS: RawBT Link Ready!");
      const mockDevice = {
        name: "MP-B20 (RawBT)",
        id: "rawbt-intent",
        gatt: {
          connected: true,
          connect: async () => mockDevice.gatt,
          disconnect: () => { 
            this.log("Disconnected.");
            if (this.onDisconnect) this.onDisconnect(); 
          }
        }
      };
      resolve(mockDevice);
    });
  }

  async connectBluetooth(): Promise<any> {
    this.log("Initializing RawBT Link (BT Mode)...");
    return this.connect();
  }

  async connectUsb(): Promise<string> {
    this.log("Initializing RawBT Link (USB Mode)...");
    await this.connect();
    return "MP-B20 (RawBT)";
  }

  disconnect() {
    this.log("Disconnected.");
    if (this.onDisconnect) this.onDisconnect();
  }

  isConnected(): boolean {
    return true;
  }

  async restoreBluetoothConnection(): Promise<boolean> {
    return true;
  }

  async print(data: any) {
    let bytes: Uint8Array;
    if (data instanceof Uint8Array) {
      bytes = data;
    } else if (data && data.buffer) {
      bytes = new Uint8Array(data.buffer);
    } else if (Array.isArray(data)) {
      bytes = new Uint8Array(data);
    } else {
      bytes = new TextEncoder().encode(String(data));
    }
    
    for(let i=0; i<bytes.length; i++) {
       this.buffer.push(bytes[i]);
    }
    this.log("Buffering data... " + this.buffer.length + " bytes");
    
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.flush();
    }, 1500);
  }

  flush() {
    if (this.buffer.length === 0) return;
    this.log("Finalizing receipt for RawBT...");
    try {
      let binary = '';
      for (let i = 0; i < this.buffer.length; i++) {
        binary += String.fromCharCode(this.buffer[i]);
      }
      const base64data = btoa(binary);
      // RawBT Intent: Pass raw base64 data. 
      const intentUrl = "intent:base64," + base64data + "#Intent;scheme=rawbt;package=ru.a402d.rawbtprinter;end;";
      
      this.buffer = [];
      window.location.href = intentUrl;
      this.log("SUCCESS: Receipt sent via RawBT!");
    } catch (e: any) {
      this.log("Print Error: " + e.message);
    }
  }

  private encode(text: string): number[] {
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
      logoUrl: string | null = null
  ) {
    this.log("Generating Receipt (Shift_JIS)...");
    
    const cmds: number[] = [];
    const add = (data: number[]) => {
        cmds.push(...data);
    };
    
    // Header & Initialization for Japanese
    add([ESC, AT]); // Initialize
    add(COUNTRY_JAPAN); // ESC R 8
    add(KANJI_MODE_ON); // FS & (Enable Kanji)
    add(JIS_CODE_SYSTEM); // FS C 1 (Shift JIS)
    
    add(ALIGN_CENTER);

    // Print Logo if provided
    if (logoUrl) {
        try {
            this.log("Processing logo image from: " + logoUrl);
            const imageCmds = await this.convertImageToEscPos(logoUrl);
            add(ALIGN_CENTER);
            add(imageCmds);
            add([LF]);
        } catch (e) {
            console.warn("Logo print failed:", e);
        }
    }
    
    // Title
    add(SIZE_DOUBLE);
    if (mode === 'FORMAL') {
        add(this.encode("領 収 証\n"));
    } else if (mode === 'INVOICE') {
        add(this.encode("請 求 書\n"));
    } else if (mode === 'ESTIMATION') {
        add(this.encode("御 見 積 書\n"));
    } else {
        // [FIX] Changed from "領収書 (レシート)" to "領収書"
        add(this.encode("領収書\n"));
    }
    add(SIZE_NORMAL);
    add([LF]);

    // Date
    add(ALIGN_RIGHT);
    add(this.encode(`${new Date().toLocaleString()}\n`));
    add([LF]);

    // Formal/Invoice/Estimation Details
    if (mode === 'FORMAL' || mode === 'INVOICE' || mode === 'ESTIMATION') {
        add(ALIGN_LEFT);
        add(this.encode(`${recipientName || "          "} 様\n`));
        add([LF]);
        
        if (mode === 'INVOICE') {
             add(ALIGN_RIGHT);
             add(this.encode("下記の通りご請求申し上げます。\n"));
        } else if (mode === 'ESTIMATION') {
             add(ALIGN_RIGHT);
             add(this.encode("下記の通り御見積申し上げます。\n"));
        }

        add(ALIGN_CENTER);
        add(SIZE_DOUBLE);
        add(EMPHASIS_ON);
        // [FIX] Use "円" suffix, remove "¥"
        add(this.encode(`${total.toLocaleString()}円\n`));
        add(EMPHASIS_OFF);
        add(SIZE_NORMAL);
        add([LF]);
        
        if (mode === 'FORMAL') {
            add(ALIGN_LEFT);
            add(this.encode(`但  ${proviso || "お品代"}として\n`));
            add(this.encode("上記正に領収いたしました\n"));
            add([LF]);
        }
        
        if (mode === 'INVOICE' && paymentDeadline) {
             add(ALIGN_RIGHT);
             add(this.encode(`お支払期限: ${paymentDeadline}\n`));
             add([LF]);
        }
        
        if (mode === 'ESTIMATION') {
             add(ALIGN_RIGHT);
             const d = new Date();
             d.setMonth(d.getMonth() + 1);
             add(this.encode(`有効期限: ${d.toLocaleDateString()}\n`));
             add([LF]);
        }
    }

    add(ALIGN_CENTER);
    add(this.encode("--------------------------------\n"));
    
    // Items
    add(ALIGN_LEFT);
    for (const item of items) {
        add(this.encode(`${item.name}\n`));
        // [FIX] Use "円" suffix, remove "¥"
        const line = `${item.quantity} x ${item.price.toLocaleString()}円`;
        const totalStr = `${(item.price * item.quantity).toLocaleString()}円`;
        
        // Calculate visual width for alignment (Shift_JIS)
        let lineLen = 0;
        for(let i=0; i<line.length; i++) lineLen += (line.charCodeAt(i) > 255 ? 2 : 1);
        let totalLen = 0;
        for(let i=0; i<totalStr.length; i++) totalLen += (totalStr.charCodeAt(i) > 255 ? 2 : 1);

        const spaces = 32 - (lineLen + totalLen); 
        const padding = spaces > 0 ? " ".repeat(spaces) : " ";
        add(this.encode(`${line}${padding}${totalStr}\n`));
    }
    
    add(ALIGN_CENTER);
    add(this.encode("--------------------------------\n"));
    
    // Total Breakdown
    add(ALIGN_RIGHT);
    
    // Discount Line
    if (discount > 0) {
        add(this.encode(`値引: - ${discount.toLocaleString()}円\n`));
    }
    
    // [FIX] Use "円" suffix, remove "¥"
    add(this.encode(`小計: ${subTotal.toLocaleString()}円\n`));
    add(this.encode(`(内消費税10%): ${tax.toLocaleString()}円\n`));
    
    if (mode === 'RECEIPT') {
        add([LF]);
        add(EMPHASIS_ON);
        add(SIZE_DOUBLE);
        // [FIX] Use "円" suffix, remove "¥"
        add(this.encode(`合計: ${total.toLocaleString()}円\n`));
        add(EMPHASIS_OFF);
        add(SIZE_NORMAL);
    }
    add([LF]);

    // Invoice/Estimation Bank Info
    if (mode === 'INVOICE' || mode === 'ESTIMATION') {
        add(ALIGN_LEFT);
        add(EMPHASIS_ON);
        add(this.encode("[お振込先]\n"));
        add(EMPHASIS_OFF);
        add(this.encode("天草信用金庫 瀬戸橋支店\n"));
        add(this.encode("普通口座 0088477\n"));
        // [FIX] Changed from half-width "ﾌｸｼﾏ ｶｽﾞﾋｺ" to full-width "フクシマ カズヒコ"
        add(this.encode("フクシマ カズヒコ\n"));
        add([LF]);
    }
    
    // Footer: Store Info
    add(ALIGN_CENTER);
    add(EMPHASIS_ON);
    add(this.encode("パナランドヨシダ\n"));
    add(EMPHASIS_OFF);
    add(this.encode("〒863-0015\n熊本県天草市旭町43\n"));
    add(this.encode("電話: 0969-24-0218\n"));
    add(this.encode("登録番号: T6810624772686\n"));
    
    if (mode === 'FORMAL' || mode === 'INVOICE' || mode === 'ESTIMATION') {
        add(ALIGN_RIGHT);
        add(this.encode("(印)\n"));
        add(ALIGN_CENTER);
    }

    if (mode === 'FORMAL' && total >= 50000) {
        add([LF]);
        add(ALIGN_RIGHT);
        add(this.encode("----------\n"));
        add(this.encode("| 収入印紙 |\n"));
        add(this.encode("----------\n"));
        add(ALIGN_CENTER);
    }

    add([LF]);
    if (mode === 'INVOICE') {
         add(this.encode("ご請求書を送付いたします。\n"));
    } else if (mode === 'ESTIMATION') {
         // No specific footer
    } else {
         add(this.encode("毎度ありがとうございます!\n"));
    }
    
    add([LF, LF, LF, LF]);

    await this.print(new Uint8Array(cmds));
  }
}

export const printerService = new PrinterService();