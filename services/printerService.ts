
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
const SII_SERVICE_UUID = "49535343-fe7d-4ae5-8fa9-9fafd205e455";
const SII_WRITE_UUID_1 = "49535343-1e4d-4bd9-ba61-802d64c64e01";
const SII_WRITE_UUID_2 = "49535343-8841-43f4-a8d4-ecbe34729bb3";
const STANDARD_PRINTER_UUID = "000018f0-0000-1000-8000-00805f9b34fb";

export class PrinterService {
  private bluetoothDevice: BluetoothDevice | null = null;
  private bluetoothChar: BluetoothRemoteGATTCharacteristic | null = null;
  
  // USB / Serial Properties
  private serialPort: SerialPort | null = null;
  private serialWriter: WritableStreamDefaultWriter | null = null;
  private serialDisconnectListener: ((e: Event) => void) | null = null;

  private onDisconnectCallback: (() => void) | null = null;
  private logger: ((msg: string) => void) | null = null;
  private intentionalDisconnect = false;

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
    this.log("Device Disconnected");
    this.bluetoothChar = null;
    this.serialWriter = null;

    if (this.serialDisconnectListener) {
      navigator.serial.removeEventListener('disconnect', this.serialDisconnectListener);
      this.serialDisconnectListener = null;
    }

    if (!this.intentionalDisconnect && this.bluetoothDevice) {
        this.log("⚠️ Unexpected BT disconnect. Attempting Keep-Alive reconnect...");
        this.restoreBluetoothConnection().then(success => {
            if (success) this.log("✅ Auto-reconnected!");
        });
    }

