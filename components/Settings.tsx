import React, { useState, useEffect } from 'react';
import { StoreSettings } from '../types';
import { X, Save, Store, Landmark, FileSpreadsheet, Edit2 } from 'lucide-react';

interface SettingsProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (settings: StoreSettings) => void;
  initialSettings: StoreSettings;
  onOpenMasterEditor: () => void;
}

const Settings: React.FC<SettingsProps> = ({ isOpen, onClose, onSave, initialSettings, onOpenMasterEditor }) => {
  const [settings, setSettings] = useState<StoreSettings>(initialSettings);

  useEffect(() => {
    setSettings(initialSettings);
  }, [initialSettings, isOpen]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
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
            店舗・口座設定
          </h2>
          <button onClick={onClose} className="p-2 hover:bg-gray-800 rounded-full transition-colors text-gray-400">
            <X size={24} />
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-6 space-y-8">
          {/* Store Info Section */}
          <div className="space-y-4">
            <h3 className="text-sm font-bold text-secondary flex items-center gap-2 border-b border-gray-800 pb-2">
                <Store size={16} /> 基本情報
            </h3>
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

          {/* Spreadsheet Info Section */}
          <div className="space-y-4">
             <h3 className="text-sm font-bold text-secondary flex items-center gap-2 border-b border-gray-800 pb-2">
                <FileSpreadsheet size={16} /> データソース設定
            </h3>
            
            <button 
                onClick={onOpenMasterEditor}
                className="w-full bg-gray-800 border border-gray-700 text-secondary py-3 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-gray-700 transition-colors mb-4"
            >
                <Edit2 size={18} />
                マスターデータを編集
            </button>

            <div>
              <label className="block text-xs font-bold text-gray-400 mb-1">スプレッドシートID</label>
              <input
                name="spreadsheetId"
                value={settings.spreadsheetId || ''}
                onChange={handleChange}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg p-3 text-white font-mono text-xs focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary transition-all break-all"
                placeholder="1abc...xyz"
              />
              <p className="text-[10px] text-gray-500 mt-1">※URLの /d/ と /edit の間の文字列</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
                <div className="col-span-1">
                    <label className="block text-xs font-bold text-gray-400 mb-1">ブック名 (表示用)</label>
                    <input
                        name="spreadsheetName"
                        value={settings.spreadsheetName || ''}
                        onChange={handleChange}
                        className="w-full bg-gray-900 border border-gray-700 rounded-lg p-3 text-white focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary transition-all"
                        placeholder="DATA"
                    />
                </div>
                <div className="col-span-1">
                     <label className="block text-xs font-bold text-gray-400 mb-1">シート名 (品番参照)</label>
                    <input
                        name="sheetName"
                        value={settings.sheetName || ''}
                        onChange={handleChange}
                        className="w-full bg-gray-900 border border-gray-700 rounded-lg p-3 text-white focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary transition-all"
                        placeholder="品番参照"
                    />
                </div>
                <div className="col-span-1">
                     <label className="block text-xs font-bold text-gray-400 mb-1">シート名 (サービス)</label>
                    <input
                        name="serviceSheetName"
                        value={settings.serviceSheetName || ''}
                        onChange={handleChange}
                        className="w-full bg-gray-900 border border-gray-700 rounded-lg p-3 text-white focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary transition-all"
                        placeholder="ServiceItems"
                    />
                </div>
            </div>
          </div>

          {/* Bank Info Section */}
          <div className="space-y-4">
             <h3 className="text-sm font-bold text-secondary flex items-center gap-2 border-b border-gray-800 pb-2">
                <Landmark size={16} /> 振込先口座
            </h3>
            <div>
              <label className="block text-xs font-bold text-gray-400 mb-1">金融機関名</label>
              <input
                name="bankName"
                value={settings.bankName || ''}
                onChange={handleChange}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg p-3 text-white focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary transition-all"
                placeholder="例: 天草信用金庫"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-400 mb-1">支店名</label>
              <input
                name="branchName"
                value={settings.branchName || ''}
                onChange={handleChange}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg p-3 text-white focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary transition-all"
                placeholder="例: 瀬戸橋支店"
              />
            </div>
            <div className="grid grid-cols-3 gap-4">
                <div className="col-span-1">
                     <label className="block text-xs font-bold text-gray-400 mb-1">預金種別</label>
                     <select 
                        name="accountType"
                        value={settings.accountType || '普通'}
                        onChange={handleChange}
                        className="w-full bg-gray-900 border border-gray-700 rounded-lg p-3 text-white focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary transition-all appearance-none"
                     >
                         <option value="普通">普通</option>
                         <option value="当座">当座</option>
                     </select>
                </div>
                <div className="col-span-2">
                     <label className="block text-xs font-bold text-gray-400 mb-1">口座番号</label>
                     <input
                        name="accountNumber"
                        value={settings.accountNumber || ''}
                        onChange={handleChange}
                        className="w-full bg-gray-900 border border-gray-700 rounded-lg p-3 text-white focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary transition-all"
                        placeholder="例: 1234567"
                     />
                </div>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-400 mb-1">口座名義 (カナ)</label>
              <input
                name="accountHolder"
                value={settings.accountHolder || ''}
                onChange={handleChange}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg p-3 text-white focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary transition-all"
                placeholder="例: フクシマ カズヒコ"
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