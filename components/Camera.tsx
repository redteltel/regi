import React, { useRef, useEffect, useState, useCallback } from 'react';
import { extractPartNumber } from '../services/geminiService';
import { searchProduct } from '../services/sheetService';
import { Product } from '../types';

interface CameraProps {
  onProductFound: (product: Product) => void;
  isProcessing: boolean;
  setIsProcessing: (val: boolean) => void;
}

const Camera: React.FC<CameraProps> = ({ onProductFound, isProcessing, setIsProcessing }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);
  
  // UI States for feedback
  const [statusMsg, setStatusMsg] = useState<string>("");
  const [debugMsg, setDebugMsg] = useState<string>("");

  useEffect(() => {
    startCamera();
    return () => stopCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startCamera = async () => {
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { 
          facingMode: 'environment',
          width: { ideal: 1920 },
          height: { ideal: 1080 } 
        },
        audio: false,
      });
      setStream(mediaStream);
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
      }
      setError(null);
    } catch (err) {
      console.error("Camera access error:", err);
      setError("カメラへのアクセスが拒否されました。設定を確認してください。");
    }
  };

  const stopCamera = () => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
  };

  const handleCapture = useCallback(async () => {
    if (isProcessing) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (!video || !canvas) {
      setDebugMsg("Error: Video/Canvas ref missing");
      return;
    }

    if (video.readyState !== 4 || video.videoWidth === 0) {
      setStatusMsg("カメラ準備中...");
      setTimeout(() => setStatusMsg(""), 1000);
      return;
    }

    // Trigger visual flash
    setFlash(true);
    setTimeout(() => setFlash(false), 200);

    if (navigator.vibrate) navigator.vibrate(50);
    setIsProcessing(true);
    setStatusMsg("📸 画像処理中...");
    setDebugMsg("");

    try {
      const MAX_WIDTH = 600;
      const scale = Math.min(1, MAX_WIDTH / video.videoWidth);
      
      canvas.width = video.videoWidth * scale;
      canvas.height = video.videoHeight * scale;

      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error("Canvas context error");

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const base64 = canvas.toDataURL('image/jpeg', 0.5);

      setStatusMsg("🤖 AIが品番を解析中...");
      const result = await extractPartNumber(base64);
      
      if (result && result.partNumber) {
        setStatusMsg(`🔍 検索中: ${result.partNumber}`);
        const product = await searchProduct(result.partNumber);
        
        if (product) {
          setStatusMsg("✅ 商品が見つかりました");
          if (navigator.vibrate) navigator.vibrate([50, 50]);
          onProductFound(product);
          setTimeout(() => setIsProcessing(false), 500);
          return; 
        } else {
          setStatusMsg("⚠️ 商品マスタ未登録");
          setDebugMsg(`品番 "${result.partNumber}" は検出されましたが、登録されていません。`);
          if (navigator.vibrate) navigator.vibrate(200);
        }
      } else {
        setStatusMsg("⚠️ 品番を読み取れませんでした");
        setDebugMsg("文字が不鮮明か、品番が含まれていません。");
      }
    } catch (e: any) {
      console.error("Scan Process Error:", e);
      setStatusMsg("❌ エラー発生");
      setDebugMsg(e.message || "Unknown error occurred");
      if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
    } finally {
      setIsProcessing(false);
      setTimeout(() => {
        setStatusMsg("");
        if (!debugMsg) setDebugMsg("");
      }, 4000);
    }
  }, [isProcessing, onProductFound, setIsProcessing, debugMsg]);

  return (
    <div className="flex flex-col w-full h-full bg-surface pb-20">
      {error ? (
        <div className="h-40 flex items-center justify-center text-red-400 p-4 text-center bg-gray-900">
          <p>{error}</p>
        </div>
      ) : (
        /* Reduced to 30vh for better button visibility */
        <div className="relative w-full h-[30vh] bg-black shrink-0 overflow-hidden rounded-b-3xl shadow-xl">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="absolute inset-0 w-full h-full object-cover"
          />

          {/* Flash Effect Overlay */}
          <div 
            className={`absolute inset-0 bg-white pointer-events-none transition-opacity duration-200 z-50 ${flash ? 'opacity-80' : 'opacity-0'}`}
          />
          
          {/* Status Overlay */}
          <div className="absolute top-4 left-0 right-0 z-30 flex flex-col gap-2 items-center pointer-events-none px-4">
             {statusMsg && (
               <div className="bg-black/80 backdrop-blur-md text-white py-2 px-4 rounded-full text-center font-bold text-sm shadow-lg animate-fade-in border border-white/10">
                 {statusMsg}
               </div>
             )}
          </div>

          {/* Guide Frame */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-64 h-16 border-2 border-primary/90 rounded-lg relative shadow-[0_0_100px_rgba(0,0,0,0.5)] bg-black/10">
              <div className="absolute -top-6 left-1/2 -translate-x-1/2 text-white/90 text-[10px] font-bold drop-shadow-md whitespace-nowrap bg-black/40 px-2 py-0.5 rounded">
                品番をこの枠に合わせてください
              </div>
              <div className="absolute top-1/2 left-4 right-4 h-px bg-red-500/50"></div>
            </div>
          </div>
          
           {/* Debug msg */}
           {debugMsg && (
             <div className="absolute bottom-4 left-4 right-4 bg-red-900/90 text-white p-2 rounded text-xs font-mono break-all border border-red-500/30">
               {debugMsg}
             </div>
           )}
        </div>
      )}
      
      {/* Controls Area */}
      <div className="flex-1 flex flex-col items-center justify-center p-6 gap-6 bg-surface">
        <button
          onClick={handleCapture}
          disabled={isProcessing}
          className={`
            relative w-24 h-24 rounded-full border-4 border-surface ring-4 ring-primary/20 flex items-center justify-center
            transition-all duration-200 shadow-2xl
            ${isProcessing ? 'bg-gray-700 scale-95 opacity-80 cursor-not-allowed' : 'bg-primary hover:bg-primary/90 active:scale-90 active:bg-white'}
          `}
        >
          {isProcessing ? (
             <svg className="animate-spin h-10 w-10 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
               <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
               <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
             </svg>
          ) : (
            <div className="w-20 h-20 rounded-full bg-white/20 pointer-events-none backdrop-blur-sm flex items-center justify-center">
                 <div className="w-16 h-16 rounded-full bg-white opacity-80"></div>
            </div>
          )}
        </button>

        <div className="text-center space-y-1">
            <h3 className="text-xl font-bold text-onSurface">Scan Label</h3>
            <p className="text-gray-400 text-sm">
              Press button to analyze
            </p>
        </div>
      </div>
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
};

export default Camera;