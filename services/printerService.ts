import { CartItem, StoreSettings, PrinterType } from '../types';
import Encoding from 'encoding-japanese';
import html2canvas from 'html2canvas';

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
  // Sends ESC/POS data to the RAWBT app via Android URI intent.
  // Supports multiple URL scheme formats for compatibility across Android versions and PWA modes.

  async print(data: Uint8Array, type: PrinterType) {
      if (type === 'BLUETOOTH' || type === 'SUNMI' || type === 'SII_AGENT') {
          // Convert Uint8Array → binary string → Base64
          let binary = '';
          const len = data.byteLength;
          for (let i = 0; i < len; i++) {
              binary += String.fromCharCode(data[i]);
          }
          const base64 = btoa(binary);

          if (type === 'SII_AGENT') {
              // SII URL Print Agent Scheme (iOS)
              this.launchRawbt(`sii-printer-agent://${base64}`);
              return;
          }

          // Sunmi uses rawbt: scheme with UTF-8 charset hint
          if (type === 'SUNMI') {
              console.log('[RAWBT] Launching SUNMI via rawbt: scheme');
              this.launchRawbt(`rawbt:base64,${base64}?charset=UTF-8`);
              return;
          }

          // === RAWBT URL Scheme — MP-B20 (BLUETOOTH) ===
          //
          // RAWBT (ru.a402d.rawbtprinter) supports the following URI formats:
          //   Format A: rawbt:base64,<data>
          //     — Classic format. Most widely supported.
          //     — Anchor click fires Android intent without navigating PWA.
          //   Format B: intent://<host>#Intent;scheme=rawbt;package=ru.a402d.rawbtprinter;end
          //     — Android explicit intent URL. Useful when Format A is blocked by PWA scope.
          //     — Does NOT carry base64 payload (RAWBT cannot receive it via this path).
          //
          // Strategy:
          //   1. Try Format A via anchor click (avoids PWA scope navigation issue).
          //   2. Fall back to Format A via window.location.href (legacy path, may navigate away).
          //
          // The intent:// format is intentionally NOT used here because RAWBT reads the ESC/POS
          // data from the URI's data portion, not from an Intent extra. The rawbt: URI itself
          // IS the intent data, so anchor click on rawbt:base64,<data> is the correct approach.

          const rawbtUrl = `rawbt:base64,${base64}`;
          console.log('[RAWBT] rawbtUrl length:', rawbtUrl.length, '| first 80 chars:', rawbtUrl.slice(0, 80));

          // Primary: anchor click (preferred in Android PWA standalone mode)
          const launched = this.launchRawbt(rawbtUrl);
          if (!launched) {
              // Fallback: direct navigation (may work in browser mode, may navigate PWA away)
              console.log('[RAWBT] anchor click failed, falling back to window.location.href');
              window.location.href = rawbtUrl;
          }
      }
  }

  // Launch an intent URL via anchor click.
  // Returns true if the anchor click was dispatched (doesn't guarantee the app opened).
  // Anchor click is preferred over window.location.href in PWA standalone mode because
  // it triggers Android's intent resolution without navigating the PWA page itself.
  private launchRawbt(url: string): boolean {
      try {
          console.log('[RAWBT] launchRawbt:', url.slice(0, 120));
          const a = document.createElement('a');
          a.href = url;
          a.style.display = 'none';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          return true;
      } catch (e) {
          console.error('[RAWBT] launchRawbt error:', e);
          return false;
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

    // --- SUNMI LOGIC ---
    // @ts-ignore
    const isSunmi = /(SUNMI|V2)/i.test(navigator.userAgent) || (window.SunmiInnerPrinter || window.sunmiInnerPrinter || window.SunmiPrinterPlugin);
    
    if (isSunmi || settings.printerType === 'SUNMI') {
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
      const printer = window.SunmiPrinterPlugin || window.SunmiInnerPrinter || window.sunmiInnerPrinter;
      
      if (!printer) {
          throw new Error("SUNMI Printer Not Found");
      }

      // Helper to convert URL to Base64 for Logo
      const getBase64FromUrl = async (url: string): Promise<string> => {
          try {
              const data = await fetch(url);
              const blob = await data.blob();
              return new Promise((resolve) => {
                  const reader = new FileReader();
                  reader.readAsDataURL(blob);
                  reader.onloadend = () => {
                      const base64data = reader.result as string;
                      resolve(base64data.replace(/^data:image\/\w+;base64,/, ""));
                  };
              });
          } catch (e) {
              console.warn("Logo fetch failed", e);
              return "";
          }
      };

      try {
          console.log("Starting AIDL Print Sequence...");
          const p = printer as any;
          
          // Init
          if (typeof p.printerInit === 'function') {
              p.printerInit();
          } else {
              console.warn("printerInit not found");
          }

          // 1. Logo
          if (logoUrl) {
              const base64Logo = await getBase64FromUrl(logoUrl);
              if (base64Logo) {
                  if (typeof p.printBitmap === 'function') {
                      p.printBitmap(base64Logo, 384, 0); 
                  } else if (typeof p.printBitmapWithBase64 === 'function') {
                      p.printBitmapWithBase64(base64Logo, 384, 0);
                  } else {
                      console.warn("printBitmap method not found");
                  }
                  if (typeof p.lineWrap === 'function') p.lineWrap(1);
              }
          }

          // Helper for text printing
          const printLine = (text: string) => {
              if (typeof p.printText === 'function') {
                  p.printText(text);
              } else if (typeof p.printString === 'function') {
                  p.printString(text); // Some versions use printString
              }
          };

          const setAlign = (align: number) => {
              if (typeof p.setAlignment === 'function') p.setAlignment(align);
          };

          const setSize = (size: number) => {
              if (typeof p.setFontSize === 'function') p.setFontSize(size);
          };

          const setBold = (isBold: boolean) => {
              if (typeof p.setBold === 'function') p.setBold(isBold);
          };

          // 2. Title
          setAlign(1); // Center
          setSize(32); // Large
          setBold(true);
          
          let title = "領収書";
          if (mode === 'FORMAL') title = "領 収 証";
          else if (mode === 'INVOICE') title = "請 求 書";
          else if (mode === 'ESTIMATION') title = "御 見 積 書";
          
          printLine(title + "\n");
          
          setSize(24); // Normal
          setBold(false);
          printLine("\n");

          // Date & No
          setAlign(2); // Right
          setSize(18); // Small
          const dateStr = new Date().toLocaleString();
          printLine(dateStr + "\n");
          printLine("--------------------------------\n");

          // 3. Items
          setAlign(0); // Left
          setSize(24); // Normal
          
          items.forEach(item => {
              printLine(item.name + "\n");
              setAlign(2); // Right
              const line = `${item.quantity} x ${item.price.toLocaleString()}  ${(item.quantity * item.price).toLocaleString()}`;
              printLine(line + "\n");
              setAlign(0); // Left
          });

          printLine("--------------------------------\n");

          // 4. Totals
          setAlign(2); // Right
          setSize(24);
          printLine(`小計: ¥${subTotal.toLocaleString()}\n`);
          printLine(`消費税: ¥${(finalTax || tax).toLocaleString()}\n`);
          
          if (discount > 0) {
              printLine(`値引: -¥${discount.toLocaleString()}\n`);
          }

          setSize(36); // Large Total
          setBold(true);
          printLine(`合計: ¥${total.toLocaleString()}\n`);
          
          setSize(20);
          setBold(false);
          printLine(`(内消費税等: ¥${(finalTax || tax).toLocaleString()})\n`);
          
          printLine("\n");

          // 5. Store Info
          setAlign(1); // Center
          setSize(24);
          printLine(settings.storeName + "\n");
          setSize(18);
          printLine(settings.tel + "\n");
          printLine(settings.registrationNum + "\n");

          // 6. Footer
          printLine("\n毎度ありがとうございます\n\n");
          
          // Cut
          if (typeof p.lineWrap === 'function') p.lineWrap(4);
          if (typeof p.cutPaper === 'function') p.cutPaper();

          console.log("AIDL Print Sequence Completed");

      } catch (e) {
          console.error("AIDL Print Error", e);
          throw e;
      }
  }
}

export const printerService = new PrinterService();