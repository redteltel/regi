import React, { useState, useEffect } from 'react';
import Camera from './components/Camera';
import Receipt from './components/Receipt';
import { AppState, CartItem, Product, PrinterStatus } from './types';
import { printerService } from './services/printerService';
import { Bluetooth, Camera as CameraIcon, ShoppingCart, Printer, Plus, Minus, Cable, Download, ChevronLeft, X, Home } from 'lucide-react';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';

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
  
  useEffect(() => {
    // Logging UI removed for production
    printerService.setOnDisconnect(() => {
      console.log("App detected printer disconnect");
      setPrinterStatus(prev => ({
        ...prev,
        isConnected: false,
        type: null
      }));
    });
  }, []);

  // Tax Calculation Logic
  const subTotal = cart.reduce((acc, item) => acc + item.price * item.quantity, 0);
  const tax = Math.floor(subTotal * 0.1); // 10% consumption tax
  const totalAmount = subTotal + tax;

  const handleConnectBluetooth = async () => {
    try {
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
    if (!msg.includes("cancelled")) {
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

  // Printing Logic - Simplified (No alerts, stay on screen)
  const handlePrint = async () => {
    if (cart.length === 0) return;
    
    let isReady = printerStatus.isConnected && printerService.isConnected();

    if (!isReady && printerStatus.type === 'BLUETOOTH') {
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
      await printerService.printReceipt(cart, subTotal, tax, totalAmount);
      // UX Improvement: No alert, just stay on page.
      // The RawBT intent will handle the feedback.
      if (navigator.vibrate) navigator.vibrate([100]);
    } catch (e: any) {
      console.error(e);
      setPrinterStatus(prev => ({ ...prev, isConnected: false }));
      alert(`印刷エラー:\n${e.message}`);
    }
  };

  // Reset Logic - Clear cart and go back to Scan
  const handleFinish = () => {
    if (window.confirm("現在のカートをクリアしてトップに戻りますか？")) {
      setCart([]);
      setAppState(AppState.SCANNING);
    }
  };

  // Improved PDF Generation using html2canvas to avoid font issues (mojibake)
  const handleDownloadPDF = async () => {
    const element = document.getElementById('receipt-preview');
    if (!element) return;

    try {
      // 1. Capture the component as a high-res image
      const canvas = await html2canvas(element, { 
        scale: 2, // Increase scale for better quality
        useCORS: true, 
        logging: false,
        backgroundColor: '#ffffff'
      });
      
      const imgData = canvas.toDataURL('image/png');
      
      // 2. Initialize PDF (Portrait)
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
      });

      const imgProps = pdf.getImageProperties(imgData);
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
      
      // 3. Add image to PDF
      pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
      
      // 4. Save
      const dateStr = new Date().toISOString().slice(0,10).replace(/-/g,'');
      pdf.save(`Receipt_Panaland_${dateStr}.pdf`);
      
    } catch (e: any) {
      console.error("PDF Generation failed:", e);
      alert("PDF生成に失敗しました。");
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
                  <div className="flex justify-between items-center text-sm mb-2 text-gray-400">
                    <span>Subtotal</span>
                    <span>¥{subTotal.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between items-center text-sm mb-2 text-gray-400">
                    <span>Tax (10%)</span>
                    <span>¥{tax.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between items-center text-lg font-bold pt-2 border-t border-gray-700">
                    <span>Total</span>
                    <span className="text-primary">¥{totalAmount.toLocaleString()}</span>
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
          <div className="flex flex-col h-[100dvh] bg-gray-100 text-black overflow-hidden">
            {/* Header - Fixed Top */}
            <div className="w-full flex justify-between items-center px-4 py-4 shrink-0 bg-white shadow-sm z-20">
              <button 
                onClick={() => setAppState(AppState.LIST)} 
                className="flex items-center text-blue-600 font-medium active:opacity-60"
              >
                <ChevronLeft size={20} />
                修正
              </button>
              <h2 className="font-bold">プレビュー</h2>
              <button 
                onClick={handleFinish} 
                className="flex items-center gap-1 text-gray-600 font-medium active:opacity-60 bg-gray-100 px-3 py-1.5 rounded-full"
              >
                <Home size={16} />
                <span className="text-xs">完了</span>
              </button>
            </div>
            
            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto p-4 pb-32">
               <Receipt items={cart} subTotal={subTotal} tax={tax} total={totalAmount} />
               <div className="text-center text-gray-400 text-xs mt-4">
                 内容をご確認の上、印刷してください。
               </div>
            </div>

            {/* Sticky Footer - Always Visible */}
            <div className="w-full shrink-0 bg-white p-4 pb-10 shadow-[0_-5px_20px_rgba(0,0,0,0.1)] rounded-t-2xl z-30 sticky bottom-0">
              
              {!printerStatus.isConnected ? (
                <div className="flex flex-col gap-2 mb-3">
                    <button 
                      onClick={handleConnectBluetooth}
                      className="w-full bg-gray-900 text-white py-3 rounded-xl font-bold flex items-center justify-center gap-2 shadow-lg active:scale-[0.98]"
                    >
                      <Bluetooth size={20} />
                      Bluetooth接続
                    </button>
                    <div className="flex items-center gap-2 text-xs text-gray-400 justify-center">
                        <span className="h-px w-12 bg-gray-300"></span>
                        OR
                        <span className="h-px w-12 bg-gray-300"></span>
                    </div>
                    <button 
                      onClick={handleConnectUsb}
                      className="w-full bg-blue-600 text-white py-3 rounded-xl font-bold flex items-center justify-center gap-2 shadow-lg active:scale-[0.98]"
                    >
                      <Cable size={20} />
                      USB接続
                    </button>
                </div>
              ) : (
                <div 
                  className="w-full bg-green-50 border border-green-200 text-green-700 py-2 rounded-xl font-medium flex items-center justify-center gap-2 mb-3 cursor-pointer text-sm"
                  onClick={() => {
                     if(window.confirm("プリンタを切断しますか？")) {
                        printerService.disconnect();
                        setPrinterStatus(prev => ({ ...prev, isConnected: false, type: null }));
                     }
                  }}
                >
                  {printerStatus.type === 'USB' ? <Cable size={16} /> : <Bluetooth size={16} />}
                  Connected to {printerStatus.name}
                </div>
              )}

              <div className="flex gap-3">
                  <button 
                    onClick={handleDownloadPDF}
                    className="flex-1 bg-gray-700 text-white py-4 rounded-xl font-bold text-lg shadow-xl active:scale-[0.98] transition-transform flex items-center justify-center gap-2"
                  >
                    <Download size={20} />
                    PDF
                  </button>

                  <button 
                    onClick={handlePrint}
                    className={`flex-[2] py-4 rounded-xl font-bold text-lg shadow-xl active:scale-[0.98] transition-transform flex items-center justify-center gap-2 ${
                      !printerStatus.isConnected ? 'bg-gray-400 text-gray-100 cursor-not-allowed' : 'bg-blue-600 text-white'
                    }`}
                  >
                    <Printer size={20} />
                    印刷
                  </button>
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
        <div className="bg-surface border-t border-gray-800 flex items-center justify-around px-6 pt-3 pb-10 shrink-0 z-20">
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