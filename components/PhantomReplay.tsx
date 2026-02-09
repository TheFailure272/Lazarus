import React, { useRef, useEffect, useState } from 'react';

interface PhantomReplayProps {
  videoUrl: string | null;
  reason: string;
  onClose: () => void;
}

const PhantomReplay: React.FC<PhantomReplayProps> = ({ videoUrl, reason, onClose }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (videoRef.current && videoUrl) {
      // Reset error state on new url
      setError(null);
      // Ensure muted is set for autoplay to work reliably
      videoRef.current.muted = true;
      videoRef.current.load();
      
      const playPromise = videoRef.current.play();
      if (playPromise !== undefined) {
          playPromise.catch(e => {
              console.warn("Auto-play prevented:", e);
              // We don't show an error for this, user can just click play
          });
      }
    }
  }, [videoUrl]);

  if (!videoUrl) return null;

  return (
    <div className="fixed top-24 right-8 z-50 w-80 bg-black border border-red-500 shadow-[0_0_30px_rgba(255,0,0,0.5)] animate-in slide-in-from-right duration-500">
      <div className="bg-red-900/80 text-white text-xs px-2 py-1 flex justify-between items-center font-bold">
        <span>PHANTOM REPLAY // EVIDENCE</span>
        <button onClick={onClose} className="hover:text-red-300">X</button>
      </div>
      
      <div className="relative aspect-video bg-gray-900 flex items-center justify-center">
        {error ? (
            <div className="text-red-500 text-xs p-4 text-center">
                PLAYBACK ERROR: {error}
            </div>
        ) : (
            <video 
                ref={videoRef}
                className="w-full h-full object-cover" 
                controls 
                playsInline
                muted
                autoPlay
                loop
                onError={() => {
                    // Do not log the event object directly to avoid circular reference errors in some consoles
                    console.error("Video Playback Error: Source format not supported");
                    setError("Source format not supported");
                }}
            >
                <source src={videoUrl} />
            </video>
        )}
        <div className="absolute top-2 left-2 text-[10px] bg-black/50 text-red-500 px-1 border border-red-500 pointer-events-none">
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