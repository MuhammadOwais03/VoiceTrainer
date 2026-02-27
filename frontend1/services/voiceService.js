import { Audio } from "expo-av";
import * as Speech from "expo-speech";
import { BACKEND_URL } from "../constants/config";

let recording = null;

export const startRecording = async () => {
  const permission = await Audio.requestPermissionsAsync();
  if (!permission.granted) return;

  await Audio.setAudioModeAsync({
    allowsRecordingIOS: true,
    playsInSilentModeIOS: true,
  });

  const result = await Audio.Recording.createAsync(
    Audio.RecordingOptionsPresets.HIGH_QUALITY
  );

  recording = result.recording;
};

export const stopRecording = async () => {
  if (!recording) return;

  await recording.stopAndUnloadAsync();
  const uri = recording.getURI();

  await sendAudioToBackend(uri);
};

const sendAudioToBackend = async (uri) => {
  const formData = new FormData();

  formData.append("file", {
    uri,
    type: "audio/m4a",
    name: "voice.m4a",
  });

  await fetch(`${BACKEND_URL}/speech`, {
    method: "POST",
    body: formData,
    headers: {
      "Content-Type": "multipart/form-data",
    },
  });
};

export const speak = (text) => {
  Speech.speak(text);
};