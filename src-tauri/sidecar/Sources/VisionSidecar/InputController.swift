import CoreGraphics
import AppKit

/// Pinch state for click/drag/zoom detection.
enum PinchState {
    case open
    case pinched    // thumb+index touching
    case dragging   // pinch held for drag threshold
}

/// Handles cursor movement and input simulation via CGEvent.
final class InputController {
    private var screenWidth: CGFloat = 0
    private var screenHeight: CGFloat = 0
    private var cursorEnabled = false

    /// Smoothing factor for cursor movement (0 = no smoothing, 1 = max smoothing).
    var smoothingFactor: CGFloat = 0.7

    /// Which hand to track: "Left" or "Right" (Vision framework chirality).
    var cursorHand: String = "Right"

    private var lastCursorX: CGFloat = 0
    private var lastCursorY: CGFloat = 0
    private var initialized = false

    // Pinch tracking
    private var pinchState: PinchState = .open
    private var pinchStartTime: Double = 0
    private let dragThresholdMs: Double = 350 // hold pinch this long to start drag
    private let pinchDistanceThreshold: Float = 0.04 // normalized distance for "pinched"
    private let pinchReleaseThreshold: Float = 0.07 // slightly larger to avoid flicker
    private var pinchFrameCount: Int = 0 // debounce: require N consecutive pinch frames
    private let pinchFramesRequired: Int = 3 // must be pinched for 3 frames before registering

    // Two-hand zoom tracking
    private var lastTwoHandDistance: Float? = nil

    init() {
        updateScreenSize()
    }

    private func updateScreenSize() {
        if let screen = NSScreen.main {
            screenWidth = screen.frame.width
            screenHeight = screen.frame.height
        }
    }

    /// Enable/disable cursor tracking.
    func setCursorEnabled(_ enabled: Bool) {
        cursorEnabled = enabled
        if !enabled {
            initialized = false
            releaseDrag()
            pinchState = .open
        }
    }

    /// Move cursor based on index finger tip (normalized 0..1).
    func moveCursor(x: Float, y: Float) {
        guard cursorEnabled else { return }

        let targetX = CGFloat(1.0 - x) * screenWidth
        let targetY = CGFloat(y) * screenHeight

        let smoothedX: CGFloat
        let smoothedY: CGFloat

        if !initialized {
            smoothedX = targetX
            smoothedY = targetY
            initialized = true
        } else {
            smoothedX = lastCursorX * smoothingFactor + targetX * (1 - smoothingFactor)
            smoothedY = lastCursorY * smoothingFactor + targetY * (1 - smoothingFactor)
        }

        lastCursorX = smoothedX
        lastCursorY = smoothedY

        let point = CGPoint(x: smoothedX, y: smoothedY)

        if pinchState == .dragging {
            // While dragging, send leftMouseDragged events
            if let event = CGEvent(mouseEventSource: nil, mouseType: .leftMouseDragged, mouseCursorPosition: point, mouseButton: .left) {
                event.post(tap: .cghidEventTap)
            }
        } else {
            if let event = CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: point, mouseButton: .left) {
                event.post(tap: .cghidEventTap)
            }
        }
    }

    /// Update pinch state based on thumb tip (4) and index tip (8) distance.
    /// Call every frame with the current distance and timestamp.
    func updatePinch(thumbTip: LandmarkPoint, indexTip: LandmarkPoint, now: Double) {
        guard cursorEnabled else { return }

        let dx = thumbTip.x - indexTip.x
        let dy = thumbTip.y - indexTip.y
        let dz = thumbTip.z - indexTip.z
        let distance = sqrt(dx * dx + dy * dy + dz * dz)

        let isPinched = distance < pinchDistanceThreshold
        let isReleased = distance > pinchReleaseThreshold

        switch pinchState {
        case .open:
            if isPinched {
                pinchFrameCount += 1
                if pinchFrameCount >= pinchFramesRequired {
                    pinchState = .pinched
                    pinchStartTime = now
                    pinchFrameCount = 0
                }
            } else {
                pinchFrameCount = 0
            }

        case .pinched:
            if isReleased {
                // Quick pinch-release = click
                pinchState = .open
                click()
            } else if now - pinchStartTime >= dragThresholdMs {
                // Held long enough = start drag
                pinchState = .dragging
                startDrag()
            }

        case .dragging:
            if isReleased {
                // Release drag
                pinchState = .open
                releaseDrag()
            }
        }
    }

    /// Handle two-hand pinch zoom.
    /// Pass the index finger tips of both hands.
    func updateTwoHandZoom(hand1IndexTip: LandmarkPoint, hand2IndexTip: LandmarkPoint) {
        guard cursorEnabled else { return }

        let dx = hand1IndexTip.x - hand2IndexTip.x
        let dy = hand1IndexTip.y - hand2IndexTip.y
        let currentDist = sqrt(dx * dx + dy * dy)

        if let lastDist = lastTwoHandDistance {
            let delta = currentDist - lastDist
            // Scale delta to scroll amount — positive = zoom in, negative = zoom out
            if abs(delta) > 0.005 {
                let scrollAmount = Int32(delta * 500)
                zoom(delta: scrollAmount)
            }
        }

        lastTwoHandDistance = currentDist
    }

    func resetTwoHandZoom() {
        lastTwoHandDistance = nil
    }

    // MARK: - Low-level input

    private func click() {
        let pos = CGPoint(x: lastCursorX, y: lastCursorY)
        if let down = CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: pos, mouseButton: .left),
           let up = CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: pos, mouseButton: .left) {
            down.post(tap: .cghidEventTap)
            // Small delay between down and up for reliable click
            usleep(20_000) // 20ms
            up.post(tap: .cghidEventTap)
        }
    }

    private func startDrag() {
        let pos = CGPoint(x: lastCursorX, y: lastCursorY)
        if let down = CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: pos, mouseButton: .left) {
            down.post(tap: .cghidEventTap)
        }
    }

    private func releaseDrag() {
        let pos = CGPoint(x: lastCursorX, y: lastCursorY)
        if let up = CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: pos, mouseButton: .left) {
            up.post(tap: .cghidEventTap)
        }
    }

    private func zoom(delta: Int32) {
        // Use scroll with cmd held for pinch-to-zoom behavior
        if let event = CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 1, wheel1: delta, wheel2: 0, wheel3: 0) {
            event.flags = .maskCommand
            event.post(tap: .cghidEventTap)
        }
    }
}
