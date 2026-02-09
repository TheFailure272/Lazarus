import { GoogleGenAI, LiveServerMessage, Modality, Type, FunctionDeclaration } from '@google/genai';
import { DiagnosisStatus, MedicalAlert } from '../types';

// Tool Definition for structured output
const REPORT_TOOL: FunctionDeclaration = {
  name: "report_medical_status",
  description: "Report the current medical status and diagnosis based on the patient's condition.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      status: { 
        type: Type.STRING, 
        enum: ["NORMAL", "WARNING", "CRITICAL"],
        description: "The triage status of the patient."
      },
      diagnosis: { 
        type: Type.STRING,
        description: "The specific medical diagnosis (e.g., Stroke, Cardiac Arrest)."
      },
      confidence: { 
        type: Type.NUMBER,
        description: "Confidence score between 0.0 and 1.0."
      },
      symptoms: { 
        type: Type.ARRAY, 
        items: { type: Type.STRING },
        description: "List of observed symptoms."
      },
      cpr_feedback: { 
        type: Type.STRING,
        description: "CPR instructions if applicable (e.g., PUSH FASTER)."
      }
    },
    required: ["status", "diagnosis", "confidence", "symptoms"]
  }
};

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
- You must use the 'report_medical_status' tool to report your findings.
- Report immediately when a condition is detected or changes.
- Do NOT speak. Only use the tool.
`;

export class LazarusLiveClient {
  private ai: GoogleGenAI;
  private session: any = null;
  public onAlert: (alert: MedicalAlert) => void;
  public onConnectionChange: (isConnected: boolean, error?: string) => void;
  private audioContext: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;

  constructor(
      onAlert: (alert: MedicalAlert) => void,
      onConnectionChange: (isConnected: boolean, error?: string) => void
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
            responseModalities: [Modality.AUDIO], 
            tools: [{ functionDeclarations: [REPORT_TOOL] }],
        },
        callbacks: {
            onopen: () => {
                console.log("Lazarus Core: Connected");
                this.onConnectionChange(true);
            },
            onmessage: (msg: LiveServerMessage) => this.handleMessage(msg),
            onclose: (event) => {
                console.log("Lazarus Core: Disconnected", event);
                this.onConnectionChange(false, "Connection Closed");
            },
            onerror: (err) => {
                console.error("Lazarus Core Error:", err);
                this.onConnectionChange(false, err.message || "Unknown Error");
            },
        }
        });
        return this.session;
    } catch (e: any) {
        console.error("Failed to connect:", e);
        this.onConnectionChange(false, e.message || "Connection Failed");
        throw e;
    }
  }

  private handleMessage(message: LiveServerMessage) {
    // Handle Tool Calls (Structured Data)
    if (message.toolCall) {
        const responses = message.toolCall.functionCalls.map(fc => {
            if (fc.name === 'report_medical_status') {
                try {
                    const args = fc.args as any;
                    this.onAlert({
                        status: args.status as DiagnosisStatus,
                        diagnosis: args.diagnosis,
                        confidence: args.confidence,
                        symptoms: args.symptoms,
                        cpr_feedback: args.cpr_feedback,
                        timestamp: Date.now()
                    });
                } catch (e) {
                    console.error("Error parsing tool args", e);
                }
            }
            // Gemini requires a response to tool calls
            return {
                id: fc.id,
                name: fc.name,
                response: { result: "ok" }
            };
        });

        // Send confirmation back to model so it continues monitoring
        if (this.session) {
            this.session.sendToolResponse({
                functionResponses: responses
            }).catch((e: any) => console.error("Failed to send tool response", e));
        }
    }
  }

  async startAudioStream(stream: MediaStream) {
    this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
    
    if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
    }

    this.source = this.audioContext.createMediaStreamSource(stream);
    this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);

    this.processor.onaudioprocess = (e) => {
      if (!this.session) return;

      const inputData = e.inputBuffer.getChannelData(0);
      const data16 = this.floatTo16BitPCM(inputData);
      
      try {
         this.session.sendRealtimeInput({
            media: {
                mimeType: "audio/pcm;rate=16000",
                data: this.base64Encode(data16)
            }
         });
      } catch (err) {
          console.error("Error sending audio chunk", err);
      }
    };

    this.source.connect(this.processor);
    this.processor.connect(this.audioContext.destination);
  }

  sendVideoFrame(base64Data: string) {
    if (this.session) {
      try {
        this.session.sendRealtimeInput({
            media: {
            mimeType: "image/jpeg",
            data: base64Data
            }
        });
      } catch (e) {
          console.error("Error sending video frame", e);
      }
    }
  }

  disconnect() {
    // Prevent onclose callback from triggering a "Connection Closed" error state 
    // when we disconnect intentionally.
    if (this.session) {
        // We set session to null first so callbacks know to ignore
        const tempSession = this.session;
        this.session = null; 
        try {
            tempSession.close();
        } catch(e) { /* ignore close errors */ }
    }

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