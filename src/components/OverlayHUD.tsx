import { useState, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

interface GestureStatePayload {
  state: string;
  firedGesture: string | null;
}

export default function OverlayHUD() {
  const [state, setState] = useState("idle");
  const [lastFired, setLastFired] = useState<string | null>(null);

  useEffect(() => {
    // Make window click-through and transparent
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
    const root = document.getElementById("root");
    if (root) root.style.background = "transparent";

    getCurrentWindow().setIgnoreCursorEvents(true).catch(console.error);

    const unlisten = listen<GestureStatePayload>("gesture-state", (event) => {
      setState(event.payload.state);
      if (event.payload.firedGesture) {
        setLastFired(event.payload.firedGesture);
        setTimeout(() => setLastFired(null), 2000);
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const stateColors: Record<string, string> = {
    idle: "rgba(255,255,255,0.12)",
    armed: "rgba(0,255,136,0.85)",
    fired: "rgba(255,200,0,0.9)",
    cooldown: "rgba(255,107,107,0.7)",
  };

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 4,
        background: "transparent",
        fontFamily: "monospace",
        userSelect: "none",
      }}
    >
      <div
        style={{
          fontSize: 13,
          fontWeight: 700,
          padding: "4px 16px",
          borderRadius: 6,
          background: stateColors[state] || stateColors.idle,
          color: state === "idle" ? "#888" : "#000",
          letterSpacing: 1,
        }}
      >
        {state.toUpperCase()}
      </div>
      {lastFired && (
        <div
          style={{
            fontSize: 11,
            color: "#FFD700",
            fontWeight: 600,
            background: "rgba(0,0,0,0.7)",
            padding: "2px 10px",
            borderRadius: 4,
          }}
        >
          ⚡ {lastFired}
        </div>
      )}
    </div>
  );
}
