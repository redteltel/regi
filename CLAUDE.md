# PixelPOS レジアプリ (regi) — CLAUDE.md

## 概要

**パナランドフクシマ** 向けのモバイル POS アプリ。Google Pixel 9a 上で動作する PWA。
- Gemini API でラベル画像から品番をOCR認識
- DATA.csv (商品マスタ) / ServiceItems.csv (サービス項目) をローカル CSV で管理
- Bluetooth / SII Print Agent / SUNMI / PDF の4種類の印刷に対応

GitHub: https://github.com/redteltel/regi  
本番URL: `https://<ドメイン>/regi/`  
デモURL: `https://<ドメイン>/demo-regi/`

---

## 技術スタック

| 項目 | 内容 |
|------|------|
| フレームワーク | React 18 + TypeScript |
| ビルドツール | Vite + vite-plugin-pwa |
| AI | @google/genai (gemini-3-flash-preview) |
| 印刷 | ESC/POS via RawBT / SII URL Print Agent / SUNMI AIDL / jsPDF |
| CSV パース | PapaParse |
| スタイル | Tailwind CSS (CDN) |
| デプロイ先 | Rocky Linux + Nginx (`/var/www/regi/dist/`) |

---

## ディレクトリ構成

```
/var/www/regi/
├── App.tsx               # メインコンポーネント (1339行)
├── types.ts              # 型定義 (Product, CartItem, AppState, StoreSettings 等)
├── index.tsx             # エントリポイント
├── index.html            # Tailwind CDN + importmap
├── logoData.ts           # ロゴ画像 (Base64)
├── vite.config.ts        # base: '/regi/', PWA設定, CSVキャッシュ除外
├── deploy.sh             # Rocky Linux 向けデプロイスクリプト
├── DATA.csv              # 商品マスタ (品番, 商品名, 金額) — VPS上で直接編集
├── ServiceItems.csv      # サービス項目 CSV
├── public/               # 静的アセット (アイコン等)
├── components/
│   ├── Camera.tsx        # カメラUI + Gemini OCR呼び出し
│   ├── Receipt.tsx       # レシートプレビュー + 印刷
│   ├── Settings.tsx      # 店舗・口座・プリンタ設定UI
│   └── MasterEditor.tsx  # 商品マスタ編集UI
└── services/
    ├── geminiService.ts  # Gemini API (OCR)
    ├── printerService.ts # ESC/POS生成 + 各種印刷方式
    └── sheetService.ts   # CSV読込 + 商品検索 (Levenshtein)
```

---

## 主要な型 (types.ts)

```typescript
interface Product { id, partNumber, name, price }
interface CartItem extends Product { quantity }
enum AppState { SCANNING, LIST, PREVIEW }
type PrinterType = 'PDF' | 'BLUETOOTH' | 'SUNMI' | 'SII_AGENT'
interface StoreSettings {
  storeName, zipCode, address1, address2, tel, registrationNum,
  bankName, branchName, accountType, accountNumber, accountHolder,
  printerType, bluetoothAddress?
}
```

---

## 環境変数

`.env` に設定:
```
VITE_GEMINI_API_KEY=<Gemini APIキー>
```

`deploy.sh` 内の `VITE_GEMINI_API_KEY` にもビルド時のキーを設定が必要。

---

## デプロイ手順

```bash
cd /var/www/regi
# deploy.sh 内の VITE_GEMINI_API_KEY を実際のキーに書き換えてから:
bash deploy.sh
```

スクリプトが行うこと:
1. `git pull` (または clone)
2. `npm install && npm run build`
3. `dist/` の所有権を `nginx:nginx` に変更
4. SELinux コンテキスト (`httpd_sys_content_t`) を適用

### Claude がビルドする場合の手順

```bash
# 1. dist/ 権限を一時的に戻す
sudo chown -R redteltel:redteltel /var/www/regi/dist
# 2. ビルド
cd /var/www/regi && npm run build
# 3. nginx 用に権限を戻す
sudo chown -R nginx:nginx /var/www/regi/dist && sudo restorecon -R /var/www/regi/dist
# 4. GitHub へプッシュ
git add <変更ファイル> && git commit -m "..." && git push origin main
```

**ビルド後は必ず GitHub へ push すること。**

---

## 商品データ管理

- **DATA.csv**: VPS 上の `/var/www/regi/DATA.csv` を直接編集。列は `品番,商品名,金額`。
- **ServiceItems.csv**: 同上、`/var/www/regi/services/ServiceItems.csv` または `public/`。
- CSV は PWA Service Worker のキャッシュから除外済み (NetworkOnly)。常にサーバーから取得。
- アプリ起動時に `preloadDatabase()` で in-memory キャッシュに読み込む。
- 商品検索は正規化 (大文字・ハイフン・スペース除去) + Levenshtein 距離によるファジー検索。

---

## 印刷方式

| 方式 | 用途 | 仕組み |
|------|------|--------|
| `PDF` | 汎用/PC | html2canvas → jsPDF |
| `BLUETOOTH` | Android (MP-B20) | ESC/POS → Base64 → `rawbt:base64,...` URI スキーム (RawBT アプリ) |
| `SUNMI` | SUNMI 端末 | ESC/POS → `rawbt:base64,...?charset=UTF-8` |
| `SII_AGENT` | iOS (SII Print Agent) | ESC/POS → `sii-printer-agent://...` URI スキーム |

Bluetooth (MP-B20) の UUIDs:
- Service: `000018f0-0000-1000-8000-00805f9b34fb`
- Characteristic: `00002af1-0000-1000-8000-00805f9b34fb`
- デフォルト BT アドレス: `BC:31:98:A1:17:12`

---

## デフォルト店舗情報 (App.tsx)

```
店舗名: パナランドヨシダ
住所: 〒863-2172 天草市旭町43
TEL: 0969-24-0218
インボイス登録番号: T6810624772686
銀行: 天草信用金庫 瀬戸橋支店 普通 0088477 フクシマ カズヒコ
```

---

## デモモード

`/demo-regi/` パスでアクセスすると自動的にデモモードになる。
- 背景色が濃紺 (`#0a192f`) に変わる
- `localStorage` キーが `pixelpos_config_demo` / `pixelpos_autosave_demo` に分離
- デモ専用のデフォルト店舗名を使用 (商品データは同じ CSV)

---

## 注意事項

- `.env` の `VITE_GEMINI_API_KEY` は **git 管理外** (`.gitignore` 済み)。デプロイ時は `deploy.sh` に直接記入。
- `updateSheetItem()` はメモリキャッシュのみ更新。DATA.csv の永続変更はVPS上で手動編集が必要。
- 住所1・住所2 は15文字制限 (レシート幅に合わせて Settings.tsx で制限)。
- `address1` / `address2` はレシート印刷時に長い場合に内部で折り返し処理が行われる。
