# Vision-native: Swift Sidecar Migration Plan

## Goal
Replace the WebView-based MediaPipe hand tracking with a native Swift sidecar that runs in the background, independent of window state. The app should work even when the window is hidden/closed.

## Current State (copied from Vision-tauri)
- React frontend with MediaPipe HandLandmarker running in WKWebView
- Gesture recognition: open_palm activation → custom gesture → action (app launch, keyboard shortcut, URL)
- User-defined gesture templates stored as normalized 21-landmark arrays (63 floats)
- State machine: idle → armed (open_palm) → fired (custom gesture) → cooldown
- Actions dispatched via Tauri commands (Rust): launch_app, send_keyboard_shortcut, open_url
- Overlay HUD window for visual feedback
- System tray with hide-to-tray behavior

## Architecture

```
Swift Sidecar (background process)
├── AVFoundation camera capture (works without UI)
├── Vision framework VNDetectHumanHandPoseRequest (21 landmarks)
├── Gesture classifier (normalize + template matching, same algorithm)
├── State machine (idle → armed → fired → cooldown)
├── CGEvent input control (mouse move, click, drag, scroll)
└── JSON over stdout/stdin to communicate with Tauri

Tauri Rust Backend
├── Manages sidecar lifecycle (spawn, kill, restart)
├── Reads JSON landmarks/gestures from sidecar stdout
├── Forwards events to frontend via tauri::Event
├── Handles app launch, URL open (keeps these in Rust)
└── Sidecar config commands via stdin

React Frontend (settings UI only)
├── Gesture assignment UI (capture template via sidecar)
├── Action mapping editor
├── Settings (confidence threshold, debounce, cooldown)
├── Live preview when window is visible (optional)
└── No longer runs MediaPipe — purely a config UI
```

## Implementation Steps

### Phase 1: Swift Sidecar
1. Create `src-tauri/sidecar/` as a Swift Package
   - `Package.swift` with targets
   - Binary name: `vision-sidecar`
2. `CameraCapture.swift` — AVFoundation camera session, outputs CMSampleBuffer
3. `HandTracker.swift` — Vision framework hand pose detection, extracts 21 landmarks
4. `GestureClassifier.swift` — Port the normalization + template matching from gestureClassifier.ts
5. `StateMachine.swift` — Port the state machine from stateMachine.ts
6. `InputController.swift` — CGEvent-based mouse/keyboard control
7. `main.swift` — JSON protocol over stdin/stdout, orchestrates everything

### Phase 2: Tauri Integration
1. Add sidecar config to `tauri.conf.json` (`"sidecar"` in bundle config)
2. Add build script to compile Swift package in `beforeBuildCommand`
3. Rust sidecar manager: spawn, read stdout lines, write stdin commands
4. Bridge events to frontend: `sidecar:gesture`, `sidecar:landmarks`, `sidecar:status`
5. Update entitlements: add Accessibility (CGEvent) permission

### Phase 3: Frontend Refactor
1. Remove MediaPipe dependencies and camera code from React
2. CameraPreview becomes a lightweight landmark visualizer (reads from sidecar events)
3. AssignGesture sends "capture" command to sidecar, receives template back
4. Settings UI sends config updates to sidecar via Rust bridge
5. Keep overlay HUD — update it from sidecar events instead of MediaPipe

### Phase 4: Build & Distribution
1. `beforeBuildCommand` script: build Swift sidecar → copy to `src-tauri/binaries/`
2. Binary naming convention: `vision-sidecar-aarch64-apple-darwin` (Tauri requirement)
3. Entitlements for both main app and sidecar in the .dmg bundle
4. Test full flow: install .dmg → grant camera + accessibility → gestures work with window closed

## JSON Protocol (stdin/stdout between Tauri and Sidecar)

### Sidecar → Tauri (stdout, one JSON per line)
```json
{"type":"landmarks","hands":[{"landmarks":[[x,y,z],...],"handedness":"Left"}]}
{"type":"gesture","gesture":"open_palm","confidence":0.95,"handIndex":0}
{"type":"state","state":"armed","firedGesture":null,"holdDurationMs":350}
{"type":"action_executed","gesture":"peace_sign","action":"click","success":true}
{"type":"status","camera":"running","fps":30}
{"type":"error","message":"Camera access denied"}
```

### Tauri → Sidecar (stdin, one JSON per line)
```json
{"cmd":"set_templates","templates":[{"name":"peace","landmarks":[...]}]}
{"cmd":"set_config","config":{"debounceMs":200,"cooldownMs":500,"confidenceThreshold":0.7}}
{"cmd":"capture_template"}
{"cmd":"set_action_mappings","mappings":[{"gesture":"peace","action":{"type":"click"}}]}
{"cmd":"pause"}
{"cmd":"resume"}
```

## Key Differences from MediaPipe Version
- Vision framework landmark indices map differently — need to verify joint ordering
- Vision uses VNRecognizedPoint with identifier strings, not index numbers
- Normalization should use the same wrist-relative, scale-by-wrist-to-MCP9 approach
- CGEvent requires Accessibility permission (user grants in System Preferences > Privacy)
- New action types possible: `click`, `right_click`, `drag`, `scroll`, `cursor_move`

## Permissions Needed (entitlements)
- `com.apple.security.device.camera` (already have)
- Accessibility access for CGEvent (runtime permission, not entitlement)
- App Sandbox may need to be disabled for CGEvent to work, or use specific entitlements
