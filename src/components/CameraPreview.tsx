import { useRef, useEffect, useState, useCallback } from "react";
import {
  HandLandmarker,
  FilesetResolver,
  HandLandmarkerResult,
} from "@mediapipe/tasks-vision";
import { classifyGesture, GestureResult, GestureTemplate } from "../engine/gestureClassifier";
import { GestureStateMachine, StateMachineOutput } from "../engine/stateMachine";
import { dispatchGesture, DEFAULT_MAPPINGS, GestureMapping } from "../engine/actionDispatcher";
import { loadMappings, saveMappings, loadTemplates, saveTemplates } from "../engine/storage";
import { loadSettings } from "../engine/settings";
import { createOverlayWindow, destroyOverlayWindow } from "../engine/overlayManager";
import { emitTo } from "@tauri-apps/api/event";
import AssignGesture from "./AssignGesture";

const HAND_CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],       // thumb
  [0, 5], [5, 6], [6, 7], [7, 8],       // index
  [0, 9], [9, 10], [10, 11], [11, 12],  // middle
  [0, 13], [13, 14], [14, 15], [15, 16],// ring
  [0, 17], [17, 18], [18, 19], [19, 20],// pinky
  [5, 9], [9, 13], [13, 17],            // palm
];

const DOT_COLORS = ["#00FF88", "#FF6B6B"]; // green for hand 0, red for hand 1
const LINE_COLORS = ["rgba(0,255,136,0.4)", "rgba(255,107,107,0.4)"];

