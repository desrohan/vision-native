import Foundation
import CoreMedia

/// Orchestrates camera capture, hand tracking, gesture classification,
/// state machine, and input control. Communicates with Tauri via JSON over stdin/stdout.
final class SidecarApp {
    private let camera = CameraCapture()
    private let handTracker = HandTracker()
    private let classifier = GestureClassifier()
    private let stateMachine = GestureStateMachine()
    private let inputController = InputController()
    private let leftGestureDetector = GestureDetector()
    private let rightGestureDetector = GestureDetector()
    private var swipeEnabled = true

    private var paused = false
    private var captureNextTemplate = false

    // FPS tracking
    private var frameCount = 0
    private var lastFpsTime: Double = 0

    // Throttle landmark emission (send every N frames)
    private let landmarkEmitInterval = 3
    private var framesSinceLastEmit = 0

    func run() {
        // Start reading stdin on a background thread
        startStdinReader()

        // Start camera
        do {
            try camera.start { [weak self] sampleBuffer in
                self?.processFrame(sampleBuffer)
            }
            sendOutput(.status(camera: "running", fps: 0))
        } catch {
            sendOutput(.error(message: "Camera failed: \(error)"))
            exit(1)
        }

        // Keep the process alive
        RunLoop.current.run()
    }

    // MARK: - Frame Processing

    private func processFrame(_ sampleBuffer: CMSampleBuffer) {
        guard !paused else { return }

        let now = Double(DispatchTime.now().uptimeNanoseconds) / 1_000_000 // ms

        // FPS tracking
        frameCount += 1
        if now - lastFpsTime >= 1000 {
            sendOutput(.status(camera: "running", fps: frameCount))
            frameCount = 0
            lastFpsTime = now
        }

        // Detect hands
        let hands = handTracker.detect(sampleBuffer: sampleBuffer)

        // Emit landmarks (throttled) — send empty when no hands so frontend clears
        framesSinceLastEmit += 1
        if framesSinceLastEmit >= landmarkEmitInterval {
            framesSinceLastEmit = 0
            let landmarkArrays = hands.map { hand in
                hand.landmarks.map { LandmarkArray(x: $0.x, y: $0.y, z: $0.z) }
            }
            sendOutput(.landmarks(hands: landmarkArrays))
        }

        guard !hands.isEmpty else { return }

        // Template capture mode
        if captureNextTemplate, let firstHand = hands.first {
            captureNextTemplate = false
            let normalized = GestureClassifier.normalizeLandmarks(firstHand.landmarks)
            sendOutput(.templateCaptured(landmarks: normalized))
        }

        // Classify gestures for all hands
        var gestureResults: [GestureResult] = []
        for (i, hand) in hands.enumerated() {
            let result = classifier.classify(
                landmarks: hand.landmarks,
                handIndex: i,
                handedness: hand.handedness
            )
            if result.gesture != "none" {
                sendOutput(.gesture(
                    gesture: result.gesture,
                    confidence: result.confidence,
                    handIndex: i
                ))
            }
            gestureResults.append(result)
        }

        // Update state machine
        let output = stateMachine.update(gestures: gestureResults, now: now)
        sendOutput(.state(
            state: output.state,
            firedGesture: output.firedGesture,
            holdDurationMs: output.holdDurationMs
        ))

        // Cursor hand moves the pointer; the OTHER hand handles pinch/click/drag
        let actionHand = inputController.cursorHand == "Right" ? "Left" : "Right"

        let cursorHandData = hands.first(where: { $0.handedness == inputController.cursorHand })
        let actionHandData = hands.first(where: { $0.handedness == actionHand })

        // Move cursor with the cursor hand's index finger tip (landmark 8)
        if let ch = cursorHandData {
            let indexTip = ch.landmarks[8]
            inputController.moveCursor(x: indexTip.x, y: indexTip.y)
        }

        // Pinch detection on the action hand
        if let ah = actionHandData {
            let thumbTip = ah.landmarks[4]
            let indexTip = ah.landmarks[8]
            inputController.updatePinch(
                thumbTip: LandmarkPoint(x: thumbTip.x, y: thumbTip.y, z: thumbTip.z),
                indexTip: LandmarkPoint(x: indexTip.x, y: indexTip.y, z: indexTip.z),
                now: now
            )
        }

        // Swipe and bunch detection (if enabled)
        if swipeEnabled {
            // Swipe detection — both hands, using per-hand detectors
            for hand in hands {
                let detector = hand.handedness == "Left" ? leftGestureDetector : rightGestureDetector
                let wrist = hand.landmarks[0]
                if let swipe = detector.updateSwipe(wristX: wrist.x, now: now) {
                    switch swipe {
                    case "swipe_left":
                        GestureDetector.switchDesktopRight()
                    case "swipe_right":
                        GestureDetector.switchDesktopLeft()
                    default: break
                    }
                }
            }

            // Fist detection — action hand only
            if let ah = actionHandData {
                let lm = ah.landmarks
                if let action = (ah.handedness == "Left" ? leftGestureDetector : rightGestureDetector).updateFist(
                    wrist: lm[0],
                    indexTip: lm[8], indexMCP: lm[5],
                    middleTip: lm[12], middleMCP: lm[9],
                    ringTip: lm[16], ringMCP: lm[13],
                    pinkyTip: lm[20], pinkyMCP: lm[17],
                    now: now
                ) {
                    switch action {
                    case "mission_control":
                        GestureDetector.missionControl()
                    case "app_expose":
                        GestureDetector.appExpose()
                    default: break
                    }
                }
            }
        }
    }

    // MARK: - Stdin Reader

    private func startStdinReader() {
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            while let line = readLine(strippingNewline: true) {
                guard !line.isEmpty,
                      let json = parseJSONLine(line),
                      let command = InCommand.parse(json) else {
                    continue
                }
                DispatchQueue.main.async {
                    self?.handleCommand(command)
                }
            }
            // stdin closed — parent process terminated
            exit(0)
        }
    }

    // MARK: - Command Handling

    private func handleCommand(_ command: InCommand) {
        switch command {
        case .setTemplates(let templates):
            classifier.templates = templates

        case .setConfig(let config):
            if let debounce = config.debounceMs {
                stateMachine.config.debounceMs = debounce
            }
            if let cooldown = config.cooldownMs {
                stateMachine.config.cooldownMs = cooldown
            }
            if let threshold = config.confidenceThreshold {
                stateMachine.config.confidenceThreshold = threshold
            }
            if let smoothing = config.cursorSmoothing {
                inputController.smoothingFactor = CGFloat(smoothing)
            }
            if let hand = config.cursorHand {
                // Frontend sends "left"/"right", Vision uses "Left"/"Right"
                inputController.cursorHand = hand.capitalized
            }
            if let swipe = config.swipeEnabled {
                swipeEnabled = swipe
            }

        case .captureTemplate:
            captureNextTemplate = true

        case .setCursorEnabled(let enabled):
            inputController.setCursorEnabled(enabled)

        case .pause:
            paused = true

        case .resume:
            paused = false
        }
    }

    // MARK: - Output

    private func sendOutput(_ message: OutMessage) {
        let json = message.toJSON()
        // Thread-safe stdout write
        let line = json + "\n"
        if let data = line.data(using: .utf8) {
            FileHandle.standardOutput.write(data)
        }
    }
}

// MARK: - Entry Point

import AppKit
// Prevent dock icon — this is a background sidecar process
NSApplication.shared.setActivationPolicy(.prohibited)

let app = SidecarApp()
app.run()
