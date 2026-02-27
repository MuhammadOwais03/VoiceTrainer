import { io } from "socket.io-client";
import { BACKEND_URL } from "../constants/config";

let socket = null;

export const connectSocket = () => {
  if (!socket) {
    socket = io(BACKEND_URL, {
      transports: ["websocket"],
    });

    socket.on("connect", () => {
      console.log("Connected to backend");
    });

    socket.on("disconnect", () => {
      console.log("Disconnected from backend");
    });
  }

  return socket;
};

export const getSocket = () => socket;