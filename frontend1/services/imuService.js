import { getSocket } from "./socketService";

let interval = null;

export const startIMUStreaming = () => {
  if (interval) return;

  console.log("IMU Streaming Started");

  interval = setInterval(() => {
    const fakeAngle = 30 + Math.random() * 100;
    const fakeAccel = Math.random() * 2;

    const socket = getSocket();

    if (socket?.connected) {
      socket.emit("imu_data", {
        payload: {
          kneeAngle: fakeAngle,
          acceleration: fakeAccel,
          timestamp: Date.now(),
        },
      });
    }
  }, 150); // ~7Hz
};

export const stopIMUStreaming = () => {
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
};