import React, { useState, useEffect } from 'react';
import { Product, StoreSettings } from '../types';
import { searchProduct, fetchServiceItems, updateSheetItem } from '../services/sheetService';
import { X, Search, Save, Plus, Loader2, Edit2, RefreshCw, AlertCircle } from 'lucide-react';

interface MasterEditorProps {
  isOpen: boolean;
  onClose: () => void;
  settings: StoreSettings;
}

type Tab = 'PRODUCT' | 'SERVICE';

const MasterEditor: React.FC<MasterEditorProps> = ({ isOpen, onClose, settings }) => {
  const [activeTab, setActiveTab] = useState<Tab>('PRODUCT');
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [updating, setUpdating] = useState(false);
  
  // Edit Modal State
  const [editingItem, setEditingItem] = useState<Product | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [editForm, setEditForm] = useState({ id: '', name: '', price: 0 });

  useEffect(() => {
    if (isOpen) {
        loadItems();
    }
  }, [isOpen, activeTab]);

  const loadItems = async () => {
    setLoading(true);
    try {
        if (activeTab === 'PRODUCT') {
            // For products, we don't load all at once if query is empty to avoid freeze
            // But searchProduct handles empty query by returning nothing or top items?
            // Let's just clear items if query is empty, or show some defaults
            if (query) {
                const res = await searchProduct(query);
                setItems(res.candidates.concat(res.exact ? [res.exact] : []));
            } else {
                setItems([]); 
            }
        } else {
            // Service items are few, load all
            const res = await fetchServiceItems();
            setItems(res);
        }
    } finally {
        setLoading(false);
    }
  };

  // Search effect for Product tab
  useEffect(() => {
      if (activeTab === 'PRODUCT') {
          const timer = setTimeout(() => {
              if (query) {
                  loadItems();
              } else {
                  setItems([]);
              }
          }, 500);
          return () => clearTimeout(timer);
      }
  }, [query, activeTab]);

  const handleEdit = (item: Product) => {
      setEditingItem(item);
      setEditForm({ id: item.partNumber, name: item.name, price: item.price });
      setIsNew(false);
  };

  const handleAddNew = () => {
      setEditingItem({ id: '', partNumber: '', name: '', price: 0 });
      setEditForm({ id: '', name: '', price: 0 });
      setIsNew(true);
  };

  const handleSave = async () => {
      if (!editForm.id || !editForm.name) {
          alert("品番と品名は必須です");
          return;
      }

      setUpdating(true);
      try {
          const targetSheetName = activeTab === 'PRODUCT' ? settings.sheetName : settings.serviceSheetName;
          
          await updateSheetItem({
              spreadsheetId: settings.spreadsheetId,
              sheetName: targetSheetName,
              id: editForm.id,
              name: editForm.name,
              price: editForm.price,
              action: 'UPDATE'
          });

          alert("保存しました。反映には数秒かかる場合があります。");
          setEditingItem(null);
          loadItems(); // Reload list
      } catch (e: any) {
          console.error(e);
          alert(`保存エラー: ${e.message}`);
      } finally {
          setUpdating(false);
      }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[70] bg-surface text-onSurface flex flex-col animate-in slide-in-from-bottom duration-200">
      {/* Header */}
      <div className="p-4 border-b border-gray-800 flex justify-between items-center bg-surface shrink-0">
        <h2 className="text-xl font-bold flex items-center gap-2 text-primary">
          <Edit2 size={24} />
          マスターデータ編集
        </h2>
        <button onClick={onClose} className="p-2 hover:bg-gray-800 rounded-full transition-colors text-gray-400">
          <X size={24} />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-800 shrink-0">
          <button 
            onClick={() => setActiveTab('PRODUCT')}
            className={`flex-1 py-3 font-bold text-sm transition-colors ${activeTab === 'PRODUCT' ? 'text-primary border-b-2 border-primary bg-primary/5' : 'text-gray-500 hover:text-gray-300'}`}
          >
              品番参照 (Product)
          </button>
          <button 
            onClick={() => setActiveTab('SERVICE')}
            className={`flex-1 py-3 font-bold text-sm transition-colors ${activeTab === 'SERVICE' ? 'text-secondary border-b-2 border-secondary bg-secondary/5' : 'text-gray-500 hover:text-gray-300'}`}
          >
              サービス (Service)
          </button>
      </div>

      {/* Toolbar */}
      <div className="p-4 border-b border-gray-800 flex gap-2 shrink-0">
          {activeTab === 'PRODUCT' && (
              <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
                  <input 
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    placeholder="品番または品名で検索..."
                    className="w-full bg-gray-900 border border-gray-700 rounded-lg py-2 pl-10 pr-4 text-white focus:border-primary focus:outline-none"
                  />
              </div>
          )}
          <button 
            onClick={handleAddNew}
            className="px-4 py-2 bg-primary text-onPrimary rounded-lg font-bold flex items-center gap-2 hover:bg-primary/90 active:scale-95 transition-all whitespace-nowrap"
          >
              <Plus size={18} />
              新規登録
          </button>
          {activeTab === 'SERVICE' && (
              <button 
                onClick={loadItems}
                className="p-2 bg-gray-800 rounded-lg text-gray-400 hover:text-white"
              >
                  <RefreshCw size={20} className={loading ? 'animate-spin' : ''} />
              </button>
          )}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {loading ? (
              <div className="flex justify-center py-10">
                  <Loader2 className="animate-spin text-primary" size={32} />
              </div>
          ) : items.length === 0 ? (
              <div className="text-center py-10 text-gray-500">
                  {activeTab === 'PRODUCT' && !query ? (
                      <div className="flex flex-col items-center gap-2">
                          <Search size={48} className="opacity-20" />
                          <p>検索ワードを入力してください</p>
                      </div>
                  ) : (
                      <p>データが見つかりません</p>
                  )}
              </div>
          ) : (
              items.map((item, idx) => (
                  <div key={item.id || idx} className="bg-gray-900/50 border border-gray-800 p-3 rounded-xl flex justify-between items-center">
                      <div>
                          <div className="font-bold text-white">{item.name}</div>
                          <div className="text-xs text-gray-400 font-mono">{item.partNumber}</div>
                      </div>
                      <div className="flex items-center gap-4">
                          <div className="font-mono font-bold text-primary">¥{item.price.toLocaleString()}</div>
                          <button 
                            onClick={() => handleEdit(item)}
                            className="p-2 bg-gray-800 hover:bg-gray-700 rounded-full transition-colors"
                          >
                              <Edit2 size={16} className="text-secondary" />
                          </button>
                      </div>
                  </div>
              ))
          )}
      </div>

      {/* Edit Modal Overlay */}
      {editingItem && (
          <div className="absolute inset-0 z-[80] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
              <div className="bg-surface border border-gray-700 w-full max-w-sm rounded-2xl shadow-2xl p-6 space-y-4">
                  <h3 className="text-lg font-bold flex items-center gap-2">
                      {isNew ? <Plus size={20} className="text-primary" /> : <Edit2 size={20} className="text-secondary" />}
                      {isNew ? '新規登録' : '編集'}
                  </h3>
                  
                  <div className="space-y-3">
                      <div>
                          <label className="block text-xs font-bold text-gray-400 mb-1">品番 (ID)</label>
                          <input 
                            value={editForm.id}
                            onChange={e => setEditForm({...editForm, id: e.target.value})}
                            disabled={!isNew && activeTab === 'PRODUCT'} // ID is key, usually immutable unless new
                            className={`w-full bg-gray-900 border border-gray-700 rounded-lg p-3 text-white font-mono ${!isNew && activeTab === 'PRODUCT' ? 'opacity-50 cursor-not-allowed' : ''}`}
                            placeholder="ABC-123"
                          />
                      </div>
                      <div>
                          <label className="block text-xs font-bold text-gray-400 mb-1">品名</label>
                          <input 
                            value={editForm.name}
                            onChange={e => setEditForm({...editForm, name: e.target.value})}
                            className="w-full bg-gray-900 border border-gray-700 rounded-lg p-3 text-white"
                            placeholder="商品名"
                          />
                      </div>
                      <div>
                          <label className="block text-xs font-bold text-gray-400 mb-1">単価 (税込/税抜は運用次第)</label>
                          <div className="relative">
                              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">¥</span>
                              <input 
                                type="number"
                                value={editForm.price}
                                onChange={e => setEditForm({...editForm, price: parseInt(e.target.value) || 0})}
                                className="w-full bg-gray-900 border border-gray-700 rounded-lg p-3 pl-8 text-white font-mono"
                                placeholder="0"
                              />
                          </div>
                      </div>
                  </div>

                  <div className="pt-4 flex gap-3">
                      <button 
                        onClick={() => setEditingItem(null)}
                        className="flex-1 py-3 bg-gray-800 rounded-xl font-bold text-gray-300 hover:bg-gray-700"
                      >
                          キャンセル
                      </button>
                      <button 
                        onClick={handleSave}
                        disabled={updating}
                        className="flex-1 py-3 bg-primary text-onPrimary rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-primary/90 disabled:opacity-50"
                      >
                          {updating ? <Loader2 className="animate-spin" /> : <Save size={18} />}
                          保存
                      </button>
                  </div>
                  
                  <div className="text-[10px] text-gray-500 text-center bg-gray-900/50 p-2 rounded border border-gray-800">
                      <AlertCircle size={12} className="inline mr-1" />
                      変更はGoogleスプレッドシートに直接反映されます。<br/>
                      GASのデプロイが必要です。
                  </div>
              </div>
          </div>
      )}
    </div>
  );
};

export default MasterEditor;
