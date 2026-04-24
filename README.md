# Vision

A macOS desktop app that detects hand gestures via webcam and triggers user-mapped actions — launch apps, fire keyboard shortcuts, or open URLs.

Built with **Tauri v2**, **React**, **TypeScript**, and **MediaPipe HandLandmarker**.

## How It Works

1. **Show open palm** → system arms
2. **Make any gesture** → action fires (app launch, keyboard shortcut, etc.)
3. **Assign Gesture** → capture any hand pose, name it, map it to an action

Gestures are template-matched against your saved poses — no predefined gesture set.

## Features

- Real-time hand tracking at 60 FPS via MediaPipe (WebGPU)
- Template-based gesture recognition — any hand pose can be a gesture
- Gesture → action mapping: app launch, keyboard shortcuts, URLs
- Activation model: open palm arms, next gesture fires, cooldown prevents repeats
- System tray with hide-to-tray on close
- Overlay HUD (configurable) showing armed/fired state
- Settings: camera selection, confidence threshold, overlay toggle
- Multi-hand support (2 hands)

## Development

**Prerequisites:** Node.js, Rust, Xcode Command Line Tools

```bash
npm install
```

**Run (requires ad-hoc codesigning for camera access):**

```bash
# Terminal 1: Vite dev server
npx vite --port 1420

# Terminal 2: Build, sign, and run
cd src-tauri && cargo build \
  && codesign --force --deep --sign - --entitlements entitlements.dev.plist target/debug/vision-tauri \
  && cd .. && TAURI_DEV=1 ./src-tauri/target/debug/vision-tauri
```

> `npm run tauri dev` won't work because the binary needs ad-hoc codesigning with the camera entitlement.

## Build for Distribution

```bash
npm run tauri build
```

Produces a `.dmg` in `src-tauri/target/release/bundle/dmg/`.

## Tech Stack

| Layer | Tech |
|-------|------|
| Shell | Tauri v2 (macOS WKWebView) |
| Frontend | React 19 + TypeScript + Vite |
| Vision | MediaPipe HandLandmarker (WASM/WebGL) |
| Backend | Rust |
| Input Sim | AppleScript via `osascript` |
| Storage | localStorage |

## Limitations

- **macOS only** — uses AppleScript for input sim, `/Applications` for app listing
- **Foreground only** — WKWebView suspends video frame decoding when the window is unfocused (WebKit limitation)

## License

MIT
