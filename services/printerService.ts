
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

// Common Service UUIDs for Receipt Printers (Seiko, Star, Epson, etc often use proprietary or standard serial)
// SII MP-B20 often uses specific UUIDs, but we will scan for standard generic services first.
const CANDIDATE_SERVICES = [
  "000018f0-0000-1000-8000-00805f9b34fb", // Generic Serial
  "e7810a71-73ae-499d-8c15-faa9aef0c3f2", // SII specific (example)
  "0000ff00-0000-1000-8000-00805f9b34fb", // Common generic
];

export class PrinterService {
  private logger: ((msg: string) => void) | null = null;
  private onDisconnectCallback: (() => void) | null = null;

  // Bluetooth State
  private btDevice: BluetoothDevice | null = null;
  private btCharacteristic: BluetoothRemoteGATTCharacteristic | null = null;

  // USB Serial State
  private serialPort: SerialPort | null = null;
  private serialWriter: WritableStreamDefaultWriter<Uint8Array> | null = null;

  private type: 'BLUETOOTH' | 'USB' | null = null;

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
  // Web Bluetooth Connection
  // ==========================================
  async connectBluetooth(): Promise<any> {
    this.disconnect(); // Clear previous connections
    this.log("Requesting Bluetooth Device...");

    try {
      // Note: "acceptAllDevices: true" cannot be used with "optionalServices".
      // We must filter by at least one criteria or list services.
      // Since MP-B20 ID varies, we try a broad filter or name prefix.
      const device = await navigator.bluetooth.requestDevice({
        filters: [
            { namePrefix: 'MP-B' }, // Target SII MP-B series
            { services: ['000018f0-0000-1000-8000-00805f9b34fb'] }
        ],
        optionalServices: [
            ...CANDIDATE_SERVICES, 
            "000018f0-0000-1000-8000-00805f9b34fb"
        ],
        acceptAllDevices: false 
      });

      this.log(`Device selected: ${device.name}`);
      this.btDevice = device;
      device.addEventListener('gattserverdisconnected', this.handleDisconnect.bind(this));

      if (!device.gatt) throw new Error("Device does not support GATT");

      this.log("Connecting to GATT Server...");
      const server = await device.gatt.connect();

      this.log("Getting Service...");
      let service: BluetoothRemoteGATTService | null = null;

      // Try to find a writable service
      const services = await server.getPrimaryServices();
      if (services.length > 0) {
          // Prefer 18f0 if available, otherwise pick first
          service = services.find(s => s.uuid.includes("18f0")) || services[0];
      }
      
      if (!service) throw new Error("No suitable service found.");
      
      this.log(`Service found: ${service.uuid}`);
      
      const characteristics = await service.getCharacteristics();
      // Find a writable characteristic
      this.btCharacteristic = characteristics.find(c => c.properties.write || c.properties.writeWithoutResponse) || null;

      if (!this.btCharacteristic) {
        throw new Error("No writable characteristic found.");
      }

      this.type = 'BLUETOOTH';
      this.log("✅ Bluetooth Connected!");
      return device;

    } catch (error: any) {
      this.log(`BT Error: ${error.message}`);
      throw error;
    }
  }

  async restoreBluetoothConnection(): Promise<boolean> {
     if (this.btDevice && this.btDevice.gatt && !this.btDevice.gatt.connected) {
         try {
             this.log("Restoring BT Connection...");
             await this.btDevice.gatt.connect();
             this.type = 'BLUETOOTH';
             return true;
         } catch (e) {
             console.error(e);
             return false;
         }
     }
     return false;
  }

  // ==========================================
  // Web Serial (USB) Connection
  // ==========================================
  async connectUsb(): Promise<string> {
    this.disconnect();
    this.log("Requesting USB Serial Port...");

    if (!navigator.serial) {
      throw new Error("Web Serial API not supported in this browser.");
    }

    try {
      // SII Vendor ID is often 0x0619, but generic filter allows user selection
      const port = await navigator.serial.requestPort({});
      await port.open({ baudRate: 115200 }); // MP-B20 default

      this.serialPort = port;
      if (port.writable) {
        this.serialWriter = port.writable.getWriter();
      }

      this.type = 'USB';
      this.log("✅ USB Serial Connected!");
      
      // Determine name
      const info = port.getInfo();
      return `USB Printer (VID:${info.usbVendorId})`;

    } catch (error: any) {
      this.log(`USB Error: ${error.message}`);
      throw error;
    }
  }

