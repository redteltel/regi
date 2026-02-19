import React, { useState, useEffect } from 'react';
import Camera from './components/Camera';
import Receipt from './components/Receipt';
import Settings from './components/Settings'; // New Import
import MasterEditor from './components/MasterEditor';
import { AppState, CartItem, Product, PrinterStatus, StoreSettings } from './types';
import { printerService } from './services/printerService';
import { fetchServiceItems, isProductKnown, logUnknownItem, clearCache } from './services/sheetService';
import { Bluetooth, Camera as CameraIcon, ShoppingCart, Printer, Plus, Minus, Cable, Share, ChevronLeft, Home, Loader2, FileText, Receipt as ReceiptIcon, ListPlus, X, RefreshCw, Settings as SettingsIcon } from 'lucide-react';
import { LOGO_URL } from './logoData';

// Default Settings
const DEFAULT_SETTINGS: StoreSettings = {
  storeName: "パナランドヨシダ",
  zipCode: "863-0015",
  address1: "熊本県天草市旭町４３",
  address2: "",
  tel: "0969-24-0218",
  registrationNum: "T6810624772686",
  bankName: "天草信用金庫",
  branchName: "瀬戸橋支店",
  accountType: "普通",
  accountNumber: "0088477",
  accountHolder: "フクシマ カズヒコ",
  // Spreadsheet Defaults
  spreadsheetId: "1t0V0t5qpkL2zNZjHWPj_7ZRsxRXuzfrXikPGgqKDL_k",
  spreadsheetName: "DATA",
  sheetName: "品番参照",
  serviceSheetName: "ServiceItems"
};

// Unique key for this specific app deployment to ensure isolation from other apps on same domain
const SETTINGS_STORAGE_KEY = 'pixelpos_regi_store_settings';

// Demo Mode Detection
const isDemoMode = window.location.pathname.includes('/demo-regi/');

