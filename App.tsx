import React, { useEffect, useRef, useState } from 'react';
import HudOverlay from './components/HudOverlay';
import PhantomReplay from './components/PhantomReplay';
import { LazarusLiveClient } from './services/liveClient';
import { MedicalAlert, DiagnosisStatus } from './types';

// Mock Alert for demo purposes if API key is missing
const DEMO_ALERT: MedicalAlert = {
  id: "demo-1",
  status: DiagnosisStatus.CRITICAL,
  diagnosis: "POSSIBLE STROKE",
  confidence: 0.89,
  symptoms: ["Left-side facial droop", "Slurred speech"],
  timestamp: Date.now()
};

function App() {
  const [isStarted, setIsStarted] = useState(false);
  const [isBooting, setIsBooting] = useState(false);
  // Connection status tracks the ACTUAL active link
  const [isConnected, setIsConnected] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  
  // App State
  const [alert, setAlert] = useState<MedicalAlert | null>(null);
  const [history, setHistory] = useState<MedicalAlert[]>([]);
  const [mode, setMode] = useState<'LIVE_CLIENT' | 'WEBSOCKET_SERVER' | 'SIMULATION'>('LIVE_CLIENT');
  
  // Phantom Replay State
  const [replayUrl, setReplayUrl] = useState<string | null>(null);
  const [replayReason, setReplayReason] = useState<string>("");
  const replayChunksRef = useRef<Blob[]>([]);
  const phantomRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingMimeTypeRef = useRef<string>(""); // Store the actual mime type used
  const lastAlertTimeRef = useRef<number>(0);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const liveClientRef = useRef<LazarusLiveClient | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const wsRecorderRef = useRef<MediaRecorder | null>(null);
  
  // Audio Analysis
  const [audioAnalyser, setAudioAnalyser] = useState<AnalyserNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  
  // Reconnect Logic Refs
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isIntentionalStop = useRef(false);

  const startSequence = async (forceSimulation = false) => {
    setIsBooting(true);
    isIntentionalStop.current = false;
    // Fake boot delay for dramatic effect
    await new Promise(r => setTimeout(r, 1500));
    await startStream(forceSimulation);
    setIsBooting(false);
  };

  const handleNewAlert = (newAlert: MedicalAlert) => {
      // Add unique ID
      const alertWithId = { ...newAlert, id: crypto.randomUUID() };
      setAlert(alertWithId);
      
      // Update history (Keep last 10 events)
      setHistory(prev => {
          // Avoid duplicate entries if diagnosis is same and timestamp is close (< 2 sec)
          const last = prev[prev.length - 1];
          if (last && last.diagnosis === newAlert.diagnosis && (newAlert.timestamp - last.timestamp < 2000)) {
              return prev;
          }
          const updated = [...prev, alertWithId];
          if (updated.length > 10) updated.shift();
          return updated;
      });

      if (newAlert.status === DiagnosisStatus.CRITICAL) {
          triggerPhantomReplay(alertWithId);
      }
  };

  // Create a synthetic stream if hardware access fails
  const createMockStream = () => {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 480;
    const ctx = canvas.getContext('2d');
    
    // Start a visual noise loop
    if (ctx) {
        setInterval(() => {
            ctx.fillStyle = '#050505';
            ctx.fillRect(0, 0, 640, 480);
            
            // Grid
            ctx.strokeStyle = '#003300';
            ctx.lineWidth = 1;
            for(let i=0; i<640; i+=40) { ctx.beginPath(); ctx.moveTo(i,0); ctx.lineTo(i,480); ctx.stroke(); }
            for(let i=0; i<480; i+=40) { ctx.beginPath(); ctx.moveTo(0,i); ctx.lineTo(640,i); ctx.stroke(); }

            // Noise
            for(let i=0; i<100; i++) {
                ctx.fillStyle = `rgba(0, 255, 65, ${Math.random() * 0.3})`;
                ctx.fillRect(Math.random() * 640, Math.random() * 480, 2, 2);
            }
            
            ctx.fillStyle = '#00ff41';
            ctx.font = '20px monospace';
            ctx.fillText("NO CAMERA SIGNAL / SIMULATION MODE", 140, 240);
        }, 100);
    }
    
    const stream = canvas.captureStream(30);
    
    // Add silent audio track to prevent WebAudio crashes
    try {
        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const dest = audioCtx.createMediaStreamDestination();
        const osc = audioCtx.createOscillator();
        osc.connect(dest);
        osc.frequency.value = 0; // Silent
        osc.start();
        const audioTrack = dest.stream.getAudioTracks()[0];
        stream.addTrack(audioTrack);
    } catch (e) {
        console.warn("Could not create mock audio track", e);
    }
    
    return stream;
  };

  // Initialize Media Stream
  const startStream = async (isSimulation: boolean) => {
    // Skip API check if we are running a simulation
    if (!process.env.API_KEY && mode === 'LIVE_CLIENT' && !isSimulation) {
        window.alert("Please provide an API Key first (Mocking enabled for now)");
        setAlert(DEMO_ALERT);
        setIsStarted(true);
        setIsConnected(true);
        return;
    }

    try {
      let stream: MediaStream | null = null;
      try {
        // Try with ideal constraints first
        stream = await navigator.mediaDevices.getUserMedia({ 
            video: { width: { ideal: 640 }, height: { ideal: 480 } }, 
            audio: { 
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }
        });
      } catch (err) {
        console.warn("Ideal constraints failed, attempting fallback to basic constraints:", err);
        try {
            // Fallback to basic constraints
            stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        } catch (err2) {
            console.warn("Basic constraints failed:", err2);
            // Final Fallback: Mock Stream
            console.log("Activating Mock Stream for Fallback");
            stream = createMockStream();
            setConnectionError("USING MOCK STREAM (CAMERA FAILED)");
        }
      }
      
      if (!stream) {
          throw new Error("Failed to initialize any media stream");
      }

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(e => console.error("Video play failed", e));
      }

      // --- SETUP AUDIO ANALYSIS ---
      try {
        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        setAudioAnalyser(analyser);
        audioContextRef.current = audioCtx;
      } catch (e) {
          console.warn("Audio Analysis Setup Failed", e);
      }

      setIsStarted(true);

      // Start the Phantom Recorder (Rolling Buffer)
      startPhantomBuffer(stream);

      if (isSimulation) {
        runSimulationScript();
      } else if (mode === 'LIVE_CLIENT') {
        await startLiveClient(stream);
      } else {
        startWebSocketServer(stream);
      }

    } catch (err: any) {
      console.error("Critical Error accessing media devices:", err);
      setConnectionError(`SYSTEM FAILURE: ${err.message || "Unknown"}`);
      setIsBooting(false);
    }
  };

  const runSimulationScript = () => {
      console.log("Running Simulation Script...");
      setIsConnected(true);
      // Don't clear error if it's the mock stream warning
      setConnectionError(prev => prev?.includes("MOCK") ? prev : null);

      const scenarios = [
          { 
              delay: 1000, 
              alert: { status: DiagnosisStatus.NORMAL, diagnosis: "VITALS STABLE", confidence: 0.98, symptoms: ["Speech clear", "Gaze steady"], timestamp: Date.now() } 
          },
          { 
              delay: 6000, 
              alert: { status: DiagnosisStatus.WARNING, diagnosis: "ANOMALY DETECTED", confidence: 0.72, symptoms: ["Mild dysarthria", "Delayed responsiveness"], timestamp: Date.now() } 
          },
          { 
              delay: 12000, 
              alert: { status: DiagnosisStatus.CRITICAL, diagnosis: "ACUTE STROKE DETECTED", confidence: 0.94, symptoms: ["Left-side facial droop", "Slurred speech (Grade 3)", "Motor asymmetry"], timestamp: Date.now() } 
          }
      ];

      scenarios.forEach(step => {
          setTimeout(() => {
              handleNewAlert(step.alert);
          }, step.delay);
      });
  };

  const startPhantomBuffer = (stream: MediaStream) => {
    try {
        // Dynamic MIME type detection for cross-browser compatibility
        let mimeType = '';
        if (MediaRecorder.isTypeSupported('video/webm;codecs=vp9')) {
            mimeType = 'video/webm;codecs=vp9';
        } else if (MediaRecorder.isTypeSupported('video/webm')) {
            mimeType = 'video/webm';
        } else if (MediaRecorder.isTypeSupported('video/mp4')) {
            mimeType = 'video/mp4';
        }
        // If mimeType is empty, MediaRecorder will use browser default
        
        const options = mimeType ? { mimeType } : undefined;
        const rec = new MediaRecorder(stream, options);
        
        // Save the actual mime type determined by the browser to use for playback
        recordingMimeTypeRef.current = rec.mimeType;
        
        console.log(`Phantom Recorder started with MIME: ${rec.mimeType}`);

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
    } catch (e) {
        console.error("Phantom Recorder failed to start:", e);
    }
  };

  const triggerPhantomReplay = (currentAlert: MedicalAlert) => {
     // Don't trigger if we just triggered one (debounce 10s)
     if (Date.now() - lastAlertTimeRef.current < 10000) return;
     lastAlertTimeRef.current = Date.now();

     // Use a slight timeout to ensure the buffer captures the event "in context"
     setTimeout(() => {
        if (replayChunksRef.current.length > 0) {
            if (replayUrl) {
                URL.revokeObjectURL(replayUrl);
            }

            // Create blob using the exact mime type we recorded with
            const blob = new Blob(replayChunksRef.current, { 
                type: recordingMimeTypeRef.current || 'video/webm' 
            });
            
            const url = URL.createObjectURL(blob);
            setReplayUrl(url);
            setReplayReason(`${currentAlert.diagnosis}: ${currentAlert.symptoms.join(', ')}`);
        }
     }, 500);
  };

  const handleCloseReplay = () => {
      if (replayUrl) {
          URL.revokeObjectURL(replayUrl);
          setReplayUrl(null);
      }
  };

  const startLiveClient = async (stream: MediaStream) => {
    if (liveClientRef.current) {
        liveClientRef.current.disconnect();
    }
    setConnectionError(null);

    const client = new LazarusLiveClient(
        (newAlert) => {
            handleNewAlert(newAlert);
        },
        (connected, error) => {
            setIsConnected(connected);
            if (error) {
                setConnectionError(error);
                console.warn("Lazarus Connection Issue:", error);
            }
            
            // Only retry if we are not connected and didn't mean to stop
            if (!connected && !isIntentionalStop.current) {
                scheduleReconnect(stream, 'LIVE_CLIENT');
            }
        }
    );

    try {
        await client.connect();
        await client.startAudioStream(stream);
        liveClientRef.current = client;
    } catch (e: any) {
        console.error("Failed to connect Live Client", e);
        setIsConnected(false);
        setConnectionError(e.message || "Init Failed");
        scheduleReconnect(stream, 'LIVE_CLIENT');
    }
  };

  const startWebSocketServer = (stream: MediaStream) => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.hostname === 'localhost' ? 'localhost:8000' : window.location.host;
    const wsUrl = `${protocol}//${host}/ws`;

    console.log("Connecting to Backend:", wsUrl);
    setConnectionError(null);
    
    if (wsRef.current) {
        wsRef.current.close();
    }
    
    if (wsRecorderRef.current && wsRecorderRef.current.state !== 'inactive') {
        wsRecorderRef.current.stop();
    }

    const ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
        console.log("Connected to Python Lazarus Backend");
        setIsConnected(true);
        setConnectionError(null);
    };

    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            handleNewAlert(data);
        } catch (e) {
            console.error("Failed to parse backend message", e);
        }
    };
    
    ws.onclose = (event) => {
        setIsConnected(false);
        if (!event.wasClean) {
             setConnectionError(`WS Disconnected (Code: ${event.code})`);
        }
        if (!isIntentionalStop.current) {
             scheduleReconnect(stream, 'WEBSOCKET_SERVER');
        }
    };

    ws.onerror = (e) => {
        console.error("WebSocket Error (See Network Tab)");
        setConnectionError("WebSocket Connection Error");
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
    // Only send if we have a valid client reference AND session
    if (liveClientRef.current) {
        const base64 = getFrameBase64();
        if (base64) {
            const data = base64.split(',')[1];
            liveClientRef.current.sendVideoFrame(data);
        }
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
      
      <video 
        ref={videoRef} 
        className="absolute inset-0 w-full h-full object-cover opacity-60 grayscale contrast-125" 
        muted 
        playsInline
      />
      
      <canvas ref={canvasRef} className="hidden" />

      {/* Pass history and analyser to HUD */}
      <HudOverlay 
        alert={alert} 
        history={history}
        isConnected={isConnected} 
        mode={mode} 
        error={connectionError} 
        audioAnalyser={audioAnalyser}
      />

      <PhantomReplay 
         videoUrl={replayUrl} 
         reason={replayReason} 
         onClose={handleCloseReplay} 
      />

      {isBooting && (
          <div className="absolute inset-0 bg-black/90 z-[60] flex flex-col items-center justify-center text-[#00ff41] font-mono">
              <div className="text-4xl font-bold animate-pulse mb-4">INITIALIZING SYSTEM</div>
              <div className="w-64 h-2 bg-gray-800 rounded">
                  <div className="h-full bg-[#00ff41] animate-[width_1.5s_ease-in-out_forwards]" style={{width: '100%'}}></div>
              </div>
              <div className="mt-2 text-xs">ESTABLISHING NEURAL LINK...</div>
          </div>
      )}

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
          
          <div className="flex flex-col gap-2 w-full mt-4">
             <button 
                onClick={() => startSequence(false)}
                className="w-full py-4 bg-[#00ff41] text-black font-black tracking-widest hover:bg-white hover:text-black transition-all duration-300 shadow-[0_0_20px_rgba(0,255,65,0.4)]"
            >
                ACTIVATE SYSTEM
            </button>
            <button 
                onClick={() => { setMode('SIMULATION'); startSequence(true); }}
                className="w-full py-2 bg-transparent border border-[#00ff41]/50 text-[#00ff41]/50 font-bold tracking-widest hover:bg-[#00ff41]/10 hover:text-[#00ff41] text-xs transition-all"
            >
                RUN SIMULATION (DEMO)
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;