export default function CameraPreview() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const handLandmarkerRef = useRef<HandLandmarker | null>(null);
  const animFrameRef = useRef<number>(0);
  const settingsRef = useRef(loadSettings());
  const stateMachineRef = useRef(new GestureStateMachine({
    confidenceThreshold: settingsRef.current.confidenceThreshold,
  }));
  const mappingsRef = useRef<GestureMapping[]>(loadMappings() ?? DEFAULT_MAPPINGS);
  const templatesRef = useRef<GestureTemplate[]>(loadTemplates());
  const lastEmittedState = useRef("");

  const [gestures, setGestures] = useState<GestureResult[]>([]);
  const [mappings, setMappings] = useState<GestureMapping[]>(mappingsRef.current);
  const [templates, setTemplates] = useState<GestureTemplate[]>(templatesRef.current);
  const [showAssign, setShowAssign] = useState(false);
  const latestLandmarksRef = useRef<import("@mediapipe/tasks-vision").NormalizedLandmark[] | null>(null);
  const [machineOutput, setMachineOutput] = useState<StateMachineOutput>({
    state: "idle",
    firedGesture: null,
    holdDurationMs: 0,
    cooldownRemainingMs: 0,
  });
  const [fps, setFps] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const lastFrameTime = useRef(0);
  const frameCount = useRef(0);
  const fpsInterval = useRef(0);

  // Initialize MediaPipe
  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
        );

        const handLandmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:
              "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
            delegate: "GPU",
          },
          runningMode: "VIDEO",
          numHands: 2,
          minHandDetectionConfidence: 0.5,
          minHandPresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });

        if (!cancelled) {
          handLandmarkerRef.current = handLandmarker;
        }
      } catch (e) {
        if (!cancelled) {
          console.error("Failed to init MediaPipe:", e);
          setError("Failed to initialize hand tracking. Check console for details.");
        }
      }
    }

    init();
    return () => { cancelled = true; };
  }, []);

  // Manage overlay HUD window
  useEffect(() => {
    if (settingsRef.current.showOverlayHUD) {
      createOverlayWindow();
    }
    return () => {
      destroyOverlayWindow();
    };
  }, []);

  // Start camera
  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;

    async function startCamera() {
      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          setError("getUserMedia not supported in this webview.");
          return;
        }

        stream = await navigator.mediaDevices.getUserMedia({
          video: settingsRef.current.cameraDeviceId
            ? { deviceId: { exact: settingsRef.current.cameraDeviceId }, width: 640, height: 480 }
            : { width: 640, height: 480 },
        });

        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          try {
            await videoRef.current.play();
          } catch (playErr: any) {
            // Ignore AbortError from StrictMode double-mount
            if (playErr.name === "AbortError") return;
            throw playErr;
          }
          setLoading(false);
        }
      } catch (e: any) {
        if (cancelled) return;
        console.error("Camera error:", e);
        setError(`Camera error: ${e.name} — ${e.message}`);
      }
    }

    startCamera();
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // Schedule next frame — uses rAF when visible, setTimeout when hidden
  const scheduleNext = useCallback((fn: () => void) => {
    if (document.hidden) {
      // Window hidden (tray mode) — setTimeout keeps running
      animFrameRef.current = window.setTimeout(fn, 33) as unknown as number;
    } else {
      animFrameRef.current = requestAnimationFrame(fn);
    }
  }, []);

  // Detection loop
  const detect = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const handLandmarker = handLandmarkerRef.current;

    if (!video || !canvas || !handLandmarker || video.readyState < 2) {
      scheduleNext(detect);
      return;
    }

    const now = performance.now();

    // FPS counter
    frameCount.current++;
    if (now - fpsInterval.current >= 1000) {
      setFps(frameCount.current);
      frameCount.current = 0;
      fpsInterval.current = now;
    }

    // Avoid sending same frame twice
    if (now - lastFrameTime.current < 33) {
      // cap at ~30fps
      scheduleNext(detect);
      return;
    }
    lastFrameTime.current = now;

    let results: HandLandmarkerResult;
    try {
      results = handLandmarker.detectForVideo(video, now);
    } catch {
      scheduleNext(detect);
      return;
    }

    // Draw
    const ctx = canvas.getContext("2d")!;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const newGestures: GestureResult[] = [];

    if (results.landmarks) {
      for (let i = 0; i < results.landmarks.length; i++) {
        const landmarks = results.landmarks[i];
        const handedness =
          results.handednesses?.[i]?.[0]?.categoryName ?? "Unknown";
        const color = DOT_COLORS[i % DOT_COLORS.length];
        const lineColor = LINE_COLORS[i % LINE_COLORS.length];

        // Draw connections
        ctx.strokeStyle = lineColor;
        ctx.lineWidth = 2;
        for (const [a, b] of HAND_CONNECTIONS) {
          const lmA = landmarks[a];
          const lmB = landmarks[b];
          ctx.beginPath();
          ctx.moveTo(lmA.x * canvas.width, lmA.y * canvas.height);
          ctx.lineTo(lmB.x * canvas.width, lmB.y * canvas.height);
          ctx.stroke();
        }

        // Draw landmarks
        for (const lm of landmarks) {
          ctx.beginPath();
          ctx.arc(
            lm.x * canvas.width,
            lm.y * canvas.height,
            5,
            0,
            2 * Math.PI
          );
          ctx.fillStyle = color;
          ctx.fill();
        }

        // Classify
        const gesture = classifyGesture(landmarks, i, handedness, templatesRef.current);
        newGestures.push(gesture);

        // Track raw landmarks for assign modal (use first hand)
        if (i === 0) {
          latestLandmarksRef.current = landmarks;
        }
      }
    }

    if (newGestures.length === 0) {
      latestLandmarksRef.current = null;
    }

    setGestures(newGestures);

    // Update state machine (skip if assigning)
    const output = stateMachineRef.current.update(newGestures, now);
    setMachineOutput(output);

    // If a gesture was just fired and we're not in assign mode, dispatch
    if (output.firedGesture) {
      console.log(`🔥 FIRED: ${output.firedGesture}`);
      dispatchGesture(output.firedGesture, mappingsRef.current).catch(console.error);
    }

    // Emit state to overlay HUD (only on changes)
    const stateKey = `${output.state}:${output.firedGesture || ""}`;
    if (stateKey !== lastEmittedState.current) {
      lastEmittedState.current = stateKey;
      emitTo("overlay", "gesture-state", {
        state: output.state,
        firedGesture: output.firedGesture,
      }).catch(() => {});
    }

    scheduleNext(detect);
  }, [scheduleNext]);

  // Start detection loop once everything is ready
  useEffect(() => {
    if (!loading) {
      animFrameRef.current = requestAnimationFrame(detect);
    }
    return () => {
      cancelAnimationFrame(animFrameRef.current);
      clearTimeout(animFrameRef.current);
    };
  }, [loading, detect]);

  if (error) {
    return (
      <div style={styles.errorContainer}>
        <p style={styles.errorText}>{error}</p>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.videoWrapper}>
        <video
          ref={videoRef}
          style={styles.video}
          playsInline
          muted
        />
        <canvas ref={canvasRef} style={styles.canvas} />

        {/* FPS counter + Settings gear */}
        <div style={styles.topLeft}>
          <div style={styles.fpsCounter}>{fps} FPS</div>
          <button
            style={styles.gearBtn}
            onClick={() => { window.location.hash = "#/settings"; }}
            title="Settings"
          >
            ⚙
          </button>
        </div>

        {/* Gesture labels */}
        <div style={styles.gesturePanel}>
          {gestures.length === 0 && !loading && (
            <div style={styles.gestureLabel}>No hands detected</div>
          )}
          {gestures.map((g, i) => (
            <div key={i} style={styles.gestureLabel}>
              <span style={{ color: DOT_COLORS[i % DOT_COLORS.length] }}>
                {g.handedness}
              </span>
              :{" "}
              <strong>
                {g.gesture === "none" ? "—" : g.gesture.replace("_", " ")}
              </strong>
              {g.gesture !== "none" && (
                <span style={styles.confidence}>
                  {" "}
                  {Math.round(g.confidence * 100)}%
                </span>
              )}
            </div>
          ))}
        </div>

        {/* State machine status */}
        <div style={styles.statePanel}>
          <div style={{
            ...styles.stateBadge,
            background: machineOutput.state === "armed" ? "rgba(0,255,136,0.8)"
              : machineOutput.state === "fired" ? "rgba(255,200,0,0.9)"
              : machineOutput.state === "cooldown" ? "rgba(255,107,107,0.7)"
              : "rgba(255,255,255,0.15)",
            color: machineOutput.state === "idle" ? "#888" : "#000",
          }}>
            {machineOutput.state.toUpperCase()}
          </div>
          {machineOutput.firedGesture && (
            <div style={styles.firedLabel}>
              ⚡ {machineOutput.firedGesture.replace("_", " ")}
            </div>
          )}
        </div>

        {/* Assign gesture button + mapping list */}
        <div style={styles.bottomBar}>
          <button
            style={styles.assignBtn}
            onClick={() => {
              stateMachineRef.current.reset();
              setShowAssign(true);
            }}
          >
            + Assign Gesture
          </button>
          <div style={styles.mappingList}>
            {mappings.map((m, i) => (
              <div key={i} style={styles.mappingItem}>
                <span style={styles.mappingGesture}>{m.gesture.replace("_", " ")}</span>
                <span style={styles.mappingArrow}>→</span>
                <span style={styles.mappingAction}>{m.action.label || m.action.value}</span>
                <button
                  style={styles.deleteBtn}
                  onClick={() => {
                    const updatedMappings = mappings.filter((_, j) => j !== i);
                    setMappings(updatedMappings);
                    mappingsRef.current = updatedMappings;
                    saveMappings(updatedMappings);

                    // Also remove template with same name
                    const updatedTemplates = templates.filter((t) => t.name !== m.gesture);
                    setTemplates(updatedTemplates);
                    templatesRef.current = updatedTemplates;
                    saveTemplates(updatedTemplates);
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Assign gesture modal */}
        {showAssign && (
          <AssignGesture
            currentLandmarks={latestLandmarksRef.current}
            onSave={(template, mapping) => {
              // Store the template
              const updatedTemplates = templates.filter((t) => t.name !== template.name);
              updatedTemplates.push(template);
              setTemplates(updatedTemplates);
              templatesRef.current = updatedTemplates;
              saveTemplates(updatedTemplates);

              // Store the mapping
              const updatedMappings = mappings.filter((m) => m.gesture !== mapping.gesture);
              updatedMappings.push(mapping);
              setMappings(updatedMappings);
              mappingsRef.current = updatedMappings;
              saveMappings(updatedMappings);

              setShowAssign(false);
            }}
            onCancel={() => setShowAssign(false)}
          />
        )}

        {loading && (
          <div style={styles.loadingOverlay}>
            <p>Initializing hand tracking...</p>
          </div>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    width: "100vw",
    height: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#0a0a0a",
    overflow: "hidden",
  },
  videoWrapper: {
    position: "relative",
    width: "100%",
    height: "100%",
  },
  video: {
    width: "100%",
    height: "100%",
    objectFit: "cover",
    transform: "scaleX(-1)", // mirror
  },
  canvas: {
    position: "absolute",
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    transform: "scaleX(-1)", // mirror to match video
    pointerEvents: "none",
  },
  fpsCounter: {
    color: "#00FF88",
    fontSize: 14,
    fontFamily: "monospace",
    background: "rgba(0,0,0,0.6)",
    padding: "4px 8px",
    borderRadius: 4,
  },
  topLeft: {
    position: "absolute",
    top: 12,
    left: 12,
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  gearBtn: {
    background: "rgba(0,0,0,0.6)",
    border: "none",
    borderRadius: 4,
    color: "#aaa",
    fontSize: 18,
    padding: "2px 8px",
    cursor: "pointer",
    lineHeight: 1,
  },
  gesturePanel: {
    position: "absolute",
    top: 12,
    right: 12,
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  gestureLabel: {
    color: "#fff",
    fontSize: 16,
    fontFamily: "monospace",
    background: "rgba(0,0,0,0.7)",
    padding: "6px 12px",
    borderRadius: 6,
  },
  confidence: {
    color: "#aaa",
    fontSize: 13,
  },
  loadingOverlay: {
    position: "absolute",
    inset: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(0,0,0,0.8)",
    color: "#fff",
    fontSize: 18,
  },
  errorContainer: {
    width: "100vw",
    height: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#0a0a0a",
  },
  errorText: {
    color: "#FF6B6B",
    fontSize: 18,
    fontFamily: "monospace",
  },
  statePanel: {
    position: "absolute",
    bottom: 16,
    left: "50%",
    transform: "translateX(-50%)",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 6,
  },
  stateBadge: {
    fontSize: 18,
    fontFamily: "monospace",
    fontWeight: 700,
    padding: "8px 24px",
    borderRadius: 8,
    letterSpacing: 2,
  },
  firedLabel: {
    color: "#FFD700",
    fontSize: 22,
    fontFamily: "monospace",
    fontWeight: 700,
    background: "rgba(0,0,0,0.7)",
    padding: "6px 16px",
    borderRadius: 6,
  },
  bottomBar: {
    position: "absolute",
    bottom: 16,
    right: 16,
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    gap: 8,
  },
  assignBtn: {
    background: "#00FF88",
    border: "none",
    borderRadius: 8,
    color: "#000",
    fontSize: 14,
    fontFamily: "monospace",
    fontWeight: 700,
    padding: "10px 20px",
    cursor: "pointer",
    letterSpacing: 0.5,
  },
  mappingList: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    maxHeight: 200,
    overflowY: "auto",
  },
  mappingItem: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    background: "rgba(0,0,0,0.7)",
    padding: "6px 12px",
    borderRadius: 6,
    fontFamily: "monospace",
    fontSize: 13,
  },
  mappingGesture: {
    color: "#00FF88",
    fontWeight: 600,
  },
  mappingArrow: {
    color: "#555",
  },
  mappingAction: {
    color: "#fff",
  },
  deleteBtn: {
    background: "transparent",
    border: "none",
    color: "#FF6B6B",
    fontSize: 18,
    cursor: "pointer",
    padding: "0 4px",
    marginLeft: 4,
  },
};
