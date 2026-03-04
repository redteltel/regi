import React, { useState, useEffect } from 'react';
import Camera from './components/Camera';
import Receipt from './components/Receipt';
import Settings from './components/Settings'; // New Import
import MasterEditor from './components/MasterEditor';
import { AppState, CartItem, Product, PrinterStatus, StoreSettings } from './types';
import { printerService } from './services/printerService';
import { fetchServiceItems, isProductKnown, logUnknownItem, clearCache } from './services/sheetService';
import { Bluetooth, Camera as CameraIcon, ShoppingCart, Printer, Plus, Minus, Share, ChevronLeft, Home, Loader2, FileText, Receipt as ReceiptIcon, ListPlus, X, RefreshCw, Settings as SettingsIcon, Trash2 } from 'lucide-react';
import { LOGO_URL } from './logoData';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';

// Default Settings
const DEFAULT_SETTINGS: StoreSettings = {
  storeName: "パナランドフクシマ",
  zipCode: "863-2172",
  address1: "天草市旭町４３",
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
// Separate keys for Production and Demo environments
const SETTINGS_STORAGE_KEY = window.location.pathname.includes('/demo-regi/') 
  ? 'pixelpos_config_demo' 
  : 'pixelpos_config_prod';

const AUTOSAVE_STORAGE_KEY = window.location.pathname.includes('/demo-regi/')
  ? 'pixelpos_autosave_demo'
  : 'pixelpos_autosave_prod';

// Demo Mode Detection
const isDemoMode = window.location.pathname.includes('/demo-regi/');

// Demo Specific Defaults
const DEMO_DEFAULT_SETTINGS: StoreSettings = {
  ...DEFAULT_SETTINGS,
  storeName: "デモ店舗 (パナランド)",
  spreadsheetId: "11ROHRTwszS3amhW0m-6n1UM8QmMNsgmK9bcDtTfOS14",
  spreadsheetName: "デモデータ",
  sheetName: "品番参照",
  serviceSheetName: "ServiceItems"
};

const CURRENT_DEFAULT_SETTINGS = isDemoMode ? DEMO_DEFAULT_SETTINGS : DEFAULT_SETTINGS;

const App: React.FC = () => {
  const [appState, setAppState] = useState<AppState>(AppState.SCANNING);

  // Update body background color based on mode
  useEffect(() => {
    if (isDemoMode) {
      document.body.style.backgroundColor = '#0a192f';
    } else {
      document.body.style.backgroundColor = '#111318';
    }
  }, []);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  
  // Settings State
  const [storeSettings, setStoreSettings] = useState<StoreSettings>(CURRENT_DEFAULT_SETTINGS);
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
  const [storeMemo, setStoreMemo] = useState('');

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
            
            // --- MIGRATION LOGIC: Force Update Zip Code if old default ---
            if (parsed.zipCode === "863-0015") {
                parsed.zipCode = "863-2172";
                parsed.address1 = "天草市旭町４３"; // Ensure address matches too
                localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(parsed));
            }
            
            // Merge with default to ensure new fields exist if loading old settings
            setStoreSettings({ ...CURRENT_DEFAULT_SETTINGS, ...parsed });
        } catch (e) {
            console.error("Failed to load settings", e);
        }
    }

    // Load Autosaved State
    const autosavedState = localStorage.getItem(AUTOSAVE_STORAGE_KEY);
    if (autosavedState) {
        try {
            const parsed = JSON.parse(autosavedState);
            if (parsed.cart && parsed.cart.length > 0) {
                setCart(parsed.cart);
                setDiscount(parsed.discount || '');
                setCashReceived(parsed.cashReceived || '');
                setIsCashManuallyEdited(parsed.isCashManuallyEdited || false);
                setReceiptMode(parsed.receiptMode || 'RECEIPT');
                setRecipientName(parsed.recipientName || '');
                setProviso(parsed.proviso || '');
                setPaymentDeadline(parsed.paymentDeadline || '');
                setStoreMemo(parsed.storeMemo || '');
                setAppState(parsed.appState || AppState.LIST);
            }
        } catch (e) {
            console.error("Failed to load autosave", e);
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

  // Autosave Effect
  useEffect(() => {
      if (cart.length > 0) {
          const stateToSave = {
              cart,
              discount,
              cashReceived,
              isCashManuallyEdited,
              receiptMode,
              recipientName,
              proviso,
              paymentDeadline,
              storeMemo,
              appState
          };
          localStorage.setItem(AUTOSAVE_STORAGE_KEY, JSON.stringify(stateToSave));
      } else {
          // If cart is empty, we might want to clear autosave, 
          // but let's keep it until explicit finish to be safe, 
          // or only save if there is something meaningful.
          // Actually, if cart is empty, it's effectively a cleared state.
          // But user might be in SCANNING mode with empty cart.
      }
  }, [cart, discount, cashReceived, isCashManuallyEdited, receiptMode, recipientName, proviso, paymentDeadline, storeMemo, appState]);

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

  // --- REVISED Calculation Logic (Tax Inclusive Discount / 税込値引) ---
  // 1. Items Total (Taxable Base - Tax Excluded)
  const itemsTotal = cart.reduce((acc, item) => acc + item.price * item.quantity, 0);
  const subTotal = itemsTotal; // Alias for clarity

  // 2. Initial Tax (10% floor)
  const initialTax = Math.floor(itemsTotal * 0.10);

  // 3. Initial Total (Tax Inclusive)
  const initialTotal = itemsTotal + initialTax;

  // 4. Discount (Tax Inclusive)
  const discountVal = parseInt(discount || '0', 10);

  // 5. Final Total (Payment Amount)
  const totalAmount = Math.max(0, initialTotal - discountVal);

  // 6. Tax Calculation (Back-calculated from Final Total)
  // User Formula: Total / 1.1 = TaxExcluded, Total - TaxExcluded = Tax
  const finalTaxExcluded = Math.floor(totalAmount / 1.1);
  const finalTax = totalAmount - finalTaxExcluded;

  // Auto-sync cashReceived with totalAmount
  useEffect(() => {
    if (!isCashManuallyEdited) {
       // Auto-fill total amount if not manually edited
       setCashReceived(totalAmount > 0 ? totalAmount.toString() : '');
    }
  }, [totalAmount, isCashManuallyEdited]);

  // 7. Calculate Change
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
    
    setIsProcessing(true);
    if (navigator.vibrate) navigator.vibrate(50);

    try {
      await printerService.printReceipt(
        cart,
        subTotal,
        initialTax,
        totalAmount,
        receiptMode,
        recipientName,
        proviso,
        paymentDeadline,
        discountVal, 
        LOGO_URL,
        storeSettings, // Pass Settings
        finalTax, // Pass Final Tax
        storeMemo // Pass Store Memo
      );

      if (navigator.vibrate) navigator.vibrate([100]);
    } catch (e: any) {
      console.error(e);
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
      setStoreMemo('');
      setAppState(AppState.SCANNING);
      
      // Clear Autosave
      localStorage.removeItem(AUTOSAVE_STORAGE_KEY);
    }
  };

  const handleSharePDF = async () => {
    // Determine which element to capture based on mode
    const isFormal = receiptMode === 'FORMAL';
    const inputId = isFormal ? 'receipt-horizontal-pdf' : 'receipt-preview';
    const input = document.getElementById(inputId);
    
    if (!input) return;

    try {
      setIsProcessing(true);
      // Use higher scale for better quality
      const canvas = await html2canvas(input, { scale: 3, useCORS: true });
      const imgData = canvas.toDataURL('image/png');
      
      const imgProps = canvas;
      
      let pdf;
      
      if (isFormal) {
          // Horizontal Receipt (Ryoshusho)
          // Maximize roll paper width (58mm) as the short edge.
          // We generate a Landscape PDF where Height is 58mm.
          // Width is calculated based on aspect ratio.
          const pdfHeight = 58; 
          const pdfWidth = (imgProps.width * pdfHeight) / imgProps.height;
          
          pdf = new jsPDF({
            orientation: 'landscape',
            unit: 'mm',
            format: [pdfHeight, pdfWidth] // [height, width] for landscape? No, usually [width, height] but landscape swaps.
            // Let's pass [pdfWidth, pdfHeight] and 'landscape' to be safe.
            // Actually, if we want the result to be W x H, and W > H, 'landscape' is correct.
          });
          
          // Add image filling the page
          pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
      } else {
          // Standard Vertical Receipt
          // PDF width 80mm (standard thermal width, though MP-B20 is 58mm, 
          // usually digital receipts are generated at 80mm for better readability on phones).
          // If the user wants 58mm for everything, we could change this, 
          // but the request specifically mentioned "Receipt (Ryoshusho) layout".
          const pdfWidth = 80;
          const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;

          pdf = new jsPDF({
            orientation: 'portrait',
            unit: 'mm',
            format: [pdfWidth, pdfHeight + 10] // Add some padding
          });

          pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
      }
      
      const pdfBlob = pdf.output('blob');
      const fileName = `receipt_${isFormal ? 'formal_' : ''}${new Date().getTime()}.pdf`;
      const file = new File([pdfBlob], fileName, { type: 'application/pdf' });

      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: isFormal ? '領収書' : 'Receipt',
          text: 'Here is your receipt.',
        });
      } else {
        // Fallback to download
        pdf.save(fileName);
      }
    } catch (error) {
      console.error('Error generating PDF:', error);
      alert('PDF生成または共有に失敗しました。');
    } finally {
      setIsProcessing(false);
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
                <div className="flex items-center gap-3">
                    <h2 className="text-2xl font-bold text-primary">Cart ({cart.length})</h2>
                    {cart.length > 0 && (
                        <button 
                            onClick={handleFinish}
                            className="p-2 bg-red-900/30 text-red-400 rounded-full hover:bg-red-900/50 transition-colors"
                            title="カートをクリア"
                        >
                            <Trash2 size={16} />
                        </button>
                    )}
                </div>
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
                  <div className={`flex flex-col items-center justify-center py-8 border-2 border-dashed border-gray-800 rounded-xl ${isDemoMode ? 'bg-[#0a192f]/50' : 'bg-[#111318]/50'}`}>
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
                
                <div className={`mt-8 p-4 rounded-xl border border-gray-800 ${isDemoMode ? 'bg-[#0a192f]' : 'bg-[#111318]'}`}>
                  <div className="flex justify-between items-center text-sm mb-2 text-gray-400">
                    <span>Items Total (Subtotal)</span>
                    <span>¥{itemsTotal.toLocaleString()}</span>
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
                  
                  <div className="flex justify-between items-center text-sm mb-2 text-gray-400">
                    <span>Tax (10%)</span>
                    <span>¥{finalTax.toLocaleString()}</span>
                  </div>

                  <div className="border-t border-gray-800 my-2"></div>

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
                <span className="text-xs">次の会計へ</span>
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

               {/* Store Memo Input */}
               <div className="bg-white p-4 rounded-lg shadow-sm mb-4 border border-blue-100">
                  <label className="block text-xs font-bold text-gray-500 mb-1">店舗控え用メモ (Store Memo)</label>
                  <textarea 
                    value={storeMemo}
                    onChange={(e) => setStoreMemo(e.target.value)}
                    placeholder="控えにのみ印字されます"
                    className="w-full border border-gray-300 rounded-md p-2 text-sm bg-gray-50 focus:bg-white focus:border-blue-500 focus:outline-none min-h-[60px]"
                  />
               </div>

               {/* Receipt Preview Container (Includes Original and Copy) */}
               <div id="receipt-preview" className="space-y-8">
                   {/* Original */}
                   <div id="receipt-original">
                     <Receipt 
                       items={cart} 
                       subTotal={subTotal} 
                       tax={initialTax} 
                       finalTax={finalTax}
                       total={totalAmount}
                       mode={receiptMode}
                       recipientName={recipientName}
                       proviso={proviso}
                       paymentDeadline={paymentDeadline}
                       discount={discountVal}
                       logo={LOGO_URL} 
                       settings={storeSettings} 
                     />
                   </div>

                   {/* Copy */}
                   <div className="relative">
                       <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-gray-200 text-gray-500 text-[10px] px-2 py-0.5 rounded-full z-10">
                           以下、店舗控え
                       </div>
                       <div className="border-t-2 border-dashed border-gray-300 mb-4"></div>
                       <Receipt 
                         items={cart} 
                         subTotal={subTotal} 
                         tax={initialTax} 
                         finalTax={finalTax}
                         total={totalAmount}
                         mode={receiptMode}
                         recipientName={recipientName}
                         proviso={proviso}
                         paymentDeadline={paymentDeadline}
                         discount={discountVal}
                         logo={LOGO_URL} 
                         settings={storeSettings} 
                         isCopy={true}
                         memo={storeMemo}
                       />
                   </div>
               </div>
               
               <div className="text-center text-gray-400 text-xs mt-4">
                 {receiptMode === 'FORMAL' && totalAmount >= 50000 
                    ? "※ 5万円以上のため印紙枠を表示しています" 
                    : "内容をご確認の上、印刷または共有してください。"}
               </div>
            </div>

            {/* Hidden Horizontal Receipt for PDF Generation (Formal Mode) */}
            <div id="receipt-horizontal-pdf" className="fixed top-0 left-0 -z-50 opacity-0 pointer-events-none bg-white text-black font-sans box-border" style={{ width: '1400px', height: '580px', padding: '40px' }}>
                <div className="w-full h-full flex flex-row justify-between relative border-4 border-gray-800 p-4">
                    {/* Left: Title & Recipient */}
                    <div className="flex flex-col justify-between w-[32%] h-full">
                        <div className="text-6xl font-bold tracking-widest text-gray-900 mt-2">領収書</div>
                        <div className="mb-6 w-full">
                            <div className="flex items-end border-b-4 border-gray-800 pb-2">
                                <span className="text-4xl font-bold flex-1 truncate px-2 text-gray-900">
                                    {recipientName || "　　　　　　"}
                                </span>
                                <span className="text-3xl font-bold ml-2 whitespace-nowrap text-gray-900">様</span>
                            </div>
                        </div>
                    </div>

                    {/* Center: Amount */}
                    <div className="flex flex-col items-center justify-center w-[38%] h-full">
                        <div className="flex items-baseline font-bold text-gray-900 bg-gray-100 px-8 py-4 rounded-xl">
                            <span className="text-5xl mr-3">¥</span>
                            <span className="text-[7rem] leading-none tracking-tighter">{totalAmount.toLocaleString()}</span>
                            <span className="text-5xl ml-3">-</span>
                        </div>
                        <div className="mt-6 text-3xl text-gray-700 font-medium">
                            {proviso || "但 お品代として"}
                        </div>
                    </div>

                    {/* Right: Store Info */}
                    <div className="flex flex-col items-end justify-between w-[30%] h-full text-right pl-4">
                        <div className="text-2xl font-medium text-gray-600 mt-2">
                            {new Date().toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' })}
                        </div>
                        
                        <div className="flex flex-col items-end space-y-2 mb-4">
                            <div className="text-4xl font-bold text-gray-900 mb-2">{storeSettings.storeName}</div>
                            <div className="text-2xl font-medium text-gray-600">〒{storeSettings.zipCode}</div>
                            <div className="text-2xl font-medium text-gray-600">{storeSettings.address1}</div>
                            <div className="text-2xl font-medium text-gray-600">{storeSettings.tel}</div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Footer */}
            <div className="w-full shrink-0 bg-white p-4 pb-10 shadow-[0_-5px_20px_rgba(0,0,0,0.1)] rounded-t-2xl z-30 sticky bottom-0">
              <div className="flex gap-3">
                  <button 
                    onClick={handleSharePDF}
                    className="flex-1 py-4 rounded-xl font-bold text-lg shadow-xl active:scale-[0.98] transition-transform flex items-center justify-center gap-2 bg-gray-700 text-white"
                  >
                    <Share size={20} />
                    PDF/共有
                  </button>

                  <button 
                    onClick={handlePrint}
                    className="flex-1 py-4 rounded-xl font-bold text-lg shadow-xl active:scale-[0.98] transition-transform flex items-center justify-center gap-2 bg-blue-600 text-white"
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
    <div className={`h-[100dvh] w-screen flex flex-col ${isDemoMode ? 'bg-[#0a192f]' : 'bg-[#111318]'} text-onSurface overflow-hidden transition-colors duration-500`}>
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
         isDemoMode={isDemoMode}
      />

      <MasterEditor 
        isOpen={showMasterEditor}
        onClose={() => setShowMasterEditor(false)}
        settings={storeSettings}
        isDemoMode={isDemoMode}
      />

      {appState !== AppState.PREVIEW && (
        <div className={`flex justify-between items-center p-4 ${isDemoMode ? 'bg-[#0a192f]/90' : 'bg-[#111318]/90'} backdrop-blur-md z-10 shrink-0 transition-colors duration-500`}>
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
                <Bluetooth size={12} />
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