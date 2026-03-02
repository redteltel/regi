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

    // --- SUNMI: HTML Intent Mode ---
    if (settings.printerType === 'SUNMI') {
        const title = mode === 'FORMAL' ? "領 収 証" : 
                      mode === 'INVOICE' ? "請 求 書" : 
                      mode === 'ESTIMATION' ? "御 見 積 書" : "領収書";
        
        const dateStr = new Date().toLocaleString();
        const taxToDisplay = (discount > 0 && finalTax !== undefined) ? finalTax : tax;
        
        let html = `<!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
                body { 
                    font-family: sans-serif; 
                    font-size: 16px; 
                    font-weight: bold;
                    margin: 0; 
                    padding: 0; 
                    color: #000; 
                    width: 100%;
                }
                .center { text-align: center; }
                .right { text-align: right; }
                .left { text-align: left; }
                .bold { font-weight: bold; }
                .title { font-size: 24px; margin-bottom: 10px; }
                .line { border-bottom: 2px solid #000; margin: 5px 0; }
                .item { display: flex; justify-content: space-between; margin-bottom: 2px; }
                .total-area { font-size: 20px; margin-top: 10px; border-top: 2px solid #000; border-bottom: 2px solid #000; padding: 5px 0; }
                .footer { margin-top: 20px; font-size: 14px; }
                .small { font-size: 12px; }
            </style>
        </head>
        <body>
            <div class="center title">${title}</div>
            <div class="right">${dateStr}</div>
            <br>
        `;

        if (mode === 'FORMAL' || mode === 'INVOICE' || mode === 'ESTIMATION') {
            html += `<div class="left">${recipientName || "          "} 様</div><br>`;
            
            if (mode === 'INVOICE') html += `<div class="right">下記の通りご請求申し上げます。</div>`;
            if (mode === 'ESTIMATION') html += `<div class="right">下記の通り御見積申し上げます。</div>`;
            
            html += `
            <div class="center total-area bold">${total.toLocaleString()}円</div>
            <br>
            `;
            
            if (mode === 'FORMAL') {
                html += `<div class="left">但 ${proviso || "お品代"}として</div>`;
                html += `<div class="left">上記正に領収いたしました</div><br>`;
            }
            if (mode === 'INVOICE' && paymentDeadline) {
                html += `<div class="right">お支払期限: ${paymentDeadline}</div><br>`;
            }
            if (mode === 'ESTIMATION') {
                const d = new Date();
                d.setMonth(d.getMonth() + 1);
                html += `<div class="right">有効期限: ${d.toLocaleDateString()}</div><br>`;
            }
        }

        html += `<div class="line"></div>`;
        
        items.forEach(item => {
            html += `<div class="left bold">${item.name}</div>`;
            if (item.partNumber) html += `<div class="left small" style="margin-left:10px;">(品番: ${item.partNumber})</div>`;
            html += `
            <div class="item">
                <span>${item.quantity} x ${item.price.toLocaleString()}</span>
                <span>${(item.price * item.quantity).toLocaleString()}</span>
            </div>
            `;
        });

        html += `<div class="line"></div>`;
        
        html += `<div class="item"><span>小計</span><span>${subTotal.toLocaleString()}</span></div>`;
        html += `<div class="item"><span>消費税(10%)</span><span>${taxToDisplay.toLocaleString()}</span></div>`;
        
        if (discount > 0) {
            const initialTotal = subTotal + tax;
            html += `<div class="item"><span>合計(値引前)</span><span>${initialTotal.toLocaleString()}</span></div>`;
            html += `<div class="item" style="color:red;"><span>値引</span><span>- ${discount.toLocaleString()}</span></div>`;
        }
        
        if (mode === 'RECEIPT') {
            html += `<div class="item total-area bold"><span>合計</span><span>${total.toLocaleString()}円</span></div>`;
        }
        
        if (discount > 0 && finalTax !== undefined) {
             html += `<div class="right small">(内消費税等: ${finalTax.toLocaleString()}円)</div>`;
        }

        html += `<br><div class="center footer bold">${settings.storeName}</div>`;
        html += `<div class="center footer">〒${settings.zipCode}<br>${settings.address1}</div>`;
        if (settings.address2) html += `<div class="center footer">${settings.address2}</div>`;
        html += `<div class="center footer">電話: ${settings.tel}<br>登録番号: ${settings.registrationNum}</div>`;
        
        if (mode === 'FORMAL' || mode === 'INVOICE' || mode === 'ESTIMATION') {
            html += `<div class="right footer">(印)</div>`;
        }
        
        if (mode === 'FORMAL' && total >= 50000) {
            html += `<br><div class="right">----------<br>| 収入印紙 |<br>----------</div>`;
        }

        if (settings.bankName) {
            html += `<div class="line"></div>`;
            html += `<div class="left footer">【お振込先】<br>${settings.bankName} ${settings.branchName}<br>${settings.accountType} ${settings.accountNumber}<br>${settings.accountHolder}</div>`;
        }

        html += `<br><div class="center footer">`;
        if (mode === 'INVOICE') html += "ご請求書を送付いたします。";
        else if (mode === 'ESTIMATION') html += "";
        else html += "毎度ありがとうございます!";
        html += `</div>`;
        
        html += `</body></html>`;

        // Encode HTML to Base64
        // Use UTF-8 encoding for the HTML string
        const encoder = new TextEncoder();
        const data = encoder.encode(html);
        let binary = '';
        for (let i = 0; i < data.length; i++) {
            binary += String.fromCharCode(data[i]);
        }
        const base64Html = btoa(binary);

        // Construct Intent URL for RawBT
        // We use the data URI format with correct MIME type and charset
        // Added S.browser_fallback_url to prevent Play Store redirect
        const dataUri = `data:text/html;charset=utf-8;base64,${base64Html}`;
        const intentUrl = `intent:${dataUri}#Intent;scheme=rawbt;package=ru.a402d.rawbtprinter;S.browser_fallback_url=;end;`;
        
        window.location.href = intentUrl;
        return;
    }

    this.log("Generating Receipt (Shift_JIS)...");
    
    const cmds: number[] = [];
    const add = (data: number[]) => {
        cmds.push(...data);
    };
    
    // Header & Initialization
    add([ESC, AT]); // Initialize
    
    // MP-B20: Standard Japanese Init
    add(COUNTRY_JAPAN); // ESC R 8
    add(KANJI_MODE_ON); // FS & (Enable Kanji)
    add(JIS_CODE_SYSTEM); // FS C 1 (Shift JIS)
    
    // --- Helper Function to Generate One Receipt ---
    const generateOneReceipt = (isCopy: boolean) => {
        add(ALIGN_CENTER);

        // Print Logo if provided (Only on Original or both? Let's do both for consistency)
        if (logoUrl) {
            // Note: Re-using image commands might be tricky if not cached, 
            // but convertImageToEscPos is async. 
            // For simplicity, we skip logo on copy or re-process it?
            // Let's skip logo on copy to save paper/time, or just text title.
            // Or better, we can't easily await inside this sync helper if we structure it this way.
            // So we will handle logo outside or just print text.
        }
        
        // Title
        add(SIZE_DOUBLE);
        let title = "領収書";
        if (mode === 'FORMAL') title = "領 収 証";
        else if (mode === 'INVOICE') title = "請 求 書";
        else if (mode === 'ESTIMATION') title = "御 見 積 書";
        
        add(this.encode(title + (isCopy ? " (控え)\n" : "\n")));
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
            // Use "円" suffix
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
            
            // Part Number Print
            if (item.partNumber) {
                add(this.encode(`  (品番: ${item.partNumber})\n`));
            }

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
        
        add(this.encode(`小計: ${subTotal.toLocaleString()}円\n`));
        
        const taxToDisplay = (discount > 0 && finalTax !== undefined) ? finalTax : tax;
        add(this.encode(`消費税(10%): ${taxToDisplay.toLocaleString()}円\n`));

        if (discount > 0) {
            const initialTotal = subTotal + tax;
            add(this.encode(`合計(値引前): ${initialTotal.toLocaleString()}円\n`));
            add(this.encode(`値引(税込): - ${discount.toLocaleString()}円\n`));
        }
        
        if (mode === 'RECEIPT') {
            add([LF]);
            add(EMPHASIS_ON);
            add(SIZE_DOUBLE);
            add(this.encode(`合計: ${total.toLocaleString()}円\n`));
            add(EMPHASIS_OFF);
            add(SIZE_NORMAL);
        }

        if (discount > 0 && finalTax !== undefined) {
            add(this.encode(`(内消費税等: ${finalTax.toLocaleString()}円)\n`));
        }
        add([LF]);

        // Footer: Store Info from Settings
        add(ALIGN_CENTER);
        add(EMPHASIS_ON);
        add(this.encode(`${settings.storeName}\n`));
        add(EMPHASIS_OFF);
        add(this.encode(`〒${settings.zipCode}\n${settings.address1}\n`));
        if (settings.address2) {
            add(this.encode(`${settings.address2}\n`));
        }
        add(this.encode(`電話: ${settings.tel}\n`));
        add(this.encode(`登録番号: ${settings.registrationNum}\n`));
        
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
        
        // --- NEW BANK INFO LOGIC ---
        if (settings.bankName) {
            add(ALIGN_LEFT);
            add(this.encode("--------------------------------\n"));
            add(this.encode("【お振込先】\n"));
            add(this.encode(`${settings.bankName} ${settings.branchName}\n`));
            add(this.encode(`${settings.accountType} ${settings.accountNumber}\n`));
            add(this.encode(`${settings.accountHolder}\n`));
            add(this.encode("--------------------------------\n"));
            add(ALIGN_CENTER);
            add([LF]);
        }

        if (mode === 'INVOICE') {
            add(this.encode("ご請求書を送付いたします。\n"));
        } else if (mode === 'ESTIMATION') {
            // No specific footer
        } else {
            add(this.encode("毎度ありがとうございます!\n"));
        }

        // Memo for Copy (Disabled for now)
        /*
        if (isCopy && storeMemo) {
            add([LF]);
            add(ALIGN_LEFT);
            add(this.encode("--------------------------------\n"));
            add(this.encode("【店舗メモ】\n"));
            add(this.encode(`${storeMemo}\n`));
            add(this.encode("--------------------------------\n"));
            add(ALIGN_CENTER);
        }
        */
        
        add([LF, LF, LF, LF]);
    };

    // --- 1. Print Original ---
    generateOneReceipt(false);

    // --- 2. Print Copy (Disabled) ---
    // generateOneReceipt(true);

    // Final Feed and Cut
    add([LF, LF, LF]);
    add([0x1D, 0x56, 0x42, 0x00]); // GS V B 0 (Cut)

    // Send to Printer
    await this.print(new Uint8Array(cmds), settings.printerType);
  }
}

export const printerService = new PrinterService();