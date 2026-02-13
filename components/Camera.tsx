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

    // Feedback start
    if (navigator.vibrate) navigator.vibrate(50);
    setIsProcessing(true);
    setStatusMsg("📸 画像処理中...");
    setDebugMsg("");

    try {
      // 1. Capture and resize
      const MAX_WIDTH = 600;
      const scale = Math.min(1, MAX_WIDTH / video.videoWidth);
      
      canvas.width = video.videoWidth * scale;
      canvas.height = video.videoHeight * scale;

      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error("Canvas context error");

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const base64 = canvas.toDataURL('image/jpeg', 0.5);

      // 2. AI Processing
      setStatusMsg("🤖 AIが品番を解析中...");
      const result = await extractPartNumber(base64);
      
      if (result && result.partNumber) {
        // 3. Database Search
        setStatusMsg(`🔍 検索中: ${result.partNumber}`);
        const product = await searchProduct(result.partNumber);
        
        if (product) {
          setStatusMsg("✅ 商品が見つかりました");
          if (navigator.vibrate) navigator.vibrate([50, 50]);
          onProductFound(product);
          // Don't clear processing immediately to prevent accidental double taps during transition
          setTimeout(() => setIsProcessing(false), 500);
          return; // Exit here on success
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
    <div className="flex flex-col w-full min-h-full bg-surface pb-24">
      {error ? (
        <div className="h-64 flex items-center justify-center text-red-400 p-4 text-center bg-gray-900 rounded-b-2xl">
          <p>{error}</p>
        </div>
      ) : (
        <div className="relative w-full aspect-[3/4] sm:aspect-video bg-black shrink-0 overflow-hidden rounded-b-3xl shadow-2xl">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="absolute inset-0 w-full h-full object-cover"
          />
          
          {/* Status Overlay */}
          <div className="absolute top-4 left-0 right-0 z-30 flex flex-col gap-2 items-center pointer-events-none px-4">
             {statusMsg && (
               <div className="bg-black/80 backdrop-blur-md text-white py-2 px-4 rounded-full text-center font-bold text-sm shadow-lg animate-fade-in border border-white/10">
                 {statusMsg}
               </div>
             )}
          </div>

          {/* Guide Frame: Compact Horizontal for Part Number */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-72 h-20 border-2 border-primary/90 rounded-lg relative shadow-[0_0_100px_rgba(0,0,0,0.5)] bg-black/10">
              <div className="absolute -top-6 left-1/2 -translate-x-1/2 text-white/90 text-xs font-bold drop-shadow-md whitespace-nowrap bg-black/40 px-2 py-0.5 rounded">
                品番をこの枠に合わせてください
              </div>
              {/* Corner markers */}
              <div className="absolute top-0 left-0 w-3 h-3 border-t-2 border-l-2 border-white"></div>
              <div className="absolute top-0 right-0 w-3 h-3 border-t-2 border-r-2 border-white"></div>
              <div className="absolute bottom-0 left-0 w-3 h-3 border-b-2 border-l-2 border-white"></div>
              <div className="absolute bottom-0 right-0 w-3 h-3 border-b-2 border-r-2 border-white"></div>
              
              {/* Center scan line */}
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
      
      {/* Controls Area - Vertical Flow Layout */}
      <div className="flex-1 flex flex-col items-center justify-start p-8 gap-6 bg-surface">
        <button
          onClick={handleCapture}
          disabled={isProcessing}
          className={`
            relative w-20 h-20 rounded-full border-4 border-surface ring-4 ring-primary/20 flex items-center justify-center
            transition-all duration-200 shadow-xl
            ${isProcessing ? 'bg-gray-700 scale-95 opacity-80 cursor-not-allowed' : 'bg-primary hover:bg-primary/90 active:scale-90 active:bg-white'}
          `}
        >
          {isProcessing ? (
             <svg className="animate-spin h-8 w-8 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
               <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
               <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
             </svg>
          ) : (
            <div className="w-16 h-16 rounded-full bg-white/20 pointer-events-none backdrop-blur-sm"></div>
          )}
        </button>

        <div className="text-center space-y-2">
            <h3 className="text-lg font-bold text-onSurface">Scan Part Number</h3>
            <p className="text-gray-400 text-sm max-w-xs mx-auto">
              カメラを商品の品番ラベルに向けて、上のボタンを押してください。
            </p>
        </div>
      </div>
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
};

export default Camera;