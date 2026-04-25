import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { GestureTemplate } from "../engine/gestureClassifier";
import { GestureMapping } from "../engine/actionDispatcher";

type Step = "capture" | "name" | "choose" | "shortcut" | "app" | "url";

interface Props {
  onSave: (template: GestureTemplate, mapping: GestureMapping) => void;
  onCancel: () => void;
}

export default function AssignGesture({ onSave, onCancel }: Props) {
  const [step, setStep] = useState<Step>("capture");
  const [countdown, setCountdown] = useState(3);
  const [capturedLandmarks, setCapturedLandmarks] = useState<number[] | null>(null);
  const [gestureName, setGestureName] = useState("");
  const [keys, setKeys] = useState<string[]>([]);
  const [apps, setApps] = useState<string[]>([]);
  const [appSearch, setAppSearch] = useState("");
  const [loadingApps, setLoadingApps] = useState(false);
  const [waitingForCapture, setWaitingForCapture] = useState(false);
  const [urlInput, setUrlInput] = useState("");

  // Step 1: Countdown then request sidecar to capture template
  useEffect(() => {
    if (step !== "capture") return;

    setCountdown(3);
    const interval = window.setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [step]);

  // When countdown hits 0, send capture command to sidecar
  useEffect(() => {
    if (step === "capture" && countdown === 0 && !waitingForCapture) {
      setWaitingForCapture(true);
      const msg = JSON.stringify({ cmd: "capture_template" });
      invoke("sidecar_send", { message: msg }).catch(console.error);
    }
  }, [countdown, step, waitingForCapture]);

  // Listen for template_captured event from sidecar
  useEffect(() => {
    const unlisten = listen<any>("sidecar:template_captured", (event) => {
      const landmarks = event.payload.landmarks as number[];
      if (landmarks && landmarks.length === 63) {
        setCapturedLandmarks(landmarks);
        setStep("name");
        setWaitingForCapture(false);
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Load apps when entering app step
  useEffect(() => {
    if (step !== "app") return;
    setLoadingApps(true);
    invoke<string[]>("get_installed_apps")
      .then((result) => {
        setApps(result);
        setLoadingApps(false);
      })
      .catch((err) => {
        console.error("Failed to list apps:", err);
        setLoadingApps(false);
      });
  }, [step]);

  // Key capture for shortcuts
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (step !== "shortcut") return;
      e.preventDefault();
      e.stopPropagation();

      const parts: string[] = [];
      if (e.metaKey) parts.push("cmd");
      if (e.ctrlKey) parts.push("ctrl");
      if (e.altKey) parts.push("alt");
      if (e.shiftKey) parts.push("shift");

      const key = e.key.toLowerCase();
      if (!["meta", "control", "alt", "shift"].includes(key)) {
        parts.push(key);
      }

      if (parts.length > 0) {
        setKeys(parts);
      }
    },
    [step]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const handleSaveShortcut = () => {
    if (keys.length === 0 || !capturedLandmarks || !gestureName.trim()) return;
    const name = gestureName.trim();
    onSave(
      { name, landmarks: capturedLandmarks },
      {
        gesture: name,
        action: {
          type: "keyboard_shortcut",
          value: keys.join("+"),
          label: keys.join(" + ").toUpperCase(),
        },
      }
    );
  };

  const handleSelectApp = (appName: string) => {
    if (!capturedLandmarks || !gestureName.trim()) return;
    const name = gestureName.trim();
    onSave(
      { name, landmarks: capturedLandmarks },
      {
        gesture: name,
        action: {
          type: "app_launch",
          value: appName,
          label: `Open ${appName}`,
        },
      }
    );
  };

  const handleSaveUrl = () => {
    if (!urlInput.trim() || !capturedLandmarks || !gestureName.trim()) return;
    const name = gestureName.trim();
    let finalUrl = urlInput.trim();
    if (!finalUrl.includes("://")) {
      finalUrl = `https://${finalUrl}`;
    }
    onSave(
      { name, landmarks: capturedLandmarks },
      {
        gesture: name,
        action: {
          type: "url",
          value: finalUrl,
          label: `Open ${finalUrl}`,
        },
      }
    );
  };

  const filteredApps = apps.filter((a) =>
    a.toLowerCase().includes(appSearch.toLowerCase())
  );

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        {/* Step 1: Capture hand pose */}
        {step === "capture" && (
          <>
            <h2 style={styles.title}>Hold Your Gesture</h2>
            <p style={styles.subtitle}>
              {waitingForCapture
                ? "Capturing..."
                : "Show your hand to the camera and hold steady!"}
            </p>
            <div style={styles.countdown}>
              {waitingForCapture ? "📸" : countdown > 0 ? countdown : "✓"}
            </div>
            <p style={styles.hint}>
              Make any hand shape you want (open palm is reserved for activation)
            </p>
            <button style={styles.cancelBtn} onClick={onCancel}>
              Cancel
            </button>
          </>
        )}

        {/* Step 2: Name the gesture */}
        {step === "name" && (
          <>
            <h2 style={styles.title}>Gesture Captured!</h2>
            <p style={styles.subtitle}>Give this gesture a name</p>
            <input
              style={styles.searchInput}
              type="text"
              placeholder="e.g. peace sign, thumbs up, fist..."
              value={gestureName}
              onChange={(e) => setGestureName(e.target.value)}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && gestureName.trim()) setStep("choose");
              }}
            />
            <div style={styles.choiceRow}>
              <button style={styles.cancelBtn} onClick={() => { setStep("capture"); setCountdown(3); setWaitingForCapture(false); }}>
                ← Recapture
              </button>
              <button
                style={{
                  ...styles.saveBtn,
                  opacity: gestureName.trim() ? 1 : 0.4,
                }}
                onClick={() => gestureName.trim() && setStep("choose")}
                disabled={!gestureName.trim()}
              >
                Next →
              </button>
            </div>
          </>
        )}

        {/* Step 3: Choose action type */}
        {step === "choose" && (
          <>
            <h2 style={styles.title}>
              <span style={styles.highlight}>{gestureName}</span>
            </h2>
            <p style={styles.subtitle}>What should this gesture do?</p>
            <div style={styles.choiceRow}>
              <button
                style={styles.choiceBtn}
                onClick={() => setStep("shortcut")}
              >
                ⌨️ Keyboard Shortcut
              </button>
              <button
                style={styles.choiceBtn}
                onClick={() => setStep("app")}
              >
                🚀 Launch App
              </button>
              <button
                style={styles.choiceBtn}
                onClick={() => setStep("url")}
              >
                🔗 Open URL
              </button>
            </div>
            <button style={styles.cancelBtn} onClick={() => setStep("name")}>
              ← Back
            </button>
          </>
        )}

        {/* Step 4a: Shortcut capture */}
        {step === "shortcut" && (
          <>
            <h2 style={styles.title}>Press Your Shortcut</h2>
            <p style={styles.subtitle}>
              Press the key combination you want to assign
            </p>
            <div style={styles.keyDisplay}>
              {keys.length > 0
                ? keys.map((k, i) => (
                    <span key={i} style={styles.keyBadge}>
                      {k.toUpperCase()}
                    </span>
                  ))
                : <span style={styles.keyPlaceholder}>Waiting for keys...</span>}
            </div>
            <div style={styles.choiceRow}>
              <button style={styles.cancelBtn} onClick={() => { setStep("choose"); setKeys([]); }}>
                ← Back
              </button>
              <button
                style={{
                  ...styles.saveBtn,
                  opacity: keys.length === 0 ? 0.4 : 1,
                }}
                onClick={handleSaveShortcut}
                disabled={keys.length === 0}
              >
                Save
              </button>
            </div>
          </>
        )}

        {/* Step 4b: App selection */}
        {step === "app" && (
          <>
            <h2 style={styles.title}>Select an App</h2>
            <input
              style={styles.searchInput}
              type="text"
              placeholder="Search apps..."
              value={appSearch}
              onChange={(e) => setAppSearch(e.target.value)}
              autoFocus
            />
            <div style={styles.appList}>
              {loadingApps ? (
                <p style={styles.loadingText}>Loading apps...</p>
              ) : filteredApps.length === 0 ? (
                <p style={styles.loadingText}>No apps found</p>
              ) : (
                filteredApps.map((app) => (
                  <button
                    key={app}
                    style={styles.appItem}
                    onClick={() => handleSelectApp(app)}
                  >
                    {app}
                  </button>
                ))
              )}
            </div>
            <button style={styles.cancelBtn} onClick={() => setStep("choose")}>
              ← Back
            </button>
          </>
        )}

        {/* Step 4c: URL input */}
        {step === "url" && (
          <>
            <h2 style={styles.title}>Enter a URL</h2>
            <p style={styles.subtitle}>
              What website should this gesture open?
            </p>
            <input
              style={styles.searchInput}
              type="text"
              placeholder="e.g. google.com"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && urlInput.trim()) handleSaveUrl();
              }}
            />
            <div style={styles.choiceRow}>
              <button style={styles.cancelBtn} onClick={() => { setStep("choose"); setUrlInput(""); }}>
                ← Back
              </button>
              <button
                style={{
                  ...styles.saveBtn,
                  opacity: urlInput.trim() ? 1 : 0.4,
                }}
                onClick={handleSaveUrl}
                disabled={!urlInput.trim()}
              >
                Save
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.85)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 100,
  },
  modal: {
    background: "#1a1a1a",
    borderRadius: 16,
    padding: "32px 40px",
    minWidth: 380,
    maxWidth: 480,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 16,
    border: "1px solid #333",
  },
  title: {
    color: "#fff",
    fontSize: 22,
    fontFamily: "monospace",
    margin: 0,
    textAlign: "center",
  },
  subtitle: {
    color: "#aaa",
    fontSize: 14,
    fontFamily: "monospace",
    margin: 0,
    textAlign: "center",
  },
  countdown: {
    fontSize: 64,
    fontFamily: "monospace",
    fontWeight: 700,
    color: "#00FF88",
    margin: "16px 0",
  },
  hint: {
    color: "#666",
    fontSize: 12,
    fontFamily: "monospace",
    textAlign: "center",
  },
  cancelBtn: {
    background: "transparent",
    border: "1px solid #444",
    borderRadius: 8,
    color: "#aaa",
    fontSize: 13,
    fontFamily: "monospace",
    padding: "8px 16px",
    cursor: "pointer",
  },
  saveBtn: {
    background: "#00FF88",
    border: "none",
    borderRadius: 8,
    color: "#000",
    fontSize: 13,
    fontFamily: "monospace",
    fontWeight: 700,
    padding: "8px 20px",
    cursor: "pointer",
  },
  highlight: {
    color: "#00FF88",
  },
  choiceRow: {
    display: "flex",
    gap: 12,
    marginTop: 8,
  },
  choiceBtn: {
    background: "#222",
    border: "1px solid #444",
    borderRadius: 12,
    color: "#fff",
    fontSize: 15,
    fontFamily: "monospace",
    padding: "16px 24px",
    cursor: "pointer",
    transition: "background 0.15s",
  },
  keyDisplay: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
    justifyContent: "center",
    minHeight: 48,
    alignItems: "center",
  },
  keyBadge: {
    background: "#333",
    color: "#00FF88",
    fontFamily: "monospace",
    fontSize: 18,
    fontWeight: 700,
    padding: "8px 14px",
    borderRadius: 6,
    border: "1px solid #555",
  },
  keyPlaceholder: {
    color: "#555",
    fontFamily: "monospace",
    fontSize: 14,
  },
  searchInput: {
    width: "100%",
    background: "#111",
    border: "1px solid #333",
    borderRadius: 8,
    color: "#fff",
    fontSize: 15,
    fontFamily: "monospace",
    padding: "10px 14px",
    outline: "none",
    boxSizing: "border-box",
  },
  appList: {
    width: "100%",
    maxHeight: 240,
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  appItem: {
    background: "#222",
    border: "none",
    borderRadius: 6,
    color: "#fff",
    fontSize: 14,
    fontFamily: "monospace",
    padding: "10px 14px",
    cursor: "pointer",
    textAlign: "left",
  },
  loadingText: {
    color: "#666",
    fontSize: 14,
    fontFamily: "monospace",
    textAlign: "center",
    padding: 20,
  },
};
