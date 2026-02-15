import React, { useRef, useEffect, useState, useCallback } from 'react';
import { extractPartNumber } from '../services/geminiService';
import { searchProduct } from '../services/sheetService';
import { Product } from '../types';
import { Plus, X, AlertCircle, RefreshCw, CameraOff, Lock, Settings } from 'lucide-react';

interface CameraProps {
  onProductFound: (product: Product) => void;
  isProcessing: boolean;
  setIsProcessing: (val: boolean) => void;
}

const Camera: React.FC<CameraProps> = ({ onProductFound, isProcessing, setIsProcessing }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
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
    let isMounted = true;

    const checkPermissionsAndStart = async () => {
      // 1. Check for Secure Context
      if (!window.isSecureContext) {
         setError("カメラを使用するにはHTTPS接続、またはlocalhostが必要です。");
         return;
      }

      await startCamera(isMounted);
    };

    checkPermissionsAndStart();

    return () => {
      isMounted = false;
      stopCamera();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startCamera = async (isMounted: boolean) => {
    setError(null);
    if (!isMounted) return;

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setError("お使いのブラウザはカメラ機能をサポートしていないか、安全なコンテキスト(HTTPS)で実行されていません。");
      return;
    }

    try {
      stopCamera();

      let mediaStream: MediaStream;
      try {
        // Try environment camera first
        mediaStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        });
      } catch (err) {
        // Fallback to any camera
        mediaStream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: false
        });
      }

      if (!isMounted) {
         mediaStream.getTracks().forEach(t => t.stop());
         return;
      }

      streamRef.current = mediaStream;
      
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
        await videoRef.current.play().catch(e => console.error("Play error:", e));
      }
    } catch (err: any) {
      if (!isMounted) return;
      console.error("Camera error:", err);
      
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setError("access_denied");
      } else if (err.name === 'NotFoundError') {
        setError("カメラデバイスが見つかりません。");
      } else {
        setError("カメラにアクセスできません。");
      }
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
        videoRef.current.srcObject = null;
    }
  };

  const handleRetry = () => {
      stopCamera();
      setError(null);
      setTimeout(() => startCamera(true), 300);
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

    if (!video || !canvas || video.readyState !== 4) return;

    setFlash(true);
    setTimeout(() => setFlash(false), 200);
    if (navigator.vibrate) navigator.vibrate(30);

    setIsProcessing(true);
    showStatus("AI解析中...", 'info');

    try {
      const MAX_WIDTH = 1280; 
      const scale = Math.min(1, MAX_WIDTH / video.videoWidth);
      
      canvas.width = video.videoWidth * scale;
      canvas.height = video.videoHeight * scale;

      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        // Use JPEG 0.9 for high quality text recognition
        const base64 = canvas.toDataURL('image/jpeg', 0.9);

        const result = await extractPartNumber(base64);
        
        if (result && result.partNumber && result.partNumber.length > 2) {
          showStatus("データ照合中...", 'info');
          
          const searchResult = await searchProduct(result.partNumber);
          
          if (searchResult.exact) {
            // Exact Match
            if (navigator.vibrate) navigator.vibrate([50, 50]);
            onProductFound(searchResult.exact);
            showStatus(`✅ ${searchResult.exact.name}`, 'success');
            setTimeout(() => { setIsProcessing(false); setStatusMsg(""); }, 1000);

          } else if (searchResult.candidates.length > 0) {
            // Candidates found
            if (navigator.vibrate) navigator.vibrate(50);
            setScannedCode(result.partNumber);
            setCandidates(searchResult.candidates);
            setShowCandidateDialog(true);
            showStatus("候補が見つかりました", 'info');

          } else {
            // No match - Prompt to add new
            if (navigator.vibrate) navigator.vibrate([30, 100, 30]);
            const newProduct: Product = {
              id: result.partNumber,
              partNumber: result.partNumber,
              name: result.partNumber,
              price: 0
            };
            onProductFound(newProduct);
            showStatus(`🆕 未登録追加: ${result.partNumber}`, 'success');
            setTimeout(() => { setIsProcessing(false); setStatusMsg(""); }, 1000);
          }
        } else {
           throw new Error("No text found");
        }
      }
    } catch (e) {
      console.warn("Scan failed", e);
      showStatus("文字を認識できませんでした。\n商品を枠内に大きく写してください。", 'error');
      setTimeout(() => {
        setIsProcessing(false);
        setStatusMsg("");
      }, 2000);
    }
  }, [isProcessing, showCandidateDialog, onProductFound, setIsProcessing, error]);

  // Error View
  if (error) {
     const isPermissionError = error === "access_denied" || error.includes("ブロック");
     return (
        <div className="h-full flex flex-col items-center justify-center text-red-300 p-8 text-center bg-surface gap-6">
          <div className="w-24 h-24 bg-red-900/30 rounded-full flex items-center justify-center relative">
              {error.includes('HTTPS') ? (
                  <Lock size={48} className="text-red-500" />
              ) : (
                  <>
                    <CameraOff size={48} className="text-red-500" />
                    {isPermissionError && (
                        <div className="absolute -top-2 -right-2 bg-red-500 text-white p-2 rounded-full shadow-lg animate-bounce">
                            <Settings size={20} />
                        </div>
                    )}
                  </>
              )}
          </div>
          <div>
            <h3 className="text-xl font-bold mb-3 text-white">
                {isPermissionError ? "カメラへのアクセスが拒否されました" : "カメラエラー"}
            </h3>
            {isPermissionError ? (
                <div className="bg-gray-800 p-4 rounded-xl text-left text-sm text-gray-300 space-y-3 shadow-inner">
                    <p className="font-bold text-center border-b border-gray-700 pb-2 mb-2">ロックを解除する方法</p>
                    <ol className="list-decimal list-inside space-y-2">
                        <li>アドレスバーの鍵アイコンをタップ</li>
                        <li>「権限」または「サイトの設定」</li>
                        <li>「カメラ」を「許可」にする</li>
                        <li>この画面に戻り「再試行」</li>
                    </ol>
                </div>
            ) : (
                <p className="text-sm text-gray-400">{error}</p>
            )}
          </div>
          <button onClick={handleRetry} className="px-8 py-4 bg-primary text-onPrimary rounded-xl font-bold flex items-center gap-2 hover:opacity-90 shadow-lg mt-2">
            <RefreshCw size={20} />
            再試行 (Retry)
          </button>
        </div>
     );
  }

  return (
    <div className="flex flex-col w-full h-full bg-surface pb-20 relative">
      {/* Candidate Dialog */}
      {showCandidateDialog && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
           <div className="bg-white text-black w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh]">
              <div className="p-4 bg-gray-100 border-b border-gray-200 flex justify-between items-center">
                  <div>
                      <h3 className="font-bold text-lg">もしかして...</h3>
                      <p className="text-xs text-gray-500">解析: {scannedCode}</p>
                  </div>
                  <button onClick={handleCloseDialog} className="p-2 bg-gray-200 rounded-full hover:bg-gray-300"><X size={20} /></button>
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-2">
                  {candidates.map(candidate => (
                      <button key={candidate.id} onClick={() => handleSelectCandidate(candidate)} className="w-full text-left p-3 rounded-xl border border-gray-200 hover:bg-blue-50 transition-all flex justify-between items-center">
                          <div>
                              <div className="font-bold text-blue-900">{candidate.partNumber}</div>
                              <div className="text-sm text-gray-600 truncate max-w-[200px]">{candidate.name}</div>
                          </div>
                          <div className="font-mono font-bold text-gray-700">¥{candidate.price.toLocaleString()}</div>
                      </button>
                  ))}
              </div>
              <div className="p-4 border-t border-gray-200 bg-gray-50">
                  <button onClick={handleManualAdd} className="w-full py-3 bg-gray-800 text-white rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-gray-700">
                      <Plus size={18} />「{scannedCode}」として追加 (¥0)
                  </button>
              </div>
           </div>
        </div>
      )}

      {/* Main Camera View */}
      <div className="relative w-full h-[35vh] bg-black shrink-0 overflow-hidden rounded-b-3xl shadow-xl">
          <video ref={videoRef} autoPlay playsInline muted className="absolute inset-0 w-full h-full object-cover" />
          <div className={`absolute inset-0 bg-white pointer-events-none transition-opacity duration-200 z-40 ${flash ? 'opacity-80' : 'opacity-0'}`} />
          <div className="absolute top-6 left-0 right-0 z-30 flex justify-center pointer-events-none px-4">
             {statusMsg && (
               <div className={`backdrop-blur-md text-white py-2 px-6 rounded-full font-bold text-sm shadow-lg border border-white/10 animate-fade-in ${statusType === 'error' ? 'bg-red-500/80' : statusType === 'success' ? 'bg-green-500/80' : 'bg-black/70'}`}>
                 {statusMsg}
               </div>
             )}
          </div>
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-72 h-20 border-2 border-primary/90 rounded-lg relative shadow-[0_0_100px_rgba(0,0,0,0.5)] bg-black/10">
              <div className="absolute -top-7 left-1/2 -translate-x-1/2 text-white/90 text-[10px] font-bold bg-black/40 px-2 py-0.5 rounded">品番を枠内に大きく写してください</div>
              <div className="absolute top-1/2 left-4 right-4 h-px bg-red-500/50"></div>
              <div className="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-white"></div>
              <div className="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-white"></div>
              <div className="absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 border-white"></div>
              <div className="absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 border-white"></div>
            </div>
          </div>
        </div>
      
      {/* Controls */}
      <div className="flex-1 flex flex-col items-center justify-center p-6 gap-6 bg-surface">
        <button onClick={handleCapture} disabled={isProcessing || showCandidateDialog} className={`relative w-24 h-24 rounded-full border-4 border-surface ring-4 ring-primary/20 flex items-center justify-center transition-all duration-200 shadow-2xl ${isProcessing ? 'bg-gray-700 scale-95 opacity-80 cursor-not-allowed' : 'bg-primary hover:bg-primary/90 active:scale-90 active:bg-white'}`}>
          {isProcessing ? (
             <svg className="animate-spin h-10 w-10 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
          ) : (
            <div className="w-20 h-20 rounded-full bg-white/20 pointer-events-none backdrop-blur-sm flex items-center justify-center"><div className="w-16 h-16 rounded-full bg-white opacity-80 shadow-inner"></div></div>
          )}
        </button>
        <div className="text-center space-y-1">
            <h3 className="text-xl font-bold text-onSurface">Scan Label</h3>
            <p className="text-gray-400 text-sm">{isProcessing ? 'AI Processing...' : 'Press to Analyze'}</p>
        </div>
      </div>
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
};

export default Camera;