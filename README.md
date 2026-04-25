# Gestus

A macOS desktop app that lets you control your computer with hand gestures via webcam — move the cursor, click, switch desktops, and trigger custom actions, all hands-free.

Built with **Tauri v2**, **React**, **TypeScript**, and a native **Swift sidecar** using Apple's **Vision framework**.

## How It Works

**Split-hand model:** one hand controls the cursor, the other performs actions.

- **Move cursor** — point with your index finger (cursor hand)
- **Click** — pinch thumb + index finger (action hand)
- **Drag** — hold pinch for 350ms, move, release to drop
- **Switch desktops** — swipe left/right with either hand
- **Mission Control** — close fist (action hand)
- **App Exposé** — open fist (action hand)
- **Custom gestures** — show open palm to arm, then make any gesture to fire a mapped action (app launch, keyboard shortcut, URL)

## Features

- Native hand tracking via Apple Vision framework (25-30 FPS)
- Split-hand cursor/action model with configurable hand preference
- Pinch-to-click with 3-frame debounce (no ghost clicks)
- Hold-to-drag with configurable threshold
- Swipe gestures for desktop switching (configurable toggle)
- Fist open/close for Mission Control and App Exposé
- Template-based gesture recognition — any hand pose can be a gesture
- Gesture → action mapping: app launch, keyboard shortcuts, URLs
- Cursor smoothing slider
- System tray with hide-to-tray on close
- Overlay HUD (configurable) showing armed/fired state
- Camera preview with landmark overlay
- Multi-hand support (2 hands)

## Architecture

The app runs as a Tauri shell with a Swift sidecar process:

```
Tauri (Rust) ←→ JSON over stdin/stdout ←→ Swift Sidecar
     ↑                                         ↓
  React UI                              AVFoundation (camera)
                                        Vision (hand tracking)
                                        CoreGraphics (cursor/click)
                                        AppleScript (desktop switching)
```

The sidecar owns the camera and hand tracking pipeline. It streams landmarks and gesture events to the Tauri frontend over JSON. Cursor movement and click simulation happen natively in Swift via `CGEvent`. Desktop switching uses AppleScript through `System Events` for reliability.

## Development

**Prerequisites:** Node.js, Rust, Xcode Command Line Tools, Swift 6+

```bash
npm install
```

**Build the Swift sidecar:**

```bash
npm run build:sidecar
```

**Run in development:**

```bash
npx tauri dev
```

> **Permissions required:** Camera access and Accessibility (System Settings → Privacy & Security). The app will prompt on first launch.

## Build for Distribution

```bash
npm run build:sidecar
npx tauri build
```

Produces `Gestus.app` and `Gestus_0.1.0_aarch64.dmg` in `src-tauri/target/release/bundle/`.

## Tech Stack

| Layer | Tech |
|-------|------|
| Shell | Tauri v2 (macOS WKWebView) |
| Frontend | React 19 + TypeScript + Vite |
| Hand Tracking | Apple Vision framework (Swift sidecar) |
| Input Simulation | CoreGraphics (`CGEvent`) + AppleScript |
| Backend | Rust (sidecar lifecycle, tray, IPC) |
| Storage | localStorage |

## Project Structure

```
src/                    # React frontend
  components/           # CameraPreview, Settings, AssignGesture
  engine/               # settings, storage, overlayManager
src-tauri/
  src/                  # Rust backend (sidecar spawn, tray, commands)
  sidecar/              # Swift package
    Sources/VisionSidecar/
      main.swift            # Orchestrator
      CameraCapture.swift   # AVFoundation camera
      HandTracker.swift     # Vision hand pose detection
      GestureClassifier.swift  # Template matching
      GestureDetector.swift    # Swipe + fist detection
      InputController.swift    # Cursor, click, drag
      StateMachine.swift       # idle → armed → fired → cooldown
      Protocol.swift           # JSON IPC protocol
```

## Limitations

- **macOS only** — uses Apple Vision framework, CoreGraphics, and AppleScript
- **Apple Silicon / Intel** — builds natively for the host architecture
- **Accessibility permission** required for cursor control and keyboard simulation

## License

MIT
