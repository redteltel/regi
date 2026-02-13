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

export class PrinterService {
  private device: BluetoothDevice | null = null;
  private characteristic: BluetoothRemoteGATTCharacteristic | null = null;
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
    this.log("Disconnected via GATT event");
    this.characteristic = null;

    if (!this.intentionalDisconnect) {
        this.log("⚠️ Unexpected disconnect. Attempting Keep-Alive reconnect...");
        // Simple exponential backoff or immediate retry could go here.
        // For now, we notify the UI, but we could also try to auto-reconnect silently.
        // Given Web Bluetooth limitations, silent reconnect often fails without user gesture,
        // but we can try if the device object is still valid.
        this.restoreConnection().then(success => {
            if (success) this.log("✅ Auto-reconnected!");
            else this.log("❌ Auto-reconnect failed.");
        });
    }

    if (this.onDisconnectCallback) {
      this.onDisconnectCallback();
    }
  };

  async connect(): Promise<BluetoothDevice> {
    this.intentionalDisconnect = false;
    try {
      this.log("Requesting Device (Accept ALL)...");
      
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
      this.log("Connected. Starting Discovery Loop...");

      // DYNAMIC DISCOVERY LOOP (Keep-Alive & Retry)
      // Instead of a static wait, we poll for services.
      await this.pollForServices(server);

      return device;
    } catch (error: any) {
      this.log(`Conn Error: ${error.message || error}`);
      console.error(error);
      throw error;
    }
  }

  async retryDiscovery() {
      if (!this.device || !this.device.gatt?.connected) {
          // Try to reconnect the socket if allowed
          if (this.device) {
             this.log("Socket closed. Reconnecting...");
             await this.device.gatt?.connect();
          } else {
             throw new Error("Device not connected. Please connect first.");
          }
      }
      this.log("Manual Retry triggered...");
      if (this.device.gatt) {
          await this.pollForServices(this.device.gatt);
      }
  }

  private async pollForServices(server: BluetoothRemoteGATTServer) {
      const MAX_ATTEMPTS = 10;
      const INTERVAL_MS = 3000;
      let targetChar: BluetoothRemoteGATTCharacteristic | null = null;

      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
          // 1. Keep-Alive Check
          if (!server.connected) {
              this.log(`⚠️ Connection dropped (Attempt ${attempt}). Reconnecting...`);
              try {
                  await server.connect();
                  this.log("✅ Reconnected.");
              } catch (e) {
                  this.log("❌ Reconnect failed. Retrying...");
                  await new Promise(r => setTimeout(r, 1000));
                  continue;
              }
          }

          this.log(`Searching services (Attempt ${attempt}/${MAX_ATTEMPTS})...`);

          try {
              // 2. Fetch All Services
              // Using plural getPrimaryServices() to get the full list
              const services = await server.getPrimaryServices();
              this.log(`> Found ${services.length} services.`);

              if (services.length > 0) {
                  // 3. Prioritize SII UUID
                  const siiService = services.find(s => s.uuid === SII_SERVICE_UUID);
                  if (siiService) {
                      this.log(">>> Found SII MP-B20 Service!");
                      targetChar = await this.findWritableChar(siiService, true);
                      if (targetChar) break;
                  }

                  // 4. Fallback to other services
                  if (!targetChar) {
                      for (const service of services) {
                          if (service.uuid === SII_SERVICE_UUID) continue; // Already checked
                          this.log(`> Checking generic svc: ${service.uuid.slice(0,8)}...`);
                          targetChar = await this.findWritableChar(service, false);
                          if (targetChar) break;
                      }
                  }
              }
          } catch (e: any) {
              this.log(`> Discovery partial fail: ${e.message}`);
          }

          if (targetChar) break;

          if (attempt < MAX_ATTEMPTS) {
              this.log(`> No writable char yet. Waiting ${INTERVAL_MS/1000}s...`);
              await new Promise(r => setTimeout(r, INTERVAL_MS));
          }
      }

      if (!targetChar) {
          this.log("CRITICAL: Discovery timeout. No writable characteristic found.");
          throw new Error("Service discovery failed after retries.");
      }

      this.characteristic = targetChar;
      this.log(`Bound to: ${this.characteristic.uuid.slice(0,8)}...`);
      await this.sendWakeup();
  }

  private async findWritableChar(service: BluetoothRemoteGATTService, isPriority: boolean): Promise<BluetoothRemoteGATTCharacteristic | null> {
      try {
          const chars = await service.getCharacteristics();
          for (const char of chars) {
              const props = char.properties;
              const isWritable = props.write || props.writeWithoutResponse;
              
              if (isWritable) {
                  if (isPriority) {
                       // If we are in the SII service, look for the specific Write UUIDs first
                       if (char.uuid === SII_WRITE_UUID_1 || char.uuid === SII_WRITE_UUID_2) {
                           this.log(">>> MATCH: SII Write Characteristic!");
                           return char;
                       }
                  }
                  // Return first writable if we are desperate or just scanning
                  this.log(`> Candidate found: ${char.uuid.slice(0,8)}`);
                  return char;
              }
          }
      } catch (e) {
          this.log(`> Access denied to service ${service.uuid.slice(0,8)}`);
      }
      return null;
  }

  private async sendWakeup() {
      if (!this.characteristic) return;
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
  }

  async restoreConnection(): Promise<boolean> {
    if (!this.device) return false;
    if (this.device.gatt?.connected && this.characteristic) return true;
    try {
        this.log("Restoring connection...");
        const server = await this.device.gatt?.connect();
        if (server) {
             // If we reconnected, we might need to re-bind the characteristic if it was invalidated
             if (!this.characteristic) {
                 await this.pollForServices(server);
             }
             return true;
        }
        return false;
    } catch { return false; }
  }

  disconnect() {
    this.intentionalDisconnect = true;
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