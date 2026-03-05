import React, { useState } from 'react';
import { CartItem, StoreSettings } from '../types';

interface ReceiptProps {
  items: CartItem[];
  subTotal: number;
  tax: number; // Initial Tax (before discount)
  finalTax?: number; // Re-calculated Tax (after discount)
  total: number;
  mode: 'RECEIPT' | 'FORMAL' | 'INVOICE' | 'ESTIMATION';
  recipientName: string;
  proviso: string;
  paymentDeadline: string;
  discount?: number;
  logo?: string | null;
  settings: StoreSettings;
  isCopy?: boolean;
  memo?: string;
}

const Receipt: React.FC<ReceiptProps> = ({ 
  items, 
  subTotal, 
  tax, 
  finalTax,
  total, 
  mode,
  recipientName,
  proviso,
  paymentDeadline,
  discount = 0,
  logo = null,
  settings,
  isCopy = false,
  memo = ''
}) => {
  const needsStamp = mode === 'FORMAL' && total >= 50000;
  const [imgError, setImgError] = useState(false);

  // Calculate Expiration Date for Estimation (1 month from now)
  const expirationDate = new Date();
  expirationDate.setMonth(expirationDate.getMonth() + 1);

  const getTitle = () => {
      switch(mode) {
          case 'ESTIMATION': return '御 見 積 書';
          case 'INVOICE': return '請 求 書';
          case 'FORMAL': return '領 収 証';
          default: return '領収書';
      }
  };

  return (
    <div className="bg-white text-black p-8 rounded-sm shadow-xl max-w-sm mx-auto font-mono text-sm leading-relaxed mb-4 border-t-8 border-gray-200 relative">
      
      {/* Header */}
      <div className="text-center mb-6">
        {logo && !imgError && !isCopy && (
           <img 
             src={logo} 
             alt="Store Logo" 
             onError={() => setImgError(true)}
             className="mx-auto mb-4 object-contain"
             style={{ maxWidth: '200px', maxHeight: '100px' }} 
           />
        )}
        
        <h2 className={`font-bold mb-2 tracking-widest flex items-center justify-center gap-2 ${isCopy ? 'text-4xl' : 'text-2xl'}`}>
          {getTitle()}{isCopy ? '（控え）' : ''}
        </h2>
        {mode === 'INVOICE' && <p className="text-sm font-bold mb-1 tracking-wide">(INVOICE)</p>}
        {mode === 'ESTIMATION' && <p className="text-sm font-bold mb-1 tracking-wide">(ESTIMATION)</p>}
        <p className="text-gray-500 text-xs text-right">
          No. {new Date().toISOString().slice(0,10).replace(/-/g,'')}-{new Date().getHours()}{new Date().getMinutes()}
        </p>
        <p className="text-gray-500 text-xs text-right">
          {new Date().toLocaleDateString()} {new Date().toLocaleTimeString()}
        </p>
      </div>

      {/* Recipient & Invoice/Formal/Estimation Details */}
      {(mode === 'FORMAL' || mode === 'INVOICE' || mode === 'ESTIMATION' || isCopy) && (
        <div className="mb-6 border-b-2 border-black pb-4">
          <div className="flex justify-between items-end mb-4">
            <span className="text-lg border-b border-black flex-1 mr-2 px-1">
              {recipientName || '__________'} <span className="text-sm">様</span>
            </span>
          </div>
          
          {mode === 'INVOICE' && (
              <div className="text-right text-xs mb-2">
                下記の通りご請求申し上げます。
              </div>
          )}
          {mode === 'ESTIMATION' && (
              <div className="text-right text-xs mb-2">
                下記の通り御見積申し上げます。
              </div>
          )}
          
          <div className="bg-gray-100 py-3 px-2 text-center mb-2">
            <span className="text-xs mr-2">
                {mode === 'INVOICE' ? 'ご請求金額' : mode === 'ESTIMATION' ? '御見積金額' : '金額'}
            </span>
            <span className={`${isCopy ? 'text-5xl' : 'text-2xl'} font-bold tracking-wider block mt-1`}>
                ¥ {total.toLocaleString()} -
            </span>
          </div>
          
          {mode === 'FORMAL' && (
             <>
                <div className="text-sm">
                    <span>但 </span>
                    <span className="mx-2">{proviso || 'お品代として'}</span>
                    <span>として</span>
                </div>
                <div className="text-right text-xs mt-1">
                    上記正に領収いたしました
                </div>
             </>
          )}

          {mode === 'INVOICE' && paymentDeadline && (
            <div className="text-right text-sm font-bold mt-2 text-red-700">
                お支払期限: {paymentDeadline}
            </div>
          )}

          {mode === 'ESTIMATION' && (
            <div className="text-right text-sm font-bold mt-2 text-gray-700">
                有効期限: {expirationDate.toLocaleDateString()}
            </div>
          )}
        </div>
      )}

      {/* Line Items */}
      <div className="space-y-4 mb-4">
        {(mode === 'FORMAL' || mode === 'INVOICE' || mode === 'ESTIMATION') && <p className="text-xs text-gray-500 border-b border-dashed pb-1">内訳</p>}
        
        {items.map((item) => (
          <div key={item.id} className="flex flex-col border-b border-dashed border-gray-100 pb-2 last:border-0 last:pb-0">
            {/* Item Name */}
            <span className="font-bold text-sm break-words">{item.name}</span>
            
            {/* Part Number Display */}
            {item.partNumber && (
                <span className="text-[10px] text-gray-500 font-mono tracking-tight mb-0.5 break-all">
                  (品番: {item.partNumber})
                </span>
            )}

            <div className="flex justify-between text-gray-600 text-xs mt-0.5">
              <span>{item.quantity} x {item.price.toLocaleString()}円</span>
              <span>{(item.price * item.quantity).toLocaleString()}円</span>
            </div>
          </div>
        ))}
      </div>

      {/* Totals */}
      <div className="border-t border-dashed border-gray-400 pt-3 mb-6 space-y-1">
        <div className="flex justify-between text-gray-600">
          <span>小計 (税抜)</span>
          <span>{subTotal.toLocaleString()}円</span>
        </div>
        <div className="flex justify-between text-gray-600">
          <span>消費税(10%)</span>
          <span>{(finalTax !== undefined ? finalTax : tax).toLocaleString()}円</span>
        </div>

        {discount > 0 && (
          <>
            <div className="flex justify-between text-gray-600 border-t border-dashed border-gray-300 pt-1 mt-1">
               <span>合計 (値引前)</span>
               <span>{(subTotal + tax).toLocaleString()}円</span>
            </div>
            <div className="flex justify-between text-red-600">
               <span>値引 (税込)</span>
               <span>- {discount.toLocaleString()}円</span>
            </div>
          </>
        )}
        
        {mode === 'RECEIPT' && (
          <div className="flex justify-between text-xl font-bold border-t border-gray-200 pt-2 mt-2">
            <span>合計</span>
            <span>{total.toLocaleString()}円</span>
          </div>
        )}

        {discount > 0 && finalTax !== undefined && (
             <div className="text-right text-[10px] text-gray-500 mt-1">
                (内消費税等: {finalTax.toLocaleString()}円)
             </div>
        )}
      </div>

      {/* Footer: Store Info & Stamp */}
      <div className="mt-8 pt-4 border-t-2 border-gray-800 relative">
        <div className={`${isCopy ? 'text-base leading-7' : 'text-xs leading-5'}`}>
            <p className={`${isCopy ? 'text-xl' : 'text-sm'} font-bold`}>{settings.storeName}</p>
            <p>〒{settings.zipCode}</p>
            <p>{settings.address1}</p>
            {settings.address2 && <p>{settings.address2}</p>}
            <p>電話: {settings.tel}</p>
            <p className="mt-1 font-mono">登録番号: {settings.registrationNum}</p>
        </div>

        {/* Revenue Stamp Box */}
        {needsStamp && (
          <div className="absolute bottom-0 right-0 w-20 h-20 border border-gray-400 flex flex-col items-center justify-center text-gray-300 text-[10px] bg-gray-50">
            <div className="w-12 h-12 border border-dashed border-gray-300 rounded-full flex items-center justify-center mb-1">
                印
            </div>
            収入印紙
          </div>
        )}
      </div>

      {/* Bank Information (Appears at bottom for all modes if present in settings) */}
      {(settings.bankName && mode === 'INVOICE') && (
        <div className="mt-6 p-3 border-t border-dashed border-gray-300 text-xs">
            <p className="font-bold mb-1">【お振込先】</p>
            <div className="space-y-0.5 text-gray-800">
                <p>{settings.bankName} {settings.branchName}</p>
                <p>{settings.accountType} {settings.accountNumber}</p>
                <p>{settings.accountHolder}</p>
            </div>
        </div>
      )}
      
      <div className="text-center text-[10px] text-gray-400 mt-4">
        {mode === 'INVOICE' ? 'ご請求書を送付いたします。' : 
         mode === 'ESTIMATION' ? 'ご検討のほどお願い申し上げます。' : 
         '毎度ありがとうございます！'}
      </div>

      {/* Memo Section for Copy */}
      {isCopy && (
          <div className="mt-4 pt-4 border-t border-dashed border-gray-300">
              <p className="text-xs font-bold mb-1">【店舗メモ】</p>
              <div className="border border-gray-300 rounded p-2 min-h-[60px] text-xs whitespace-pre-wrap">
                  {memo}
              </div>
          </div>
      )}
    </div>
  );
};

export default Receipt;