import React from 'react';
import { CartItem } from '../types';

interface ReceiptProps {
  items: CartItem[];
  subTotal: number;
  tax: number;
  total: number;
}

const Receipt: React.FC<ReceiptProps> = ({ items, subTotal, tax, total }) => {
  return (
    <div className="bg-white text-black p-6 rounded-sm shadow-xl max-w-sm mx-auto font-mono text-sm leading-relaxed mb-4 border-t-8 border-gray-200">
      <div className="text-center mb-6">
        <h2 className="text-xl font-bold mb-1">パナランドヨシダ</h2>
        <p className="text-gray-500 text-xs">領収書 (Receipt)</p>
        <p className="text-gray-500 text-xs">---------------------------</p>
      </div>

      <div className="space-y-3 mb-6">
        {items.map((item) => (
          <div key={item.id} className="flex flex-col">
            <span className="font-bold">{item.name}</span>
            <div className="flex justify-between text-gray-600">
              <span>{item.quantity} x ¥{item.price.toLocaleString()}</span>
              <span>¥{(item.price * item.quantity).toLocaleString()}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="border-t border-dashed border-gray-400 pt-4 mb-6 space-y-2">
        <div className="flex justify-between text-gray-600">
          <span>小計</span>
          <span>¥{subTotal.toLocaleString()}</span>
        </div>
        <div className="flex justify-between text-gray-600">
          <span>(内消費税10%)</span>
          <span>¥{tax.toLocaleString()}</span>
        </div>
        <div className="flex justify-between text-lg font-bold border-t border-gray-200 pt-2 mt-2">
          <span>合計</span>
          <span>¥{total.toLocaleString()}</span>
        </div>
      </div>

      <div className="text-center text-xs text-gray-400">
        <p>{new Date().toLocaleDateString()} {new Date().toLocaleTimeString()}</p>
        <p className="mt-2">毎度ありがとうございます！</p>
      </div>
    </div>
  );
};

export default Receipt;