
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
  type: 'BLUETOOTH' | null;
  name: string | null;
  device: BluetoothDevice | any | null;
  characteristic: BluetoothRemoteGATTCharacteristic | null;
}

export type ScannedResult = {
  partNumber: string;
  confidence: number;
};

export type PrinterType = 'PDF' | 'BLUETOOTH' | 'SUNMI' | 'SII_AGENT';

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
  // Printer Settings
  printerType: PrinterType;
  bluetoothAddress?: string; // Optional: BT address for SII Print Agent (iOS)
}

// SUNMI AIDL Interface
export interface SunmiInnerPrinter {
    printOriginalText(text: string, callback?: any): void;
    printString(text: string, callback?: any): void;
    printText(text: string, callback?: any): void; // Added printText
    printerInit(callback?: any): void;
    lineWrap(n: number, callback?: any): void;
    cutPaper(callback?: any): void;
    setFontSize(size: number, callback?: any): void;
    printColumnsString(colsTextArr: string[], colsWidthArr: number[], colsAlign: number[], callback?: any): void;
    printBitmap(base64: string, width: number, height: number, callback?: any): void;
    printBitmapWithBase64(base64: string, width: number, height: number, callback?: any): void; // Added printBitmapWithBase64
    getPrinterStatus(callback?: any): void;
    commitPrinterBuffer(): void;
    enterPrinterBuffer(clean: boolean): void;
    exitPrinterBuffer(commit: boolean): void;
    setAlignment(align: number, callback?: any): void; // 0:Left, 1:Center, 2:Right
    sendRAWData(base64: string, callback?: any): void;
}

// SUNMI Printer Plugin Interface
export interface SunmiPrinterPlugin {
    printPDF(base64: string): void;
    printBitmap(base64: string, width: number, height: number): void;
}

// Web Bluetooth & Serial API Type Declarations
declare global {
  interface Window {
    SunmiInnerPrinter?: SunmiInnerPrinter;
    sunmiInnerPrinter?: SunmiInnerPrinter;
    SunmiPrinterPlugin?: SunmiPrinterPlugin;
  }

  interface Navigator {
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
}