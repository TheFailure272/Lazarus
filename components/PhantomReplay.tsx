import React, { useRef, useEffect } from 'react';

interface PhantomReplayProps {
  videoUrl: string | null;
  reason: string;
  onClose: () => void;
}

const PhantomReplay: React.FC<PhantomReplayProps> = ({ videoUrl, reason, onClose }) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && videoUrl) {
      videoRef.current.play().catch(e => console.error("Auto-play blocked", e));
    }
  }, [videoUrl]);

  if (!videoUrl) return null;

  return (
    <div className="fixed top-24 right-8 z-50 w-80 bg-black border border-red-500 shadow-[0_0_30px_rgba(255,0,0,0.5)] animate-in slide-in-from-right duration-500">
      <div className="bg-red-900/80 text-white text-xs px-2 py-1 flex justify-between items-center font-bold">
        <span>PHANTOM REPLAY // EVIDENCE</span>
        <button onClick={onClose} className="hover:text-red-300">X</button>
      </div>
      
      <div className="relative aspect-video bg-gray-900">
        <video 
            ref={videoRef}
            src={videoUrl} 
            className="w-full h-full object-cover" 
            controls 
            loop
        />
        <div className="absolute top-2 left-2 text-[10px] bg-black/50 text-red-500 px-1 border border-red-500">
            T-3.00s
        </div>
      </div>

      <div className="p-3">
        <div className="text-red-500 text-xs font-bold mb-1">REASON FOR ALERT:</div>
        <p className="text-white text-sm font-mono leading-tight">
          {reason}
        </p>
        <div className="mt-2 text-[10px] text-gray-400">
            Analysis confirms specific markers at timestamp.
        </div>
      </div>
    </div>
  );
};

export default PhantomReplay;
