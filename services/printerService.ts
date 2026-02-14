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
  private buffer: number[] = [];
  private timer: any = null;
  private onDisconnectCallback: (() => void) | null = null;
  private logger: ((msg: string) => void) | null = null;
  
  // Mock State to fool App.tsx
  private isConnectedFlag = false;
  private mockDeviceName = "MP-B20 (RawBT)";

  setLogger(callback: (msg: string) => void) {
    this.logger = callback;
  }

  private log(msg: string) {
    console.log(`[Printer] ${msg}`);
    if (this.logger) this.logger(msg);
  }

  setOnDisconnect(callback: () => void) {
    this.onDisconnectCallback = callback;
  }

  // ==========================================
  // Connection Mock (RawBT doesn't need real connection)
  // ==========================================
  async connect(): Promise<BluetoothDevice> {
    this.log("Preparing RawBT Link...");
    this.isConnectedFlag = true;
    this.buffer = [];

    // Return a Mock Device Object that satisfies App.tsx requirements
    return {
      id: "rawbt-link",
      name: this.mockDeviceName,
      gatt: {
        connected: true,
        connect: async () => this.log("Reconnected (Mock)"),
        disconnect: () => this.disconnect(),
        getPrimaryServices: async () => [],
        getPrimaryService: async () => ({
            uuid: "mock-service",
            getCharacteristics: async () => [],
            getCharacteristic: async () => ({
                uuid: "mock-char",
                properties: { write: true, writeWithoutResponse: true, read: false, notify: false },
                writeValue: async () => {},
                writeValueWithoutResponse: async () => {},
                writeValueWithResponse: async () => {}
            })
        })
      } as any,
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => true,
    } as unknown as BluetoothDevice;
  }

  // Compatible aliases for App.tsx
  async connectBluetooth() { return this.connect(); }
  async connectUsb() { return this.connect().then(d => d.name || "USB"); }
  async restoreBluetoothConnection() { return true; }
  async retryDiscovery() { this.log("RawBT is always ready."); }
  async restoreConnection() { return true; }

  disconnect() {
    this.isConnectedFlag = false;
    this.log("Disconnected.");
    if (this.onDisconnectCallback) this.onDisconnectCallback();
  }

  isConnected(): boolean {
    return this.isConnectedFlag;
  }

  // ==========================================
  // RawBT Data Handling
  // ==========================================
  private encode(text: string): Uint8Array {
    // Note: MP-B20 expects Shift_JIS usually. 
    // Since JS TextEncoder is UTF-8, please set RawBT driver to handle UTF-8 if possible,
    // or rely on RawBT's image rendering if mojibake occurs.
    const encoder = new TextEncoder(); 
    return encoder.encode(text);
  }

  private async writeCommand(data: number[] | Uint8Array) {
    const bytes = data instanceof Uint8Array ? Array.from(data) : data;
    
    // FILTER: Ignore single "0x00" (Wakeup) bytes to prevent "AA==" prints
    if (bytes.length === 1 && bytes[0] === 0x00) {
        this.log("Skipping Wakeup Byte for RawBT...");
        return;
    }

    // Accumulate to buffer
    this.buffer.push(...bytes);
    this.log(`Buffering... (${this.buffer.length} bytes)`);

    // Debounce flush (wait for more data)
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.flushToRawBT();
    }, 1000); // Wait 1s after last write to send intent
  }

  private flushToRawBT() {
    if (this.buffer.length === 0) return;

    this.log("🚀 Sending to RawBT App...");
    
    try {
      // Convert buffer to Binary String (Stack-safe approach)
      // Using reduce for massive arrays might be slow, but receipts are small (<5KB).
      let binary = "";
      const len = this.buffer.length;
      for (let i = 0; i < len; i++) {
          binary += String.fromCharCode(this.buffer[i]);
      }

      // Encode to Base64
      const base64data = btoa(binary);

      // Use specific rawbt scheme to prevent interpretation errors
      // Format: rawbt:base64,data
      const intentUrl = `rawbt:base64,${base64data}`;
      
      this.buffer = []; // Clear buffer
      
      // Trigger Intent
      window.location.href = intentUrl;
      this.log("✅ Sent!");

    } catch (e: any) {
      this.log(`RawBT Error: ${e.message}`);
      // Fallback for huge data
      this.buffer = [];
    }
  }

  // ==========================================
  // Receipt Logic (Same as before, feeds writeCommand)
  // ==========================================
  async printReceipt(items: CartItem[], total: number) {
    // 1. Reset Buffer
    if (this.timer) clearTimeout(this.timer);
    this.buffer = []; 
    this.log("Generating Receipt...");

    // 2. Generate Commands (Feed buffer)
    await this.writeCommand([ESC, AT]); // Init
    await this.writeCommand(ALIGN_CENTER);
    await this.writeCommand(SIZE_DOUBLE);
    await this.writeCommand(this.encode("RECEIPT\n"));
    await this.writeCommand(SIZE_NORMAL);
    await this.writeCommand(this.encode("PixelPOS Store\n"));
    await this.writeCommand(this.encode("--------------------------------\n"));
    await this.writeCommand([LF]);
    
    await this.writeCommand(ALIGN_LEFT);
    for (const item of items) {
        await this.writeCommand(this.encode(`${item.name}\n`));
        const line = `${item.quantity} x Y${item.price.toLocaleString()}`;
        const totalStr = `Y${(item.price * item.quantity).toLocaleString()}`;
        // MP-B20 has 32 columns in standard font
        const spaces = 32 - (line.length + totalStr.length); 
        const padding = spaces > 0 ? " ".repeat(spaces) : " ";
        await this.writeCommand(this.encode(`${line}${padding}${totalStr}\n`));
    }
    
    await this.writeCommand(this.encode("--------------------------------\n"));
    await this.writeCommand(EMPHASIS_ON);
    await this.writeCommand(SIZE_DOUBLE);
    await this.writeCommand(ALIGN_RIGHT);
    await this.writeCommand(this.encode(`TOTAL: Y${total.toLocaleString()}\n`));
    await this.writeCommand(EMPHASIS_OFF);
    await this.writeCommand(SIZE_NORMAL);
    
    await this.writeCommand(ALIGN_CENTER);
    await this.writeCommand([LF]);
    await this.writeCommand(this.encode(`Date: ${new Date().toLocaleString()}\n`));
    await this.writeCommand(this.encode("Thank you!\n"));
    await this.writeCommand([LF, LF, LF, LF]); // Feed
    
    // The flush will happen automatically 1s after the last command
  }
}

export const printerService = new PrinterService();