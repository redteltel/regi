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

  async connect(): Promise<BluetoothDevice> {
    try {
      console.log("Requesting Bluetooth Device...");
      // Request device filter
      const device = await navigator.bluetooth.requestDevice({
        filters: [{ namePrefix: 'MP-B20' }],
        optionalServices: [
            SII_SERVICE_UUID,
            '000018f0-0000-1000-8000-00805f9b34fb', // Full UUID string
            0x18f0, // Short 16-bit UUID
            // Add generic services that might be present
            0x1800, // Generic Access
            0x1801, // Generic Attribute
            'e7810a71-73ae-499d-8c15-faa9aef0c3f2' // Another potential generic UUID
        ] 
      });

      this.device = device;
      console.log("Device selected:", device.name);
      
      const server = await device.gatt?.connect();
      if (!server) throw new Error("Could not connect to GATT Server");
      console.log("GATT Server connected");

      // Connection stability delay for Android
      await new Promise(r => setTimeout(r, 500));

      // Attempt to find a writable characteristic
      console.log("Getting primary services...");
      const services = await server.getPrimaryServices();
      console.log("Found services:", services.map(s => s.uuid));
      
      for (const service of services) {
        console.log(`Checking service: ${service.uuid}`);
        try {
          const characteristics = await service.getCharacteristics();
          for (const char of characteristics) {
            console.log(`  > Char: ${char.uuid}, Props: ${JSON.stringify(char.properties)}`);
            if (char.properties.write || char.properties.writeWithoutResponse) {
              this.characteristic = char;
              console.log("  >>> Writable characteristic found!");
              break;
            }
          }
        } catch (e) {
          console.warn(`Failed to get characteristics for service ${service.uuid}`, e);
        }
        if (this.characteristic) break;
      }

      if (!this.characteristic) {
        throw new Error("No writable characteristic found on printer. Please unpair from Android Bluetooth settings and try again.");
      }

      return device;
    } catch (error) {
      console.error("Bluetooth connection error:", error);
      throw error;
    }
  }

  disconnect() {
    if (this.device && this.device.gatt?.connected) {
      this.device.gatt.disconnect();
    }
    this.device = null;
    this.characteristic = null;
  }

  isConnected(): boolean {
    return !!(this.device && this.device.gatt?.connected && this.characteristic);
  }

  // Helper to convert string to Uint8Array (Simple ASCII/Katakana mapping for now)
  private encode(text: string): Uint8Array {
    const encoder = new TextEncoder(); // UTF-8
    // Note: MP-B20 might expect Shift-JIS for Japanese. 
    // For this demo, we assume the printer accepts UTF-8 or we strictly use ASCII for stability.
    // If Japanese is garbled, Shift-JIS encoding logic would be needed here.
    return encoder.encode(text);
  }

  private async writeCommand(data: number[] | Uint8Array) {
    if (!this.characteristic) throw new Error("Printer not connected");
    
    const array = Array.isArray(data) ? new Uint8Array(data) : data;
    
    // Web Bluetooth can usually handle ~512 bytes, but 20 bytes is safest for older BLE
    const CHUNK_SIZE = 100; 
    for (let i = 0; i < array.length; i += CHUNK_SIZE) {
      const chunk = array.slice(i, i + CHUNK_SIZE);
      await this.characteristic.writeValue(chunk);
      // Small delay between chunks prevents buffer overflow
      await new Promise(r => setTimeout(r, 10));
    }
  }

  async printReceipt(items: CartItem[], total: number) {
    if (!this.isConnected()) throw new Error("Printer not connected");

    try {
      // 1. Initialize
      await this.writeCommand([ESC, AT]);

      // 2. Header
      await this.writeCommand(ALIGN_CENTER);
      await this.writeCommand(SIZE_DOUBLE);
      await this.writeCommand(this.encode("RECEIPT\n"));
      await this.writeCommand(SIZE_NORMAL);
      await this.writeCommand(this.encode("PixelPOS Store\n"));
      await this.writeCommand(this.encode("--------------------------------\n"));
      await this.writeCommand([LF]);

      // 3. Items
      await this.writeCommand(ALIGN_LEFT);
      for (const item of items) {
        // Name
        await this.writeCommand(this.encode(`${item.name}\n`));
        
        // Qty x Price ... Total (Manual spacing for 32 columns approx)
        const line = `${item.quantity} x ¥${item.price.toLocaleString()}`;
        const totalStr = `¥${(item.price * item.quantity).toLocaleString()}`;
        
        // Simple manual spacing logic
        const spaces = 32 - (line.length + totalStr.length);
        const padding = spaces > 0 ? " ".repeat(spaces) : " ";
        
        await this.writeCommand(this.encode(`${line}${padding}${totalStr}\n`));
      }

      await this.writeCommand(this.encode("--------------------------------\n"));

      // 4. Total
      await this.writeCommand(EMPHASIS_ON);
      await this.writeCommand(SIZE_DOUBLE);
      await this.writeCommand(ALIGN_RIGHT);
      await this.writeCommand(this.encode(`TOTAL: ¥${total.toLocaleString()}\n`));
      await this.writeCommand(EMPHASIS_OFF);
      await this.writeCommand(SIZE_NORMAL);
      await this.writeCommand(ALIGN_CENTER);
      
      // 5. Footer
      await this.writeCommand([LF]);
      await this.writeCommand(this.encode(`Date: ${new Date().toLocaleString()}\n`));
      await this.writeCommand(this.encode("Thank you!\n"));
      
      // 6. Feed and Cut (Feed 4 lines)
      await this.writeCommand([LF, LF, LF, LF]);
      
    } catch (e) {
      console.error("Print failed", e);
      throw e;
    }
  }
}

export const printerService = new PrinterService();