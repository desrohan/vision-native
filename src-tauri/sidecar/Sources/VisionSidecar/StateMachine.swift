import Foundation

/// Possible states of the gesture state machine.
enum MachineState: String, Codable {
    case idle
    case armed
    case fired
    case cooldown
}

/// Configuration for the state machine.
struct StateMachineConfig {
    var debounceMs: Double = 200
    var cooldownMs: Double = 500
    var confidenceThreshold: Float = 0.7
    var activationGesture: String = "open_palm"
}

/// Output of the state machine after each update.
struct StateMachineOutput {
    let state: MachineState
    let firedGesture: String?
    let holdDurationMs: Double
    let cooldownRemainingMs: Double
}

/// Gesture state machine: idle → armed → fired → cooldown.
/// Ported from stateMachine.ts
final class GestureStateMachine {
    private(set) var state: MachineState = .idle
    var config: StateMachineConfig

    // Debounce tracking
    private var currentGesture: String = "none"
    private var gestureStartTime: Double = 0

    // Cooldown tracking
    private var cooldownStartTime: Double = 0

    // Fired gesture
    private var firedGesture: String? = nil

    init(config: StateMachineConfig = StateMachineConfig()) {
        self.config = config
    }

    /// Feed new gesture results. Call every frame.
    func update(gestures: [GestureResult], now: Double) -> StateMachineOutput {
        // Pick highest-confidence gesture above threshold
        let valid = gestures.filter { $0.gesture != "none" && $0.confidence >= config.confidenceThreshold }
        let best = valid.max(by: { $0.confidence < $1.confidence })
        let detectedGesture = best?.gesture ?? "none"

        // Track how long the same gesture is held
        if detectedGesture != currentGesture {
            currentGesture = detectedGesture
            gestureStartTime = now
        }

        let holdDuration = now - gestureStartTime
        let debounced = holdDuration >= config.debounceMs

        switch state {
        case .idle:
            firedGesture = nil
            if detectedGesture == config.activationGesture && debounced {
                state = .armed
                currentGesture = "none"
                gestureStartTime = now
            }

        case .armed:
            firedGesture = nil
            if detectedGesture == config.activationGesture {
                break
            }
            if detectedGesture != "none" && detectedGesture != config.activationGesture && debounced {
                firedGesture = detectedGesture
                state = .fired
                cooldownStartTime = now
            }
            if detectedGesture == "none" && holdDuration > 1000 {
                state = .idle
            }

        case .fired:
            state = .cooldown
            cooldownStartTime = now
            firedGesture = nil

        case .cooldown:
            if now - cooldownStartTime >= config.cooldownMs {
                state = .idle
                firedGesture = nil
                currentGesture = "none"
                gestureStartTime = now
            }
        }

        let cooldownRemaining: Double
        if state == .cooldown {
            cooldownRemaining = max(0, config.cooldownMs - (now - cooldownStartTime))
        } else {
            cooldownRemaining = 0
        }

        return StateMachineOutput(
            state: state,
            firedGesture: firedGesture,
            holdDurationMs: holdDuration,
            cooldownRemainingMs: cooldownRemaining
        )
    }

    func reset() {
        state = .idle
        currentGesture = "none"
        gestureStartTime = 0
        cooldownStartTime = 0
        firedGesture = nil
    }
}
