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
      if (type === 'BLUETOOTH' || type === 'SUNMI' || type === 'SII_AGENT') {
          // Convert data to Base64
          let binary = '';
          const len = data.byteLength;
          for (let i = 0; i < len; i++) {
              binary += String.fromCharCode(data[i]);
          }
          const base64 = btoa(binary);

          if (type === 'SII_AGENT') {
              // SII URL Print Agent Scheme
              // Sending base64 encoded ESC/POS commands
              window.location.href = `sii-printer-agent://${base64}`;
              return;
          }

          // Construct RawBT Intent URL
          // scheme: rawbt:base64,
          let intentUrl = `rawbt:base64,${base64}`;
          
          // Sunmi specific: Add charset=UTF-8
          if (type === 'SUNMI') {
              intentUrl += '?charset=UTF-8';
          }
          
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
    this.log("Generating Receipt (Shift_JIS)...");
    
    const cmds: number[] = [];
    const add = (data: number[]) => {
        cmds.push(...data);
    };

    const addInit = () => {
        // Sunmi specific: Add UTF-8 BOM
        if (settings.printerType === 'SUNMI') {
            add([0xEF, 0xBB, 0xBF]);
        }
        
        // Header & Initialization
        add([ESC, AT]); // Initialize
        
        if (settings.printerType === 'SUNMI') {
            // SUNMI: No special commands. RawBT Image Mode handles UTF-8 text.
        } else {
            // MP-B20: Standard Japanese Init
            add(COUNTRY_JAPAN); // ESC R 8
            add(KANJI_MODE_ON); // FS & (Enable Kanji)
            add(JIS_CODE_SYSTEM); // FS C 1 (Shift JIS)
        }
    };
    
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

        // --- NEW BANK INFO LOGIC ---
        if (settings.bankName && mode === 'INVOICE') {
            add(ALIGN_LEFT);
            add(this.encode("--------------------------------\n"));
            add(this.encode("【お振込先】\n"));
            add(this.encode(`${settings.bankName} ${settings.branchName}\n`));
            add(this.encode(`${settings.accountType} ${settings.accountNumber}\n`));
            add(this.encode(`${settings.accountHolder}\n`));
            add(this.encode("--------------------------------\n"));
            add(ALIGN_CENTER);
        }

        if (mode === 'INVOICE') {
            add(this.encode("ご請求書を送付いたします。"));
        } else if (mode === 'ESTIMATION') {
            // No specific footer
        } else {
            add(this.encode("毎度ありがとうございます!"));
        }

        // Memo for Copy
        if (isCopy && storeMemo) {
            add([LF]);
            add(ALIGN_LEFT);
            add(this.encode("--------------------------------\n"));
            add(this.encode("【店舗メモ】\n"));
            add(this.encode(`${storeMemo}`));
            add(this.encode("--------------------------------"));
            add(ALIGN_CENTER);
        }

        // Add 5mm margin (approx 2 lines)
        add([LF, LF]);
    };

    // --- SII AGENT LOGIC (iPhone) ---
    if (settings.printerType === 'SII_AGENT') {
        addInit();
        generateOneReceipt(false);
        // Removed Cut/Feed

        addInit();
        generateOneReceipt(true);
        // Removed Cut/Feed

        await this.print(new Uint8Array(cmds), 'SII_AGENT');
        return;
    }

    // --- SUNMI AIDL LOGIC ---
    if (settings.printerType === 'SUNMI' && (window.SunmiInnerPrinter || window.sunmiInnerPrinter)) {
        await this.printSunmi(items, subTotal, tax, total, mode, recipientName, proviso, paymentDeadline, discount, logoUrl, settings, finalTax, storeMemo);
        return;
    }

    // --- 1. Print Original ---
    addInit();
    generateOneReceipt(false);
    // Removed Cut/Feed

    await this.print(new Uint8Array(cmds), settings.printerType);

    // Dialog for 2nd receipt
    // "OK" -> Print Copy
    // "Cancel" -> Skip
    if (!window.confirm("お客様用を印刷しました。続けて店舗控えを印刷しますか？")) {
        return;
    }

    // --- 2. Print Copy ---
    cmds.length = 0;
    addInit();
    generateOneReceipt(true);
    // Removed Cut/Feed

    await this.print(new Uint8Array(cmds), settings.printerType);
  }

  // --- SUNMI AIDL Implementation ---
  async printSunmi(
      items: CartItem[], 
      subTotal: number, 
      tax: number, 
      total: number,
      mode: 'RECEIPT' | 'FORMAL' | 'INVOICE' | 'ESTIMATION',
      recipientName: string,
      proviso: string,
      paymentDeadline: string,
      discount: number,
      logoUrl: string | null,
      settings: StoreSettings,
      finalTax?: number,
      storeMemo?: string
  ) {
      const printer = window.SunmiInnerPrinter || window.sunmiInnerPrinter;
      if (!printer) return;

      const printOne = (isCopy: boolean) => {
          return new Promise<void>((resolve) => {
              try {
                  printer.printerInit();
                  
                  // Force Bold via ESC/POS if available (ESC E 1)
                  if (printer.sendRAWData) {
                      try {
                          // 0x1B 0x45 0x01 -> Base64: GwEB
                          printer.sendRAWData("GwEB");
                      } catch (e) {
                          console.warn("Failed to send bold command", e);
                      }
                  }

                  printer.setAlignment(1); // Center

                  // Title
                  printer.setFontSize(48); // Extra Large
                  let title = "領収書";
                  if (mode === 'FORMAL') title = "領 収 証";
                  else if (mode === 'INVOICE') title = "請 求 書";
                  else if (mode === 'ESTIMATION') title = "御 見 積 書";
                  
                  // Use printText for UTF-8 support
                  printer.printText(title + (isCopy ? " (控え)\n" : "\n"));
                  printer.setFontSize(24); // Normal
                  printer.printText("\n");

                  // Date
                  printer.setAlignment(2); // Right
                  printer.printText(`${new Date().toLocaleString()}\n`);
                  printer.printText("\n");

                  // Details
                  if (mode === 'FORMAL' || mode === 'INVOICE' || mode === 'ESTIMATION') {
                      printer.setAlignment(0); // Left
                      printer.printText(`${recipientName || "          "} 様\n`);
                      printer.printText("\n");
                      
                      if (mode === 'INVOICE') {
                          printer.setAlignment(2);
                          printer.printText("下記の通りご請求申し上げます。\n");
                      } else if (mode === 'ESTIMATION') {
                          printer.setAlignment(2);
                          printer.printText("下記の通り御見積申し上げます。\n");
                      }

                      printer.setAlignment(1); // Center
                      printer.setFontSize(48); // Large
                      printer.printText(`${total.toLocaleString()}円\n`);
                      printer.setFontSize(24); // Normal
                      printer.printText("\n");
                      
                      if (mode === 'FORMAL') {
                          printer.setAlignment(0);
                          printer.printText(`但  ${proviso || "お品代"}として\n`);
                          printer.printText("上記正に領収いたしました\n");
                          printer.printText("\n");
                      }
                      
                      if (mode === 'INVOICE' && paymentDeadline) {
                          printer.setAlignment(2);
                          printer.printText(`お支払期限: ${paymentDeadline}\n`);
                          printer.printText("\n");
                      }
                      
                      if (mode === 'ESTIMATION') {
                          printer.setAlignment(2);
                          const d = new Date();
                          d.setMonth(d.getMonth() + 1);
                          printer.printText(`有効期限: ${d.toLocaleDateString()}\n`);
                          printer.printText("\n");
                      }
                  }

                  printer.setAlignment(1);
                  printer.printText("--------------------------------\n");
                  
                  // Items
                  printer.setAlignment(0); // Left
                  for (const item of items) {
                      printer.printText(`${item.name}\n`);
                      if (item.partNumber) {
                          printer.printText(`  (品番: ${item.partNumber})\n`);
                      }

                      const line = `${item.quantity} x ${item.price.toLocaleString()}円`;
                      const totalStr = `${(item.price * item.quantity).toLocaleString()}円`;
                      
                      // Strict width calculation for 48mm (384px)
                      // Assuming standard font width approx 12px per char -> 32 chars
                      // But SUNMI standard font might be different. 
                      // Let's use a safer 30-32 char limit.
                      let lineLen = 0;
                      for(let i=0; i<line.length; i++) lineLen += (line.charCodeAt(i) > 255 ? 2 : 1);
                      let totalLen = 0;
                      for(let i=0; i<totalStr.length; i++) totalLen += (totalStr.charCodeAt(i) > 255 ? 2 : 1);

                      const spaces = 32 - (lineLen + totalLen); 
                      const padding = spaces > 0 ? " ".repeat(spaces) : " ";
                      printer.printText(`${line}${padding}${totalStr}\n`);
                  }
                  
                  printer.setAlignment(1);
                  printer.printText("--------------------------------\n");
                  
                  // Total Breakdown
                  printer.setAlignment(2); // Right
                  printer.printText(`小計: ${subTotal.toLocaleString()}円\n`);
                  
                  const taxToDisplay = (discount > 0 && finalTax !== undefined) ? finalTax : tax;
                  printer.printText(`消費税(10%): ${taxToDisplay.toLocaleString()}円\n`);

                  if (discount > 0) {
                      const initialTotal = subTotal + tax;
                      printer.printText(`合計(値引前): ${initialTotal.toLocaleString()}円\n`);
                      printer.printText(`値引(税込): - ${discount.toLocaleString()}円\n`);
                  }
                  
                  if (mode === 'RECEIPT') {
                      printer.printText("\n");
                      printer.setFontSize(48);
                      printer.printText(`合計: ${total.toLocaleString()}円\n`);
                      printer.setFontSize(24);
                  }

                  if (discount > 0 && finalTax !== undefined) {
                      printer.printText(`(内消費税等: ${finalTax.toLocaleString()}円)\n`);
                  }
                  printer.printText("\n");

                  // Footer
                  printer.setAlignment(1); // Center
                  printer.setFontSize(30); // Slightly larger for store name
                  printer.printText(`${settings.storeName}\n`);
                  printer.setFontSize(24);
                  printer.printText(`〒${settings.zipCode}\n${settings.address1}\n`);
                  if (settings.address2) {
                      printer.printText(`${settings.address2}\n`);
                  }
                  printer.printText(`電話: ${settings.tel}\n`);
                  printer.printText(`登録番号: ${settings.registrationNum}\n`);
                  
                  if (mode === 'FORMAL' || mode === 'INVOICE' || mode === 'ESTIMATION') {
                      printer.setAlignment(2);
                      printer.printText("(印)\n");
                      printer.setAlignment(1);
                  }

                  if (mode === 'FORMAL' && total >= 50000) {
                      printer.printText("\n");
                      printer.setAlignment(2);
                      printer.printText("----------\n");
                      printer.printText("| 収入印紙 |\n");
                      printer.printText("----------\n");
                      printer.setAlignment(1);
                  }

                  if (settings.bankName && mode === 'INVOICE') {
                      printer.setAlignment(0);
                      printer.printText("--------------------------------\n");
                      printer.printText("【お振込先】\n");
                      printer.printText(`${settings.bankName} ${settings.branchName}\n`);
                      printer.printText(`${settings.accountType} ${settings.accountNumber}\n`);
                      printer.printText(`${settings.accountHolder}\n`);
                      printer.printText("--------------------------------\n");
                      printer.setAlignment(1);
                  }

                  if (mode === 'INVOICE') {
                      printer.printText("ご請求書を送付いたします。");
                  } else if (mode === 'ESTIMATION') {
                      // No specific footer
                  } else {
                      printer.printText("毎度ありがとうございます!");
                  }

                  if (isCopy && storeMemo) {
                      printer.printText("\n\n");
                      printer.setAlignment(0);
                      printer.printText("--------------------------------\n");
                      printer.printText("【店舗メモ】\n");
                      printer.printText(`${storeMemo}`);
                      printer.printText("--------------------------------");
                      printer.setAlignment(1);
                  }

                  printer.printText("\n\n\n"); // Feed
                  printer.cutPaper();
                  resolve();
              } catch (e) {
                  console.error("SUNMI Print Error:", e);
                  resolve(); // Resolve anyway to continue flow
              }
          });
      };

      // 1. Print Original
      await printOne(false);

      // Dialog for 2nd receipt
      if (!window.confirm("お客様用を印刷しました。続けて店舗控えを印刷しますか？")) {
          return;
      }

      // 2. Print Copy
      await printOne(true);
  }
}

export const printerService = new PrinterService();