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

// PRIORITY TARGETS for MP-B20
const TARGET_SERVICE_UUID = "49535343-fe7d-4ae5-8fa9-9fafd205e455"; // Microchip / SII Private Service
const TARGET_WRITE_UUID   = "49535343-1e4d-4bd9-ba61-802d64c64e01"; // Specific Write Char
const ALT_WRITE_UUID      = "49535343-8841-43f4-a8d4-ecbe34729bb3"; // Transparent UART

const FALLBACK_SERVICE_UUID = "000018f0-0000-1000-8000-00805f9b34fb"; // SII Standard Service
const FALLBACK_WRITE_UUID   = "00002af1-0000-1000-8000-00805f9b34fb"; // SII Standard Write

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
      this.log("Requesting Device (MP-B20)...");
      
      const device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [
            TARGET_SERVICE_UUID,
            FALLBACK_SERVICE_UUID,
            "49535343-fe7d-4ae5-8fa9-9fafd205e455", // Explicit string
            0x18f0, 0x1800, 0x1801, 0x180A, 0xFF00, 0xFF02 // Generics
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

      // CRITICAL: 7000ms delay for Pixel 9a stability
      this.log("WAITING 7 SECONDS (Stabilizing)...");
      await new Promise(r => setTimeout(r, 7000));

      this.log("Discovering Services...");
      const services = await server.getPrimaryServices();
      this.log(`Found ${services.length} services.`);
      
      let targetChar: BluetoothRemoteGATTCharacteristic | null = null;
      let fallbackChar: BluetoothRemoteGATTCharacteristic | null = null;

      // Scan loop
      for (const service of services) {
        const sUuid = service.uuid;
        // Check if this is our Priority Service
        const isPriorityService = sUuid === TARGET_SERVICE_UUID;
        
        if (isPriorityService) {
            this.log(`>>> FOUND PRIORITY SERVICE: ${sUuid.slice(0,8)}...`);
        } else {
            this.log(`[S] ${sUuid.slice(0,8)}...`);
        }

        try {
          const characteristics = await service.getCharacteristics();
          
          for (const char of characteristics) {
            const cUuid = char.uuid;
            const props = char.properties;
            const isWritable = props.write || props.writeWithoutResponse;
            
            this.log(`  -[C] ${cUuid.slice(0,8)}... [WR:${isWritable}]`);

            if (isWritable) {
                // 1. Exact Match Priority 1
                if (cUuid === TARGET_WRITE_UUID) {
                    this.log(`  >>> TARGET MATCH (Primary)!`);
                    targetChar = char;
                    break; // Stop looking in this service
                }
                // 2. Exact Match Priority 2
                if (cUuid === ALT_WRITE_UUID) {
                    this.log(`  >>> TARGET MATCH (Secondary)!`);
                    targetChar = char;
                }
                // 3. Fallback Standard
                if (cUuid === FALLBACK_WRITE_UUID) {
                    this.log(`  >>> FALLBACK MATCH (Standard)!`);
                    if (!targetChar) targetChar = char;
                }
                // 4. Any writable
                if (!fallbackChar) {
                    fallbackChar = char;
                }
            }
          }
        } catch (e) {
          this.log(`  x Error reading chars: ${e}`);
        }
        
        if (targetChar && isPriorityService) break; // Found best match in best service
      }

      // Final Selection
      if (targetChar) {
          this.characteristic = targetChar;
          this.log(`Bound to TARGET: ${this.characteristic.uuid.slice(0,8)}`);
      } else if (fallbackChar) {
          this.characteristic = fallbackChar;
          this.log(`Bound to FALLBACK: ${this.characteristic.uuid.slice(0,8)}`);
      } else {
          this.log("CRITICAL: No writable characteristic found.");
          throw new Error("No writable ports found. See logs.");
      }

      // Wake up / Test
      try {
          this.log("Sending wakeup (0x00)...");
          const nullByte = new Uint8Array([0x00]);
          if (this.characteristic.properties.writeWithoutResponse) {
              await this.characteristic.writeValueWithoutResponse(nullByte);
          } else {
              await this.characteristic.writeValue(nullByte);
          }
          this.log("Wakeup sent.");
      } catch (e) {
          this.log(`Wakeup warning: ${e}`);
      }

      return device;
    } catch (error: any) {
      this.log(`Connection failed: ${error.message || error}`);
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