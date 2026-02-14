import React, { useState, useEffect } from 'react';
import Camera from './components/Camera';
import Receipt from './components/Receipt';
import { AppState, CartItem, Product, PrinterStatus } from './types';
import { printerService } from './services/printerService';
import { Bluetooth, Camera as CameraIcon, ShoppingCart, Trash2, Printer, Plus, Minus, AlertTriangle, BellRing, Terminal, RefreshCw, HelpCircle, Cable } from 'lucide-react';

const App: React.FC = () => {
  const [appState, setAppState] = useState<AppState>(AppState.SCANNING);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [printerStatus, setPrinterStatus] = useState<PrinterStatus>({
    isConnected: false,
    type: null,
    name: null,
    device: null,
    characteristic: null,
  });
  
  const [logs, setLogs] = useState<string[]>([]);
  const addLog = (msg: string) => setLogs(prev => [...prev.slice(-99), msg]);

  useEffect(() => {
    printerService.setLogger(addLog);
    printerService.setOnDisconnect(() => {
      console.log("App detected printer disconnect");
      addLog("Status: Disconnected");
      setPrinterStatus(prev => ({
        ...prev,
        isConnected: false,
        type: null
      }));
    });
  }, []);

  const cartTotal = cart.reduce((acc, item) => acc + item.price * item.quantity, 0);

  const handleConnectBluetooth = async () => {
    try {
      setLogs([]); 
      const device = await printerService.connectBluetooth();
      const dispName = device.name || (device.id ? `ID:${device.id.slice(0,5)}` : 'MP-B20');
      
      setPrinterStatus({
        isConnected: true,
        type: 'BLUETOOTH',
        name: dispName,
        device: device,
        characteristic: null
      });
    } catch (e: any) {
      handleConnError(e);
    }
  };

  const handleConnectUsb = async () => {
    try {
      setLogs([]); 
      const name = await printerService.connectUsb();
      setPrinterStatus({
        isConnected: true,
        type: 'USB',
        name: name,
        device: null,
        characteristic: null
      });
    } catch (e: any) {
      handleConnError(e);
    }
  };

  const handleConnError = (e: any) => {
    console.error(e);
    const msg = e.message || "Unknown error";
    if (msg.includes("cancelled")) {
        addLog("⚠️ Cancelled");
    } else {
        addLog(`Error: ${msg}`);
        alert(`接続エラー:\n${msg}`);
    }
  };

  const handleProductFound = (product: Product) => {
    setCart(prev => {
      const existing = prev.find(item => item.id === product.id);
      if (existing) {
        return prev.map(item => item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item);
      }
      return [...prev, { ...product, quantity: 1 }];
    });
    if (navigator.vibrate) navigator.vibrate(50);
  };

  const updateQuantity = (id: string, delta: number) => {
    setCart(prev => prev.map(item => {
      if (item.id === id) {
        return { ...item, quantity: Math.max(0, item.quantity + delta) };
      }
      return item;
    }).filter(item => item.quantity > 0));
  };

  const handlePrint = async () => {
    if (cart.length === 0) return;
    
    let isReady = printerStatus.isConnected && printerService.isConnected();

    if (!isReady && printerStatus.type === 'BLUETOOTH') {
       addLog("Auto-reconnecting BT...");
       const restored = await printerService.restoreBluetoothConnection();
       if (restored) {
         setPrinterStatus(prev => ({ ...prev, isConnected: true }));
         isReady = true;
       }
    }

    if (!isReady) {
      alert("プリンタと接続されていません。再接続してください。");
      setPrinterStatus(prev => ({ ...prev, isConnected: false, type: null }));
      return; 
    }

    try {
      await printerService.printReceipt(cart, cartTotal);
      setCart([]); 
      setAppState(AppState.SCANNING);
      alert("印刷が完了しました！");
    } catch (e: any) {
      console.error(e);
      setPrinterStatus(prev => ({ ...prev, isConnected: false }));
      alert(`印刷エラー:\n${e.message}`);
    }
  };

  const renderContent = () => {
    switch (appState) {
      case AppState.SCANNING:
        return (
          <Camera 
            onProductFound={handleProductFound} 
            isProcessing={isProcessing}
            setIsProcessing={setIsProcessing}
          />
        );
      case AppState.LIST:
        return (
          <div className="flex-1 p-4 pb-24 overflow-y-auto">
            <h2 className="text-2xl font-bold mb-6 text-primary">Cart ({cart.length})</h2>
            {cart.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 text-gray-500">
                <ShoppingCart className="w-12 h-12 mb-4 opacity-50" />
                <p>Your cart is empty.</p>
                <button 
                  onClick={() => setAppState(AppState.SCANNING)}
                  className="mt-4 px-6 py-2 bg-surface border border-gray-700 rounded-full text-sm"
                >
                  Start Scanning
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                {cart.map(item => (
                  <div key={item.id} className="bg-[#1E2025] p-4 rounded-xl flex items-center justify-between shadow-sm">
                    <div className="flex-1">
                      <h3 className="font-semibold text-onSurface">{item.name}</h3>
                      <p className="text-xs text-gray-400">{item.partNumber}</p>
                      <p className="text-primary font-mono mt-1">¥{item.price.toLocaleString()}</p>
                    </div>
                    <div className="flex items-center gap-3 bg-surface rounded-lg p-1 border border-gray-800">
                      <button onClick={() => updateQuantity(item.id, -1)} className="p-2 hover:bg-gray-800 rounded-md">
                        <Minus size={16} />
                      </button>
                      <span className="font-mono w-4 text-center">{item.quantity}</span>
                      <button onClick={() => updateQuantity(item.id, 1)} className="p-2 hover:bg-gray-800 rounded-md">
                        <Plus size={16} />
                      </button>
                    </div>
                  </div>
                ))}
                
                <div className="mt-8 bg-surface p-4 rounded-xl border border-gray-800">
                  <div className="flex justify-between items-center text-lg font-bold">
                    <span>Total</span>
                    <span className="text-primary">¥{cartTotal.toLocaleString()}</span>
                  </div>
                </div>

                <button
                  onClick={() => setAppState(AppState.PREVIEW)}
                  className="w-full mt-6 bg-primary text-onPrimary py-4 rounded-xl font-bold text-lg shadow-lg active:scale-[0.98] transition-transform flex items-center justify-center gap-2"
                >
                  Proceed to Checkout
                </button>
              </div>
            )}
          </div>
        );
      case AppState.PREVIEW:
        return (
          <div className="flex-1 flex flex-col min-h-0 bg-gray-100 text-black">
            <div className="w-full flex justify-between items-center px-4 py-4 shrink-0 bg-white shadow-sm z-10">
              <button onClick={() => setAppState(AppState.LIST)} className="text-blue-600 font-medium">Back</button>
              <h2 className="font-bold">Preview</h2>
              <div className="w-8"></div>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4">
               <Receipt items={cart} total={cartTotal} />
            </div>

            <div className="w-full shrink-0 bg-white p-4 pb-8 shadow-[0_-5px_20px_rgba(0,0,0,0.1)] rounded-t-2xl z-20">
              
              {!printerStatus.isConnected ? (
                <div className="flex flex-col gap-2 mb-3">
                    <button 
                      onClick={handleConnectBluetooth}
                      className="w-full bg-gray-900 text-white py-3 rounded-xl font-bold flex items-center justify-center gap-2 shadow-lg"
                    >
                      <Bluetooth size={20} />
                      Connect Bluetooth (Wireless)
                    </button>
                    <div className="flex items-center gap-2 text-xs text-gray-400 justify-center">
                        <span className="h-px w-12 bg-gray-300"></span>
                        OR
                        <span className="h-px w-12 bg-gray-300"></span>
                    </div>
                    <button 
                      onClick={handleConnectUsb}
                      className="w-full bg-blue-600 text-white py-3 rounded-xl font-bold flex items-center justify-center gap-2 shadow-lg"
                    >
                      <Cable size={20} />
                      Connect USB Cable (Stable)
                    </button>
                </div>
              ) : (
                <div 
                  className="w-full bg-green-50 border border-green-200 text-green-700 py-3 rounded-xl font-medium flex items-center justify-center gap-2 mb-3 cursor-pointer"
                  onClick={() => {
                     if(window.confirm("プリンタを切断しますか？")) {
                        printerService.disconnect();
                        setPrinterStatus(prev => ({ ...prev, isConnected: false, type: null }));
                     }
                  }}
                >
                  {printerStatus.type === 'USB' ? <Cable size={18} /> : <Bluetooth size={18} />}
                  Connected to {printerStatus.name}
                </div>
              )}

              <button 
                onClick={handlePrint}
                className={`w-full py-4 rounded-xl font-bold text-lg shadow-xl active:scale-[0.98] transition-transform flex items-center justify-center gap-2 ${
                  !printerStatus.isConnected ? 'bg-gray-400 text-gray-100 cursor-not-allowed' : 'bg-blue-600 text-white'
                }`}
              >
                <Printer size={20} />
                Print Receipt
              </button>

              <div className="mt-4 bg-black p-3 rounded-lg border border-gray-800 shadow-inner">
                <div className="text-gray-400 text-xs mb-2 border-b border-gray-800 pb-1 flex justify-between">
                    <span>System Logs</span>
                    <span className="text-[10px]">MP-B20 Protocol</span>
                </div>

                <div className="text-green-400 font-mono text-xs h-32 overflow-y-auto mb-2">
                  <div className="flex flex-col gap-0.5">
                    {logs.length === 0 && <span className="text-gray-600 italic">No logs...</span>}
                    {logs.slice().reverse().map((log, i) => (
                      <div key={i} className="break-all border-b border-gray-800/50 pb-0.5 hover:bg-gray-900">{log}</div>
                    ))}
                  </div>
                </div>
              </div>

            </div>
          </div>
        );
    }
  };

  return (
    <div className="h-screen w-screen flex flex-col bg-surface text-onSurface overflow-hidden">
      {appState !== AppState.PREVIEW && (
        <div className="flex justify-between items-center p-4 bg-surface/80 backdrop-blur-md z-10 shrink-0">
          <h1 className="text-xl font-bold bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">
            PixelPOS
          </h1>
          <button 
            className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border ${
              printerStatus.isConnected 
                ? 'bg-green-500/10 border-green-500/50 text-green-300' 
                : 'bg-gray-800 border-gray-700 text-gray-400'
            }`}
          >
            {printerStatus.type === 'USB' ? <Cable size={12} /> : <Bluetooth size={12} />}
            {printerStatus.isConnected ? 'Ready' : 'No Printer'}
          </button>
        </div>
      )}

      <div className="flex-1 flex flex-col relative overflow-hidden">
        {renderContent()}
      </div>

      {appState !== AppState.PREVIEW && (
        <div className="h-20 bg-surface border-t border-gray-800 flex items-center justify-around px-6 pb-2 shrink-0 z-20">
          <button 
            onClick={() => setAppState(AppState.SCANNING)}
            className={`flex flex-col items-center gap-1 p-2 transition-colors ${appState === AppState.SCANNING ? 'text-primary' : 'text-gray-500'}`}
          >
            <CameraIcon size={24} />
            <span className="text-[10px] font-medium tracking-wide">Scan</span>
          </button>
          
          <button 
            onClick={() => setAppState(AppState.LIST)}
            className={`relative flex flex-col items-center gap-1 p-2 transition-colors ${appState === AppState.LIST ? 'text-primary' : 'text-gray-500'}`}
          >
            <div className="relative">
              <ShoppingCart size={24} />
              {cart.length > 0 && (
                <span className="absolute -top-1 -right-2 bg-secondary text-[#000] text-[10px] font-bold h-4 w-4 rounded-full flex items-center justify-center">
                  {cart.length}
                </span>
              )}
            </div>
            <span className="text-[10px] font-medium tracking-wide">Cart</span>
          </button>
        </div>
      )}
    </div>
  );
};

export default App;