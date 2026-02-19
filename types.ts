
export interface Product {
  id: string;
  partNumber: string;
  name: string;
  price: number;
}

export interface CartItem extends Product {
  quantity: number;
}

export enum AppState {
  SCANNING = 'SCANNING',
  LIST = 'LIST',
  PREVIEW = 'PREVIEW',
}

export interface PrinterStatus {
  isConnected: boolean;
  type: 'BLUETOOTH' | 'USB' | null;
  name: string | null;
  device: BluetoothDevice | any | null;
  characteristic: BluetoothRemoteGATTCharacteristic | null;
}

export type ScannedResult = {
  partNumber: string;
  confidence: number;
};

export interface StoreSettings {
  storeName: string;
  zipCode: string;
  address1: string;
  address2: string;
  tel: string;
  registrationNum: string;
  bankName: string;
  branchName: string;
  accountType: string;
  accountNumber: string;
  accountHolder: string;
  // Spreadsheet Settings
  spreadsheetId: string;
  spreadsheetName: string; // Just for display/memo
  sheetName: string; // For Product DB
  serviceSheetName: string; // For Service Items
}

// Web Bluetooth & Serial API Type Declarations
declare global {
  interface Navigator {
    bluetooth: Bluetooth;
    serial: Serial;
  }

  interface Serial extends EventTarget {
    requestPort(options?: SerialPortRequestOptions): Promise<SerialPort>;
  }

  interface SerialPortRequestOptions {
    filters?: SerialPortFilter[];
  }

  interface SerialPortFilter {
    usbVendorId?: number;
    usbProductId?: number;
  }

  interface SerialPort extends EventTarget {
    open(options: SerialOptions): Promise<void>;
    close(): Promise<void>;
    writable: WritableStream;
    getInfo(): { usbVendorId?: number; usbProductId?: number };
  }

  interface SerialOptions {
    baudRate: number;
    dataBits?: number;
    stopBits?: number;
    parity?: 'none' | 'even' | 'odd';
    bufferSize?: number;
    flowControl?: 'none' | 'hardware';
  }

  interface Bluetooth {
    requestDevice(options?: RequestDeviceOptions): Promise<BluetoothDevice>;
  }

  interface RequestDeviceOptions {
    filters?: BluetoothLEScanFilter[];
    optionalServices?: (string | number)[];
    acceptAllDevices?: boolean;
  }

  interface BluetoothLEScanFilter {
    name?: string;
    namePrefix?: string;
    services?: (string | number)[];
  }

  interface BluetoothDevice extends EventTarget {
    id: string;
    name?: string;
    gatt?: BluetoothRemoteGATTServer;
  }

  interface BluetoothRemoteGATTServer {
    connected: boolean;
    connect(): Promise<BluetoothRemoteGATTServer>;
    disconnect(): void;
    getPrimaryServices(service?: string | number): Promise<BluetoothRemoteGATTService[]>;
    getPrimaryService(service: string | number): Promise<BluetoothRemoteGATTService>;
  }

  interface BluetoothRemoteGATTService {
    uuid: string;
    getCharacteristics(characteristic?: string | number): Promise<BluetoothRemoteGATTCharacteristic[]>;
    getCharacteristic(characteristic: string | number): Promise<BluetoothRemoteGATTCharacteristic>;
  }

  interface BluetoothRemoteGATTCharacteristic {
    uuid: string;
    properties: {
      write: boolean;
      writeWithoutResponse: boolean;
      read: boolean;
      notify: boolean;
    };
    writeValue(value: BufferSource): Promise<void>;
    writeValueWithResponse(value: BufferSource): Promise<void>;
    writeValueWithoutResponse(value: BufferSource): Promise<void>;
  }
}