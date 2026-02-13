import { CartItem } from '../types';

// Seiko Instruments (SII) often uses this specific service UUID for their mobile printers via BLE.
const SII_SERVICE_UUID = "000018f0-0000-1000-8000-00805f9b34fb";
// Common writable characteristic for SII
const SII_CHAR_UUID_PREFIX = "00002af1"; 

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

  // Set a callback to update UI when the printer disconnects unexpectedly
  setOnDisconnect(callback: () => void) {
    this.onDisconnectCallback = callback;
  }

  private handleDisconnect = () => {
    this.log("Disconnected via GATT event");
    this.characteristic = null;
    if (this.onDisconnectCallback) {
      this.onDisconnectCallback();
    }
    // Attempt auto-reconnect if it was an accidental drop
    this.log("Attempting silent reconnect...");
    this.restoreConnection().catch(() => {});
  };

  async connect(): Promise<BluetoothDevice> {
    try {
      this.log("Starting Bluetooth scan (Accept All)...");
      
      // Pixel 9a / Android Optimization: 
      // Use acceptAllDevices: true to ensure the device shows up in the list, even if the name isn't resolved yet.
      // We MUST NOT use 'filters' when acceptAllDevices is true.
      const device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [
            SII_SERVICE_UUID, 
            '000018f0-0000-1000-8000-00805f9b34fb',
            0x18f0,
            0x1800, 
            0x1801,
            0x180A
        ] 
      });

      if (this.device) {
        this.device.removeEventListener('gattserverdisconnected', this.handleDisconnect);
      }

      this.device = device;
      this.device.addEventListener('gattserverdisconnected', this.handleDisconnect);

      // Handle cases where name is null/undefined (Android security feature until connected)
      const displayName = device.name || "Unknown Device";
      const displayId = device.id.slice(0, 8); // Show partial ID for identification
      this.log(`Selected: ${displayName}`);
      this.log(`ID: ${displayId}...`);

      this.log("Connecting to GATT Server...");
      
      const server = await device.gatt?.connect();
      if (!server) throw new Error("Could not connect to GATT Server");
      this.log("GATT connected");

      // Pixel 9a Fix: Delay to stabilize GATT
      this.log("Stabilizing connection (1500ms)...");
      await new Promise(r => setTimeout(r, 1500));

      this.log("Discovering services...");
      const services = await server.getPrimaryServices();
      this.log(`Found ${services.length} services`);
      
      let foundChar: BluetoothRemoteGATTCharacteristic | null = null;
      let preferredChar: BluetoothRemoteGATTCharacteristic | null = null;

      for (const service of services) {
        this.log(`Chk Svc: ${service.uuid.slice(0,8)}...`);
        try {
          const characteristics = await service.getCharacteristics();
          for (const char of characteristics) {
            const props = char.properties;
            const uuid = char.uuid;
            const canWrite = props.write || props.writeWithoutResponse;
            
            if (canWrite) {
                // If this matches the SII specific characteristic, prefer it
                if (uuid.startsWith(SII_CHAR_UUID_PREFIX) || uuid === SII_SERVICE_UUID) {
                    preferredChar = char;
                    this.log(` > Preferred Char found`);
                }
                // Keep the first writable one as fallback
                if (!foundChar) foundChar = char;
            }
          }
        } catch (e) {
          // Ignore services we can't read
        }
      }

      this.characteristic = preferredChar || foundChar;

      if (!this.characteristic) {
        throw new Error("No writable characteristic found. Please unpair and retry.");
      }
      
      this.log(`Ready to print.`);
      return device;
    } catch (error: any) {
      this.log(`Connection error: ${error.message || error}`);
      console.error("Bluetooth connection error:", error);
      throw error;
    }
  }

  // Attempt to reconnect using the existing device object without showing the picker
  async restoreConnection(): Promise<boolean> {
    if (!this.device) return false;
    
    // Already connected?
    if (this.device.gatt?.connected && this.characteristic) return true;

    try {
      this.log("Attempting auto-reconnect...");
      const server = await this.device.gatt?.connect();
      if (!server) return false;
      
      // Delay for restore as well
      await new Promise(r => setTimeout(r, 1500));
      
      const services = await server.getPrimaryServices();
      
      // Quick scan for writable
      for (const service of services) {
        try {
          const characteristics = await service.getCharacteristics();
          for (const char of characteristics) {
            if (char.properties.write || char.properties.writeWithoutResponse) {
              this.characteristic = char;
              this.log("Reconnected successfully.");
              return true;
            }
          }
        } catch (e) { continue; }
      }
    } catch (e) {
      this.log(`Reconnect failed: ${e}`);
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
    
    // Check property capability
    const canWriteNoResp = this.characteristic.properties.writeWithoutResponse;

    // Reduced chunk size to 20 bytes for Android stability
    const CHUNK_SIZE = 20; 
    for (let i = 0; i < array.length; i += CHUNK_SIZE) {
      const chunk = array.slice(i, i + CHUNK_SIZE);
      
      try {
        if (canWriteNoResp) {
            // Prefer NoResponse for speed and stability on Android
            await this.characteristic.writeValueWithoutResponse(chunk);
        } else {
            // Fallback to standard write
            await this.characteristic.writeValue(chunk);
        }
      } catch (e) {
          try { await this.characteristic.writeValue(chunk); } catch (err) { throw err; }
      }

      await new Promise(r => setTimeout(r, 20));
    }
  }

  async printReceipt(items: CartItem[], total: number) {
    // 1. Check connection
    if (!this.isConnected()) {
      const restored = await this.restoreConnection();
      if (!restored) {
        throw new Error("Printer disconnected");
      }
    }

    // Wrapper to perform printing
    const performPrint = async () => {
        this.log("Sending print data...");
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
        this.log("Print sent.");
    };

    try {
        await performPrint();
    } catch (e) {
        this.log("Print failed, retrying...");
        console.warn("First print attempt failed, retrying once...", e);
        await new Promise(r => setTimeout(r, 1000));
        await this.restoreConnection();
        await performPrint();
    }
  }
}

export const printerService = new PrinterService();