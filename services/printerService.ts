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
      // User Request: Notify start of printing
      alert("印刷を開始します...");

      // Check for printer availability (Plugin or InnerPrinter)
      const hasPlugin = !!(window.SunmiPrinterPlugin && window.SunmiPrinterPlugin.printBitmap);
      const hasInner = !!(window.SunmiInnerPrinter || window.sunmiInnerPrinter);

      if (!hasPlugin && !hasInner) {
          alert("エラー: SUNMIプリンターが見つかりません。\n(SunmiPrinterPlugin または SunmiInnerPrinter が未検出)");
          return;
      }

      // Generate Image from DOM
      const generateImage = async (isCopy: boolean): Promise<string> => {
          // Temporarily render the receipt content to a hidden div
          const tempDiv = document.createElement('div');
          tempDiv.style.position = 'absolute';
          tempDiv.style.top = '-9999px';
          tempDiv.style.left = '0';
          tempDiv.style.width = '384px'; // 48mm width
          tempDiv.style.backgroundColor = 'white';
          tempDiv.style.color = 'black';
          tempDiv.style.fontFamily = 'monospace'; // Match Receipt component
          tempDiv.style.fontWeight = 'bold';
          // Ensure high contrast
          tempDiv.style.filter = 'contrast(150%)'; 

          let title = "領収書";
          if (mode === 'FORMAL') title = "領 収 証";
          else if (mode === 'INVOICE') title = "請 求 書";
          else if (mode === 'ESTIMATION') title = "御 見 積 書";
          
          let html = `
            <div style="padding: 10px; font-size: 14px; line-height: 1.4;">
              <div style="text-align: center; margin-bottom: 10px;">
          `;

          if (logoUrl && !isCopy) {
              html += `<img src="${logoUrl}" style="max-width: 150px; max-height: 80px; margin-bottom: 5px;" />`;
          }

          html += `
                <div style="font-size: 24px; font-weight: bold;">${title}${isCopy ? ' (控え)' : ''}</div>
          `;
          
          if (mode === 'INVOICE') html += `<div style="font-size: 12px;">(INVOICE)</div>`;
          if (mode === 'ESTIMATION') html += `<div style="font-size: 12px;">(ESTIMATION)</div>`;

          html += `
              </div>
              <div style="text-align: right; font-size: 10px; color: #555;">
                No. ${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${new Date().getHours()}${new Date().getMinutes()}
              </div>
              <div style="text-align: right; margin-bottom: 10px; font-size: 10px; color: #555;">${new Date().toLocaleString()}</div>
          `;

          if (mode === 'FORMAL' || mode === 'INVOICE' || mode === 'ESTIMATION') {
              html += `<div style="text-align: left; margin-bottom: 10px; font-size: 16px; border-bottom: 1px solid black;">${recipientName || "          "} <span style="font-size: 12px;">様</span></div>`;
              
              if (mode === 'INVOICE') html += `<div style="text-align: right; font-size: 12px;">下記の通りご請求申し上げます。</div>`;
              else if (mode === 'ESTIMATION') html += `<div style="text-align: right; font-size: 12px;">下記の通り御見積申し上げます。</div>`;

              html += `
                <div style="background-color: #f3f4f6; padding: 5px; text-align: center; margin: 10px 0;">
                    <div style="font-size: 12px;">${mode === 'INVOICE' ? 'ご請求金額' : mode === 'ESTIMATION' ? '御見積金額' : '金額'}</div>
                    <div style="font-size: 28px; font-weight: bold; border-bottom: 2px solid black;">¥ ${total.toLocaleString()} -</div>
                </div>
              `;
              
              if (mode === 'FORMAL') {
                  html += `
                    <div style="margin-bottom: 5px;">但  ${proviso || "お品代"}として</div>
                    <div style="margin-bottom: 10px; text-align: right; font-size: 12px;">上記正に領収いたしました</div>
                  `;
              }
              
              if (mode === 'INVOICE' && paymentDeadline) {
                  html += `<div style="text-align: right; color: #b91c1c; font-weight: bold;">お支払期限: ${paymentDeadline}</div>`;
              }
              
              if (mode === 'ESTIMATION') {
                   const d = new Date();
                   d.setMonth(d.getMonth() + 1);
                   html += `<div style="text-align: right; color: #374151; font-weight: bold;">有効期限: ${d.toLocaleDateString()}</div>`;
              }
          }

          html += `<hr style="border-top: 1px dashed black; margin: 10px 0;">`;
          if (mode === 'FORMAL' || mode === 'INVOICE' || mode === 'ESTIMATION') {
              html += `<div style="font-size: 12px; color: #555; margin-bottom: 5px;">内訳</div>`;
          }
          
          items.forEach(item => {
              html += `<div style="font-weight: bold; font-size: 16px;">${item.name}</div>`;
              if (item.partNumber) html += `<div style="font-size: 10px; color: #555; margin-left: 10px;">(品番: ${item.partNumber})</div>`;
              html += `
                <div style="display: flex; justify-content: space-between; font-size: 12px; color: #374151;">
                  <span>${item.quantity} x ${item.price.toLocaleString()}</span>
                  <span>${(item.price * item.quantity).toLocaleString()}</span>
                </div>
                <div style="border-bottom: 1px dashed #e5e7eb; margin-bottom: 5px;"></div>
              `;
          });

          html += `
            <div style="display: flex; justify-content: space-between; margin-top: 10px;"><span>小計 (税抜)</span><span>${subTotal.toLocaleString()}</span></div>
          `;
          
          const taxToDisplay = (discount > 0 && finalTax !== undefined) ? finalTax : tax;
          html += `
            <div style="display: flex; justify-content: space-between;"><span>消費税(10%)</span><span>${taxToDisplay.toLocaleString()}</span></div>
          `;

          if (discount > 0) {
              const initialTotal = subTotal + tax;
              html += `
                <div style="display: flex; justify-content: space-between; border-top: 1px dashed #ccc; margin-top: 5px;"><span>合計(値引前)</span><span>${initialTotal.toLocaleString()}</span></div>
                <div style="display: flex; justify-content: space-between; color: #dc2626;"><span>値引(税込)</span><span>- ${discount.toLocaleString()}</span></div>
              `;
          }
          
          if (mode === 'RECEIPT') {
              html += `
                <div style="display: flex; justify-content: space-between; font-size: 20px; font-weight: bold; margin-top: 5px; border-top: 1px solid #e5e7eb; padding-top: 5px;">
                  <span>合計</span><span>${total.toLocaleString()}</span>
                </div>
              `;
          }

          if (discount > 0 && finalTax !== undefined) {
              html += `<div style="text-align: right; font-size: 10px; color: #555;">(内消費税等: ${finalTax.toLocaleString()})</div>`;
          }
          
          html += `<div style="margin-top: 20px; border-top: 2px solid black; padding-top: 10px;">`;
          html += `<div style="font-size: 20px; font-weight: bold; margin-bottom: 5px;">${settings.storeName}</div>`;
          html += `<div style="font-size: 12px;">〒${settings.zipCode}</div>`;
          html += `<div style="font-size: 12px;">${settings.address1}</div>`;
          if (settings.address2) html += `<div style="font-size: 12px;">${settings.address2}</div>`;
          html += `<div style="font-size: 12px;">電話: ${settings.tel}</div>`;
          html += `<div style="font-size: 12px; font-family: monospace;">登録番号: ${settings.registrationNum}</div>`;
          html += `</div>`;

          if (mode === 'FORMAL' || mode === 'INVOICE' || mode === 'ESTIMATION') {
             // Stamp placeholder if needed, but usually physical stamp is used.
             // Receipt component has a stamp box for revenue stamp.
          }

          if (mode === 'FORMAL' && total >= 50000) {
              html += `
                <div style="margin-top: 10px; text-align: right;">
                  <div style="display: inline-block; border: 1px solid #9ca3af; padding: 10px; width: 60px; height: 60px; text-align: center; background-color: #f9fafb;">
                    <div style="font-size: 8px; color: #d1d5db;">印</div>
                    <div style="font-size: 8px; color: #d1d5db;">収入印紙</div>
                  </div>
                </div>
              `;
          }

          if (settings.bankName && mode === 'INVOICE') {
              html += `
                <div style="margin-top: 15px; padding: 10px; border-top: 1px dashed black; font-size: 12px;">
                    <div style="font-weight: bold; margin-bottom: 5px;">【お振込先】</div>
                    <div>${settings.bankName} ${settings.branchName}</div>
                    <div>${settings.accountType} ${settings.accountNumber}</div>
                    <div>${settings.accountHolder}</div>
                </div>
              `;
          }
          
          html += `<div style="margin-top: 10px; text-align: center; font-size: 10px; color: #9ca3af;">`;
          if (mode === 'INVOICE') html += `ご請求書を送付いたします。`;
          else if (mode === 'ESTIMATION') html += `ご検討のほどお願い申し上げます。`;
          else html += `毎度ありがとうございます!`;
          html += `</div>`;

          if (isCopy && storeMemo) {
              html += `
                <div style="margin-top: 15px; padding-top: 10px; border-top: 1px dashed black;">
                    <div style="font-size: 12px; font-weight: bold;">【店舗メモ】</div>
                    <div style="white-space: pre-wrap; font-size: 12px; border: 1px solid #d1d5db; padding: 5px; border-radius: 4px;">${storeMemo}</div>
                </div>
              `;
          }

          html += `</div>`;
          tempDiv.innerHTML = html;
          document.body.appendChild(tempDiv);

          // Use html2canvas to generate image
          const canvas = await html2canvas(tempDiv, {
              width: 384,
              scale: 2, // Higher scale for better quality
              logging: false,
              useCORS: true,
              backgroundColor: '#ffffff'
          });
          
          document.body.removeChild(tempDiv);

          // Resize to 384px width (SUNMI V2S Print Width) and add padding
          const finalCanvas = document.createElement('canvas');
          finalCanvas.width = 384;
          // Calculate height based on aspect ratio
          const scaledHeight = (canvas.height * 384) / canvas.width;
          finalCanvas.height = scaledHeight;
          
          const ctx = finalCanvas.getContext('2d');
          if (ctx) {
              ctx.fillStyle = '#ffffff';
              ctx.fillRect(0, 0, finalCanvas.width, finalCanvas.height);
              
              // Draw image with 10px right padding (so max width effectively 374px)
              // Actually, to prevent cutting on right, we should perhaps scale it slightly smaller or just ensure content is within bounds.
              // User requested: "Force insert 10px padding on right side".
              // So we draw the image slightly shifted left or scaled down?
              // If we draw it at 0,0 with width 374, and canvas is 384, we have 10px space on right.
              const contentWidth = 374;
              const contentHeight = (canvas.height * contentWidth) / canvas.width;
              
              // Recalculate canvas height for the new content height
              finalCanvas.height = contentHeight;
              
              // Fill white again for new height
              ctx.fillStyle = '#ffffff';
              ctx.fillRect(0, 0, finalCanvas.width, finalCanvas.height);

              ctx.drawImage(canvas, 0, 0, contentWidth, contentHeight);
              // Right side (10px) remains white
          }
          
          // Return Base64 (remove prefix)
          return finalCanvas.toDataURL('image/png').replace(/^data:image\/\w+;base64,/, "");
      };

      try {
          // 1. Print Original
          const base64Original = await generateImage(false);
          
          if (window.SunmiPrinterPlugin && window.SunmiPrinterPlugin.printBitmap) {
              window.SunmiPrinterPlugin.printBitmap(base64Original, 384, 0);
          } else if (window.SunmiInnerPrinter && window.SunmiInnerPrinter.printBitmapWithBase64) {
               // Fallback to InnerPrinter if Plugin method missing
               window.SunmiInnerPrinter.printBitmapWithBase64(base64Original, 384, 0);
               window.SunmiInnerPrinter.lineWrap(3);
               window.SunmiInnerPrinter.cutPaper();
          } else {
               console.warn("Sunmi Printer not found.");
               alert("プリンターが見つかりません");
          }

          // 2. Print Copy (if confirmed)
          setTimeout(async () => {
              if (window.confirm("お客様用を印刷しました。続けて店舗控えを印刷しますか？")) {
                  const base64Copy = await generateImage(true);
                  if (window.SunmiPrinterPlugin && window.SunmiPrinterPlugin.printBitmap) {
                      window.SunmiPrinterPlugin.printBitmap(base64Copy, 384, 0);
                  } else if (window.SunmiInnerPrinter && window.SunmiInnerPrinter.printBitmapWithBase64) {
                      window.SunmiInnerPrinter.printBitmapWithBase64(base64Copy, 384, 0);
                      window.SunmiInnerPrinter.lineWrap(3);
                      window.SunmiInnerPrinter.cutPaper();
                  }
              }
          }, 500);

      } catch (e) {
          console.error("Sunmi Print Error:", e);
          alert("印刷エラーが発生しました");
      }
  }
}

export const printerService = new PrinterService();