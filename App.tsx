import React, { useState, useEffect } from 'react';
import Camera from './components/Camera';
import Receipt from './components/Receipt';
import { AppState, CartItem, Product, PrinterStatus } from './types';
import { printerService } from './services/printerService';
import { Bluetooth, Camera as CameraIcon, ShoppingCart, Trash2, Printer, Plus, Minus } from 'lucide-react';

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

  const cartTotal = cart.reduce((acc, item) => acc + item.price * item.quantity, 0);

  // Check connection initially? No, browser blocks auto-connect without user gesture.

  const handleConnectPrinter = async () => {
    try {
      const device = await printerService.connect();
      setPrinterStatus({
        isConnected: true,
        name: device.name || 'MP-B20',
        device: device,
        characteristic: null // managed inside service
      });
    } catch (e) {
      alert("Failed to connect to printer. Ensure Bluetooth is on and device is paired or discoverable.");
    }
  };

  const handleProductFound = (product: Product) => {
    // Check if already in cart
    setCart(prev => {
      const existing = prev.find(item => item.id === product.id);
      if (existing) {
        return prev.map(item => item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item);
      }
      return [...prev, { ...product, quantity: 1 }];
    });
    // Haptic feedback
    if (navigator.vibrate) navigator.vibrate(50);
    // Switch to list view momentarily or stay? Let's stay to scan more, but show toast.
    alert(`Added ${product.name} to cart.`);
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
    if (!printerStatus.isConnected) {
      await handleConnectPrinter();
      if (!printerService.isConnected()) return; // User cancelled
    }

    try {
      await printerService.printReceipt(cart, cartTotal);
      setCart([]); // Clear cart after print
      setAppState(AppState.SCANNING);
      alert("Printing successful!");
    } catch (e) {
      alert("Error printing. Please check printer status.");
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
          <div className="flex-1 overflow-y-auto p-4 pb-24">
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
          <div className="flex-1 overflow-y-auto p-4 bg-gray-100 text-black flex flex-col items-center">
            <div className="w-full flex justify-between items-center mb-6 px-2">
              <button onClick={() => setAppState(AppState.LIST)} className="text-blue-600 font-medium">Back</button>
              <h2 className="font-bold">Preview</h2>
              <div className="w-8"></div>
            </div>
            
            <Receipt items={cart} total={cartTotal} />

            <div className="w-full max-w-sm mt-auto pb-8">
              {!printerStatus.isConnected ? (
                <button 
                  onClick={handleConnectPrinter}
                  className="w-full bg-gray-900 text-white py-4 rounded-xl font-bold flex items-center justify-center gap-2 shadow-xl mb-4"
                >
                  <Bluetooth size={20} />
                  Connect Printer
                </button>
              ) : (
                <div className="text-center text-green-600 text-sm mb-4 font-medium flex items-center justify-center gap-2">
                  <Bluetooth size={14} /> Connected to {printerStatus.name}
                </div>
              )}

              <button 
                onClick={handlePrint}
                className="w-full bg-blue-600 text-white py-4 rounded-xl font-bold text-lg shadow-xl active:scale-[0.98] transition-transform flex items-center justify-center gap-2"
              >
                <Printer size={20} />
                Print Receipt
              </button>
            </div>
          </div>
        );
    }
  };

  return (
    <div className="h-screen w-screen flex flex-col bg-surface text-onSurface overflow-hidden">
      {/* Top Bar (Only visible in Scan/List, hidden in preview for cleanliness) */}
      {appState !== AppState.PREVIEW && (
        <div className="flex justify-between items-center p-4 bg-surface/80 backdrop-blur-md z-10">
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

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col relative overflow-hidden">
        {renderContent()}
      </div>

      {/* Bottom Navigation */}
      {appState !== AppState.PREVIEW && (
        <div className="h-20 bg-surface border-t border-gray-800 flex items-center justify-around px-6 pb-2">
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