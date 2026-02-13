import { CartItem } from '../types';

// Seiko Instruments (SII) often uses this specific service UUID for their mobile printers via BLE.
const SII_SERVICE_UUID = "000018f0-0000-1000-8000-00805f9b34fb";
// Common writable characteristic for SII
const SII_CHAR_UUID = "00002af1-0000-1000-8000-00805f9b34fb";

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

  // Set a callback to update UI when the printer disconnects unexpectedly
  setOnDisconnect(callback: () => void) {
    this.onDisconnectCallback = callback;
  }

  private handleDisconnect = () => {
    console.log("Printer disconnected via GATT event");
    this.characteristic = null;
    if (this.onDisconnectCallback) {
      this.onDisconnectCallback();
    }
  };

  async connect(): Promise<BluetoothDevice> {
    try {
      console.log("Requesting Bluetooth Device...");
      const device = await navigator.bluetooth.requestDevice({
        filters: [{ namePrefix: 'MP-B20' }],
        optionalServices: [
            SII_SERVICE_UUID,
            '000018f0-0000-1000-8000-00805f9b34fb',
            0x18f0,
            0x1800,
            0x1801,
            'e7810a71-73ae-499d-8c15-faa9aef0c3f2'
        ] 
      });

      if (this.device) {
        this.device.removeEventListener('gattserverdisconnected', this.handleDisconnect);
      }

      this.device = device;
      this.device.addEventListener('gattserverdisconnected', this.handleDisconnect);

      console.log("Device selected:", device.name);
      
      const server = await device.gatt?.connect();
      if (!server) throw new Error("Could not connect to GATT Server");
      console.log("GATT Server connected");

      // Increased delay to 3000ms to give ample time for Android pairing dialog
      await new Promise(r => setTimeout(r, 3000));

      console.log("Getting primary services...");
      const services = await server.getPrimaryServices();
      
      let foundChar = false;
      for (const service of services) {
        try {
          const characteristics = await service.getCharacteristics();
          for (const char of characteristics) {
            if (char.properties.write || char.properties.writeWithoutResponse) {
              this.characteristic = char;
              foundChar = true;
              break;
            }
          }
        } catch (e) {
          console.warn(`Failed to get characteristics for service ${service.uuid}`, e);
        }
        if (foundChar) break;
      }

      if (!this.characteristic) {
        throw new Error("プリンタへの書き込み権限が見つかりません。Androidの設定でペアリングを解除してから、再試行してください。");
      }

      return device;
    } catch (error) {
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
      console.log("Attempting to restore connection...");
      const server = await this.device.gatt?.connect();
      if (!server) return false;
      
      await new Promise(r => setTimeout(r, 1000)); // Short delay for stability
      const services = await server.getPrimaryServices();
      
      for (const service of services) {
        try {
          const characteristics = await service.getCharacteristics();
          for (const char of characteristics) {
            if (char.properties.write || char.properties.writeWithoutResponse) {
              this.characteristic = char;
              return true;
            }
          }
        } catch (e) { continue; }
      }
    } catch (e) {
      console.warn("Restoration failed:", e);
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
    
    const CHUNK_SIZE = 50; 
    for (let i = 0; i < array.length; i += CHUNK_SIZE) {
      const chunk = array.slice(i, i + CHUNK_SIZE);
      await this.characteristic.writeValue(chunk);
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
        // Initialize
        await this.writeCommand([ESC, AT]);

        // Header
        await this.writeCommand(ALIGN_CENTER);
        await this.writeCommand(SIZE_DOUBLE);
        await this.writeCommand(this.encode("RECEIPT\n"));
        await this.writeCommand(SIZE_NORMAL);
        await this.writeCommand(this.encode("PixelPOS Store\n"));
        await this.writeCommand(this.encode("--------------------------------\n"));
        await this.writeCommand([LF]);

        // Items
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

        // Total
        await this.writeCommand(EMPHASIS_ON);
        await this.writeCommand(SIZE_DOUBLE);
        await this.writeCommand(ALIGN_RIGHT);
        await this.writeCommand(this.encode(`TOTAL: Y${total.toLocaleString()}\n`));
        await this.writeCommand(EMPHASIS_OFF);
        await this.writeCommand(SIZE_NORMAL);
        await this.writeCommand(ALIGN_CENTER);
        
        // Footer
        await this.writeCommand([LF]);
        await this.writeCommand(this.encode(`Date: ${new Date().toLocaleString()}\n`));
        await this.writeCommand(this.encode("Thank you!\n"));
        
        // Feed and Cut
        await this.writeCommand([LF, LF, LF, LF]);
    };

    try {
        await performPrint();
    } catch (e) {
        console.warn("First print attempt failed, retrying once...", e);
        // Simple retry logic: wait a bit, try to restore connection again, then print
        await new Promise(r => setTimeout(r, 1000));
        await this.restoreConnection();
        await performPrint();
    }
  }
}

export const printerService = new PrinterService();