# from fastapi import FastAPI, WebSocket
# from fastapi.middleware.cors import CORSMiddleware
# import asyncio

# app = FastAPI()

# app.add_middleware(
#     CORSMiddleware,
#     allow_origins=["*"],
#     allow_credentials=True,
#     allow_methods=["*"],
#     allow_headers=["*"],
# )

# # Fake processing – replace with real ML/LLM
# def fake_process_sensor(data: dict) -> str:
#     if "accelerometer" in data:
#         z = float(data["accelerometer"]["z"])
#         if z > 10:
#             return "Whoa! That's a strong upward force!"
#         elif z < 9:
#             return "Looks like free fall or tilting down."
#         else:
#             return f"Stable – acceleration z ≈ {z:.2f} m/s²"
#     return "Got sensor data"

# def fake_process_text(text: str) -> str:
#     text = text.lower()
#     if "acceleration" in text:
#         return "The device is experiencing normal gravity (~9.81 m/s²) with small movements."
#     if "gyroscope" in text:
#         return "Gyro values are showing gentle rotation – nothing dramatic."
#     return f"You said: '{text}'. How can I help?"

# @app.websocket("/ws/sensor")
# async def sensor_endpoint(websocket: WebSocket):
#     await websocket.accept()
#     try:
#         while True:
#             data = await websocket.receive_json()
#             print("Received sensor data:", data)
#             response_text = fake_process_sensor(data)
#             await websocket.send_json({"response": response_text})
#             await asyncio.sleep(0.1)  # prevent tight loop
#     except Exception as e:
#         print("WS closed:", e)

# @app.post("/process_speech")
# async def process_speech(body: dict):
#     text = body.get("input_text", "")
#     print("Received text:", text)
#     if not text:
#         return {"response": "Didn't catch that."}
#     reply = fake_process_text(text)
#     return {"response": reply}

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import asyncio

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Fake processors (replace with real ML/LLM) ────────────────────────────────

def fake_process_sensor(data: dict) -> str | None:
    """Return a response string, or None if this sensor reading is unremarkable."""
    print("Enter")
    if "accelerometer" in data:
        print("Enter 1")
        z = float(data["accelerometer"]["z"])
        if z > 9:
            return "Whoa! That's a strong upward force!"
        elif z < 9:
            return "Looks like free fall or tilting down."
        # Return None for normal readings so we don't spam the user
        return None
    return None

def fake_process_speech(text: str) -> str:
    text = text.lower()
    if "acceleration" in text:
        return "The device is experiencing normal gravity (~9.81 m/s²) with small movements."
    if "gyroscope" in text:
        return "Gyro values are showing gentle rotation – nothing dramatic."
    return f"You said: '{text}'. How can I help?"


# ── Single WebSocket endpoint ──────────────────────────────────────────────────
# Message types from client:
#   { "type": "sensor", ...sensor fields... }   → sensor reading
#   { "type": "speech", "text": "..." }          → user spoke something
#
# Message types to client:
#   { "type": "sensor_response", "response": "..." }
#   { "type": "speech_response", "response": "..." }

@app.websocket("/ws")
async def unified_endpoint(websocket: WebSocket):
    await websocket.accept()
    print("Client connected")
    try:
        while True:
            data = await websocket.receive_json()
            print(data)
            msg_type = data.get("type", "")

            if msg_type == "sensor":
                response_text = fake_process_sensor(data)
                print(response_text)
                if response_text:                          # only send if noteworthy
                    await websocket.send_json({
                        "type":     "sensor_response",
                        "response": response_text,
                    })

            elif msg_type == "speech":
                text = data.get("text", "").strip()
                print("Speech received:", text)
                if not text:
                    await websocket.send_json({
                        "type":     "speech_response",
                        "response": "I didn't catch that.",
                    })
                else:
                    reply = fake_process_speech(text)
                    await websocket.send_json({
                        "type":     "speech_response",
                        "response": reply,
                    })

            else:
                print("Unknown message type:", msg_type)

            await asyncio.sleep(0.01)   # prevent tight loop

    except WebSocketDisconnect:
        print("Client disconnected")
    except Exception as e:
        print("WS error:", e)