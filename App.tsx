import React, { useEffect, useRef, useState } from 'react';
import HudOverlay from './components/HudOverlay';
import PhantomReplay from './components/PhantomReplay';
import { LazarusLiveClient } from './services/liveClient';
import { MedicalAlert, DiagnosisStatus } from './types';

// Mock Alert for demo purposes if API key is missing
const DEMO_ALERT: MedicalAlert = {
  status: DiagnosisStatus.CRITICAL,
  diagnosis: "POSSIBLE STROKE",
  confidence: 0.89,
  symptoms: ["Left-side facial droop", "Slurred speech"],
  timestamp: Date.now()
};

function App() {
  const [isStarted, setIsStarted] = useState(false);
  const [isBooting, setIsBooting] = useState(false);
  // Connection status tracks the ACTUAL active link, not just user intent
  const [isConnected, setIsConnected] = useState(false);
  const [alert, setAlert] = useState<MedicalAlert | null>(null);
  const [mode, setMode] = useState<'LIVE_CLIENT' | 'WEBSOCKET_SERVER'>('LIVE_CLIENT');
  
  // Phantom Replay State
  const [replayUrl, setReplayUrl] = useState<string | null>(null);
  const [replayReason, setReplayReason] = useState<string>("");
  const replayChunksRef = useRef<Blob[]>([]);
  const phantomRecorderRef = useRef<MediaRecorder | null>(null);
  const lastAlertTimeRef = useRef<number>(0);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const liveClientRef = useRef<LazarusLiveClient | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const wsRecorderRef = useRef<MediaRecorder | null>(null);
  
  // Reconnect Logic Refs
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isIntentionalStop = useRef(false);

  const startSequence = async () => {
    setIsBooting(true);
    isIntentionalStop.current = false;
    // Fake boot delay for dramatic effect
    await new Promise(r => setTimeout(r, 1500));
    await startStream();
    setIsBooting(false);
  };

  // Initialize Media Stream
  const startStream = async () => {
    if (!process.env.API_KEY && mode === 'LIVE_CLIENT') {
        window.alert("Please provide an API Key first (Mocking enabled for now)");
        setAlert(DEMO_ALERT);
        setIsStarted(true);
        setIsConnected(true);
        return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { width: 640, height: 480 }, 
        audio: { 
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
        }
      });
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }

      setIsStarted(true);

      // Start the Phantom Recorder (Rolling Buffer)
      startPhantomBuffer(stream);

      if (mode === 'LIVE_CLIENT') {
        await startLiveClient(stream);
      } else {
        startWebSocketServer(stream);
      }

    } catch (err) {
      console.error("Error accessing media devices:", err);
      setIsBooting(false);
    }
  };

  const startPhantomBuffer = (stream: MediaStream) => {
    // Record in 1-second chunks to build a rolling buffer
    const rec = new MediaRecorder(stream, { mimeType: 'video/webm' });
    
    rec.ondataavailable = (e) => {
        if (e.data.size > 0) {
            replayChunksRef.current.push(e.data);
            // Keep last 5 seconds (approx 5 chunks)
            if (replayChunksRef.current.length > 5) {
                replayChunksRef.current.shift();
            }
        }
    };
    rec.start(1000); 
    phantomRecorderRef.current = rec;
  };

  const triggerPhantomReplay = (currentAlert: MedicalAlert) => {
     // Don't trigger if we just triggered one (debounce 10s)
     if (Date.now() - lastAlertTimeRef.current < 10000) return;
     lastAlertTimeRef.current = Date.now();

     if (replayChunksRef.current.length > 0) {
         const blob = new Blob(replayChunksRef.current, { type: 'video/webm' });
         const url = URL.createObjectURL(blob);
         setReplayUrl(url);
         setReplayReason(`${currentAlert.diagnosis}: ${currentAlert.symptoms.join(', ')}`);
     }
  };

  const startLiveClient = async (stream: MediaStream) => {
    if (liveClientRef.current) {
        liveClientRef.current.disconnect();
    }

    const client = new LazarusLiveClient(
        (newAlert) => {
            setAlert(newAlert);
            if (newAlert.status === DiagnosisStatus.CRITICAL) {
                triggerPhantomReplay(newAlert);
            }
        },
        (connected) => {
            setIsConnected(connected);
            if (!connected && !isIntentionalStop.current) {
                console.warn("Live Client disconnected unexpectedly. Attempting reconnect...");
                scheduleReconnect(stream, 'LIVE_CLIENT');
            }
        }
    );

    try {
        await client.connect();
        await client.startAudioStream(stream);
        liveClientRef.current = client;
    } catch (e) {
        console.error("Failed to connect Live Client", e);
        setIsConnected(false);
        scheduleReconnect(stream, 'LIVE_CLIENT');
    }
  };

  const startWebSocketServer = (stream: MediaStream) => {
    // 1. Determine correct WebSocket URL for deployment
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.hostname === 'localhost' ? 'localhost:8000' : window.location.host;
    const wsUrl = `${protocol}//${host}/ws`;

    console.log("Connecting to Backend:", wsUrl);
    
    if (wsRef.current) {
        wsRef.current.close();
    }
    
    // Stop previous audio recorder if it exists to prevent memory leaks
    if (wsRecorderRef.current && wsRecorderRef.current.state !== 'inactive') {
        wsRecorderRef.current.stop();
    }

    const ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
        console.log("Connected to Python Lazarus Backend");
        setIsConnected(true);
    };

    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            setAlert(data);
            if (data.status === DiagnosisStatus.CRITICAL) {
                triggerPhantomReplay(data);
            }
        } catch (e) {
            console.error("Failed to parse backend message", e);
        }
    };
    
    ws.onclose = () => {
        setIsConnected(false);
        console.log("WebSocket Disconnected");
        if (!isIntentionalStop.current) {
             scheduleReconnect(stream, 'WEBSOCKET_SERVER');
        }
    };

    ws.onerror = (e) => {
        console.error("WebSocket Error:", e);
    };
    
    wsRef.current = ws;

    // 2. Audio Handling
    try {
        const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
        mediaRecorder.ondataavailable = async (e) => {
            if (ws.readyState === WebSocket.OPEN && e.data.size > 0) {
                const buffer = await e.data.arrayBuffer();
                ws.send(buffer); 
            }
        };
        mediaRecorder.start(250);
        wsRecorderRef.current = mediaRecorder;
    } catch (e) {
        console.error("MediaRecorder Error", e);
    }
  };

  const scheduleReconnect = (stream: MediaStream, currentMode: 'LIVE_CLIENT' | 'WEBSOCKET_SERVER') => {
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      
      reconnectTimeoutRef.current = setTimeout(() => {
          console.log("Reconnecting...");
          if (currentMode === 'LIVE_CLIENT') {
              startLiveClient(stream);
          } else {
              startWebSocketServer(stream);
          }
      }, 3000); // Retry every 3 seconds
  };

  // Video Loop Effect
  useEffect(() => {
      const interval = setInterval(() => {
          if (!isConnected) return;
          
          if (mode === 'LIVE_CLIENT') {
             captureAndSendFrameLive();
          } else {
             captureAndSendFrameWS();
          }
      }, 200);
      return () => clearInterval(interval);
  }, [isConnected, mode]);

  const captureAndSendFrameLive = () => {
    const base64 = getFrameBase64();
    if (base64 && liveClientRef.current) {
        const data = base64.split(',')[1];
        liveClientRef.current.sendVideoFrame(data);
    }
  };

  const captureAndSendFrameWS = () => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
          const frame = getFrameBase64();
          if (frame) {
              ws.send(JSON.stringify({ type: 'video', data: frame }));
          }
      }
  };

  const getFrameBase64 = (): string | null => {
      if (!videoRef.current || !canvasRef.current) return null;
      const ctx = canvasRef.current.getContext('2d');
      if (!ctx) return null;
      
      canvasRef.current.width = videoRef.current.videoWidth;
      canvasRef.current.height = videoRef.current.videoHeight;
      ctx.drawImage(videoRef.current, 0, 0);
      return canvasRef.current.toDataURL('image/jpeg', 0.5);
  };

  useEffect(() => {
    if (!process.env.API_KEY && (window as any).aistudio) {
        (window as any).aistudio.hasSelectedApiKey().then((hasKey: boolean) => {
            if(!hasKey && isStarted) {
                (window as any).aistudio.openSelectKey();
            }
        });
    }
  }, [isStarted]);

  return (
    <div className="relative w-full h-screen bg-black flex flex-col items-center justify-center overflow-hidden">
      <div className="scan-line"></div>
      
      {/* Video Background */}
      <video 
        ref={videoRef} 
        className="absolute inset-0 w-full h-full object-cover opacity-60 grayscale contrast-125" 
        muted 
        playsInline
      />
      
      {/* Hidden Canvas for processing */}
      <canvas ref={canvasRef} className="hidden" />

      {/* HUD Layer */}
      <HudOverlay alert={alert} isConnected={isConnected} mode={mode} />

      {/* Phantom Replay Popup */}
      <PhantomReplay 
         videoUrl={replayUrl} 
         reason={replayReason} 
         onClose={() => setReplayUrl(null)} 
      />

      {/* Booting Overlay */}
      {isBooting && (
          <div className="absolute inset-0 bg-black/90 z-[60] flex flex-col items-center justify-center text-[#00ff41] font-mono">
              <div className="text-4xl font-bold animate-pulse mb-4">INITIALIZING SYSTEM</div>
              <div className="w-64 h-2 bg-gray-800 rounded">
                  <div className="h-full bg-[#00ff41] animate-[width_1.5s_ease-in-out_forwards]" style={{width: '100%'}}></div>
              </div>
              <div className="mt-2 text-xs">ESTABLISHING NEURAL LINK...</div>
          </div>
      )}

      {/* Controls */}
      {!isStarted && !isBooting && (
        <div className="z-50 flex flex-col gap-4 items-center bg-black/90 p-8 border border-[#00ff41] rounded shadow-[0_0_50px_rgba(0,255,65,0.2)] backdrop-blur-md">
          <h1 className="text-6xl font-black tracking-widest text-[#00ff41] drop-shadow-[0_0_10px_#00ff41]">LAZARUS</h1>
          <p className="text-[#00ff41]/70 text-sm tracking-[0.5em] mb-4">GUARDIAN ANGEL V3.0</p>
          
          <div className="flex flex-col gap-2 w-full">
            <label className="text-xs text-[#00ff41] tracking-widest">ENGINE SELECTION</label>
            <div className="flex gap-2">
                <button 
                    onClick={() => setMode('LIVE_CLIENT')}
                    className={`flex-1 p-3 text-xs font-bold border transition-all ${mode === 'LIVE_CLIENT' ? 'bg-[#00ff41] text-black shadow-[0_0_20px_#00ff41]' : 'text-[#00ff41] border-[#00ff41] hover:bg-[#00ff41]/10'}`}
                >
                    LIVE API CLIENT
                </button>
                <button 
                    onClick={() => setMode('WEBSOCKET_SERVER')}
                    className={`flex-1 p-3 text-xs font-bold border transition-all ${mode === 'WEBSOCKET_SERVER' ? 'bg-[#00ff41] text-black shadow-[0_0_20px_#00ff41]' : 'text-[#00ff41] border-[#00ff41] hover:bg-[#00ff41]/10'}`}
                >
                    PYTHON BACKEND
                </button>
            </div>
          </div>

          {!process.env.API_KEY && mode === 'LIVE_CLIENT' && (
             <div className="text-red-500 text-xs border border-red-900 bg-red-900/20 p-2 w-full text-center">API_KEY REQUIRED FOR CLIENT MODE</div>
          )}
          
          <button 
            onClick={startSequence}
            className="w-full py-4 mt-4 bg-[#00ff41] text-black font-black tracking-widest hover:bg-white hover:text-black transition-all duration-300 shadow-[0_0_20px_rgba(0,255,65,0.4)]"
          >
            ACTIVATE SYSTEM
          </button>
        </div>
      )}
    </div>
  );
}

export default App;