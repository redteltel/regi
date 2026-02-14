import { CartItem } from '../types';

// ESC/POS Commands
const ESC = 0x1B;
const GS = 0x1D;
const AT = 0x40; // Initialize
const LF = 0x0A; // Line Feed
const ALIGN_CENTER = [ESC, 0x61, 1];
const ALIGN_LEFT = [ESC, 0x61, 0];
const ALIGN_RIGHT = [ESC, 0x61, 2];
const EMPHASIS_ON = [ESC, 0x45, 1];
const EMPHASIS_OFF = [ESC, 0x45, 0];
const SIZE_NORMAL = [GS, 0x21, 0x00];
const SIZE_DOUBLE = [GS, 0x21, 0x11];

export class PrinterService {
  public onLog: ((msg: string) => void) | null = null;
  public onDisconnect: (() => void) | null = null;
  private buffer: number[] = [];
  private timer: any = null;

  setLogger(logger: (msg: string) => void) { this.onLog = logger; }
  setOnDisconnect(callback: () => void) { this.onDisconnect = callback; }
  log(msg: string) { if (this.onLog) this.onLog(msg); console.log(msg); }

  // ----------------------------------------
  // Connection Methods (Compatible with App.tsx)
  // ----------------------------------------
  
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

  // ----------------------------------------
  // Data Handling
  // ----------------------------------------

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
      const intentUrl = "intent:base64," + base64data + "#Intent;scheme=rawbt;package=ru.a402d.rawbtprinter;end;";
      
      this.buffer = [];
      window.location.href = intentUrl;
      this.log("SUCCESS: Receipt sent via RawBT!");
    } catch (e: any) {
      this.log("Print Error: " + e.message);
    }
  }

  // ----------------------------------------
  // Receipt Generation (ESC/POS)
  // ----------------------------------------

  private encode(text: string): Uint8Array {
    return new TextEncoder().encode(text);
  }

  async printReceipt(items: CartItem[], subTotal: number, tax: number, total: number) {
    this.log("Generating Receipt...");
    
    const cmds: number[] = [];
    const add = (data: number[] | Uint8Array) => {
        if (data instanceof Uint8Array) {
            data.forEach(b => cmds.push(b));
        } else {
            cmds.push(...data);
        }
    };
    
    // Header
    add([ESC, AT]); // Initialize
    add(ALIGN_CENTER);
    add(SIZE_DOUBLE);
    add(this.encode("パナランドヨシダ\n"));
    
    add(SIZE_NORMAL);
    add(this.encode("領収書\n"));
    add(this.encode("--------------------------------\n"));
    add([LF]);
    
    // Items
    add(ALIGN_LEFT);
    for (const item of items) {
        add(this.encode(`${item.name}\n`));
        const line = `${item.quantity} x Y${item.price.toLocaleString()}`;
        const totalStr = `Y${(item.price * item.quantity).toLocaleString()}`;
        
        // Simple padding calculation (assuming font A 32 chars width)
        const spaces = 32 - (line.length + totalStr.length); 
        const padding = spaces > 0 ? " ".repeat(spaces) : " ";
        add(this.encode(`${line}${padding}${totalStr}\n`));
    }
    
    add(this.encode("--------------------------------\n"));
    
    // Total Breakdown
    add(ALIGN_RIGHT);
    add(this.encode(`小計: Y${subTotal.toLocaleString()}\n`));
    add(this.encode(`(内消費税10%): Y${tax.toLocaleString()}\n`));
    add([LF]);

    add(EMPHASIS_ON);
    add(SIZE_DOUBLE);
    add(this.encode(`合計: Y${total.toLocaleString()}\n`));
    add(EMPHASIS_OFF);
    add(SIZE_NORMAL);
    
    // Footer
    add(ALIGN_CENTER);
    add([LF]);
    add(this.encode(`Date: ${new Date().toLocaleString()}\n`));
    add(this.encode("毎度ありがとうございます!\n"));
    
    // Feed and Cut
    add([LF, LF, LF, LF]);

    // Send to buffer -> RawBT
    await this.print(new Uint8Array(cmds));
  }
}

export const printerService = new PrinterService();