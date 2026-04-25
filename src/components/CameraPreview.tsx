import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { GestureTemplate } from "../engine/gestureClassifier";
import { dispatchGesture, GestureMapping, DEFAULT_MAPPINGS } from "../engine/actionDispatcher";
import { loadMappings, saveMappings, loadTemplates, saveTemplates } from "../engine/storage";
import { loadSettings } from "../engine/settings";
import { createOverlayWindow, destroyOverlayWindow } from "../engine/overlayManager";
import { emitTo } from "@tauri-apps/api/event";
import AssignGesture from "./AssignGesture";

interface SidecarGesture {
  type: string;
  gesture: string;
  confidence: number;
  handIndex: number;
}

interface SidecarState {
  type: string;
  state: string;
  firedGesture: string | null;
  holdDurationMs: number;
}

interface SidecarStatus {
  type: string;
  camera: string;
  fps: number;
}

const HAND_CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [0, 9], [9, 10], [10, 11], [11, 12],
  [0, 13], [13, 14], [14, 15], [15, 16],
  [0, 17], [17, 18], [18, 19], [19, 20],
  [5, 9], [9, 13], [13, 17],
];

const DOT_COLORS = ["#00FF88", "#FF6B6B"];
const LINE_COLORS = ["rgba(0,255,136,0.4)", "rgba(255,107,107,0.4)"];

