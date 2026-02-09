import React, { useEffect, useState, useRef } from 'react';
import { DiagnosisStatus, MedicalAlert } from '../types';

interface HudOverlayProps {
  alert: MedicalAlert | null;
  isConnected: boolean;
  mode: 'LIVE_CLIENT' | 'WEBSOCKET_SERVER';
}

const HudOverlay: React.FC<HudOverlayProps> = ({ alert, isConnected, mode }) => {
  const [pulse, setPulse] = useState(false);
  const [metronomeActive, setMetronomeActive] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);

  // Derived state for cleaner logic
  const isCardiacArrest = alert?.diagnosis?.toUpperCase().includes('CARDIAC') ?? false;
  const isCritical = alert?.status === DiagnosisStatus.CRITICAL;

  // --- PULSE EFFECT FOR CRITICAL ---
  useEffect(() => {
    if (isCritical) {
      const interval = setInterval(() => setPulse(p => !p), 500);
      return () => clearInterval(interval);
    } else {
      setPulse(false);
    }
  }, [isCritical]);

  // --- CPR METRONOME (AUDIO) ---
  useEffect(() => {
    if (isCritical && isCardiacArrest) {
      if (!metronomeActive) setMetronomeActive(true);

      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }

      // Metronome at 100 BPM = 600ms interval
      const interval = setInterval(() => {
        const ctx = audioContextRef.current;
        if (ctx) {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          
          osc.frequency.value = 1000; // High pitch beep
          osc.type = 'sine';
          
          gain.gain.setValueAtTime(0.5, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);
          
          osc.start();
          osc.stop(ctx.currentTime + 0.1);
        }
      }, 600);

      return () => clearInterval(interval);
    } else {
      setMetronomeActive(false);
    }
  }, [isCritical, isCardiacArrest]);

  const borderColor = isCritical 
    ? 'border-red-600' 
    : alert?.status === DiagnosisStatus.WARNING 
      ? 'border-yellow-500' 
      : 'border-[#00ff41]';

  const textColor = isCritical 
    ? 'text-red-500' 
    : alert?.status === DiagnosisStatus.WARNING 
      ? 'text-yellow-500' 
      : 'text-[#00ff41]';

  return (
    <div className={`absolute inset-0 pointer-events-none transition-colors duration-500 ${pulse ? 'bg-red-900/20' : ''}`}>
      {/* TACTICAL GRID BACKGROUND */}
      <div 
        className="absolute inset-0 opacity-10" 
        style={{
            backgroundImage: `linear-gradient(#00ff41 1px, transparent 1px), linear-gradient(90deg, #00ff41 1px, transparent 1px)`,
            backgroundSize: '40px 40px'
        }}
      ></div>

      {/* Decorative Corners */}
      <div className={`hud-corner hud-tl ${borderColor} transition-colors duration-300`}></div>
      <div className={`hud-corner hud-tr ${borderColor} transition-colors duration-300`}></div>
      <div className={`hud-corner hud-bl ${borderColor} transition-colors duration-300`}></div>
      <div className={`hud-corner hud-br ${borderColor} transition-colors duration-300`}></div>

      {/* Header Info */}
      <div className="absolute top-6 left-12 flex gap-4 text-xs tracking-widest opacity-80">
        <div>SYS.LAZARUS.V3</div>
        <div>MODE: {mode}</div>
        <div className="flex items-center gap-2">
            NET: <span className={isConnected ? "text-[#00ff41]" : "text-red-500"}>{isConnected ? "ONLINE" : "OFFLINE"}</span>
            {isConnected && (
                <div className="w-2 h-2 bg-[#00ff41] rounded-full animate-ping"></div>
            )}
        </div>
      </div>

      {/* Dummy Audio Visualization Bar */}
      <div className="absolute top-6 right-12 flex gap-1 items-end h-8">
        {[...Array(10)].map((_, i) => (
             <div 
                key={i} 
                className={`w-1 bg-[#00ff41] ${isConnected ? 'animate-pulse' : 'opacity-20'}`}
                style={{ height: `${isConnected ? Math.random() * 100 : 20}%`, animationDuration: `${0.2 + Math.random() * 0.5}s`}}
             ></div>
        ))}
      </div>

      {/* Central Targeting Reticle (Decorative) */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 border border-[#00ff41]/20 rounded-full flex items-center justify-center">
        <div className="w-2 h-2 bg-[#00ff41]/50 rounded-full"></div>
        <div className="absolute w-60 h-0.5 bg-[#00ff41]/10 rotate-45"></div>
        <div className="absolute w-60 h-0.5 bg-[#00ff41]/10 -rotate-45"></div>
      </div>

      {/* VISUAL METRONOME RING (Only in Cardiac Arrest) */}
      {metronomeActive && (
        <>
         {/* Expanding Ring (100 BPM) */}
         <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] border-4 border-red-500 rounded-full animate-[ping_0.6s_cubic-bezier(0,0,0.2,1)_infinite] opacity-50 z-0"></div>
         {/* Center Beat Indicator */}
         <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-6 h-6 bg-red-600 rounded-full animate-pulse z-10 shadow-[0_0_15px_rgba(255,0,0,1)]"></div>
         {/* BPM Label */}
         <div className="absolute top-1/2 left-1/2 -translate-x-1/2 translate-y-8 text-red-500 font-bold tracking-widest text-xs animate-pulse">CPR PACE: 100 BPM</div>
        </>
      )}

      {/* Alert Box */}
      {alert && (
        <div className={`absolute bottom-32 left-1/2 -translate-x-1/2 w-full max-w-lg p-4 border bg-black/80 backdrop-blur-sm ${borderColor} ${textColor} transition-all duration-300`}>
          <div className="flex justify-between items-baseline border-b border-current pb-2 mb-2">
            <h2 className="text-2xl font-bold animate-pulse">{alert.status} DETECTED</h2>
            <span className="text-sm">CONFIDENCE: {(alert.confidence * 100).toFixed(1)}%</span>
          </div>
          <div className="space-y-1">
            <p className="text-xl font-bold">{alert.diagnosis}</p>
            <div className="flex gap-2 text-sm opacity-80 mt-2">
              {alert.symptoms.map((sym, i) => (
                <span key={i} className="px-2 py-0.5 border border-current rounded-sm">
                  {sym}
                </span>
              ))}
            </div>
            
            {/* CPR FEEDBACK DISPLAY - UPDATED */}
            {isCritical && isCardiacArrest && alert.cpr_feedback && (
                <div className="mt-6 bg-red-600/30 border-4 border-red-500 p-6 text-center shadow-[0_0_60px_rgba(220,38,38,0.6)] animate-pulse rounded-md relative overflow-hidden">
                    <div className="absolute inset-0 bg-red-500/10 animate-pulse"></div>
                    <div className="relative z-10">
                        <div className="text-sm text-white tracking-[0.4em] mb-2 font-black uppercase border-b-2 border-red-500/50 pb-2 inline-block">CPR INTERVENTION</div>
                        <div className="text-4xl font-black text-white tracking-widest uppercase drop-shadow-[0_4px_4px_rgba(0,0,0,1)]">
                            {alert.cpr_feedback.replace(/^INSTRUCT:\s*/i, '')}
                        </div>
                    </div>
                </div>
            )}
          </div>
        </div>
      )}

      {/* Scrolling Log (Simulation) */}
      <div className="absolute bottom-6 right-12 text-[10px] text-[#00ff41]/50 text-right font-mono hidden md:block">
        <div>MEM: 4096TB OK</div>
        <div>AUDIO: PCM 16kHz ACTIVE</div>
        <div>VIDEO: 5FPS STREAMING</div>
        <div>{new Date().toISOString()}</div>
      </div>
    </div>
  );
};

export default HudOverlay;