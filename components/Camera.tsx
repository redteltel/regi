import React, { useRef, useEffect, useState, useCallback } from 'react';
import { extractPartNumber } from '../services/geminiService';
import { searchProduct } from '../services/sheetService';
import { Product } from '../types';
import { Plus, X, AlertCircle, RefreshCw, CameraOff, Lock } from 'lucide-react';

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
  
  // Status UI
  const [statusMsg, setStatusMsg] = useState<string>("");
  const [statusType, setStatusType] = useState<'info' | 'success' | 'error'>('info');

  // Candidate Dialog State
  const [showCandidateDialog, setShowCandidateDialog] = useState(false);
  const [candidates, setCandidates] = useState<Product[]>([]);
  const [scannedCode, setScannedCode] = useState<string>("");

  useEffect(() => {
    let mounted = true;

    const init = async () => {
        await startCamera();
    };
    init();

    return () => {
        mounted = false;
        stopCamera();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startCamera = async () => {
    // 1. Check for Secure Context (HTTPS or Localhost)
    // Chrome requires HTTPS for getUserMedia (except localhost)
    if (window.location.protocol !== 'https:' && 
        window.location.hostname !== 'localhost' && 
        window.location.hostname !== '127.0.0.1') {
         setError("カメラを使用するにはHTTPS接続が必要です。\n(現在の接続: " + window.location.protocol + "//" + window.location.hostname + ")");
         return;
    }

    // 2. Check API support
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setError("このブラウザはカメラAPIをサポートしていません。");
        return;
    }

    try {
      stopCamera(); // Stop existing if any

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
        // Explicit play helps on some Android versions if autoplay fails
        videoRef.current.play().catch(e => console.warn("Video play error:", e));
      }
      setError(null);
    } catch (err: any) {
      console.error("Camera access error:", err);
      
      const name = err.name || 'Unknown';
      const msg = err.message || '';
      
      let userMsg = "カメラを起動できませんでした。";

      if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || msg.includes('Permission denied')) {
        userMsg = "カメラのアクセスが許可されていません。\nブラウザのアドレスバーの鍵アイコン🔒または設定から、このサイトへのカメラ権限を許可してください。";
      } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        userMsg = "カメラデバイスが見つかりません。";
      } else if (name === 'NotReadableError' || name === 'TrackStartError') {
        userMsg = "カメラにアクセスできません。\n他のアプリが使用中の可能性があります。";
      } else if (name === 'OverconstrainedError') {
        userMsg = "要求された解像度がサポートされていません。";
      } else {
        userMsg = `カメラエラー (${name}): ${msg}`;
      }
      
      setError(userMsg);
    }
  };

  const stopCamera = () => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
  };

  const handleRetry = () => {
      setError(null);
      startCamera();
  };

  const showStatus = (msg: string, type: 'info' | 'success' | 'error' = 'info') => {
    setStatusMsg(msg);
    setStatusType(type);
  };

  const handleManualAdd = () => {
      const newProduct: Product = {
        id: scannedCode,
        partNumber: scannedCode,
        name: scannedCode, 
        price: 0 
      };
      onProductFound(newProduct);
      showStatus(`🆕 未登録追加: ${scannedCode}`, 'success');
      handleCloseDialog();
  };

  const handleSelectCandidate = (product: Product) => {
      onProductFound(product);
      showStatus(`✅ ${product.name}`, 'success');
      handleCloseDialog();
  };

  const handleCloseDialog = () => {
      setShowCandidateDialog(false);
      setCandidates([]);
      setScannedCode("");
      setIsProcessing(false);
      setStatusMsg("");
  };

  const handleCapture = useCallback(async () => {
    if (isProcessing || showCandidateDialog || error) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (!video || !canvas) return;
    if (video.readyState !== 4 || video.videoWidth === 0) return;

    setFlash(true);
    setTimeout(() => setFlash(false), 200);

    if (navigator.vibrate) navigator.vibrate(30);
    setIsProcessing(true);
    showStatus("AI解析中...", 'info');

    try {
      const MAX_WIDTH = 1024; 
      const scale = Math.min(1, MAX_WIDTH / video.videoWidth);
      
      canvas.width = video.videoWidth * scale;
      canvas.height = video.videoHeight * scale;

      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error("Canvas context error");

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const base64 = canvas.toDataURL('image/webp', 0.6);

      // Add timeout for Gemini API call (Increased to 45s for stability)
      const timeoutPromise = new Promise<null>((_, reject) => 
         setTimeout(() => reject(new Error("Timeout")), 45000)
      );
      
      const result = await Promise.race([
          extractPartNumber(base64),
          timeoutPromise
      ]) as any;
      
      if (result && result.partNumber) {
        showStatus("データ照合中...", 'info');
        const searchResult = await searchProduct(result.partNumber);
        
        if (searchResult.exact) {
          if (navigator.vibrate) navigator.vibrate([50, 50]);
          onProductFound(searchResult.exact);
          showStatus(`✅ ${searchResult.exact.name}`, 'success');
          setTimeout(() => { setIsProcessing(false); setStatusMsg(""); }, 1200);
        } else if (searchResult.candidates.length > 0) {
          if (navigator.vibrate) navigator.vibrate(50);
          setScannedCode(result.partNumber);
          setCandidates(searchResult.candidates);
          setShowCandidateDialog(true);
          showStatus("候補が見つかりました", 'info');
        } else {
          if (navigator.vibrate) navigator.vibrate([30, 100, 30]);
          const newProduct: Product = {
            id: result.partNumber,
            partNumber: result.partNumber,
            name: result.partNumber,
            price: 0
          };
          onProductFound(newProduct);
          showStatus(`🆕 未登録追加: ${result.partNumber}`, 'success');
          setTimeout(() => { setIsProcessing(false); setStatusMsg(""); }, 1200);
        }
      } else {
        showStatus("⚠️ 文字が読み取れません", 'error');
        setTimeout(() => { setIsProcessing(false); setStatusMsg(""); }, 1500);
      }
    } catch (e: any) {
      console.error("Scan Error:", e);
      let errMsg = e.message || "エラーが発生しました";
      
      if (errMsg === "Timeout") {
          errMsg = "通信タイムアウト\n電波の良い場所で再試行してください";
      } else if (errMsg.includes("fetch") || errMsg.includes("Network")) {
          errMsg = "通信エラー\n接続状況を確認してください";
      }
      
      showStatus(errMsg, 'error');
      // Show error message for 4 seconds so user can read it
      setTimeout(() => { setIsProcessing(false); setStatusMsg(""); }, 4000);
    }
  }, [isProcessing, showCandidateDialog, onProductFound, setIsProcessing, error]);

  if (error) {
    return (
      <div className="flex flex-col w-full h-full bg-surface items-center justify-center p-6 text-center space-y-6">
          <div className="w-24 h-24 rounded-full bg-red-500/10 flex items-center justify-center animate-pulse">
              <CameraOff className="text-red-500" size={48} />
          </div>
          <div>
              <h3 className="text-xl font-bold text-white mb-2">カメラエラー</h3>
              <p className="text-red-300 text-sm whitespace-pre-wrap leading-relaxed max-w-xs mx-auto">
                  {error}
              </p>
          </div>
          <button 
              onClick={handleRetry}
              className="px-8 py-3 bg-primary text-onPrimary rounded-full font-bold flex items-center gap-2 hover:bg-primary/90 transition-transform active:scale-95 shadow-lg"
          >
              <RefreshCw size={20} />
              再読み込み
          </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col w-full h-full bg-surface pb-20 relative">
      {/* Candidate Selection Dialog */}
      {showCandidateDialog && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
           <div className="bg-white text-black w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh]">
              <div className="p-4 bg-gray-100 border-b border-gray-200 flex justify-between items-center">
                  <div>
                      <h3 className="font-bold text-lg">もしかして...</h3>
                      <p className="text-xs text-gray-500">解析: {scannedCode}</p>
                  </div>
                  <button onClick={handleCloseDialog} className="p-2 bg-gray-200 rounded-full hover:bg-gray-300">
                      <X size={20} />
                  </button>
              </div>
              
              <div className="flex-1 overflow-y-auto p-2 space-y-2">
                  {candidates.map(candidate => (
                      <button 
                        key={candidate.id}
                        onClick={() => handleSelectCandidate(candidate)}
                        className="w-full text-left p-3 rounded-xl border border-gray-200 hover:bg-blue-50 hover:border-blue-300 transition-all flex justify-between items-center group"
                      >
                          <div>
                              <div className="font-bold text-blue-900 group-hover:text-blue-700">{candidate.partNumber}</div>
                              <div className="text-sm text-gray-600 truncate max-w-[200px]">{candidate.name}</div>
                          </div>
                          <div className="font-mono font-bold text-gray-700">
                              ¥{candidate.price.toLocaleString()}
                          </div>
                      </button>
                  ))}
              </div>

              <div className="p-4 border-t border-gray-200 bg-gray-50">
                  <div className="flex items-start gap-2 mb-3 text-xs text-amber-600 bg-amber-50 p-2 rounded border border-amber-200">
                      <AlertCircle size={16} className="shrink-0" />
                      <p>リストにない場合は、読み取った品番で新規追加します。</p>
                  </div>
                  <button 
                    onClick={handleManualAdd}
                    className="w-full py-3 bg-gray-800 text-white rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-gray-700 active:scale-[0.98] transition-all"
                  >
                      <Plus size={18} />
                      「{scannedCode}」として追加 (¥0)
                  </button>
              </div>
           </div>
        </div>
      )}

      {/* Viewfinder */}
      <div className="relative w-full h-[35vh] bg-black shrink-0 overflow-hidden rounded-b-3xl shadow-xl">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="absolute inset-0 w-full h-full object-cover"
          />

          <div 
            className={`absolute inset-0 bg-white pointer-events-none transition-opacity duration-200 z-40 ${flash ? 'opacity-80' : 'opacity-0'}`}
          />
          
          {/* Status Overlay */}
          <div className="absolute top-6 left-0 right-0 z-30 flex justify-center pointer-events-none px-4">
             {statusMsg && (
               <div className={`
                 backdrop-blur-md text-white py-2 px-6 rounded-full font-bold text-sm shadow-lg border border-white/10 animate-fade-in
                 ${statusType === 'error' ? 'bg-red-500/80' : statusType === 'success' ? 'bg-green-500/80' : 'bg-black/70'}
               `}>
                 {statusMsg}
               </div>
             )}
          </div>

          {/* Guide Frame */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-72 h-20 border-2 border-primary/90 rounded-lg relative shadow-[0_0_100px_rgba(0,0,0,0.5)] bg-black/10">
              <div className="absolute -top-7 left-1/2 -translate-x-1/2 text-white/90 text-[10px] font-bold drop-shadow-md whitespace-nowrap bg-black/40 px-2 py-0.5 rounded">
                品番を枠内に大きく写してください
              </div>
              <div className="absolute top-1/2 left-4 right-4 h-px bg-red-500/50"></div>
              
              {/* Corner markers */}
              <div className="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-white"></div>
              <div className="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-white"></div>
              <div className="absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 border-white"></div>
              <div className="absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 border-white"></div>
            </div>
          </div>
      </div>
      
      {/* Controls */}
      <div className="flex-1 flex flex-col items-center justify-center p-6 gap-6 bg-surface">
        <button
          onClick={handleCapture}
          disabled={isProcessing || showCandidateDialog}
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
                 <div className="w-16 h-16 rounded-full bg-white opacity-80 shadow-inner"></div>
            </div>
          )}
        </button>

        <div className="text-center space-y-1">
            <h3 className="text-xl font-bold text-onSurface">Scan Label</h3>
            <p className="text-gray-400 text-sm">
              {isProcessing ? 'AI Processing...' : 'Press to Analyze'}
            </p>
        </div>
      </div>
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
};

export default Camera;