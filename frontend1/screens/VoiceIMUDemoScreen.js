import React, { useEffect, useState } from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { connectSocket, getSocket } from "../services/socketService";
import { startIMUStreaming } from "../services/imuService";
import {
  startRecording,
  stopRecording,
  speak,
} from "../services/voiceService";

const VoiceIMUDemoScreen = () => {
  const [isRecording, setIsRecording] = useState(false);
  const [lastMessage, setLastMessage] = useState("No messages yet");

  useEffect(() => {
    const socket = connectSocket();

    startIMUStreaming();

    socket.on("server_event", (data) => {
      console.log("Server:", data);

      if (data.text) {
        setLastMessage(data.text);
        speak(data.text);
      }
    });

    return () => {
      socket.off("server_event");
    };
  }, []);

  const handleVoice = async () => {
    if (isRecording) {
      await stopRecording();
      setIsRecording(false);
    } else {
      await startRecording();
      setIsRecording(true);
    }
  };

  return (
    <View
      style={{
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
        padding: 20,
      }}
    >
      <Text style={{ fontSize: 20, fontWeight: "bold", marginBottom: 20 }}>
        AI Fitness Voice + IMU Demo
      </Text>

      <Text style={{ marginBottom: 20 }}>
        Last AI Message:
      </Text>

      <Text style={{ marginBottom: 40, fontStyle: "italic" }}>
        {lastMessage}
      </Text>

      <TouchableOpacity
        onPress={handleVoice}
        style={{
          backgroundColor: "#2563eb",
          padding: 18,
          borderRadius: 20,
        }}
      >
        <Text style={{ color: "#fff", fontWeight: "bold" }}>
          {isRecording ? "Stop Talking" : "Talk to AI Coach"}
        </Text>
      </TouchableOpacity>
    </View>
  );
};

export default VoiceIMUDemoScreen;