import CoreGraphics
import Foundation

/// Detects hand swipe gestures (left/right) and fist open/close (Mission Control / App Exposé).
final class GestureDetector {
    // MARK: - Swipe detection

    /// Track wrist position history for swipe detection
    private var wristHistory: [(x: Float, time: Double)] = []
    private let swipeWindowMs: Double = 400      // time window to detect a swipe
    private let swipeThreshold: Float = 0.35     // min normalized X distance for a swipe
    private var swipeCooldownUntil: Double = 0
    private let swipeCooldownMs: Double = 1200   // prevent return-trip from triggering opposite swipe

    // MARK: - Fist detection

    private var wasFist = false
    private var wasOpen = false
    private var fistCooldownUntil: Double = 0
    private let fistCooldownMs: Double = 800

    // MARK: - Swipe

    /// Call every frame with wrist (landmark 0) x-position.
    /// Returns "swipe_left", "swipe_right", or nil.
    func updateSwipe(wristX: Float, now: Double) -> String? {
        // During cooldown, keep clearing history so the return movement doesn't accumulate
        guard now >= swipeCooldownUntil else {
            wristHistory.removeAll()
            return nil
        }

        // Add to history
        wristHistory.append((x: wristX, time: now))

        // Remove old entries outside the time window
        wristHistory.removeAll { now - $0.time > swipeWindowMs }

        // Need at least a few samples
        guard wristHistory.count >= 4 else { return nil }

        // Check displacement from oldest to newest within window
        let oldest = wristHistory.first!
        let newest = wristHistory.last!
        let dx = newest.x - oldest.x

        if abs(dx) >= swipeThreshold {
            swipeCooldownUntil = now + swipeCooldownMs
            wristHistory.removeAll()

            // Camera is mirrored, so moving hand right in real life = x decreases in Vision coords
            if dx < 0 {
                return "swipe_right"
            } else {
                return "swipe_left"
            }
        }

        return nil
    }

    /// Call every frame with fingertip + MCP landmarks.
    /// Fist = all 4 fingers curled (tip closer to wrist than MCP).
    /// Detects transitions:
    ///   open → fist = "mission_control" (Ctrl+Up)
    ///   fist → open = "app_expose" (Ctrl+Down)
    func updateFist(
        wrist: LandmarkPoint,        // landmark 0
        indexTip: LandmarkPoint,     // landmark 8
        indexMCP: LandmarkPoint,     // landmark 5
        middleTip: LandmarkPoint,    // landmark 12
        middleMCP: LandmarkPoint,    // landmark 9
        ringTip: LandmarkPoint,      // landmark 16
        ringMCP: LandmarkPoint,      // landmark 13
        pinkyTip: LandmarkPoint,     // landmark 20
        pinkyMCP: LandmarkPoint,     // landmark 17
        now: Double
    ) -> String? {
        // A finger is curled if its tip is closer to the wrist than its MCP joint
        func dist(_ a: LandmarkPoint, _ b: LandmarkPoint) -> Float {
            let dx = a.x - b.x
            let dy = a.y - b.y
            return sqrt(dx * dx + dy * dy)
        }

        let indexCurled = dist(indexTip, wrist) < dist(indexMCP, wrist)
        let middleCurled = dist(middleTip, wrist) < dist(middleMCP, wrist)
        let ringCurled = dist(ringTip, wrist) < dist(ringMCP, wrist)
        let pinkyCurled = dist(pinkyTip, wrist) < dist(pinkyMCP, wrist)

        let curledCount = [indexCurled, middleCurled, ringCurled, pinkyCurled].filter { $0 }.count
        let isFist = curledCount >= 3  // at least 3 of 4 fingers curled
        let isOpen = curledCount <= 1  // at most 1 finger curled

        guard now >= fistCooldownUntil else {
            if isFist { wasFist = true; wasOpen = false }
            if isOpen { wasOpen = true; wasFist = false }
            return nil
        }

        // open → fist = Mission Control
        if isFist && wasOpen {
            wasOpen = false
            wasFist = true
            fistCooldownUntil = now + fistCooldownMs
            return "mission_control"
        }

        // fist → open = App Exposé
        if isOpen && wasFist {
            wasFist = false
            wasOpen = true
            fistCooldownUntil = now + fistCooldownMs
            return "app_expose"
        }

        // Update state
        if isFist { wasFist = true; wasOpen = false }
        if isOpen { wasOpen = true; wasFist = false }

        return nil
    }

    func reset() {
        wristHistory.removeAll()
        wasFist = false
        wasOpen = false
    }

    // MARK: - macOS Actions via AppleScript (reliable for system shortcuts)

    /// Switch desktop left (Control + Left Arrow)
    static func switchDesktopLeft() {
        runAppleScript("tell application \"System Events\" to key code 123 using control down")
    }

    /// Switch desktop right (Control + Right Arrow)
    static func switchDesktopRight() {
        runAppleScript("tell application \"System Events\" to key code 124 using control down")
    }

    /// Mission Control (Control + Up Arrow)
    static func missionControl() {
        runAppleScript("tell application \"System Events\" to key code 126 using control down")
    }

    /// App Exposé (Control + Down Arrow)
    static func appExpose() {
        runAppleScript("tell application \"System Events\" to key code 125 using control down")
    }

    private static func runAppleScript(_ script: String) {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
        process.arguments = ["-e", script]
        try? process.run()
    }
}
