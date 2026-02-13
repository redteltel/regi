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

// Known Target UUIDs for MP-B20 / SII / Microchip
// We prioritize these if found.
const TARGET_UUIDS = [
  "00002af1-0000-1000-8000-00805f9b34fb", // SII Standard Write
  "49535343-8841-43f4-a8d4-ecbe34729bb3", // Microchip Transparent UART
];

export class PrinterService {
  private device: BluetoothDevice | null = null;
  private characteristic: BluetoothRemoteGATTCharacteristic | null = null;
  private onDisconnectCallback: (() => void) | null = null;
  private logger: ((msg: string) => void) | null = null;

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

  private handleDisconnect = () => {
    this.log("Disconnected via GATT event");
    this.characteristic = null;
    if (this.onDisconnectCallback) {
      this.onDisconnectCallback();
    }
    // Do not auto-reconnect immediately to avoid cache loops on error
  };

  async connect(): Promise<BluetoothDevice> {
    try {
      this.log("Requesting Device...");
      
      const device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [
            // SII Service
            "000018f0-0000-1000-8000-00805f9b34fb", 
            // Microchip Service (often parent of 49535343-8841...)
            "49535343-fe7d-4ae5-8fa9-9fafd205e455",
            // Generic & Standard Services
            0x18f0, 0x1800, 0x1801, 0x180A, 0xFF00, 0xFF02,
            // Explicitly list the target chars as services just in case implementation varies
            "49535343-8841-43f4-a8d4-ecbe34729bb3"
        ] 
      });

      if (this.device) {
        this.device.removeEventListener('gattserverdisconnected', this.handleDisconnect);
      }

      this.device = device;
      this.device.addEventListener('gattserverdisconnected', this.handleDisconnect);

      const displayName = device.name || (device.id ? `ID:${device.id.slice(0,5)}` : "Unknown");
      this.log(`Selected: ${displayName}`);

      this.log("Connecting GATT...");
      const server = await device.gatt?.connect();
      if (!server) throw new Error("GATT Connect failed");
      this.log("Connected.");

      // CRITICAL: 5000ms delay to bypass Android Service Cache
      this.log("WAITING 5 SECONDS (Cache Clear)...");
      await new Promise(r => setTimeout(r, 5000));

      this.log("Discovering Services...");
      const services = await server.getPrimaryServices();
      this.log(`Found ${services.length} services.`);
      
      let targetChar: BluetoothRemoteGATTCharacteristic | null = null;
      let fallbackChar: BluetoothRemoteGATTCharacteristic | null = null;

      // Verbose Logging Loop
      for (const service of services) {
        const sUuid = service.uuid;
        // Clean log for short UUIDs, keep full for 128-bit
        const sLog = sUuid.startsWith("0000") ? sUuid.slice(4, 8) : sUuid.slice(0, 8) + "..";
        this.log(`[S] ${sLog}`);

        try {
          const characteristics = await service.getCharacteristics();
          
          for (const char of characteristics) {
            const cUuid = char.uuid;
            const props = char.properties;
            
            // Build property string
            const pList = [];
            if (props.write) pList.push("WR");
            if (props.writeWithoutResponse) pList.push("WWoR");
            if (props.notify) pList.push("NT");
            if (props.read) pList.push("RD");
            
            const cLog = cUuid.startsWith("0000") ? cUuid.slice(4, 8) : cUuid.slice(0, 8) + "..";
            this.log(`  -[C] ${cLog} [${pList.join(',')}]`);

            // Check capability
            const isWritable = props.write || props.writeWithoutResponse;

            if (isWritable) {
                // 1. Check for Exact Target Match
                if (TARGET_UUIDS.includes(cUuid)) {
                    this.log(`  >>> TARGET MATCH FOUND!`);
                    targetChar = char;
                }
                // 2. Fallback to any writable if not found yet
                else if (!fallbackChar) {
                    fallbackChar = char;
                }
            }
          }
        } catch (e) {
          this.log(`  x Error reading service chars`);
        }
        
        // If we found a specific target, stop scanning to save time? 
        // No, user requested FULL logs, so we scan everything.
      }

      // Selection Logic
      if (targetChar) {
          this.characteristic = targetChar;
          this.log("Selected: TARGET Characteristic");
      } else if (fallbackChar) {
          this.characteristic = fallbackChar;
          this.log("Selected: Fallback Characteristic");
      } else {
          this.log("CRITICAL: No writable characteristic found.");
          throw new Error("No writable ports found. Check logs.");
      }

      this.log(`Bound: ${this.characteristic.uuid.slice(0,8)}...`);

      // Test Write (0x00)
      try {
          const nullByte = new Uint8Array([0x00]);
          if (this.characteristic.properties.writeWithoutResponse) {
              await this.characteristic.writeValueWithoutResponse(nullByte);
          } else {
              await this.characteristic.writeValue(nullByte);
          }
          this.log("Test write (0x00) OK.");
      } catch (e) {
          this.log(`Test write warning: ${e}`);
      }

      return device;
    } catch (error: any) {
      this.log(`Err: ${error.message || error}`);
      console.error(error);
      throw error;
    }
  }

  async restoreConnection(): Promise<boolean> {
    // Simplified restore for now, focusing on initial connection stability
    if (!this.device) return false;
    if (this.device.gatt?.connected && this.characteristic) return true;
    try {
        await this.device.gatt?.connect();
        return true; 
    } catch { return false; }
  }

  disconnect() {
    if (this.device) {
      this.device.removeEventListener('gattserverdisconnected', this.handleDisconnect);
      if (this.device.gatt?.connected) {
        this.device.gatt.disconnect();
      }
    }
    this.device = null;
    this.characteristic = null;
    this.log("Disconnected.");
  }

  isConnected(): boolean {
    return !!(this.device && this.device.gatt?.connected && this.characteristic);
  }

  private encode(text: string): Uint8Array {
    const encoder = new TextEncoder(); 
    return encoder.encode(text);
  }

  private async writeCommand(data: number[] | Uint8Array) {
    if (!this.characteristic) throw new Error("Printer not connected");
    const array = Array.isArray(data) ? new Uint8Array(data) : data;
    const canWriteNoResp = this.characteristic.properties.writeWithoutResponse;
    const CHUNK_SIZE = 20; 

    for (let i = 0; i < array.length; i += CHUNK_SIZE) {
      const chunk = array.slice(i, i + CHUNK_SIZE);
      try {
        if (canWriteNoResp) {
            await this.characteristic.writeValueWithoutResponse(chunk);
        } else {
            await this.characteristic.writeValue(chunk);
        }
      } catch (e) {
          // Retry once
          await new Promise(r => setTimeout(r, 50));
          try { await this.characteristic.writeValue(chunk); } catch (err) { throw err; }
      }
      await new Promise(r => setTimeout(r, 20));
    }
  }

  async printReceipt(items: CartItem[], total: number) {
    if (!this.isConnected()) throw new Error("Printer disconnected");

    this.log("Printing...");
    await this.writeCommand([ESC, AT]);
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
    await this.writeCommand([LF, LF, LF, LF]);
    this.log("Done.");
  }
}

export const printerService = new PrinterService();