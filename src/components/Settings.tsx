import { useState, useEffect } from "react";
import { loadSettings, saveSettings, AppSettings } from "../engine/settings";
import { createOverlayWindow, destroyOverlayWindow } from "../engine/overlayManager";

export default function Settings() {
  const [settings, setSettings] = useState<AppSettings>(loadSettings());
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);

  useEffect(() => {
    navigator.mediaDevices
      .enumerateDevices()
      .then((devices) => {
        setCameras(devices.filter((d) => d.kind === "videoinput"));
      })
      .catch(console.error);
  }, []);

  const update = (partial: Partial<AppSettings>) => {
    const updated = { ...settings, ...partial };
    setSettings(updated);
    saveSettings(updated);

    // Handle overlay toggle
    if ("showOverlayHUD" in partial) {
      if (partial.showOverlayHUD) {
        createOverlayWindow();
      } else {
        destroyOverlayWindow();
      }
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.inner}>
        {/* Header */}
        <div style={styles.header}>
          <button
            style={styles.backBtn}
            onClick={() => {
              window.location.hash = "#/";
            }}
          >
            ← Back
          </button>
          <h1 style={styles.title}>Settings</h1>
          <div style={{ width: 70 }} />
        </div>

        {/* Camera */}
        <div style={styles.section}>
          <h3 style={styles.sectionTitle}>Camera</h3>
          <select
            style={styles.select}
            value={settings.cameraDeviceId}
            onChange={(e) => update({ cameraDeviceId: e.target.value })}
          >
            <option value="">Default Camera</option>
            {cameras.map((cam) => (
              <option key={cam.deviceId} value={cam.deviceId}>
                {cam.label || `Camera ${cam.deviceId.slice(0, 8)}`}
              </option>
            ))}
          </select>
        </div>

        {/* Confidence threshold */}
        <div style={styles.section}>
          <h3 style={styles.sectionTitle}>Recognition</h3>
          <label style={styles.label}>
            Confidence Threshold:{" "}
            <span style={styles.value}>
              {Math.round(settings.confidenceThreshold * 100)}%
            </span>
          </label>
          <input
            type="range"
            min="0.3"
            max="1.0"
            step="0.05"
            value={settings.confidenceThreshold}
            onChange={(e) =>
              update({ confidenceThreshold: parseFloat(e.target.value) })
            }
            style={styles.slider}
          />
          <div style={styles.sliderLabels}>
            <span>Loose (30%)</span>
            <span>Strict (100%)</span>
          </div>
        </div>

        {/* Overlay HUD */}
        <div style={styles.section}>
          <h3 style={styles.sectionTitle}>Overlay HUD</h3>
          <div style={styles.toggleRow}>
            <span style={styles.toggleLabel}>
              Show floating state indicator
            </span>
            <button
              style={{
                ...styles.toggle,
                background: settings.showOverlayHUD ? "#00FF88" : "#333",
              }}
              onClick={() =>
                update({ showOverlayHUD: !settings.showOverlayHUD })
              }
            >
              <div
                style={{
                  ...styles.toggleKnob,
                  transform: settings.showOverlayHUD
                    ? "translateX(20px)"
                    : "translateX(2px)",
                }}
              />
            </button>
          </div>
          <p style={styles.hint}>
            A small always-on-top indicator showing the current gesture state
            (idle, armed, fired).
          </p>
        </div>

        {/* About */}
        <div style={styles.section}>
          <h3 style={styles.sectionTitle}>About</h3>
          <p style={styles.aboutText}>Vision v0.1.0</p>
          <p style={styles.hint}>Gesture-based app launcher for macOS</p>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    width: "100vw",
    height: "100vh",
    background: "#0a0a0a",
    overflow: "auto",
    display: "flex",
    justifyContent: "center",
  },
  inner: {
    width: "100%",
    maxWidth: 520,
    padding: "24px 32px",
    display: "flex",
    flexDirection: "column",
    gap: 0,
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 32,
  },
  backBtn: {
    background: "transparent",
    border: "1px solid #444",
    borderRadius: 6,
    color: "#aaa",
    fontSize: 14,
    fontFamily: "monospace",
    padding: "6px 14px",
    cursor: "pointer",
  },
  title: {
    color: "#fff",
    fontSize: 22,
    fontFamily: "monospace",
    fontWeight: 700,
    margin: 0,
  },
  section: {
    borderTop: "1px solid #222",
    padding: "20px 0",
  },
  sectionTitle: {
    color: "#888",
    fontSize: 12,
    fontFamily: "monospace",
    fontWeight: 600,
    textTransform: "uppercase" as const,
    letterSpacing: 1.5,
    margin: "0 0 12px 0",
  },
  label: {
    color: "#ccc",
    fontSize: 14,
    fontFamily: "monospace",
    display: "block",
    marginBottom: 8,
  },
  value: {
    color: "#00FF88",
    fontWeight: 700,
  },
  select: {
    width: "100%",
    padding: "10px 12px",
    fontSize: 14,
    fontFamily: "monospace",
    background: "#151515",
    border: "1px solid #333",
    borderRadius: 6,
    color: "#fff",
    outline: "none",
    cursor: "pointer",
    appearance: "none" as const,
    WebkitAppearance: "none" as const,
  },
  slider: {
    width: "100%",
    accentColor: "#00FF88",
    cursor: "pointer",
  },
  sliderLabels: {
    display: "flex",
    justifyContent: "space-between",
    color: "#555",
    fontSize: 11,
    fontFamily: "monospace",
    marginTop: 4,
  },
  toggleRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  toggleLabel: {
    color: "#ccc",
    fontSize: 14,
    fontFamily: "monospace",
  },
  toggle: {
    width: 44,
    height: 24,
    borderRadius: 12,
    border: "none",
    cursor: "pointer",
    position: "relative" as const,
    transition: "background 0.2s",
    flexShrink: 0,
  },
  toggleKnob: {
    width: 20,
    height: 20,
    borderRadius: 10,
    background: "#fff",
    position: "absolute" as const,
    top: 2,
    transition: "transform 0.2s",
  },
  hint: {
    color: "#555",
    fontSize: 12,
    fontFamily: "monospace",
    marginTop: 8,
    lineHeight: 1.4,
  },
  aboutText: {
    color: "#fff",
    fontSize: 14,
    fontFamily: "monospace",
    margin: 0,
  },
};
