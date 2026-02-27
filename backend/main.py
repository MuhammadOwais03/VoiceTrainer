from fastapi import FastAPI, WebSocket
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

# Fake processing – replace with real ML/LLM
def fake_process_sensor(data: dict) -> str:
    if "accelerometer" in data:
        z = float(data["accelerometer"]["z"])
        if z > 10:
            return "Whoa! That's a strong upward force!"
        elif z < 9:
            return "Looks like free fall or tilting down."
        else:
            return f"Stable – acceleration z ≈ {z:.2f} m/s²"
    return "Got sensor data"

def fake_process_text(text: str) -> str:
    text = text.lower()
    if "acceleration" in text:
        return "The device is experiencing normal gravity (~9.81 m/s²) with small movements."
    if "gyroscope" in text:
        return "Gyro values are showing gentle rotation – nothing dramatic."
    return f"You said: '{text}'. How can I help?"

@app.websocket("/ws/sensor")
async def sensor_endpoint(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            data = await websocket.receive_json()
            print("Received sensor data:", data)
            response_text = fake_process_sensor(data)
            await websocket.send_json({"response": response_text})
            await asyncio.sleep(0.1)  # prevent tight loop
    except Exception as e:
        print("WS closed:", e)

@app.post("/process_speech")
async def process_speech(body: dict):
    text = body.get("input_text", "")
    print("Received text:", text)
    if not text:
        return {"response": "Didn't catch that."}
    reply = fake_process_text(text)
    return {"response": reply}