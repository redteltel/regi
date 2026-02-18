import React, { useState, useEffect } from 'react';
import { StoreSettings } from '../types';
import { X, Save, Store } from 'lucide-react';

interface SettingsProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (settings: StoreSettings) => void;
  initialSettings: StoreSettings;
}

const Settings: React.FC<SettingsProps> = ({ isOpen, onClose, onSave, initialSettings }) => {
  const [settings, setSettings] = useState<StoreSettings>(initialSettings);

  useEffect(() => {
    setSettings(initialSettings);
  }, [initialSettings, isOpen]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    // Address length check (simplified for UI feedback, print logic handles truncation if needed)
    if ((name === 'address1' || name === 'address2') && value.length > 15) {
      // allow typing but maybe warn? For now strict limit as per request
      return; 
    }
    setSettings(prev => ({ ...prev, [name]: value }));
  };

  const handleSave = () => {
    onSave(settings);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-surface text-onSurface w-full max-w-md rounded-2xl shadow-2xl border border-gray-800 flex flex-col max-h-[90vh]">
        <div className="p-4 border-b border-gray-800 flex justify-between items-center bg-surface rounded-t-2xl">
          <h2 className="text-xl font-bold flex items-center gap-2 text-primary">
            <Store size={24} />
            店舗設定
          </h2>
          <button onClick={onClose} className="p-2 hover:bg-gray-800 rounded-full transition-colors text-gray-400">
            <X size={24} />
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-gray-400 mb-1">店舗名</label>
              <input
                name="storeName"
                value={settings.storeName}
                onChange={handleChange}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg p-3 text-white focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary transition-all"
                placeholder="店舗名"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
                <div className="col-span-1">
                    <label className="block text-xs font-bold text-gray-400 mb-1">郵便番号</label>
                    <input
                        name="zipCode"
                        value={settings.zipCode}
                        onChange={handleChange}
                        className="w-full bg-gray-900 border border-gray-700 rounded-lg p-3 text-white focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary transition-all"
                        placeholder="000-0000"
                    />
                </div>
                <div className="col-span-1">
                     <label className="block text-xs font-bold text-gray-400 mb-1">電話番号</label>
                    <input
                        name="tel"
                        value={settings.tel}
                        onChange={handleChange}
                        className="w-full bg-gray-900 border border-gray-700 rounded-lg p-3 text-white focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary transition-all"
                        placeholder="00-0000-0000"
                    />
                </div>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-400 mb-1">
                住所1 <span className="text-[10px] font-normal text-gray-500 ml-1">※全角15文字以内</span>
              </label>
              <input
                name="address1"
                value={settings.address1}
                onChange={handleChange}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg p-3 text-white focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary transition-all"
                placeholder="都道府県 市区町村 番地"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-400 mb-1">
                 住所2 <span className="text-[10px] font-normal text-gray-500 ml-1">※全角15文字以内</span>
              </label>
              <input
                name="address2"
                value={settings.address2}
                onChange={handleChange}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg p-3 text-white focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary transition-all"
                placeholder="ビル・建物名など"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-400 mb-1">登録番号 (インボイス)</label>
              <input
                name="registrationNum"
                value={settings.registrationNum}
                onChange={handleChange}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg p-3 text-white font-mono focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary transition-all"
                placeholder="T1234567890123"
              />
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-gray-800 bg-surface rounded-b-2xl">
            <button 
                onClick={handleSave}
                className="w-full bg-primary text-onPrimary py-3 rounded-xl font-bold text-lg shadow-lg active:scale-[0.98] transition-transform flex items-center justify-center gap-2 hover:bg-primary/90"
            >
                <Save size={20} />
                設定を保存
            </button>
        </div>
      </div>
    </div>
  );
};

export default Settings;