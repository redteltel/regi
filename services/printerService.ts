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

// PRIORITY TARGETS for MP-B20 (SII / Microchip)
// Service: 49535343-fe7d-4ae5-8fa9-9fafd205e455
// Write Char: 49535343-1e4d-4bd9-ba61-802d64c64e01 or 49535343-8841-43f4-a8d4-ecbe34729bb3
const SII_SERVICE_UUID = "49535343-fe7d-4ae5-8fa9-9fafd205e455";
const SII_WRITE_UUID_1 = "49535343-1e4d-4bd9-ba61-802d64c64e01";
const SII_WRITE_UUID_2 = "49535343-8841-43f4-a8d4-ecbe34729bb3";

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
  };

  async connect(): Promise<BluetoothDevice> {
    try {
      this.log("Requesting Device (Accept ALL)...");
      
      // 1. Device Selection: Open filter completely
      const device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [
            SII_SERVICE_UUID,
            "000018f0-0000-1000-8000-00805f9b34fb", // Standard SII
            0x18f0, 0x1800, 0x1801, 0x180A, 0xFF00, 0xFF02 // Generics
        ] 
      });

      if (this.device) {
        this.device.removeEventListener('gattserverdisconnected', this.handleDisconnect);
      }

      this.device = device;
      this.device.addEventListener('gattserverdisconnected', this.handleDisconnect);

      const displayName = device.name || (device.id ? `ID:${device.id.slice(0,5)}` : "Unknown Device");
      this.log(`Selected: ${displayName}`);

      this.log("Connecting GATT...");
      const server = await device.gatt?.connect();
      if (!server) throw new Error("GATT Connect failed");
      this.log("Connected.");

      // 2. STABILIZATION DELAY (10 seconds)
      // Visual countdown for user assurance
      for (let i = 10; i > 0; i--) {
        this.log(`Waiting ${i}s for Android GATT...`);
        await new Promise(r => setTimeout(r, 1000));
      }
      this.log("Stabilization complete.");

      // 3. Service Discovery with Retry & Direct Targeting
      let targetChar: BluetoothRemoteGATTCharacteristic | null = null;
      const MAX_ATTEMPTS = 3;

      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        this.log(`Finding Services (Attempt ${attempt}/${MAX_ATTEMPTS})...`);
        
        try {
            // STRATEGY A: Direct "Hitman" Approach (Target known SII UUID directly)
            // This bypasses "List All" which often fails on Android 13+
            try {
                this.log(`Trying Direct SII Service...`);
                const service = await server.getPrimaryService(SII_SERVICE_UUID);
                this.log(`> Found SII Service! Getting Char...`);
                
                // Try getting characteristic directly
                try {
                    targetChar = await service.getCharacteristic(SII_WRITE_UUID_1);
                    this.log(`> Found Primary Write Char!`);
                    break;
                } catch {
                     try {
                        targetChar = await service.getCharacteristic(SII_WRITE_UUID_2);
                        this.log(`> Found Secondary Write Char!`);
                        break;
                     } catch (e) { this.log(`> Direct Char lookup failed.`); }
                }
            } catch (e) {
                this.log(`Direct SII lookup failed. Moving to scan.`);
            }

            if (targetChar) break;

            // STRATEGY B: Brute Force Scan (List All)
            this.log(`Scanning ALL services...`);
            const services = await server.getPrimaryServices();
            this.log(`Found ${services.length} services via scan.`);

            for (const service of services) {
                this.log(`Scanned Svc: ${service.uuid.slice(0,8)}...`);
                try {
                    const chars = await service.getCharacteristics();
                    for (const char of chars) {
                        const props = char.properties;
                        const isWritable = props.write || props.writeWithoutResponse;
                        this.log(` - Char: ${char.uuid.slice(0,8)} [WR:${isWritable}]`);
                        
                        if (isWritable && !targetChar) {
                            targetChar = char;
                            this.log(`MATCHED: ${char.uuid}`);
                        }
                    }
                } catch (e) { /* ignore access errors */ }
                
                if (targetChar) break;
            }

        } catch (e: any) {
            this.log(`Scan Error: ${e.message}`);
        }

        if (targetChar) break;
        
        if (attempt < MAX_ATTEMPTS) {
            this.log("Retrying in 2s...");
            await new Promise(r => setTimeout(r, 2000));
        }
      }

      if (!targetChar) {
          this.log("CRITICAL: Failed to find writable port after retries.");
          throw new Error("Service discovery failed. Please restart Printer and App.");
      }

      this.characteristic = targetChar;
      this.log(`Bound to: ${this.characteristic.uuid.slice(0,8)}...`);

      // Wake up / Test
      try {
          this.log("Sending wakeup byte...");
          const nullByte = new Uint8Array([0x00]);
          if (this.characteristic.properties.writeWithoutResponse) {
              await this.characteristic.writeValueWithoutResponse(nullByte);
          } else {
              await this.characteristic.writeValue(nullByte);
          }
          this.log("Wakeup OK.");
      } catch (e) {
          this.log(`Wakeup warning: ${e}`);
      }

      return device;
    } catch (error: any) {
      this.log(`Conn Error: ${error.message || error}`);
      console.error(error);
      throw error;
    }
  }

  async restoreConnection(): Promise<boolean> {
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
    this.log("Print Done.");
  }
}

export const printerService = new PrinterService();