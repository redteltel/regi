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
// Basic text size
const SIZE_NORMAL = [GS, 0x21, 0x00];
const SIZE_DOUBLE = [GS, 0x21, 0x11];

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
    this.log("Attempting silent reconnect...");
    this.restoreConnection().catch(() => {});
  };

  async connect(): Promise<BluetoothDevice> {
    try {
      this.log("Requesting Device (Accept All)...");
      
      // Use acceptAllDevices to ensure the device appears even if the name is missing
      const device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [
            // List potential services to ensure access permission
            "000018f0-0000-1000-8000-00805f9b34fb", // SII Custom
            0x18f0,
            0x1800, // Generic Access
            0x1801, // Generic Attribute
            0x180A, // Device Information
            0xFF00, // Common custom range
            0xFF02
        ] 
      });

      if (this.device) {
        this.device.removeEventListener('gattserverdisconnected', this.handleDisconnect);
      }

      this.device = device;
      this.device.addEventListener('gattserverdisconnected', this.handleDisconnect);

      const displayName = device.name || (device.id ? `ID:${device.id.slice(0,5)}` : "Unknown");
      this.log(`Selected: ${displayName}`);

      this.log("Connecting to GATT Server...");
      const server = await device.gatt?.connect();
      if (!server) throw new Error("Could not connect to GATT Server");
      this.log("GATT connected");

      // CRITICAL: 3000ms delay for Android 14/Pixel 9a to stabilize service discovery
      this.log("WAITING 3000ms (Android DB build)...");
      await new Promise(r => setTimeout(r, 3000));

      this.log("Scanning ALL services...");
      // Get ALL services visible to the device
      const services = await server.getPrimaryServices();
      this.log(`Found ${services.length} services.`);
      
      let targetChar: BluetoothRemoteGATTCharacteristic | null = null;
      const scannedInfo: string[] = [];

      // Brute-force: Iterate EVERYTHING to find a writable port
      for (const service of services) {
        const uuidShort = service.uuid.slice(0, 8);
        this.log(`Svc: ${uuidShort}...`);
        
        try {
          const characteristics = await service.getCharacteristics();
          this.log(` -> ${characteristics.length} chars found`);
          
          for (const char of characteristics) {
            const props = char.properties;
            const canWrite = props.write;
            const canWriteNoResp = props.writeWithoutResponse;
            
            const charUuidShort = char.uuid.slice(0, 8);
            
            if (canWrite || canWriteNoResp) {
                const mode = canWriteNoResp ? "WriteNoResp" : "Write";
                this.log(`   -> [MATCH] ${charUuidShort} (${mode})`);
                
                // We take the FIRST writable characteristic we find.
                // Usually, the custom service is listed first or second after Generic Access.
                if (!targetChar) {
                    targetChar = char;
                    // We don't break immediately; we could prefer 'writeWithoutResponse' 
                    // but for now, first match is safest for brute force.
                }
            } else {
                 // Log read-only chars for debugging
                 // this.log(`   -> [Skip] ${charUuidShort}`);
            }
          }
        } catch (e) {
          this.log(` -> Access Denied/Error: ${uuidShort}`);
        }
        
        if (targetChar) {
            this.log("Target Characteristic secured.");
            break; 
        }
      }

      if (!targetChar) {
        this.log("CRITICAL: No writable characteristic found in any service.");
        throw new Error("No writable characteristic found. See logs.");
      }

      this.characteristic = targetChar;
      this.log(`Bound to: ${this.characteristic.uuid.slice(0,8)}...`);
      
      // Optional: Send a null byte to wake/test connection
      try {
          const nullByte = new Uint8Array([0x00]);
          if (this.characteristic.properties.writeWithoutResponse) {
              await this.characteristic.writeValueWithoutResponse(nullByte);
          } else {
              await this.characteristic.writeValue(nullByte);
          }
          this.log("Connection verified (0x00 sent).");
      } catch (e) {
          this.log(`Verify write warning: ${e}`);
      }

      return device;
    } catch (error: any) {
      this.log(`Connection error: ${error.message || error}`);
      console.error("Bluetooth connection error:", error);
      throw error;
    }
  }

  async restoreConnection(): Promise<boolean> {
    if (!this.device) return false;
    if (this.device.gatt?.connected && this.characteristic) return true;

    try {
      this.log("Auto-reconnecting...");
      const server = await this.device.gatt?.connect();
      if (!server) return false;
      
      await new Promise(r => setTimeout(r, 2000));
      const services = await server.getPrimaryServices();
      
      for (const service of services) {
        try {
          const characteristics = await service.getCharacteristics();
          for (const char of characteristics) {
            if (char.properties.write || char.properties.writeWithoutResponse) {
              this.characteristic = char;
              this.log("Restored via scan.");
              return true;
            }
          }
        } catch (e) { continue; }
      }
    } catch (e) {
      this.log(`Restore failed: ${e}`);
    }
    return false;
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
          try { await this.characteristic.writeValue(chunk); } catch (err) { throw err; }
      }
      await new Promise(r => setTimeout(r, 20));
    }
  }

  async printReceipt(items: CartItem[], total: number) {
    if (!this.isConnected()) {
      const restored = await this.restoreConnection();
      if (!restored) throw new Error("Printer disconnected");
    }

    const performPrint = async () => {
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
    };

    try {
        await performPrint();
    } catch (e) {
        this.log("Retry print...");
        await new Promise(r => setTimeout(r, 1000));
        await this.restoreConnection();
        await performPrint();
    }
  }
}

export const printerService = new PrinterService();