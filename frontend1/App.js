import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  Button,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import * as Speech from 'expo-speech';
import { Audio } from 'expo-av';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';

const BACKEND_WS_URL   = 'ws://192.168.100.50:8000/ws/sensor';
const BACKEND_HTTP_URL = 'http://192.168.100.50:8000/process_speech';
const SIMULATE_SENSOR    = true;
const SENSOR_INTERVAL_MS = 300;

export default function App() {
  const [status, setStatus]                 = useState('Ready');
  const [lastSensorData, setLastSensorData] = useState(null);
  const [lastResponse, setLastResponse]     = useState('');
  const [isListening, setIsListening]       = useState(false);
  const [isSpeaking, setIsSpeaking]         = useState(false);

  const wsRef             = useRef(null);
  const sensorIntervalRef = useRef(null);
  const listeningTimeout  = useRef(null);

  // ── Priority flag: true while user interaction is in progress ─────────────
  // Blocks sensor WS messages from overriding the user's response.
  const userInteractionActive = useRef(false);

  // ── Sync ref so resetListening() can read speaking state without stale closure ──
  const isSpeakingRef = useRef(false);

  // ── Reset helper ───────────────────────────────────────────────────────────
  const resetListening = () => {
    clearTimeout(listeningTimeout.current);
    setIsListening(false);
    setStatus('Ready');
    // Only keep the priority lock alive if TTS is actively running.
    // Use the ref (not state) so we always get the current value.
    if (!isSpeakingRef.current) {
      userInteractionActive.current = false;
    }
  };

  // ── WebSocket + sensor simulation ──────────────────────────────────────────
  useEffect(() => {
    const ws = new WebSocket(BACKEND_WS_URL);
    ws.onopen    = () => setStatus('WebSocket connected');
    ws.onmessage = (event) => {
      // ✅ Drop sensor-triggered responses while user interaction is active
      if (userInteractionActive.current) {
        console.log('WS message suppressed — user interaction in progress');
        return;
      }
      try {
        const data = JSON.parse(event.data);
        setLastResponse(data.response || 'No response text');

        // speak(data.response || 'Got message but no text');
      } catch (err) { console.error('WS parse error:', err); }
    };
    ws.onerror = () => setStatus('WebSocket error');
    ws.onclose = () => setStatus('WebSocket closed');
    wsRef.current = ws;

    if (SIMULATE_SENSOR) startSimulatedSensor(ws);

    return () => {
      clearInterval(sensorIntervalRef.current);
      ws.close();
    };
  }, []);

  const startSimulatedSensor = (ws) => {
    sensorIntervalRef.current = setInterval(() => {
      const now = Date.now() / 1000;
      const demoData = {
        type: 'imu',
        timestamp: now.toFixed(3),
        accelerometer: {
          x: (0.03 * Math.sin(now * 1.4) + (Math.random() - 0.5) * 0.03).toFixed(3),
          y: (0.02 * Math.cos(now * 1.8) + (Math.random() - 0.5) * 0.025).toFixed(3),
          z: (9.81 + 0.04 * Math.sin(now * 2.2) + (Math.random() - 0.5) * 0.04).toFixed(3),
        },
        gyroscope: {
          x: (0.9  * Math.sin(now * 1.1) + (Math.random() - 0.5) * 0.15).toFixed(3),
          y: (-1.1 * Math.cos(now * 1.6) + (Math.random() - 0.5) * 0.18).toFixed(3),
          z: (0.6  * Math.sin(now * 2.4) + (Math.random() - 0.5) * 0.12).toFixed(3),
        },
      };
      setLastSensorData(demoData);
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(demoData));
    }, SENSOR_INTERVAL_MS);
  };

  // ── Speech recognition events ──────────────────────────────────────────────
  useSpeechRecognitionEvent('result', async (event) => {
    if (!event.isFinal) return;

    const spokenText = event.results?.[0]?.transcript?.trim() ?? '';
    console.log('Recognized:', spokenText);

    if (!spokenText) {
      speak('I did not hear anything. Please try again.');
      resetListening();
      return;
    }

    setStatus(`You said: "${spokenText}"`);

    try {
      const res = await fetch(BACKEND_HTTP_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ input_text: spokenText }),
      });

      if (!res.ok) throw new Error('HTTP ' + res.status);

      const data  = await res.json();
      const reply = data.response || 'No reply from bot';
      setLastResponse(reply);
      speak(reply);           // userInteractionActive stays true until TTS done
    } catch (err) {
      console.error('Fetch error:', err);
      setLastResponse('Error contacting server');
      speak('Sorry, something went wrong reaching the server.');
    } finally {
      resetListening();
    }
  });

  useSpeechRecognitionEvent('error', (event) => {
    console.warn('STT error:', event.error, event.message);

    const messages = {
      'no-speech':   'I did not catch that. Please try again.',
      'not-allowed': 'Microphone access was denied.',
      'network':     'Network error during recognition.',
      'aborted':     'Listening was cancelled.',
    };

    const msg = messages[event.error] ?? 'Speech recognition failed. Please try again.';
    setLastResponse(msg);
    speak(msg);
    resetListening();
  });

  useSpeechRecognitionEvent('end', () => {
    console.log('STT session ended');
    resetListening();
  });

  // ── Start listening ────────────────────────────────────────────────────────
  const handleSpeakToBot = async () => {
    console.log('Button pressed: Speak to Bot');
    if (isListening || isSpeaking) return;

    // ✅ Mark user interaction as active — suppresses WS responses
    userInteractionActive.current = true;

    setStatus('Checking microphone permission…');
    const { status: permStatus } = await Audio.requestPermissionsAsync();
    if (permStatus !== 'granted') {
      setStatus('Microphone permission denied');
      speak('Please allow microphone access to speak to me.');
      return;
    }

    const available = await ExpoSpeechRecognitionModule.isAvailableAsync?.() ?? true;
    if (!available) {
      setStatus('Speech recognition not available on this device');
      speak('Speech recognition is not available on this device.');
      return;
    }

    listeningTimeout.current = setTimeout(() => {
      console.warn('STT timeout — forcing reset');
      try { ExpoSpeechRecognitionModule.abort(); } catch (_) {}
      speak('Listening timed out. Please try again.');
      resetListening();
    }, 15000);

    setIsListening(true);
    setStatus('Listening… Speak now 🎙️');

    try {
      ExpoSpeechRecognitionModule.start({
        lang:            'en-US',
        interimResults:  false,
        maxAlternatives: 1,
        continuous:      false,
      });
    } catch (err) {
      console.error('start() threw:', err);
      speak('Could not start speech recognition.');
      resetListening();
    }
  };

  // ── TTS ────────────────────────────────────────────────────────────────────
  const speak = async (text) => {
    if (!text) return;
    console.log('Speaking:', text);
    Speech.stop();
    isSpeakingRef.current = true;
    setIsSpeaking(true);
    await Speech.speak(text, {
      language: 'en-US',
      pitch:    1.0,
      rate:     0.95,
      onDone: () => {
        isSpeakingRef.current = false;
        setIsSpeaking(false);
        // ✅ Release priority lock only after TTS finishes
        userInteractionActive.current = false;
      },
      onError: () => {
        isSpeakingRef.current = false;
        setIsSpeaking(false);
        userInteractionActive.current = false;
      },
      onStopped: () => {
        isSpeakingRef.current = false;
        setIsSpeaking(false);
        userInteractionActive.current = false;
      },
    });
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Voice Bot Demo</Text>
      <Text style={styles.status}>Status: {status}</Text>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Last Sensor Data</Text>
        <ScrollView style={styles.dataBox}>
          <Text style={styles.mono}>
            {lastSensorData ? JSON.stringify(lastSensorData, null, 2) : 'No data yet'}
          </Text>
        </ScrollView>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Last Response</Text>
        <Text style={styles.response}>{lastResponse || '—'}</Text>
      </View>

      <View style={styles.buttonRow}>
        <Button
          title={isListening ? '🎙️  Listening…' : '🎤  Speak to Bot'}
          onPress={handleSpeakToBot}
          disabled={isListening || isSpeaking}
          color="#2196F3"
        />
      </View>

      {(isListening || isSpeaking) && (
        <ActivityIndicator
          size="large"
          color={isListening ? '#2196F3' : '#FF5722'}
          style={{ marginTop: 20 }}
        />
      )}

      {isListening && (
        <Text style={styles.hint}>Speak clearly into your microphone…</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container:    { flex: 1, padding: 20, backgroundColor: '#f5f5f5', paddingTop: 60 },
  title:        { fontSize: 28, fontWeight: 'bold', textAlign: 'center', marginBottom: 20 },
  status:       { textAlign: 'center', marginBottom: 16, fontSize: 16, color: '#555' },
  section:      { marginVertical: 12 },
  sectionTitle: { fontSize: 18, fontWeight: '600', marginBottom: 8 },
  dataBox:      { backgroundColor: '#fff', padding: 12, borderRadius: 8, maxHeight: 180 },
  mono:         { fontFamily: 'monospace', fontSize: 12 },
  response:     { backgroundColor: '#e8f5e9', padding: 16, borderRadius: 8, fontSize: 16, minHeight: 80 },
  buttonRow:    { marginVertical: 24, alignItems: 'center' },
  hint:         { textAlign: 'center', color: '#2196F3', fontSize: 14, marginTop: 8 },
});