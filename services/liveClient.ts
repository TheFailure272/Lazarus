import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { DiagnosisStatus, MedicalAlert } from '../types';

// The system prompt for Lazarus
const LAZARUS_SYSTEM_PROMPT = `
You are LAZARUS, a highly advanced medical AI guardian.
Your Input: A continuous stream of audio (from a 911 call) and video frames (of the caller).
Your Mission: Detect life-threatening medical emergencies in REAL-TIME.

Diagnostic Criteria (Strict):
1. STROKE: Unilateral facial droop OR asymmetry + Slurred speech.
2. CARDIAC_ARREST: Agonal breathing (gasping, snorting, labored) + Unresponsiveness/Unconscious.
3. SHOCK: Pale/Cyanotic skin tone + Confused speech OR Rapid breathing.

*** RHYTHM OF LIFE PROTOCOL (CPR ASSIST) ***
If Status is CARDIAC ARREST:
1. Listen intently for rhythmic compression sounds (thumping/grunting).
2. Estimate the BPM of the compressions.
3. If < 100 BPM, set "cpr_feedback" to "INSTRUCT: PUSH FASTER".
4. If > 120 BPM, set "cpr_feedback" to "INSTRUCT: PUSH SLOWER".
5. If ~100-120 BPM, set "cpr_feedback" to "GOOD RHYTHM".
6. If no compressions heard, set "cpr_feedback" to "INSTRUCT: START CPR NOW".

Output Rules:
- You must output a JSON object strictly. 
- Do NOT output markdown or plain text explanations outside the JSON.
- JSON Format:
  {
    "status": "NORMAL" | "WARNING" | "CRITICAL",
    "diagnosis": "Possible Stroke" | "Cardiac Arrest" | "Shock" | "Normal",
    "confidence": 0.0 to 1.0,
    "symptoms": ["facial droop", "slurred speech", "gasping"],
    "cpr_feedback": "INSTRUCT: PUSH FASTER"
  }
`;

export class LazarusLiveClient {
  private ai: GoogleGenAI;
  private session: any = null;
  public onAlert: (alert: MedicalAlert) => void;
  public onConnectionChange: (isConnected: boolean) => void;
  private audioContext: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private textBuffer: string = "";

  constructor(
      onAlert: (alert: MedicalAlert) => void,
      onConnectionChange: (isConnected: boolean) => void
  ) {
    this.ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    this.onAlert = onAlert;
    this.onConnectionChange = onConnectionChange;
  }

  async connect() {
    try {
        this.session = await this.ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        config: {
            systemInstruction: LAZARUS_SYSTEM_PROMPT,
            // CRITICAL: We want TEXT back (JSON), not Audio. 
            // If we ask for Audio, it will read the JSON syntax out loud.
            responseModalities: [Modality.TEXT], 
            speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } }
            },
        },
        callbacks: {
            onopen: () => {
                console.log("Lazarus Core: Connected");
                this.onConnectionChange(true);
            },
            onmessage: (msg: LiveServerMessage) => this.handleMessage(msg),
            onclose: () => {
                console.log("Lazarus Core: Disconnected");
                this.onConnectionChange(false);
            },
            onerror: (err) => {
                console.error("Lazarus Core Error:", err);
                this.onConnectionChange(false);
            },
        }
        });
        return this.session;
    } catch (e) {
        console.error("Failed to connect:", e);
        this.onConnectionChange(false);
        throw e;
    }
  }

  private handleMessage(message: LiveServerMessage) {
    // Accumulate transcription text
    const text = message.serverContent?.modelTurn?.parts?.[0]?.text;
    
    if (text) {
      this.textBuffer += text;
      this.tryParseBuffer();
    }
  }

  private tryParseBuffer() {
    let buffer = this.textBuffer;
    
    // Safety: prevent infinite memory growth if model goes rogue
    if (buffer.length > 5000) {
        buffer = buffer.slice(-2000);
    }

    // Try to find a complete JSON object: { ... }
    let startIndex = buffer.indexOf('{');
    while (startIndex !== -1) {
        let braceCount = 0;
        let endIndex = -1;
        let inString = false;
        let escaped = false;

        // Scan for matching closing brace
        for (let i = startIndex; i < buffer.length; i++) {
            const char = buffer[i];
            
            if (inString) {
                if (char === '\\' && !escaped) escaped = true;
                else if (char === '"' && !escaped) inString = false;
                else escaped = false;
            } else {
                if (char === '"') inString = true;
                else if (char === '{') braceCount++;
                else if (char === '}') {
                    braceCount--;
                    if (braceCount === 0) {
                        endIndex = i;
                        break;
                    }
                }
            }
        }

        if (endIndex !== -1) {
            // Extracted a potential JSON string
            const jsonStr = buffer.substring(startIndex, endIndex + 1);
            
            // Remove this chunk from the class buffer immediately
            this.textBuffer = buffer.substring(endIndex + 1);
            buffer = this.textBuffer; 

            try {
                // Clean markdown code blocks if present inside the chunk
                // Enhanced regex to kill 'json' label and backticks anywhere
                let cleanJson = jsonStr.replace(/```json/gi, "").replace(/```/g, "").trim();
                const parsed = JSON.parse(cleanJson);
                
                if (parsed && parsed.status) {
                    this.onAlert({
                        status: parsed.status as DiagnosisStatus,
                        diagnosis: parsed.diagnosis || "Unknown Diagnosis",
                        confidence: parsed.confidence || 0,
                        symptoms: parsed.symptoms || [],
                        cpr_feedback: parsed.cpr_feedback,
                        timestamp: Date.now()
                    });
                }
            } catch (e) {
                console.warn("Lazarus Core: JSON Parse failed on extracted chunk", e);
            }

            // Look for next object in remaining buffer
            startIndex = buffer.indexOf('{');
        } else {
            // No matching closing brace yet, wait for more data
            break;
        }
    }
    
    // Update the class buffer with whatever is left
    this.textBuffer = buffer;
  }

  async startAudioStream(stream: MediaStream) {
    this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
    
    // Resume context if suspended (browser autoplay policy)
    if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
    }

    this.source = this.audioContext.createMediaStreamSource(stream);
    this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);

    this.processor.onaudioprocess = (e) => {
      const inputData = e.inputBuffer.getChannelData(0);
      const data16 = this.floatTo16BitPCM(inputData);
      
      if (this.session) {
         // Using promise.then to avoid blocking the audio thread if send fails
         this.session.sendRealtimeInput({
            media: {
                mimeType: "audio/pcm;rate=16000",
                data: this.base64Encode(data16)
            }
         });
      }
    };

    this.source.connect(this.processor);
    this.processor.connect(this.audioContext.destination);
  }

  sendVideoFrame(base64Data: string) {
    if (this.session) {
      this.session.sendRealtimeInput({
        media: {
          mimeType: "image/jpeg",
          data: base64Data
        }
      });
    }
  }

  disconnect() {
    if (this.processor) {
        this.processor.disconnect();
        this.processor = null;
    }
    if (this.source) {
        this.source.disconnect();
        this.source = null;
    }
    if (this.audioContext) {
        this.audioContext.close();
        this.audioContext = null;
    }
    this.session = null;
    this.textBuffer = "";
    this.onConnectionChange(false);
  }

  private floatTo16BitPCM(input: Float32Array): Uint8Array {
    const output = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
        const s = Math.max(-1, Math.min(1, input[i]));
        output[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return new Uint8Array(output.buffer);
  }

  private base64Encode(bytes: Uint8Array) {
    let binary = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }
}