  // ==========================================
  // Common Methods
  // ==========================================
  
  disconnect() {
    if (this.btDevice && this.btDevice.gatt?.connected) {
      this.btDevice.gatt.disconnect();
    }
    this.btDevice = null;
    this.btCharacteristic = null;

    if (this.serialWriter) {
        this.serialWriter.releaseLock();
        this.serialWriter = null;
    }
    if (this.serialPort) {
        this.serialPort.close().catch(e => console.error(e));
        this.serialPort = null;
    }

    this.type = null;
    this.log("Disconnected.");
    if (this.onDisconnectCallback) this.onDisconnectCallback();
  }

  private handleDisconnect() {
    this.log("Device disconnected remotely.");
    this.type = null;
    if (this.onDisconnectCallback) this.onDisconnectCallback();
  }

  isConnected(): boolean {
    if (this.type === 'BLUETOOTH') {
        return !!(this.btDevice && this.btDevice.gatt && this.btDevice.gatt.connected);
    }
    if (this.type === 'USB') {
        return !!(this.serialPort && this.serialPort.writable);
    }
    return false;
  }

  // ==========================================
  // Printing Logic
  // ==========================================
  
  private encode(text: string): Uint8Array {
    // Note: MP-B20 default is Shift_JIS for Japanese. 
    // TextEncoder only supports UTF-8.
    // If characters are garbled, the printer needs to be set to UTF-8 mode
    // or we need a Shift_JIS mapping library.
    // For this demo, we assume UTF-8 or ASCII.
    return new TextEncoder().encode(text);
  }

  private async write(data: Uint8Array | number[]) {
    const buffer = data instanceof Uint8Array ? data : new Uint8Array(data);

    if (this.type === 'BLUETOOTH' && this.btCharacteristic) {
        // BLE limits packet size (MTU). Typically 20 bytes or 512 bytes.
        // We split into small chunks to be safe (e.g., 100 bytes).
        const CHUNK_SIZE = 100;
        for (let i = 0; i < buffer.length; i += CHUNK_SIZE) {
            const chunk = buffer.slice(i, i + CHUNK_SIZE);
            await this.btCharacteristic.writeValue(chunk);
        }
    } else if (this.type === 'USB' && this.serialWriter) {
        await this.serialWriter.write(buffer);
    } else {
        throw new Error("Printer not connected");
    }
  }

  async printReceipt(items: CartItem[], total: number) {
    if (!this.isConnected()) throw new Error("Not connected");
    
    this.log("Printing...");

    try {
        await this.write([ESC, AT]); // Init
        await this.write(ALIGN_CENTER);
        await this.write(SIZE_DOUBLE);
        await this.write(this.encode("RECEIPT\n"));
        
        await this.write(SIZE_NORMAL);
        await this.write(this.encode("PixelPOS Store\n"));
        await this.write(this.encode("--------------------------------\n"));
        await this.write([LF]);
        
        await this.write(ALIGN_LEFT);
        for (const item of items) {
            await this.write(this.encode(`${item.name}\n`));
            const line = `${item.quantity} x Y${item.price.toLocaleString()}`;
            const totalStr = `Y${(item.price * item.quantity).toLocaleString()}`;
            
            // Simple padding calculation
            const spaces = 32 - (line.length + totalStr.length); 
            const padding = spaces > 0 ? " ".repeat(spaces) : " ";
            await this.write(this.encode(`${line}${padding}${totalStr}\n`));
        }
        
        await this.write(this.encode("--------------------------------\n"));
        
        await this.write(EMPHASIS_ON);
        await this.write(SIZE_DOUBLE);
        await this.write(ALIGN_RIGHT);
        await this.write(this.encode(`TOTAL: Y${total.toLocaleString()}\n`));
        await this.write(EMPHASIS_OFF);
        await this.write(SIZE_NORMAL);
        
        await this.write(ALIGN_CENTER);
        await this.write([LF]);
        await this.write(this.encode(`Date: ${new Date().toLocaleString()}\n`));
        await this.write(this.encode("Thank you!\n"));
        
        // Feed lines and cut (if supported, MP-B20 is usually tear-off)
        await this.write([LF, LF, LF, LF]); 

        this.log("✅ Print Sent!");
    } catch (e: any) {
        this.log(`Print Error: ${e.message}`);
        throw e;
    }
  }
}

export const printerService = new PrinterService();
    