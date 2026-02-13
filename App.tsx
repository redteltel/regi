import React, { useState, useEffect } from 'react';
import Camera from './components/Camera';
import Receipt from './components/Receipt';
import { AppState, CartItem, Product, PrinterStatus } from './types';
import { printerService } from './services/printerService';
import { Bluetooth, Camera as CameraIcon, ShoppingCart, Trash2, Printer, Plus, Minus, AlertTriangle, BellRing, Terminal, RefreshCw } from 'lucide-react';

const App: React.FC = () => {
  const [appState, setAppState] = useState<AppState>(AppState.SCANNING);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [printerStatus, setPrinterStatus] = useState<PrinterStatus>({
    isConnected: false,
    name: null,
    device: null,
    characteristic: null,
  });
  
  // Debug logs - Increased to 99 to capture full UUID lists
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
      }));
    });
  }, []);

  const cartTotal = cart.reduce((acc, item) => acc + item.price * item.quantity, 0);

  const handleConnectPrinter = async () => {
    try {
      setLogs([]); 
      const device = await printerService.connect();
      const dispName = device.name || (device.id ? `ID:${device.id.slice(0,5)}` : 'MP-B20');
      
      setPrinterStatus({
        isConnected: true,
        name: dispName,
        device: device,
        characteristic: null
      });
    } catch (e: any) {
      console.error(e);
      const msg = e.message || "Unknown error";
      addLog(`Error: ${msg}`);
      if (!msg.includes("User cancelled")) {
        alert(`接続エラー:\n${msg}\n\nペアリングの問題が続く場合は、AndroidのBluetooth設定からMP-B20を削除(ペアリング解除)してからやり直してください。`);
      }
    }
  };

  const handleRetryDiscovery = async () => {
    try {
      addLog("Manual Retry triggered...");
      await printerService.retryDiscovery();
      alert("再検索が完了しました。");
    } catch (e: any) {
      addLog(`Retry Error: ${e.message}`);
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

    if (!isReady) {
       addLog("Auto-reconnecting...");
       const restored = await printerService.restoreConnection();
       if (restored) {
         setPrinterStatus(prev => ({ ...prev, isConnected: true }));
         isReady = true;
       }
    }

    if (!isReady) {
      alert("プリンタと接続されていません。\n下の「Connect Printer」ボタンを押して再接続してください。");
      setPrinterStatus(prev => ({ ...prev, isConnected: false }));
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
      alert(`印刷エラー:\n${e.message}\n\n再接続してから試してください。`);
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
            {/* Header */}
            <div className="w-full flex justify-between items-center px-4 py-4 shrink-0 bg-white shadow-sm z-10">
              <button onClick={() => setAppState(AppState.LIST)} className="text-blue-600 font-medium">Back</button>
              <h2 className="font-bold">Preview</h2>
              <div className="w-8"></div>
            </div>
            
            {/* Scrollable Receipt Area */}
            <div className="flex-1 overflow-y-auto p-4">
               <Receipt items={cart} total={cartTotal} />
            </div>

            {/* Fixed Bottom Controls */}
            <div className="w-full shrink-0 bg-white p-4 pb-8 shadow-[0_-5px_20px_rgba(0,0,0,0.1)] rounded-t-2xl z-20">
              {/* Connection Status Helper */}
              {!printerStatus.isConnected && (
                <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 px-4 py-3 rounded-lg text-xs mb-3 flex items-start gap-2">
                  <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                  <div>
                    <p className="font-bold">プリンタ未接続</p>
                    <p>下の黒いボタンを押して接続してください。</p>
                  </div>
                </div>
              )}

              {!printerStatus.isConnected ? (
                <button 
                  onClick={handleConnectPrinter}
                  className="w-full bg-gray-900 text-white py-4 rounded-xl font-bold flex items-center justify-center gap-2 shadow-xl mb-3"
                >
                  <Bluetooth size={20} />
                  Connect Printer
                </button>
              ) : (
                <div 
                  className="w-full bg-green-50 border border-green-200 text-green-700 py-3 rounded-xl font-medium flex items-center justify-center gap-2 mb-3 cursor-pointer"
                  onClick={() => {
                     if(window.confirm("プリンタを切断しますか？")) {
                        printerService.disconnect();
                        setPrinterStatus(prev => ({ ...prev, isConnected: false }));
                     }
                  }}
                >
                  <Bluetooth size={18} /> 
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

              {/* Enhanced Debug Log (h-64, text-xs) */}
              <div className="mt-4 bg-black p-3 rounded-lg border border-gray-800 shadow-inner">
                {/* Warning Message */}
                <div className="text-red-500 font-bold text-sm mb-2 text-center animate-pulse bg-red-900/20 p-2 rounded">
                   ※ 接続後、15秒間そのままお待ちください
                </div>

                <div className="text-green-400 font-mono text-xs h-64 overflow-y-auto mb-2">
                  <div className="flex flex-col gap-0.5">
                    {logs.length === 0 && <span className="text-gray-600 italic">No logs...</span>}
                    {logs.slice().reverse().map((log, i) => (
                      <div key={i} className="break-all border-b border-gray-800/50 pb-0.5 hover:bg-gray-900">{log}</div>
                    ))}
                  </div>
                </div>

                {/* Retry Button */}
                {printerStatus.isConnected && (
                    <button 
                        onClick={handleRetryDiscovery}
                        className="w-full bg-gray-800 hover:bg-gray-700 text-white text-xs py-2 rounded border border-gray-600 flex items-center justify-center gap-2"
                    >
                        <RefreshCw size={12} />
                        Retry Discovery (サービス再検索)
                    </button>
                )}
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
            onClick={printerStatus.isConnected ? () => {} : handleConnectPrinter}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border ${
              printerStatus.isConnected 
                ? 'bg-green-500/10 border-green-500/50 text-green-300' 
                : 'bg-gray-800 border-gray-700 text-gray-400'
            }`}
          >
            <Bluetooth size={12} />
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