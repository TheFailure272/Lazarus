import React, { useEffect, useState, useRef } from 'react';
import { DiagnosisStatus, MedicalAlert } from '../types';

interface HudOverlayProps {
  alert: MedicalAlert | null;
  history: MedicalAlert[];
  isConnected: boolean;
  mode: 'LIVE_CLIENT' | 'WEBSOCKET_SERVER' | 'SIMULATION';
  error: string | null;
  audioAnalyser: AnalyserNode | null;
}

const HudOverlay: React.FC<HudOverlayProps> = ({ alert, history, isConnected, mode, error, audioAnalyser }) => {
  const [pulse, setPulse] = useState(false);
  const [metronomeActive, setMetronomeActive] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastAnnouncedRef = useRef<string>("");

  // Derived state for cleaner logic
  const isCardiacArrest = alert?.diagnosis?.toUpperCase().includes('CARDIAC') ?? false;
  const isCritical = alert?.status === DiagnosisStatus.CRITICAL;

  // --- CLOCK ---
  useEffect(() => {
      const timer = setInterval(() => setCurrentTime(new Date()), 1000);
      return () => clearInterval(timer);
  }, []);

  // --- PULSE EFFECT ---
  useEffect(() => {
    if (isCritical) {
      const interval = setInterval(() => setPulse(p => !p), 500);
      return () => clearInterval(interval);
    } else {
      setPulse(false);
    }
  }, [isCritical]);

  // --- TEXT TO SPEECH ANNOUNCER ---
  useEffect(() => {
    if (alert && alert.status === DiagnosisStatus.CRITICAL) {
        // Prevent spamming the same announcement
        const announcementKey = `${alert.diagnosis}-${alert.timestamp}`;
        // Simple debounce: only announce if we haven't announced this exact diagnosis type in the last 5 seconds
        // OR if the timestamp is significantly new
        if (lastAnnouncedRef.current !== alert.diagnosis) {
            const utterance = new SpeechSynthesisUtterance(`Critical Alert. ${alert.diagnosis.replace('_', ' ')} detected.`);
            utterance.rate = 1.1;
            utterance.pitch = 0.9;
            utterance.volume = 1.0;
            // Select a "tech" sounding voice if available
            const voices = window.speechSynthesis.getVoices();
            const techVoice = voices.find(v => v.name.includes('Google US English') || v.name.includes('Samantha'));
            if (techVoice) utterance.voice = techVoice;
            
            window.speechSynthesis.speak(utterance);
            lastAnnouncedRef.current = alert.diagnosis;
            
            // Reset announcement memory after 8 seconds
            setTimeout(() => { lastAnnouncedRef.current = ""; }, 8000);
        }
    }
  }, [alert]);

  // --- AUDIO OSCILLOSCOPE ---
  useEffect(() => {
      let animationId: number;
      
      const renderWaveform = () => {
          const canvas = canvasRef.current;
          if (!canvas || !audioAnalyser) return;
          
          const ctx = canvas.getContext('2d');
          if (!ctx) return;

          const bufferLength = audioAnalyser.frequencyBinCount;
          const dataArray = new Uint8Array(bufferLength);
          audioAnalyser.getByteTimeDomainData(dataArray);

          ctx.fillStyle = 'rgba(0, 0, 0, 0.2)'; // Fade out effect
          ctx.fillRect(0, 0, canvas.width, canvas.height);

          ctx.lineWidth = 2;
          ctx.strokeStyle = isCritical ? '#ef4444' : '#00ff41'; // Red if critical, Green if normal
          ctx.beginPath();

          const sliceWidth = canvas.width * 1.0 / bufferLength;
          let x = 0;

          for (let i = 0; i < bufferLength; i++) {
              const v = dataArray[i] / 128.0;
              const y = v * canvas.height / 2;

              if (i === 0) {
                  ctx.moveTo(x, y);
              } else {
                  ctx.lineTo(x, y);
              }
              x += sliceWidth;
          }

          ctx.lineTo(canvas.width, canvas.height / 2);
          ctx.stroke();

          animationId = requestAnimationFrame(renderWaveform);
      };

      if (isConnected && audioAnalyser) {
          renderWaveform();
      }

      return () => cancelAnimationFrame(animationId);
  }, [isConnected, audioAnalyser, isCritical]);

  // --- CPR METRONOME (AUDIO) ---
  useEffect(() => {
    if (isCritical && isCardiacArrest) {
      if (!metronomeActive) setMetronomeActive(true);

      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }

      const interval = setInterval(() => {
        const ctx = audioContextRef.current;
        if (ctx) {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          
          osc.frequency.value = 1000;
          osc.type = 'sine';
          
          gain.gain.setValueAtTime(0.5, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);
          
          osc.start();
          osc.stop(ctx.currentTime + 0.1);
        }
      }, 600); // 100 BPM

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
    <div className={`absolute inset-0 pointer-events-none transition-colors duration-500 ${pulse ? 'bg-red-900/10' : ''}`}>
      {/* TACTICAL GRID BACKGROUND */}
      <div 
        className="absolute inset-0 opacity-10" 
        style={{
            backgroundImage: `linear-gradient(#00ff41 1px, transparent 1px), linear-gradient(90deg, #00ff41 1px, transparent 1px)`,
            backgroundSize: '40px 40px'
        }}
      ></div>

      {/* Corners */}
      <div className={`hud-corner hud-tl ${borderColor} transition-colors duration-300`}></div>
      <div className={`hud-corner hud-tr ${borderColor} transition-colors duration-300`}></div>
      <div className={`hud-corner hud-bl ${borderColor} transition-colors duration-300`}></div>
      <div className={`hud-corner hud-br ${borderColor} transition-colors duration-300`}></div>

      {/* Header Info */}
      <div className="absolute top-6 left-12 flex flex-col gap-1 text-xs tracking-widest opacity-80">
        <div className="font-bold text-lg">SYS.LAZARUS.V3</div>
        <div className="text-[#00ff41]/60">MODE: {mode}</div>
        
        {/* Real Network Status */}
        <div className="flex items-center gap-2 mt-2">
            STATUS: 
            <span className={isConnected ? "text-[#00ff41] font-bold" : "text-red-500 font-bold animate-pulse"}>
                {isConnected ? "SYSTEM ONLINE" : error ? `ERROR: ${error}` : "OFFLINE / RECONNECTING..."}
            </span>
            {isConnected && (
                <div className="w-2 h-2 bg-[#00ff41] rounded-full animate-ping"></div>
            )}
        </div>
      </div>

      {/* WAVEFORM VISUALIZER (Replaces Signal Bars) */}
      <div className="absolute top-6 right-12 flex flex-col items-end gap-1 w-48">
        <div className="text-[10px] text-[#00ff41]/50 tracking-widest mb-1">AUDIO INPUT FEED</div>
        <div className="border border-[#00ff41]/30 bg-black/50 w-full h-12 relative overflow-hidden">
            {!isConnected && <div className="absolute inset-0 flex items-center justify-center text-[10px] text-red-500">NO SIGNAL</div>}
            <canvas ref={canvasRef} width="190" height="48" className="w-full h-full opacity-80" />
        </div>
      </div>

      {/* Incident Timeline (History) */}
      <div className="absolute top-32 right-12 w-64 max-h-[40vh] overflow-hidden flex flex-col gap-2 pointer-events-auto">
         {history.length > 0 && <div className="text-[10px] text-[#00ff41]/50 tracking-widest text-right border-b border-[#00ff41]/30 pb-1">EVENT LOG</div>}
         <div className="flex flex-col-reverse gap-2 overflow-y-auto no-scrollbar mask-image-b">
            {history.map((item) => (
                <div key={item.id} className={`p-2 border-l-2 text-[10px] font-mono bg-black/60 backdrop-blur-sm ${
                    item.status === DiagnosisStatus.CRITICAL ? 'border-red-500 text-red-400' : 
                    item.status === DiagnosisStatus.WARNING ? 'border-yellow-500 text-yellow-400' : 'border-green-500 text-green-400'
                }`}>
                    <div className="flex justify-between opacity-70 mb-1">
                        <span>{new Date(item.timestamp).toLocaleTimeString([], {hour12: false, hour: '2-digit', minute:'2-digit', second:'2-digit'})}</span>
                        <span>{(item.confidence * 100).toFixed(0)}% CONF</span>
                    </div>
                    <div className="font-bold">{item.diagnosis}</div>
                </div>
            ))}
         </div>
      </div>

      {/* Central Targeting Reticle - Dynamic */}
      <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 transition-all duration-500 flex items-center justify-center
          ${isCritical ? 'w-80 h-80 border-2 border-red-500 rounded-none' : 'w-64 h-64 border border-[#00ff41]/20 rounded-full'}
      `}>
        {isCritical && (
             <>
                <div className="absolute top-0 left-0 w-4 h-4 border-t-4 border-l-4 border-red-500"></div>
                <div className="absolute top-0 right-0 w-4 h-4 border-t-4 border-r-4 border-red-500"></div>
                <div className="absolute bottom-0 left-0 w-4 h-4 border-b-4 border-l-4 border-red-500"></div>
                <div className="absolute bottom-0 right-0 w-4 h-4 border-b-4 border-r-4 border-red-500"></div>
                <div className="absolute inset-0 bg-red-500/10 animate-pulse"></div>
             </>
        )}
        <div className={`w-2 h-2 rounded-full ${isCritical ? 'bg-red-500' : 'bg-[#00ff41]/50'}`}></div>
        {!isCritical && (
            <>
                <div className="absolute w-60 h-0.5 bg-[#00ff41]/10 rotate-45"></div>
                <div className="absolute w-60 h-0.5 bg-[#00ff41]/10 -rotate-45"></div>
            </>
        )}
      </div>

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

      {/* Scrolling Log (System Stats) */}
      <div className="absolute bottom-6 right-12 text-[10px] text-[#00ff41]/50 text-right font-mono hidden md:block">
        <div>SYS: MONITORING</div>
        <div>AUDIO: ANALYSER ACTIVE</div>
        <div>VIDEO: 640x480 @ 5FPS</div>
        <div>{currentTime.toISOString().replace('T', ' ').substring(0, 19)}</div>
      </div>
    </div>
  );
};

export default HudOverlay;