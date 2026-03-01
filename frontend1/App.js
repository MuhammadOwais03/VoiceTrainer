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

const BACKEND_WS_URL     = 'ws://192.168.100.48:8000/ws';
const SIMULATE_SENSOR    = true;
const SENSOR_INTERVAL_MS = 300;

// ── Modes ──────────────────────────────────────────────────────────────────────
const MODE = {
  IDLE:          'idle',
  WS_SPEAKING:   'ws-speaking',
  WAITING_REPLY: 'waiting-reply',
  USER_SPEAK:    'user-speaking',
  LISTENING:     'listening',
};

// ── TTS Queue & Priorities ─────────────────────────────────────────────────────
const ttsQueue = []; // { text, targetMode, priority }
let isProcessingTTS = false;

const PRIORITY = {
  ERROR:   100,
  USER:     80,   // speech_response – conversation replies
  SENSOR:   10,   // sensor_response – lowest priority
};

export default function App() {
  const [status,         setStatus]         = useState('Ready');
  const [lastSensorData, setLastSensorData] = useState(null);
  const [lastResponse,   setLastResponse]   = useState('');
  const [mode,           setMode]           = useState(MODE.IDLE);

  const wsRef             = useRef(null);
  const sensorIntervalRef = useRef(null);
  const listeningTimeout  = useRef(null);

  // Mirror of mode for use in callbacks/closures
  const modeRef = useRef(MODE.IDLE);
  const setModeBoth = (m) => { modeRef.current = m; setMode(m); };

  // Flag to detect intentional interruptions
  const interruptedRef = useRef(false);

  // ── TTS Queue Logic ──────────────────────────────────────────────────────────
  const enqueueTTS = (text, targetMode, priority = PRIORITY.SENSOR) => {
    if (!text?.trim()) return;

    ttsQueue.push({ text, targetMode, priority });
    console.log(`[TTS] Enqueued → ${targetMode} (prio=${priority})  queue=${ttsQueue.length}`);

    if (!isProcessingTTS) {
      processNextTTS();
    }
  };

  const processNextTTS = async () => {
    if (ttsQueue.length === 0) {
      isProcessingTTS = false;
      return;
    }

    isProcessingTTS = true;

    // Sort by priority DESC (highest first)
    ttsQueue.sort((a, b) => b.priority - a.priority);
    const { text, targetMode } = ttsQueue.shift();

    const current = modeRef.current;

    // Guard: skip if mode doesn't allow this type of speech
    if (targetMode === MODE.WS_SPEAKING && current !== MODE.IDLE) {
      console.log(`[TTS] Skipped sensor alert (mode=${current})`);
      processNextTTS();
      return;
    }
    if (targetMode === MODE.USER_SPEAK && current !== MODE.WAITING_REPLY) {
      console.log(`[TTS] Skipped user reply (mode=${current})`);
      processNextTTS();
      return;
    }

    // Stop anything currently playing
    interruptedRef.current = false;
    Speech.stop();

    setModeBoth(targetMode);
    setLastResponse(text);

    const statusText =
      targetMode === MODE.USER_SPEAK ? 'Speaking reply…'
      : targetMode === MODE.WS_SPEAKING ? `Alert: ${text.slice(0, 40)}`
      : 'Processing…';

    setStatus(statusText);

    console.log(`[TTS] Playing → ${targetMode}: ${text.slice(0, 70)}`);

    await new Promise((resolve) => {
      const finish = () => {
        if (!interruptedRef.current && modeRef.current === targetMode) {
          setModeBoth(MODE.IDLE);
          setStatus('Ready');
        }
        resolve();
      };

      Speech.speak(text, {
        language: 'en-US',
        pitch: 1.0,
        rate: 0.95,
        onDone: finish,
        onError: finish,
        onStopped: finish,
      });
    });

    // Continue with next in queue
    processNextTTS();
  };

  // ── WebSocket ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    console.log('Connecting WebSocket…');
    const ws = new WebSocket(BACKEND_WS_URL);

    ws.onopen  = () => setStatus('Connected');
    ws.onerror = () => setStatus('WebSocket error');
    ws.onclose = () => setStatus('WebSocket closed');

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        const { type, response } = data;
        console.log('[WS in]', type, '| mode=', modeRef.current);

        if (type === 'sensor_response') {
          enqueueTTS(response, MODE.WS_SPEAKING, PRIORITY.SENSOR);
        } else if (type === 'speech_response') {
          enqueueTTS(response, MODE.USER_SPEAK, PRIORITY.USER);
        } else {
          console.warn('[WS] Unknown type:', type);
        }
      } catch (err) {
        console.error('WS parse error:', err);
      }
    };

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
      const payload = {
        type: 'sensor',
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
      setLastSensorData(payload);
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
    }, SENSOR_INTERVAL_MS);
  };

  // ── Send user speech to backend ──────────────────────────────────────────────
  const sendSpeechOverWS = (text) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'speech', text }));
    } else {
      enqueueTTS('Connection lost. Please try again.', MODE.USER_SPEAK, PRIORITY.ERROR);
    }
  };

  // ── Start listening ──────────────────────────────────────────────────────────
  const startListening = async () => {
    setModeBoth(MODE.LISTENING);
    setStatus('Listening… Speak now 🎙️');

    listeningTimeout.current = setTimeout(() => {
      console.warn('STT timeout');
      try { ExpoSpeechRecognitionModule.abort(); } catch (_) {}
      interruptedRef.current = true;
      Speech.stop();
      interruptedRef.current = false;
      setModeBoth(MODE.WAITING_REPLY);
      enqueueTTS('Listening timed out. Please try again.', MODE.USER_SPEAK, PRIORITY.ERROR);
    }, 15000);

    try {
      ExpoSpeechRecognitionModule.start({
        lang: 'en-US',
        interimResults: false,
        maxAlternatives: 1,
        continuous: false,
      });
    } catch (err) {
      console.error('start() threw:', err);
      setModeBoth(MODE.WAITING_REPLY);
      enqueueTTS('Could not start speech recognition.', MODE.USER_SPEAK, PRIORITY.ERROR);
    }
  };

  // ── Button handler ───────────────────────────────────────────────────────────
  const handleSpeakToBot = async () => {
    const current = modeRef.current;
    console.log(`[button] mode=${current}`);

    if (current === MODE.LISTENING)     return;
    if (current === MODE.USER_SPEAK)    return;
    if (current === MODE.WAITING_REPLY) return;

    if (current === MODE.WS_SPEAKING) {
      // Interrupt sensor speech → go to listening
      interruptedRef.current = true;
      Speech.stop();
      interruptedRef.current = false;
      await startListening();
      return;
    }

    // Normal flow from IDLE
    const { status: perm } = await Audio.requestPermissionsAsync();
    if (perm !== 'granted') {
      setModeBoth(MODE.WAITING_REPLY);
      enqueueTTS('Please allow microphone access.', MODE.USER_SPEAK, PRIORITY.ERROR);
      return;
    }

    const available = await ExpoSpeechRecognitionModule.isAvailableAsync?.() ?? true;
    if (!available) {
      setModeBoth(MODE.WAITING_REPLY);
      enqueueTTS('Speech recognition is not available on this device.', MODE.USER_SPEAK, PRIORITY.ERROR);
      return;
    }

    await startListening();
  };

  // ── Speech Recognition Events ────────────────────────────────────────────────
  useSpeechRecognitionEvent('result', (event) => {
    if (!event.isFinal) return;
    clearTimeout(listeningTimeout.current);

    const spokenText = event.results?.[0]?.transcript?.trim() ?? '';
    console.log('[STT result]', spokenText);

    if (!spokenText) {
      setModeBoth(MODE.WAITING_REPLY);
      enqueueTTS('I did not hear anything. Please try again.', MODE.USER_SPEAK, PRIORITY.ERROR);
      return;
    }

    setStatus(`You said: "${spokenText}"`);
    setModeBoth(MODE.WAITING_REPLY);
    sendSpeechOverWS(spokenText);
  });

  useSpeechRecognitionEvent('error', (event) => {
    console.warn('[STT error]', event.error);
    clearTimeout(listeningTimeout.current);

    if (event.error === 'aborted') return;

    const messages = {
      'no-speech':   'I did not catch that. Please try again.',
      'not-allowed': 'Microphone access was denied.',
      'network':     'Network error during recognition.',
    };
    const msg = messages[event.error] ?? 'Speech recognition failed. Please try again.';
    setModeBoth(MODE.WAITING_REPLY);
    enqueueTTS(msg, MODE.USER_SPEAK, PRIORITY.ERROR);
  });

  useSpeechRecognitionEvent('end', () => {
    console.log('[STT end] mode=', modeRef.current);
    clearTimeout(listeningTimeout.current);
    if (modeRef.current === MODE.LISTENING) {
      setModeBoth(MODE.IDLE);
      setStatus('Ready');
    }
  });

  // ── UI ───────────────────────────────────────────────────────────────────────
  const isListening    = mode === MODE.LISTENING;
  const isWsSpeaking   = mode === MODE.WS_SPEAKING;
  const isUserSpeaking = mode === MODE.USER_SPEAK;
  const isWaiting      = mode === MODE.WAITING_REPLY;
  const isSpeaking     = isWsSpeaking || isUserSpeaking;

  const buttonTitle =
      isListening    ? '🎙️  Listening…'
    : isWsSpeaking   ? '🎤  Interrupt & Speak'
    : isUserSpeaking ? '🔊  Bot Speaking…'
    : isWaiting      ? '⏳  Waiting for reply…'
    :                  '🎤  Speak to Bot';

  const buttonDisabled = isListening || isUserSpeaking || isWaiting;
  const buttonColor    = isWsSpeaking ? '#FF5722' : '#2196F3';

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
          title={buttonTitle}
          onPress={handleSpeakToBot}
          disabled={buttonDisabled}
          color={buttonColor}
        />
      </View>

      {(isListening || isSpeaking || isWaiting) && (
        <ActivityIndicator
          size="large"
          color={isListening ? '#2196F3' : isWaiting ? '#FF9800' : '#FF5722'}
          style={{ marginTop: 20 }}
        />
      )}

      {isListening && <Text style={styles.hint}>Speak clearly into your microphone…</Text>}
      {isWaiting   && <Text style={styles.hint}>Processing your request…</Text>}
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