"use client";
import { useEffect, useRef, useState } from "react";

interface BarcodeScannerProps {
  onDetect: (barcode: string) => void;
  onClose: () => void;
}

export default function BarcodeScanner({ onDetect, onClose }: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState("");
  const [scanning, setScanning] = useState(true);
  const [manualCode, setManualCode] = useState("");
  const streamRef = useRef<MediaStream | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    let stopped = false;

    const startCamera = async () => {
      // Check BarcodeDetector support
      if (!("BarcodeDetector" in window)) {
        setError("Your browser doesn't support the Barcode API. Please use Chrome 83+ or enter the barcode manually below.");
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } }
        });
        streamRef.current = stream;

        if (videoRef.current && !stopped) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        // @ts-ignore — BarcodeDetector is not in TS types yet
        const detector = new BarcodeDetector({
          formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "qr_code"]
        });

        intervalRef.current = setInterval(async () => {
          if (!videoRef.current || stopped) return;
          try {
            const barcodes = await detector.detect(videoRef.current);
            if (barcodes.length > 0) {
              stopCamera();
              onDetect(barcodes[0].rawValue);
            }
          } catch { /* ignore frame errors */ }
        }, 400);

      } catch {
        setError("Camera access denied. Please allow camera permission or enter the barcode manually below.");
      }
    };

    const stopCamera = () => {
      stopped = true;
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
      setScanning(false);
    };

    startCamera();

    return () => {
      stopped = true;
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    };
  }, [onDetect]);

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <div>
            <h3 className="font-bold text-gray-900">📸 Scan Barcode</h3>
            <p className="text-xs text-gray-400 mt-0.5">Point camera at the product barcode</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500 transition-colors">✕</button>
        </div>

        {/* Camera or error */}
        <div className="relative bg-black aspect-video overflow-hidden">
          {error ? (
            <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
              <p className="text-gray-400 text-sm">{error}</p>
            </div>
          ) : (
            <>
              <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
              {/* Scan overlay */}
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-56 h-32 border-2 border-emerald-400 rounded-lg relative">
                  <div className="absolute top-0 left-0 w-5 h-5 border-t-4 border-l-4 border-emerald-400 rounded-tl"></div>
                  <div className="absolute top-0 right-0 w-5 h-5 border-t-4 border-r-4 border-emerald-400 rounded-tr"></div>
                  <div className="absolute bottom-0 left-0 w-5 h-5 border-b-4 border-l-4 border-emerald-400 rounded-bl"></div>
                  <div className="absolute bottom-0 right-0 w-5 h-5 border-b-4 border-r-4 border-emerald-400 rounded-br"></div>
                  {scanning && <div className="absolute inset-x-0 top-1/2 h-0.5 bg-emerald-400 animate-pulse"></div>}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Manual entry fallback */}
        <div className="px-5 py-4">
          <p className="text-xs text-gray-400 mb-2 text-center">Or enter the barcode number manually:</p>
          <div className="flex gap-2">
            <input
              type="text"
              inputMode="numeric"
              placeholder="e.g. 5000112548167"
              className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
              value={manualCode}
              onChange={e => setManualCode(e.target.value)}
              onKeyDown={e => e.key === "Enter" && manualCode && onDetect(manualCode)}
            />
            <button
              onClick={() => manualCode && onDetect(manualCode)}
              className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 transition-colors"
            >
              Look up
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
