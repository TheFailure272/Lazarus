# LAZARUS - AI Medical Guardian (V3.0)

**Lazarus** is a real-time, multimodal AI system designed to assist 911 operators and first responders. It analyzes live audio and video streams to detect life-threatening medical emergencies such as Stroke, Cardiac Arrest, and Shock with high precision.

## 🚀 Features

*   **Multimodal Analysis**: Simultaneously processes Audio (speech patterns, agonal breathing) and Video (facial asymmetry, skin pallor).
*   **Real-Time Diagnostics**:
    *   **Stroke**: Detects facial droop and slurred speech.
    *   **Cardiac Arrest**: Identifies agonal breathing and unresponsiveness.
    *   **Shock**: Monitors skin tone (cyanosis) and confusion.
*   **"Rhythm of Life" CPR Assist**: Uses the microphone to listen for CPR compressions, calculating BPM in real-time and providing audio feedback ("PUSH FASTER", "GOOD RHYTHM").
*   **Phantom Replay**: Automatically captures and loops the last 5 seconds of critical events for operator review (Evidence Mode).
*   **HUD Interface**: A tactical, "Share Tech Mono" styled overlay with:
    *   Real-time Audio Oscilloscope.
    *   Incident History Timeline.
    *   Voice Annunciator (Text-to-Speech) for hands-free alerts.

## 🛠️ Tech Stack

*   **Frontend**: React 19, Tailwind CSS, Canvas API.
*   **AI Core**: Google Gemini 2.5 Flash (Live API) & Gemini 3 Pro.
*   **Backend (Optional)**: Python FastAPI (for WebSocket fallback mode).
*   **Audio**: Web Audio API (Oscilloscope, Metronome).

## 📦 Setup & Installation

1.  **Clone the repository**:
    ```bash
    git clone https://github.com/TheFailure272/LAZARUS-FINAL.git
    cd LAZARUS-FINAL
    ```

2.  **Install Frontend Dependencies**:
    ```bash
    npm install
    ```

3.  **Run the Application**:
    ```bash
    npm run dev
    ```

4.  **API Key**:
    The application requires a Google Gemini API Key. It will prompt you to enter one via the AI Studio integration or looks for `process.env.API_KEY`.

## 🖥️ Modes of Operation

1.  **Live Client (Default)**: Connects directly to Google Gemini Live API from the browser via WebSockets. Lowest latency.
2.  **Simulation Mode**: Runs a pre-scripted scenario (Stroke detection) to demonstrate UI capabilities without a camera/mic.
3.  **Python Backend**: Connects to the local `server.py` (FastAPI) for server-side processing (requires running `python server.py`).

## ⚠️ Disclaimer
This software is a **prototype** demonstrating the capabilities of multimodal AI in emergency medicine. It is **not** an FDA-cleared medical device and should not be used as the sole basis for medical decisions.