    if (this.onDisconnectCallback) {
      this.onDisconnectCallback();
    }
  };

  // ==========================================
  // USB / Web Serial Connection
  // ==========================================
  async connectUsb(): Promise<string> {
      this.intentionalDisconnect = false;
      if (!navigator.serial) {
          throw new Error("Web Serial API not supported in this browser.");
      }

      this.log("Requesting USB Device...");
      // Filter for SII vendor ID (0x0603) or just let user pick
      const port = await navigator.serial.requestPort({ filters: [{ usbVendorId: 0x0603 }] });
      
      this.log("Opening Serial Port...");
      await port.open({ baudRate: 115200 }); // MP-B20 standard

      this.serialPort = port;
      const textEncoder = new TextEncoderStream();
      const writableStreamClosed = textEncoder.readable.pipeTo(port.writable);
      // We write raw bytes, so we access port.writable directly or via a writer
      // Actually for binary data (ESC/POS), we should bypass TextEncoder
      // Let's get a direct writer
      this.serialWriter = port.writable.getWriter();

      // Monitor disconnect
      this.serialDisconnectListener = (e: Event) => {
        const event = e as any;
        if (event.port === port) {
          this.handleDisconnect();
        }
      };
      navigator.serial.addEventListener('disconnect', this.serialDisconnectListener);

      this.log("USB Connected.");
      return "USB Printer";
  }

  // ==========================================
  // Bluetooth Connection
  // ==========================================
  async connectBluetooth(): Promise<BluetoothDevice> {
    this.intentionalDisconnect = false;
    try {
      this.log("Requesting Bluetooth Device...");
      
      // Use specific filters instead of acceptAllDevices for better stability on Pixel/Android 13+
      const device = await navigator.bluetooth.requestDevice({
        filters: [{ namePrefix: "MP-B" }], // Target MP-B20 specifically
        optionalServices: [SII_SERVICE_UUID, STANDARD_PRINTER_UUID] 
      });

      if (this.bluetoothDevice) {
        this.bluetoothDevice.removeEventListener('gattserverdisconnected', this.handleDisconnect);
      }

      this.bluetoothDevice = device;
      this.bluetoothDevice.addEventListener('gattserverdisconnected', this.handleDisconnect);

      this.log(`Selected: ${device.name}`);
      this.log("Stabilizing radio (500ms)...");
      await new Promise(resolve => setTimeout(resolve, 500));

      this.log("Connecting GATT...");
      const server = await device.gatt?.connect();
      if (!server) throw new Error("GATT Connect failed");
      this.log("Connected. Finding Services...");

      await this.pollForServices(server);

      return device;
    } catch (error: any) {
      if (!error.message?.includes("cancelled")) {
          this.log(`BT Error: ${error.message || error}`);
      }
      throw error;
    }
  }

  async restoreBluetoothConnection(): Promise<boolean> {
    if (!this.bluetoothDevice) return false;
    if (this.bluetoothDevice.gatt?.connected && this.bluetoothChar) return true;
    try {
        this.log("Restoring BT connection...");
        const server = await this.bluetoothDevice.gatt?.connect();
        if (server) {
             if (!this.bluetoothChar) {
                 await this.pollForServices(server);
             }
             return true;
        }
        return false;
    } catch { return false; }
  }

  private async pollForServices(server: BluetoothRemoteGATTServer) {
      // (Simplified logic from previous step, keeping it robust)
      try {
          const services = await server.getPrimaryServices();
          const siiService = services.find(s => s.uuid === SII_SERVICE_UUID) 
                          || services.find(s => s.uuid === STANDARD_PRINTER_UUID)
                          || services[0];
          
          if (!siiService) throw new Error("No suitable service found");
          
          this.log(`Using Service: ${siiService.uuid.slice(0,8)}...`);
          
          const chars = await siiService.getCharacteristics();
          const writable = chars.find(c => c.properties.write || c.properties.writeWithoutResponse);
          
          if (!writable) throw new Error("No writable characteristic");
          
          this.bluetoothChar = writable;
          this.log("Bluetooth Ready.");
      } catch (e: any) {
          this.log(`Svc Error: ${e.message}`);
          throw e;
      }
  }

  // ==========================================
  // Common Methods
  // ==========================================
  
  disconnect() {
    this.intentionalDisconnect = true;
    
    // Bluetooth cleanup
    if (this.bluetoothDevice) {
      this.bluetoothDevice.removeEventListener('gattserverdisconnected', this.handleDisconnect);
      if (this.bluetoothDevice.gatt?.connected) {
        this.bluetoothDevice.gatt.disconnect();
      }
    }
    this.bluetoothDevice = null;
    this.bluetoothChar = null;

    // USB cleanup
    if (this.serialDisconnectListener) {
      navigator.serial.removeEventListener('disconnect', this.serialDisconnectListener);
      this.serialDisconnectListener = null;
    }

    if (this.serialWriter) {
        this.serialWriter.releaseLock();
        this.serialWriter = null;
    }
    if (this.serialPort) {
        this.serialPort.close().catch(console.error);
        this.serialPort = null;
    }

    this.log("Disconnected.");
  }

  isConnected(): boolean {
    const btConnected = !!(this.bluetoothDevice && this.bluetoothDevice.gatt?.connected && this.bluetoothChar);
    const usbConnected = !!(this.serialPort && this.serialWriter);
    return btConnected || usbConnected;
  }

  private encode(text: string): Uint8Array {
    const encoder = new TextEncoder(); 
    return encoder.encode(text);
  }

  private async writeCommand(data: number[] | Uint8Array) {
    const array = Array.isArray(data) ? new Uint8Array(data) : data;

    // 1. Try USB
    if (this.serialWriter) {
        await this.serialWriter.write(array);
        return;
    }

    // 2. Try Bluetooth
    if (this.bluetoothChar) {
        const canWriteNoResp = this.bluetoothChar.properties.writeWithoutResponse;
        const CHUNK_SIZE = 20; 
        for (let i = 0; i < array.length; i += CHUNK_SIZE) {
            const chunk = array.slice(i, i + CHUNK_SIZE);
            if (canWriteNoResp) {
                await this.bluetoothChar.writeValueWithoutResponse(chunk);
            } else {
                await this.bluetoothChar.writeValue(chunk);
            }
            await new Promise(r => setTimeout(r, 10)); // tiny delay
        }
        return;
    }

    throw new Error("Printer not connected");
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
