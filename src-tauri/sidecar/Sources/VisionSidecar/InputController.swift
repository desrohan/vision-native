import CoreGraphics
import AppKit

/// Handles cursor movement and input simulation via CGEvent.
final class InputController {
    private var screenWidth: CGFloat = 0
    private var screenHeight: CGFloat = 0
    private var cursorEnabled = false

    /// Smoothing factor for cursor movement (0 = no smoothing, 1 = max smoothing).
    var smoothingFactor: CGFloat = 0.7

    private var lastCursorX: CGFloat = 0
    private var lastCursorY: CGFloat = 0
    private var initialized = false

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
        }
    }

    /// Move cursor based on normalized hand position (0..1 range).
    /// Uses the index finger tip position.
    func moveCursor(x: Float, y: Float) {
        guard cursorEnabled else { return }

        // Map normalized coordinates to screen coordinates.
        // Mirror x-axis so movement feels natural (camera is mirrored).
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
        if let event = CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: point, mouseButton: .left) {
            event.post(tap: .cghidEventTap)
        }
    }

    /// Simulate a left click at the current cursor position.
    func click() {
        let pos = CGEvent(source: nil)?.location ?? .zero
        if let down = CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: pos, mouseButton: .left),
           let up = CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: pos, mouseButton: .left) {
            down.post(tap: .cghidEventTap)
            up.post(tap: .cghidEventTap)
        }
    }

    /// Simulate a right click at the current cursor position.
    func rightClick() {
        let pos = CGEvent(source: nil)?.location ?? .zero
        if let down = CGEvent(mouseEventSource: nil, mouseType: .rightMouseDown, mouseCursorPosition: pos, mouseButton: .right),
           let up = CGEvent(mouseEventSource: nil, mouseType: .rightMouseUp, mouseCursorPosition: pos, mouseButton: .right) {
            down.post(tap: .cghidEventTap)
            up.post(tap: .cghidEventTap)
        }
    }

    /// Simulate scroll (deltaY in pixels).
    func scroll(deltaY: Int32) {
        if let event = CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 1, wheel1: deltaY, wheel2: 0, wheel3: 0) {
            event.post(tap: .cghidEventTap)
        }
    }
}
