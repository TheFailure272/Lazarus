import os
import json
import asyncio
import base64
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import google.generativeai as genai

# --- CONFIGURATION ---
API_KEY = os.getenv("API_KEY")
if not API_KEY:
    print("WARNING: API_KEY not set in environment.")

genai.configure(api_key=API_KEY)

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- SYSTEM PROMPT ---
LAZARUS_SYSTEM_PROMPT = """
You are LAZARUS, a medical AI guardian for 911 operators.
Input: Audio stream (call) + Video stream (caller).
Task: Detect Stroke, Cardiac Arrest, or Shock immediately.

Criteria:
- STROKE: Unilateral facial droop, asymmetry, slurred speech.
- CARDIAC ARREST: Agonal breathing (gasping), unresponsiveness.
- SHOCK: Pale/blue skin (cyanosis), confusion, rapid breathing.

*** RHYTHM OF LIFE PROTOCOL (CPR ASSIST) ***
If Status is CARDIAC ARREST:
1. Listen intently for rhythmic compression sounds (thumping/grunting).
2. Estimate the BPM of the compressions.
3. If < 100 BPM, set "cpr_feedback" to "INSTRUCT: PUSH FASTER".
4. If > 120 BPM, set "cpr_feedback" to "INSTRUCT: PUSH SLOWER".
5. If ~100-120 BPM, set "cpr_feedback" to "GOOD RHYTHM".
6. If no compressions heard, set "cpr_feedback" to "INSTRUCT: START CPR NOW".

Output format: JSON only. No markdown.
{
  "status": "NORMAL" | "WARNING" | "CRITICAL",
  "diagnosis": "string",
  "confidence": 0.0-1.0,
  "symptoms": ["list", "of", "symptoms"],
  "cpr_feedback": "string" (Optional, only if Cardiac Arrest)
}
"""

# --- HELPER CLASSES ---

class JsonStreamBuffer:
    """Accumulates text chunks and extracts valid JSON objects."""
    def __init__(self):
        self.buffer = ""

    def process(self, chunk_text):
        self.buffer += chunk_text
        results = []
        
        while True:
            start = self.buffer.find('{')
            if start == -1:
                # Keep a small tail to avoid cutting off a start brace that hasn't arrived
                if len(self.buffer) > 2000: 
                    self.buffer = self.buffer[-200:]
                break
            
            brace_count = 0
            end = -1
            in_string = False
            escape = False
            
            for i in range(start, len(self.buffer)):
                char = self.buffer[i]
                if in_string:
                    if char == '\\' and not escape:
                        escape = True
                    elif char == '"' and not escape:
                        in_string = False
                    else:
                        escape = False
                else:
                    if char == '"':
                        in_string = True
                    elif char == '{':
                        brace_count += 1
                    elif char == '}':
                        brace_count -= 1
                        if brace_count == 0:
                            end = i
                            break
            
            if end != -1:
                json_str = self.buffer[start:end+1]
                self.buffer = self.buffer[end+1:]
                try:
                    clean_str = json_str.replace('\n', '')
                    obj = json.loads(clean_str)
                    results.append(obj)
                except json.JSONDecodeError:
                    continue
            else:
                break
        return results

# --- WEBSOCKET ENDPOINT ---

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    print("Client connected - Initializing Lazarus Core")

    # Initialize Gemini Chat Session
    model = genai.GenerativeModel(
        model_name="gemini-3-pro-preview",
        system_instruction=LAZARUS_SYSTEM_PROMPT
    )
    chat = model.start_chat(history=[])
    json_buffer = JsonStreamBuffer()
    
    # Queue for decoupling WebSocket receiving (fast) from Gemini processing (slower)
    processing_queue = asyncio.Queue(maxsize=20) 

    # --- CONSUMER TASK (The Brain) ---
    async def ai_processor():
        while True:
            try:
                # Get data from queue
                item = await processing_queue.get()
                
                # Construct Gemini Input
                gemini_content = []
                if item["type"] == "audio":
                    gemini_content.append({"mime_type": "audio/webm", "data": item["data"]})
                elif item["type"] == "video":
                    image_bytes = base64.b64decode(item["data"])
                    gemini_content.append({"mime_type": "image/jpeg", "data": image_bytes})

                # Send to Gemini (Streaming)
                if gemini_content:
                    try:
                        response_stream = await chat.send_message_async(gemini_content, stream=True)
                        async for chunk in response_stream:
                            if chunk.text:
                                alerts = json_buffer.process(chunk.text)
                                for alert in alerts:
                                    await websocket.send_json(alert)
                    except Exception as e:
                        print(f"Gemini API Error: {e}")

                processing_queue.task_done()
                
            except asyncio.CancelledError:
                print("Processor task cancelled")
                break
            except Exception as e:
                print(f"AI Loop Error: {e}")
                processing_queue.task_done()

    processor_task = asyncio.create_task(ai_processor())

    # --- PRODUCER LOOP (The Ears/Eyes) ---
    try:
        while True:
            message = await websocket.receive()
            
            # CRITICAL FIX: Python uses None, not null
            payload = None
            
            if "bytes" in message:
                payload = {"type": "audio", "data": message["bytes"]}
            elif "text" in message:
                try:
                    data = json.loads(message["text"])
                    if data.get("type") == "video":
                        payload = {"type": "video", "data": data["data"]}
                except:
                    pass

            if payload:
                try:
                    # Non-blocking put to maintain real-time input stream
                    if not processing_queue.full():
                        processing_queue.put_nowait(payload)
                    else:
                        # Dropping frames strategy: 
                        # If video, drop it. If audio, try to squeeze it in if possible, 
                        # but avoiding blocking is priority for WebSocket health.
                        if payload["type"] == "audio":
                            # Try to pop oldest item to make space for audio (audio is king)
                            try:
                                processing_queue.get_nowait()
                                processing_queue.put_nowait(payload)
                            except:
                                pass
                except asyncio.QueueFull:
                    pass

    except WebSocketDisconnect:
        print("Client disconnected")
    except Exception as e:
        print(f"WebSocket Error: {e}")
    finally:
        print("Cleaning up resources...")
        processor_task.cancel()
        try:
            await processor_task
        except asyncio.CancelledError:
            pass

if __name__ == "__main__":
    import uvicorn
    # Listen on all interfaces for deployment
    uvicorn.run(app, host="0.0.0.0", port=8000)
