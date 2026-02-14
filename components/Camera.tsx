import React, { useRef, useEffect, useState, useCallback } from 'react';
import { extractPartNumber } from '../services/geminiService';
import { searchProduct } from '../services/sheetService';
import { Product } from '../types';

interface CameraProps {
  onProductFound: (product: Product) => void;
  isProcessing: boolean;
  setIsProcessing: (val: boolean) => void;
}

// Simple in-memory cache for recent scan results to prevent duplicate processing
const resultCache = new Map<string, Product | null>();

const Camera: React.FC<CameraProps> = ({ onProductFound, isProcessing, setIsProcessing }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);
  
  // Simplified Status UI
  const [statusMsg, setStatusMsg] = useState<string>("");

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
          width: { ideal: 1280 }, // Lower resolution is sufficient for OCR preview
          height: { ideal: 720 } 
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
      setError("カメラへのアクセスが拒否されました。");
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

    if (!video || !canvas) return;

    if (video.readyState !== 4 || video.videoWidth === 0) {
      return;
    }

    // Visual Flash Feedback
    setFlash(true);
    setTimeout(() => setFlash(false), 200);

    if (navigator.vibrate) navigator.vibrate(30);
    setIsProcessing(true);
    setStatusMsg("解析中...");

    try {
      // OPTIMIZATION: Resize to max 512px width for faster upload/processing
      // Gemini Flash model works great with smaller images for text
      const MAX_WIDTH = 512; 
      const scale = Math.min(1, MAX_WIDTH / video.videoWidth);
      
      canvas.width = video.videoWidth * scale;
      canvas.height = video.videoHeight * scale;

      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error("Canvas context error");

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      
      // OPTIMIZATION: Use WebP with 0.4 quality for minimal payload size
      const base64 = canvas.toDataURL('image/webp', 0.4);

      // Check cache to see if we processed this exact image recently (unlikely but good for rapid taps)
      // Note: hashing base64 is expensive, so we just proceed to AI for now, 
      // but rely on `isProcessing` flag to prevent concurrent requests.

      const result = await extractPartNumber(base64);
      
      if (result && result.partNumber) {
        // Local search is now instant due to sheetService caching
        const product = await searchProduct(result.partNumber);
        
        if (product) {
          if (navigator.vibrate) navigator.vibrate([50, 50]);
          onProductFound(product);
          setStatusMsg(`✅ ${product.name}`);
          // Short delay to show success before resetting
          setTimeout(() => {
             setIsProcessing(false);
             setStatusMsg("");
          }, 800);
          return; 
        } else {
          setStatusMsg("⚠️ 未登録商品");
          if (navigator.vibrate) navigator.vibrate(200);
        }
      } else {
        setStatusMsg("⚠️ 読取不可");
      }
    } catch (e: any) {
      console.error("Scan Error:", e);
      setStatusMsg("エラー");
    } finally {
      // Ensure we unblock UI if we didn't return early
      setTimeout(() => {
        setIsProcessing(false);
        setStatusMsg("");
      }, 1500);
    }
  }, [isProcessing, onProductFound, setIsProcessing]);

  return (
    <div className="flex flex-col w-full h-full bg-surface pb-20">
      {error ? (
        <div className="h-40 flex items-center justify-center text-red-400 p-4 text-center bg-gray-900">
          <p>{error}</p>
        </div>
      ) : (
        <div className="relative w-full h-[30vh] bg-black shrink-0 overflow-hidden rounded-b-3xl shadow-xl">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="absolute inset-0 w-full h-full object-cover"
          />

          <div 
            className={`absolute inset-0 bg-white pointer-events-none transition-opacity duration-200 z-50 ${flash ? 'opacity-80' : 'opacity-0'}`}
          />
          
          {/* Minimal Status Overlay */}
          <div className="absolute top-4 left-0 right-0 z-30 flex justify-center pointer-events-none px-4">
             {statusMsg && (
               <div className="bg-black/70 backdrop-blur-md text-white py-1.5 px-4 rounded-full font-bold text-sm shadow-lg border border-white/10 animate-fade-in">
                 {statusMsg}
               </div>
             )}
          </div>

          {/* Clean Guide Frame */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-64 h-16 border-2 border-primary/90 rounded-lg relative shadow-[0_0_100px_rgba(0,0,0,0.5)] bg-black/10">
              <div className="absolute -top-6 left-1/2 -translate-x-1/2 text-white/90 text-[10px] font-bold drop-shadow-md whitespace-nowrap bg-black/40 px-2 py-0.5 rounded">
                枠に合わせてください
              </div>
              <div className="absolute top-1/2 left-4 right-4 h-px bg-red-500/50"></div>
            </div>
          </div>
        </div>
      )}
      
      {/* Controls */}
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