const App: React.FC = () => {
  const [appState, setAppState] = useState<AppState>(AppState.SCANNING);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  
  // Settings State
  const [storeSettings, setStoreSettings] = useState<StoreSettings>(DEFAULT_SETTINGS);
  const [showSettings, setShowSettings] = useState(false);
  const [showMasterEditor, setShowMasterEditor] = useState(false);

  // Discount & Cash State
  const [discount, setDiscount] = useState<string>('');
  const [cashReceived, setCashReceived] = useState<string>('');
  const [isCashManuallyEdited, setIsCashManuallyEdited] = useState(false);

  // Service Items State
  const [serviceItems, setServiceItems] = useState<Product[]>([]);
  const [isServiceLoading, setIsServiceLoading] = useState(false);
  const [showServiceModal, setShowServiceModal] = useState(false);
  
  // Receipt Mode State (ESTIMATION is at left)
  const [receiptMode, setReceiptMode] = useState<'RECEIPT' | 'FORMAL' | 'INVOICE' | 'ESTIMATION'>('RECEIPT');
  const [recipientName, setRecipientName] = useState('');
  const [proviso, setProviso] = useState('');
  const [paymentDeadline, setPaymentDeadline] = useState('');

  const [printerStatus, setPrinterStatus] = useState<PrinterStatus>({
    isConnected: false,
    type: null,
    name: null,
    device: null,
    characteristic: null,
  });
  
  const loadServiceItems = async () => {
      setIsServiceLoading(true);
      try {
          const items = await fetchServiceItems();
          setServiceItems(items);
      } finally {
          setIsServiceLoading(false);
      }
  };

  useEffect(() => {
    // Load Settings from LocalStorage (Session Independent)
    const savedSettings = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (savedSettings) {
        try {
            const parsed = JSON.parse(savedSettings);
            // Merge with default to ensure new fields exist if loading old settings
            setStoreSettings({ ...DEFAULT_SETTINGS, ...parsed });
        } catch (e) {
            console.error("Failed to load settings", e);
        }
    }

    // Ensure no debug logs appear in UI
    printerService.setOnDisconnect(() => {
      console.log("App detected printer disconnect");
      setPrinterStatus(prev => ({
        ...prev,
        isConnected: false,
        type: null
      }));
    });
    
    // Fetch Service Items on mount
    loadServiceItems();
  }, []);

  const handleSaveSettings = (newSettings: StoreSettings) => {
      // Check if spreadsheet settings changed
      const prevId = storeSettings.spreadsheetId;
      const prevSheet = storeSettings.sheetName;
      const prevServiceSheet = storeSettings.serviceSheetName;
      
      setStoreSettings(newSettings);
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(newSettings));

      if (prevId !== newSettings.spreadsheetId || prevSheet !== newSettings.sheetName || prevServiceSheet !== newSettings.serviceSheetName) {
          clearCache();
          loadServiceItems(); // Reload service items from new sheet
      }
  };

  // Update proviso default when entering preview
  useEffect(() => {
    if (appState === AppState.PREVIEW && !proviso) {
        if (cart.length > 0) {
            setProviso('お品代として');
        }
    }
  }, [appState, cart.length]);

  // --- REVISED Calculation Logic (Tax Exclusive / 外税) ---
  // Formula: floor(subtotal * 0.10), Total = subtotal + tax - discount

  // 1. Items Total (Taxable Base)
  const itemsTotal = cart.reduce((acc, item) => acc + item.price * item.quantity, 0);
  const subTotal = itemsTotal; // Alias for clarity

  // 2. Tax (10% floor)
  const tax = Math.floor(subTotal * 0.10);

  // 3. Initial Total (Before Discount)
  const initialTotal = subTotal + tax;

  // 4. Discount
  const discountVal = parseInt(discount || '0', 10);

  // 5. Final Total
  const totalAmount = Math.max(0, initialTotal - discountVal);

  // Auto-sync cashReceived with totalAmount
  useEffect(() => {
    if (!isCashManuallyEdited) {
       // Auto-fill total amount if not manually edited
       setCashReceived(totalAmount > 0 ? totalAmount.toString() : '');
    }
  }, [totalAmount, isCashManuallyEdited]);

  // 6. Calculate Change
  const cashVal = parseInt(cashReceived || '0', 10);
  const changeVal = cashVal - totalAmount;

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

  const updateItemPrice = (id: string, newPrice: number) => {
    setCart(prev => prev.map(item => {
      if (item.id === id) {
        return { ...item, price: Math.max(0, newPrice) };
      }
      return item;
    }));
  };

  const updateItemName = (index: number, newName: string) => {
    setCart(prev => {
        const newCart = [...prev];
        const item = newCart[index];
        newCart[index] = { ...item, name: newName };
        return newCart;
    });
  };

  const handleAddServiceItem = (item: Product) => {
      handleProductFound(item);
      setShowServiceModal(false);
  };
  
  const handleProceedToCheckout = () => {
      const unknownItems = cart.filter(item => 
          !item.id.startsWith('SVC-') && !isProductKnown(item.id)
      );

      if (unknownItems.length > 0) {
          const examples = unknownItems.slice(0, 3).map(i => i.partNumber).join(', ');
          const more = unknownItems.length > 3 ? '...' : '';
          
          const confirmRegister = window.confirm(
              `未登録の商品をマスターデータ（品番参照シート）に追加登録しますか？\n` +
              `対象品番: ${examples}${more}\n\n` +
              `[OK] 登録して会計へ進む\n` +
              `[キャンセル] 登録せずに会計へ進む`
          );

          if (confirmRegister) {
              unknownItems.forEach(item => logUnknownItem(item));
          }
      }

      setAppState(AppState.PREVIEW);
  };

  // Printing Logic - Text Mode with Shift-JIS (via printerService)
  const handlePrint = async () => {
    if (isDemoMode) {
        alert("デモ版のため印刷機能は制限されています");
        return;
    }

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

    setIsProcessing(true);
    if (navigator.vibrate) navigator.vibrate(50);

    try {
      await printerService.printReceipt(
        cart,
        subTotal,
        tax,
        totalAmount,
        receiptMode,
        recipientName,
        proviso,
        paymentDeadline,
        discountVal, 
        LOGO_URL,
        storeSettings // Pass Settings
      );

      if (navigator.vibrate) navigator.vibrate([100]);
    } catch (e: any) {
      console.error(e);
      setPrinterStatus(prev => ({ ...prev, isConnected: false }));
      alert(`印刷エラー:\n${e.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleFinish = () => {
    if (window.confirm("現在のカートをクリアしてトップに戻りますか？")) {
      setCart([]);
      setDiscount('');
      setCashReceived('');
      setIsCashManuallyEdited(false);
      setReceiptMode('RECEIPT');
      setRecipientName('');
      setProviso('');
      setPaymentDeadline('');
      setAppState(AppState.SCANNING);
    }
  };

  // PDF Export removed to fix build errors


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
          <div className="flex-1 p-4 pb-24 overflow-y-auto relative">
            {/* Service Items Modal */}
            {showServiceModal && (
               <div className="absolute inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
                  <div className="bg-white text-black w-full max-w-sm rounded-xl shadow-2xl flex flex-col max-h-[80vh] overflow-hidden animate-in zoom-in-95 duration-200">
                      <div className="p-4 border-b border-gray-200 flex justify-between items-center bg-gray-50">
                          <h3 className="font-bold flex items-center gap-2">
                              <ListPlus size={18} className="text-blue-600"/>
                              サービス・固定費を追加
                          </h3>
                          <div className="flex items-center gap-2">
                            <button 
                                onClick={loadServiceItems} 
                                className={`p-2 hover:bg-gray-200 rounded-full ${isServiceLoading ? 'animate-spin' : ''}`}
                            >
                                <RefreshCw size={18} className="text-gray-500" />
                            </button>
                            <button onClick={() => setShowServiceModal(false)} className="p-2 hover:bg-gray-200 rounded-full">
                                <X size={20} />
                            </button>
                          </div>
                      </div>
                      <div className="flex-1 overflow-y-auto p-2 space-y-2">
                          {isServiceLoading ? (
                              <div className="flex justify-center items-center py-8">
                                <Loader2 className="animate-spin text-blue-500" size={24} />
                                <span className="ml-2 text-sm text-gray-500">データを読み込み中...</span>
                              </div>
                          ) : serviceItems.length === 0 ? (
                              <div className="text-center py-8 text-gray-500 text-sm">
                                  項目が見つかりませんでした。<br/>
                                  <span className="text-xs text-gray-400">Sheet: ServiceItems が存在するか確認してください</span>
                              </div>
                          ) : (
                              serviceItems.map(item => (
                                  <button
                                    key={item.id}
                                    onClick={() => handleAddServiceItem(item)}
                                    className="w-full text-left p-3 rounded-lg border border-gray-100 hover:bg-blue-50 hover:border-blue-300 active:bg-blue-100 transition-colors flex justify-between items-center group"
                                  >
                                      <div>
                                          <div className="font-bold text-gray-800">{item.name}</div>
                                          {item.partNumber && item.partNumber !== 'Service' && (
                                              <div className="text-xs text-gray-500">{item.partNumber}</div>
                                          )}
                                      </div>
                                      <div className="font-mono font-bold text-blue-700">
                                          ¥{item.price.toLocaleString()}
                                      </div>
                                  </button>
                              ))
                          )}
                      </div>
                  </div>
               </div>
            )}

            <div className="flex justify-between items-end mb-4">
                <h2 className="text-2xl font-bold text-primary">Cart ({cart.length})</h2>
                <button 
                  onClick={() => setShowServiceModal(true)}
                  className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-secondary text-xs rounded-full flex items-center gap-1.5 transition-colors border border-gray-700"
                >
                    <ListPlus size={14} />
                    サービス項目を追加
                </button>
            </div>
            
            <div className="space-y-4">
                {cart.length === 0 ? (
                  <div className={`flex flex-col items-center justify-center py-8 border-2 border-dashed border-gray-800 rounded-xl ${isDemoMode ? 'bg-demoSurface/50' : 'bg-surface/50'}`}>
                    <ShoppingCart className="w-10 h-10 mb-3 opacity-40 text-gray-500" />
                    <p className="text-sm font-medium text-gray-400">商品がありません (No items)</p>
                    <div className="flex gap-2 mt-4">
                        <button 
                          onClick={() => setAppState(AppState.SCANNING)}
                          className="px-5 py-2 bg-gray-800 border border-gray-700 rounded-full text-xs hover:bg-gray-700 transition-colors flex items-center gap-2 text-primary"
                        >
                          <Plus size={14} />
                          商品を追加 (Scan)
                        </button>
                        <button 
                          onClick={() => setShowServiceModal(true)}
                          className="px-5 py-2 bg-gray-800 border border-gray-700 rounded-full text-xs hover:bg-gray-700 transition-colors flex items-center gap-2 text-secondary"
                        >
                          <ListPlus size={14} />
                          サービス追加
                        </button>
                    </div>
                  </div>
                ) : (
                  cart.map((item, index) => (
                    <div key={index} className="bg-[#1E2025] p-4 rounded-xl flex items-center justify-between shadow-sm">
                      <div className="flex-1">
                        <div className="text-sm font-mono text-secondary mb-1">{item.partNumber}</div>
                        
                        <div className="mb-2">
                            <input
                              type="text"
                              value={item.name}
                              onChange={(e) => updateItemName(index, e.target.value)}
                              className="w-full bg-transparent text-lg font-bold text-onSurface border-b border-gray-700 focus:border-primary focus:text-primary outline-none transition-colors placeholder-gray-600"
                              placeholder="商品名を入力"
                            />
                        </div>

                        <div className="flex items-center gap-2">
                          <span className="text-gray-400 text-sm">@</span>
                          <div className="relative">
                              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-primary font-mono text-sm">¥</span>
                              <input
                                type="number"
                                min="0"
                                inputMode="numeric"
                                value={item.price === 0 ? '' : item.price}
                                placeholder="0"
                                onChange={(e) => updateItemPrice(item.id, parseInt(e.target.value, 10) || 0)}
                                onClick={(e) => (e.target as HTMLInputElement).select()}
                                className="w-28 bg-surface border border-gray-700 rounded-lg py-1 pl-6 pr-2 text-right text-primary font-mono focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary transition-all"
                              />
                          </div>
                        </div>
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
                  ))
                )}
                
                <div className={`mt-8 p-4 rounded-xl border border-gray-800 ${isDemoMode ? 'bg-demoSurface' : 'bg-surface'}`}>
                  <div className="flex justify-between items-center text-sm mb-2 text-gray-400">
                    <span>Items Total (Subtotal)</span>
                    <span>¥{itemsTotal.toLocaleString()}</span>
                  </div>
                  
                  <div className="flex justify-between items-center text-sm mb-2 text-gray-400">
                    <span>Tax (10%)</span>
                    <span>¥{tax.toLocaleString()}</span>
                  </div>

                  <div className="border-t border-gray-800 my-2"></div>

                  <div className="flex justify-between items-center text-sm mb-2 text-gray-300 font-medium">
                    <span>Total (Before Discount)</span>
                    <span>¥{initialTotal.toLocaleString()}</span>
                  </div>

                  {/* Discount Input */}
                  <div className="flex justify-between items-center text-sm mb-2">
                     <span className="text-gray-400">Discount (値引)</span>
                     <div className="relative">
                         <span className="absolute left-2 top-1/2 -translate-y-1/2 text-red-400 text-xs">▲</span>
                         <input 
                            type="number"
                            inputMode="numeric"
                            value={discount}
                            onChange={e => setDiscount(e.target.value)}
                            placeholder="0"
                            className="w-24 bg-surface border border-gray-700 rounded-lg py-1 pl-6 pr-2 text-right text-red-400 font-mono focus:border-red-500 focus:outline-none transition-all placeholder-gray-600"
                         />
                     </div>
                  </div>

                  <div className="flex justify-between items-center text-lg font-bold pt-2 border-t border-gray-700">
                    <span>Final Total</span>
                    <span className="text-primary">¥{totalAmount.toLocaleString()}</span>
                  </div>

                  {/* Cash Received Input */}
                  <div className="flex justify-between items-center text-sm pt-2 mt-2 border-t border-gray-800/50">
                     <span className="text-gray-400">預かり (Cash)</span>
                     <div className="relative">
                         <span className="absolute left-2 top-1/2 -translate-y-1/2 text-primary font-mono text-xs">¥</span>
                         <input 
                            type="number"
                            inputMode="numeric"
                            value={cashReceived}
                            onChange={e => {
                                setCashReceived(e.target.value);
                                setIsCashManuallyEdited(true);
                            }}
                            placeholder="0"
                            className="w-24 bg-surface border border-gray-700 rounded-lg py-1 pl-6 pr-2 text-right text-primary font-mono focus:border-primary focus:outline-none transition-all placeholder-gray-600"
                         />
                     </div>
                  </div>
                  {/* Change Display */}
                  <div className="flex justify-between items-center text-lg font-bold pt-2 mt-2 border-t border-gray-700">
                      <span>おつり (Change)</span>
                      <span className={`${changeVal < 0 ? 'text-red-400' : 'text-secondary'}`}>
                          {cashVal > 0 
                             ? (changeVal >= 0 ? `¥${changeVal.toLocaleString()}` : `不足 ¥${Math.abs(changeVal).toLocaleString()}`) 
                             : '¥0'}
                      </span>
                  </div>
                </div>

                <button
                  onClick={handleProceedToCheckout}
                  disabled={totalAmount === 0 && discountVal === 0}
                  className={`w-full mt-6 py-4 rounded-xl font-bold text-lg shadow-lg active:scale-[0.98] transition-transform flex items-center justify-center gap-2
                    ${(totalAmount === 0 && discountVal === 0) ? 'bg-gray-800 text-gray-500 cursor-not-allowed' : 'bg-primary text-onPrimary'}
                  `}
                >
                  Proceed to Checkout
                </button>
            </div>
          </div>
        );
      case AppState.PREVIEW:
        return (
          <div className="flex flex-col h-[100dvh] bg-gray-100 text-black overflow-hidden">
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
               {/* Mode Switcher */}
               <div className="flex bg-gray-200 p-1 rounded-lg mb-4">
                  <button
                    onClick={() => setReceiptMode('ESTIMATION')}
                    className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-sm font-bold transition-all ${
                      receiptMode === 'ESTIMATION' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500'
                    }`}
                  >
                    <FileText size={16} />
                    見積書
                  </button>
                  <button
                    onClick={() => setReceiptMode('INVOICE')}
                    className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-sm font-bold transition-all ${
                      receiptMode === 'INVOICE' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500'
                    }`}
                  >
                    <FileText size={16} />
                    請求書
                  </button>
                  <button
                    onClick={() => setReceiptMode('RECEIPT')}
                    className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-sm font-bold transition-all ${
                      receiptMode === 'RECEIPT' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500'
                    }`}
                  >
                    <ReceiptIcon size={16} />
                    レシート
                  </button>
                  <button
                    onClick={() => setReceiptMode('FORMAL')}
                    className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-sm font-bold transition-all ${
                      receiptMode === 'FORMAL' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500'
                    }`}
                  >
                    <FileText size={16} />
                    領収書
                  </button>
               </div>

               {/* Inputs (Invoice, Formal & Estimation) */}
               {(receiptMode === 'FORMAL' || receiptMode === 'INVOICE' || receiptMode === 'ESTIMATION') && (
                 <div className="bg-white p-4 rounded-lg shadow-sm mb-4 border border-blue-100 space-y-3">
                    <div>
                      <label className="block text-xs font-bold text-gray-500 mb-1">宛名 (Recipient)</label>
                      <input 
                        type="text" 
                        value={recipientName}
                        onChange={(e) => setRecipientName(e.target.value)}
                        placeholder="例：上様、〇〇株式会社"
                        className="w-full border border-gray-300 rounded-md p-2 text-sm bg-gray-50 focus:bg-white focus:border-blue-500 focus:outline-none"
                      />
                    </div>
                    {receiptMode === 'FORMAL' && (
                        <div>
                          <label className="block text-xs font-bold text-gray-500 mb-1">但し書き (Proviso)</label>
                          <input 
                            type="text" 
                            value={proviso}
                            onChange={(e) => setProviso(e.target.value)}
                            placeholder="例：お品代として"
                            className="w-full border border-gray-300 rounded-md p-2 text-sm bg-gray-50 focus:bg-white focus:border-blue-500 focus:outline-none"
                          />
                        </div>
                    )}
                    {receiptMode === 'INVOICE' && (
                        <div>
                          <label className="block text-xs font-bold text-gray-500 mb-1">お支払期限 (Deadline)</label>
                          <input 
                            type="text" 
                            value={paymentDeadline}
                            onChange={(e) => setPaymentDeadline(e.target.value)}
                            placeholder="例：2023年10月末日"
                            className="w-full border border-gray-300 rounded-md p-2 text-sm bg-gray-50 focus:bg-white focus:border-blue-500 focus:outline-none"
                          />
                        </div>
                    )}
                 </div>
               )}

               <Receipt 
                 items={cart} 
                 subTotal={subTotal} 
                 tax={tax} 
                 total={totalAmount}
                 mode={receiptMode}
                 recipientName={recipientName}
                 proviso={proviso}
                 paymentDeadline={paymentDeadline}
                 discount={discountVal}
                 logo={LOGO_URL} 
                 settings={storeSettings} // Pass Settings
               />
               
               <div className="text-center text-gray-400 text-xs mt-4">
                 {receiptMode === 'FORMAL' && totalAmount >= 50000 
                    ? "※ 5万円以上のため印紙枠を表示しています" 
                    : "内容をご確認の上、印刷または共有してください。"}
               </div>
            </div>

            {/* Footer */}
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
                    onClick={handlePrint}
                    className={`flex-1 py-4 rounded-xl font-bold text-lg shadow-xl active:scale-[0.98] transition-transform flex items-center justify-center gap-2 ${
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
    <div className={`h-[100dvh] w-screen flex flex-col ${isDemoMode ? 'bg-demoSurface' : 'bg-surface'} text-onSurface overflow-hidden transition-colors duration-500`}>
      {/* Demo Mode Badge */}
      {isDemoMode && (
        <div className="fixed top-0 right-0 z-[100] bg-red-600 text-white text-[10px] font-bold px-3 py-1 rounded-bl-xl shadow-lg pointer-events-none">
          DEMO MODE
        </div>
      )}

      {/* Settings Modal */}
      <Settings 
         isOpen={showSettings} 
         onClose={() => setShowSettings(false)} 
         onSave={handleSaveSettings}
         initialSettings={storeSettings}
         onOpenMasterEditor={() => {
             setShowSettings(false);
             setShowMasterEditor(true);
         }}
      />

      <MasterEditor 
        isOpen={showMasterEditor}
        onClose={() => setShowMasterEditor(false)}
        settings={storeSettings}
        isDemoMode={isDemoMode}
      />

      {appState !== AppState.PREVIEW && (
        <div className={`flex justify-between items-center p-4 ${isDemoMode ? 'bg-demoSurface/80' : 'bg-surface/80'} backdrop-blur-md z-10 shrink-0 transition-colors duration-500`}>
          <div className="flex flex-col">
              <div className="flex items-center gap-2">
                  <h1 className="text-xl font-bold bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">
                    PixelPOS
                  </h1>
              </div>
          </div>
          <div className="flex items-center gap-2">
              <button 
                onClick={() => setShowSettings(true)}
                className="p-2 bg-gray-800 rounded-full text-gray-400 hover:text-white transition-colors"
              >
                  <SettingsIcon size={18} />
              </button>
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
        </div>
      )}

      <div className="flex-1 flex flex-col relative overflow-hidden">
        {renderContent()}
      </div>

      {appState !== AppState.PREVIEW && (
        <div className={`border-t border-gray-800 flex items-center justify-around px-6 pt-4 pb-28 shrink-0 z-20 ${isDemoMode ? 'bg-demoSurface' : 'bg-surface'}`}>
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
              {(cart.length > 0) && (
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