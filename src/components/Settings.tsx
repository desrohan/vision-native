import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { loadSettings, saveSettings, AppSettings } from "../engine/settings";
import { createOverlayWindow, destroyOverlayWindow } from "../engine/overlayManager";

export default function Settings() {
  const [settings, setSettings] = useState<AppSettings>(loadSettings());

  const update = (partial: Partial<AppSettings>) => {
    const updated = { ...settings, ...partial };
    setSettings(updated);
    saveSettings(updated);

    // Send config update to sidecar
    const msg = JSON.stringify({
      cmd: "set_config",
      config: {
        confidenceThreshold: updated.confidenceThreshold,
        cursorSmoothing: updated.cursorSmoothing,
        cursorHand: updated.cursorHand,
        swipeEnabled: updated.swipeEnabled,
      },
    });
    invoke("sidecar_send", { message: msg }).catch(console.error);

    // Send cursor enable/disable
    if ("cursorEnabled" in partial) {
      const cursorMsg = JSON.stringify({
        cmd: "set_cursor_enabled",
        enabled: updated.cursorEnabled,
      });
      invoke("sidecar_send", { message: cursorMsg }).catch(console.error);
    }

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

        {/* Cursor Tracking */}
        <div style={styles.section}>
          <h3 style={styles.sectionTitle}>Cursor Tracking</h3>
          <div style={styles.toggleRow}>
            <span style={styles.toggleLabel}>
              Control cursor with hand position
            </span>
            <button
              style={{
                ...styles.toggle,
                background: settings.cursorEnabled ? "#00FF88" : "#333",
              }}
              onClick={() =>
                update({ cursorEnabled: !settings.cursorEnabled })
              }
            >
              <div
                style={{
                  ...styles.toggleKnob,
                  transform: settings.cursorEnabled
                    ? "translateX(20px)"
                    : "translateX(2px)",
                }}
              />
            </button>
          </div>
          <p style={styles.hint}>
            Move your index finger to control the mouse cursor.
            Requires Accessibility permission in System Settings.
          </p>
          {settings.cursorEnabled && (
            <>
              <label style={{ ...styles.label, marginTop: 16 }}>
                Cursor Smoothing:{" "}
                <span style={styles.value}>
                  {Math.round((settings.cursorSmoothing ?? 0.7) * 100)}%
                </span>
              </label>
              <input
                type="range"
                min="0"
                max="0.95"
                step="0.05"
                value={settings.cursorSmoothing ?? 0.7}
                onChange={(e) =>
                  update({ cursorSmoothing: parseFloat(e.target.value) })
                }
                style={styles.slider}
              />
              <div style={styles.sliderLabels}>
                <span>Responsive (0%)</span>
                <span>Smooth (95%)</span>
              </div>

              <label style={{ ...styles.label, marginTop: 16 }}>
                Tracking Hand
              </label>
              <div style={{ display: "flex", gap: 8 }}>
                {(["right", "left"] as const).map((hand) => (
                  <button
                    key={hand}
                    style={{
                      flex: 1,
                      padding: "8px 12px",
                      borderRadius: 6,
                      border: settings.cursorHand === hand ? "1px solid #00FF88" : "1px solid #333",
                      background: settings.cursorHand === hand ? "rgba(0,255,136,0.15)" : "#151515",
                      color: settings.cursorHand === hand ? "#00FF88" : "#888",
                      fontFamily: "monospace",
                      fontSize: 13,
                      cursor: "pointer",
                      fontWeight: settings.cursorHand === hand ? 700 : 400,
                    }}
                    onClick={() => update({ cursorHand: hand })}
                  >
                    {hand === "right" ? "✋ Right" : "🤚 Left"}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Swipe Gestures */}
        <div style={styles.section}>
          <h3 style={styles.sectionTitle}>Swipe Gestures</h3>
          <div style={styles.toggleRow}>
            <span style={styles.toggleLabel}>
              Swipe to switch desktops
            </span>
            <button
              style={{
                ...styles.toggle,
                background: settings.swipeEnabled ? "#00FF88" : "#333",
              }}
              onClick={() =>
                update({ swipeEnabled: !settings.swipeEnabled })
              }
            >
              <div
                style={{
                  ...styles.toggleKnob,
                  transform: settings.swipeEnabled
                    ? "translateX(20px)"
                    : "translateX(2px)",
                }}
              />
            </button>
          </div>
          <p style={styles.hint}>
            Swipe left or right with either hand to switch desktops.
            Bunch fingers for Mission Control, spread for App Exposé.
          </p>
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
          <p style={styles.aboutText}>Gestus v0.1.0</p>
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