export default function CameraPreview() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const settingsRef = useRef(loadSettings());
  const mappingsRef = useRef<GestureMapping[]>(loadMappings() ?? DEFAULT_MAPPINGS);
  const templatesRef = useRef<GestureTemplate[]>(loadTemplates());
  const lastEmittedState = useRef("");

  const [gestures, setGestures] = useState<SidecarGesture[]>([]);
  const [mappings, setMappings] = useState<GestureMapping[]>(mappingsRef.current);
  const [templates, setTemplates] = useState<GestureTemplate[]>(templatesRef.current);
  const [showAssign, setShowAssign] = useState(false);
  const [machineState, setMachineState] = useState("idle");
  const [firedGesture, setFiredGesture] = useState<string | null>(null);
  const [fps, setFps] = useState(0);
  const [sidecarStatus, setSidecarStatus] = useState<string>("connecting");
  const [error, setError] = useState<string | null>(null);

  // Send templates to sidecar whenever they change
  const sendTemplatesToSidecar = useCallback((tpls: GestureTemplate[]) => {
    const msg = JSON.stringify({
      cmd: "set_templates",
      templates: tpls.map(t => ({ name: t.name, landmarks: t.landmarks })),
    });
    invoke("sidecar_send", { message: msg }).catch(console.error);
  }, []);

  // Send config to sidecar
  useEffect(() => {
    const msg = JSON.stringify({
      cmd: "set_config",
      config: {
        confidenceThreshold: settingsRef.current.confidenceThreshold,
      },
    });
    invoke("sidecar_send", { message: msg }).catch(() => {});
  }, []);

  // Send initial templates
  useEffect(() => {
    const timer = setTimeout(() => {
      sendTemplatesToSidecar(templatesRef.current);
    }, 1000);
    return () => clearTimeout(timer);
  }, [sendTemplatesToSidecar]);

  // Manage overlay HUD window
  useEffect(() => {
    if (settingsRef.current.showOverlayHUD) {
      createOverlayWindow();
    }
    return () => {
      destroyOverlayWindow();
    };
  }, []);

  // Start local camera preview (display only — sidecar does the processing)
  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;

    async function startPreview() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480 },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
      } catch (e) {
        // Camera preview is optional — sidecar still works without it
        console.warn("Camera preview unavailable:", e);
      }
    }

    startPreview();
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // Listen to sidecar events
  useEffect(() => {
    const unlisteners: Promise<UnlistenFn>[] = [];

    // Landmarks — draw on canvas
    unlisteners.push(
      listen<any>("sidecar:landmarks", (event) => {
        const data = event.payload;
        const hands = data.hands;
        if (!canvasRef.current) return;

        const canvas = canvasRef.current;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        if (canvas.width !== 640) {
          canvas.width = 640;
          canvas.height = 480;
        }

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // If no hands, clear gestures too
        if (!hands || hands.length === 0) {
          setGestures([]);
          return;
        }

        for (let i = 0; i < hands.length; i++) {
          const landmarks: number[][] = hands[i].landmarks;
          if (!landmarks || landmarks.length !== 21) continue;

          const color = DOT_COLORS[i % DOT_COLORS.length];
          const lineColor = LINE_COLORS[i % LINE_COLORS.length];

          ctx.strokeStyle = lineColor;
          ctx.lineWidth = 2;
          for (const [a, b] of HAND_CONNECTIONS) {
            const lmA = landmarks[a];
            const lmB = landmarks[b];
            ctx.beginPath();
            ctx.moveTo(lmA[0] * canvas.width, lmA[1] * canvas.height);
            ctx.lineTo(lmB[0] * canvas.width, lmB[1] * canvas.height);
            ctx.stroke();
          }

          for (const lm of landmarks) {
            ctx.beginPath();
            ctx.arc(lm[0] * canvas.width, lm[1] * canvas.height, 5, 0, 2 * Math.PI);
            ctx.fillStyle = color;
            ctx.fill();
          }
        }
      })
    );

    // Gesture events
    unlisteners.push(
      listen<SidecarGesture>("sidecar:gesture", (event) => {
        const g = event.payload;
        if (g.gesture !== "none") {
          setGestures((prev) => {
            const updated = prev.filter((p) => p.handIndex !== g.handIndex);
            updated.push(g);
            return updated;
          });
        }
      })
    );

    // State machine events
    unlisteners.push(
      listen<SidecarState>("sidecar:state", (event) => {
        const s = event.payload;
        setMachineState(s.state);

        if (s.firedGesture) {
          setFiredGesture(s.firedGesture);
          dispatchGesture(s.firedGesture, mappingsRef.current).catch(console.error);
          setTimeout(() => setFiredGesture(null), 2000);
        }

        const key = `${s.state}:${s.firedGesture || ""}`;
        if (key !== lastEmittedState.current) {
          lastEmittedState.current = key;
          emitTo("overlay", "gesture-state", {
            state: s.state,
            firedGesture: s.firedGesture,
          }).catch(() => {});
        }
      })
    );

    // Status events
    unlisteners.push(
      listen<SidecarStatus>("sidecar:status", (event) => {
        setFps(event.payload.fps);
        setSidecarStatus(event.payload.camera);
      })
    );

    // Error events
    unlisteners.push(
      listen<any>("sidecar:error", (event) => {
        setError(event.payload.message);
      })
    );

    // Sidecar terminated
    unlisteners.push(
      listen<any>("sidecar:terminated", () => {
        setSidecarStatus("terminated");
      })
    );

    return () => {
      unlisteners.forEach((p) => p.then((fn) => fn()));
    };
  }, []);

  if (error) {
    return (
      <div style={styles.errorContainer}>
        <p style={styles.errorText}>{error}</p>
        <p style={{ color: "#888", fontSize: 14, fontFamily: "monospace", marginTop: 8 }}>
          Check that camera permissions are granted
        </p>
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

        <div style={styles.topLeft}>
          <div style={styles.fpsCounter}>{fps} FPS</div>
          <div style={{
            ...styles.statusBadge,
            background: sidecarStatus === "running" ? "rgba(0,255,136,0.3)" : "rgba(255,107,107,0.3)",
          }}>
            {sidecarStatus === "running" ? "● Camera" : sidecarStatus}
          </div>
          <button
            style={styles.gearBtn}
            onClick={() => { window.location.hash = "#/settings"; }}
            title="Settings"
          >
            ⚙
          </button>
        </div>

        <div style={styles.gesturePanel}>
          {gestures.length === 0 && (
            <div style={styles.gestureLabel}>No hands detected</div>
          )}
          {gestures.map((g, i) => (
            <div key={i} style={styles.gestureLabel}>
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

        <div style={styles.statePanel}>
          <div style={{
            ...styles.stateBadge,
            background: machineState === "armed" ? "rgba(0,255,136,0.8)"
              : machineState === "fired" ? "rgba(255,200,0,0.9)"
              : machineState === "cooldown" ? "rgba(255,107,107,0.7)"
              : "rgba(255,255,255,0.15)",
            color: machineState === "idle" ? "#888" : "#000",
          }}>
            {machineState.toUpperCase()}
          </div>
          {firedGesture && (
            <div style={styles.firedLabel}>
              ⚡ {firedGesture.replace("_", " ")}
            </div>
          )}
        </div>

        <div style={styles.bottomBar}>
          <button
            style={styles.assignBtn}
            onClick={() => setShowAssign(true)}
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

                    const updatedTemplates = templates.filter((t) => t.name !== m.gesture);
                    setTemplates(updatedTemplates);
                    templatesRef.current = updatedTemplates;
                    saveTemplates(updatedTemplates);
                    sendTemplatesToSidecar(updatedTemplates);
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>

        {showAssign && (
          <AssignGesture
            onSave={(template, mapping) => {
              const updatedTemplates = templates.filter((t) => t.name !== template.name);
              updatedTemplates.push(template);
              setTemplates(updatedTemplates);
              templatesRef.current = updatedTemplates;
              saveTemplates(updatedTemplates);
              sendTemplatesToSidecar(updatedTemplates);

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

        {sidecarStatus === "connecting" && (
          <div style={styles.loadingOverlay}>
            <p>Starting hand tracking sidecar...</p>
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
    transform: "scaleX(-1)",
  },
  canvas: {
    position: "absolute",
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    transform: "scaleX(-1)",
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
  statusBadge: {
    color: "#fff",
    fontSize: 12,
    fontFamily: "monospace",
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
    flexDirection: "column",
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
