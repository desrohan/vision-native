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

        guard !hands.isEmpty else { return }

        // Emit landmarks (throttled)
        framesSinceLastEmit += 1
        if framesSinceLastEmit >= landmarkEmitInterval {
            framesSinceLastEmit = 0
            let landmarkArrays = hands.map { hand in
                hand.landmarks.map { LandmarkArray(x: $0.x, y: $0.y, z: $0.z) }
            }
            sendOutput(.landmarks(hands: landmarkArrays))
        }

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

        // Cursor tracking: use index finger tip (landmark 8) of first hand
        if let firstHand = hands.first {
            let indexTip = firstHand.landmarks[8]
            inputController.moveCursor(x: indexTip.x, y: indexTip.y)
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

let app = SidecarApp()
app.run()
