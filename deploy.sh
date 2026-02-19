#!/bin/bash

# ==========================================
# PixelPOS Deployment Script for Rocky Linux
# ==========================================

# 設定
APP_DIR=$(pwd)
REPO_URL="https://github.com/redteltel/regi.git"
USER="redteltel"
GROUP="redteltel"
# Rocky LinuxのNginxユーザーは通常 'nginx' です
WEB_USER="nginx" 
WEB_GROUP="nginx"

# ★ここに新しいAPIキー（yoshida10ejpプロジェクト）を設定してください★
export VITE_GEMINI_API_KEY="PLEASE_PASTE_YOUR_NEW_API_KEY_HERE"
# 互換性のため古い変数名もセット
export API_KEY="$VITE_GEMINI_API_KEY"

if [ "$VITE_GEMINI_API_KEY" == "PLEASE_PASTE_YOUR_NEW_API_KEY_HERE" ]; then
    echo "⚠️  ERROR: API Key is not set in deploy.sh!"
    echo "Please edit deploy.sh and replace PLEASE_PASTE_YOUR_NEW_API_KEY_HERE with your actual key."
    exit 1
fi

echo "🚀 Starting Deployment on Rocky Linux..."

# 1. 権限の一時的な修正
echo "🔧 Adjusting permissions for build..."
if [ -d "$APP_DIR" ]; then
    sudo chown -R $USER:$GROUP $APP_DIR
fi

# 2. クローンまたはPull
if [ -d "$APP_DIR/.git" ]; then
    echo "⬇️  Pulling latest code..."
    cd $APP_DIR
    git reset --hard
    git pull
else
    echo "🧹 Cleaning directory and cloning fresh..."
    sudo rm -rf $APP_DIR
    sudo mkdir -p $APP_DIR
    sudo chown $USER:$GROUP $APP_DIR
    git clone $REPO_URL $APP_DIR
    cd $APP_DIR
fi

# 3. ビルド
echo "📦 Installing dependencies..."
npm install

echo "🔨 Building application..."
# 環境変数を明示的に渡してビルド
VITE_GEMINI_API_KEY="$VITE_GEMINI_API_KEY" npm run build

# 4. Nginx公開用の権限設定 (Rocky Linux / SELinux対応)
echo "🔒 Setting Nginx permissions and SELinux contexts..."

# distディレクトリの所有権をnginxユーザーに変更
sudo chown -R $WEB_USER:$WEB_GROUP $APP_DIR/dist

# ディレクトリ権限 (755) と ファイル権限 (644)
sudo find $APP_DIR/dist -type d -exec chmod 755 {} \;
sudo find $APP_DIR/dist -type f -exec chmod 644 {} \;

# 【重要】SELinuxコンテキストの適用
# Webサーバーが読み取れるように httpd_sys_content_t を付与します
if command -v chcon &> /dev/null; then
    echo "🛡️ Applying SELinux contexts..."
    sudo chcon -R -t httpd_sys_content_t $APP_DIR/dist
else
    echo "⚠️ chcon command not found, skipping SELinux context update."
fi

echo "✅ Deployment Complete!"
echo "Please ensure your Nginx root points to: $APP_DIR/dist"
