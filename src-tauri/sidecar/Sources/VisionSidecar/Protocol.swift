import Foundation

// MARK: - Sidecar → Tauri (stdout messages)

/// Messages sent from sidecar to Tauri via stdout.
enum OutMessage {
    case landmarks(hands: [[LandmarkArray]])
    case gesture(gesture: String, confidence: Float, handIndex: Int)
    case state(state: MachineState, firedGesture: String?, holdDurationMs: Double)
    case status(camera: String, fps: Int)
    case error(message: String)
    case templateCaptured(landmarks: [Float])

    func toJSON() -> String {
        switch self {
        case .landmarks(let hands):
            let handsArray = hands.enumerated().map { (i, lms) -> [String: Any] in
                let coords = lms.map { [$0.x, $0.y, $0.z] as [Any] }
                return ["landmarks": coords, "handedness": "Unknown"]
            }
            let dict: [String: Any] = ["type": "landmarks", "hands": handsArray]
            return dictToJSON(dict)

        case .gesture(let gesture, let confidence, let handIndex):
            let dict: [String: Any] = [
                "type": "gesture",
                "gesture": gesture,
                "confidence": confidence,
                "handIndex": handIndex
            ]
            return dictToJSON(dict)

        case .state(let state, let firedGesture, let holdDurationMs):
            var dict: [String: Any] = [
                "type": "state",
                "state": state.rawValue,
                "holdDurationMs": holdDurationMs
            ]
            dict["firedGesture"] = firedGesture as Any? ?? NSNull()
            return dictToJSON(dict)

        case .status(let camera, let fps):
            let dict: [String: Any] = [
                "type": "status",
                "camera": camera,
                "fps": fps
            ]
            return dictToJSON(dict)

        case .error(let message):
            let dict: [String: Any] = ["type": "error", "message": message]
            return dictToJSON(dict)

        case .templateCaptured(let landmarks):
            let dict: [String: Any] = ["type": "template_captured", "landmarks": landmarks]
            return dictToJSON(dict)
        }
    }
}

/// Helper: Landmark as a simple array wrapper.
struct LandmarkArray {
    let x: Float
    let y: Float
    let z: Float
}

// MARK: - Tauri → Sidecar (stdin commands)

/// Commands received from Tauri via stdin.
enum InCommand {
    case setTemplates(templates: [GestureTemplate])
    case setConfig(config: ConfigUpdate)
    case captureTemplate
    case setCursorEnabled(enabled: Bool)
    case pause
    case resume

    static func parse(_ json: [String: Any]) -> InCommand? {
        guard let cmd = json["cmd"] as? String else { return nil }

        switch cmd {
        case "set_templates":
            guard let templatesArray = json["templates"] as? [[String: Any]] else { return nil }
            let templates = templatesArray.compactMap { dict -> GestureTemplate? in
                guard let name = dict["name"] as? String,
                      let landmarks = dict["landmarks"] as? [NSNumber] else { return nil }
                return GestureTemplate(name: name, landmarks: landmarks.map { $0.floatValue })
            }
            return .setTemplates(templates: templates)

        case "set_config":
            guard let configDict = json["config"] as? [String: Any] else { return nil }
            let config = ConfigUpdate(
                debounceMs: configDict["debounceMs"] as? Double,
                cooldownMs: configDict["cooldownMs"] as? Double,
                confidenceThreshold: (configDict["confidenceThreshold"] as? NSNumber)?.floatValue,
                cursorSmoothing: (configDict["cursorSmoothing"] as? NSNumber)?.floatValue
            )
            return .setConfig(config: config)

        case "capture_template":
            return .captureTemplate

        case "set_cursor_enabled":
            guard let enabled = json["enabled"] as? Bool else { return nil }
            return .setCursorEnabled(enabled: enabled)

        case "pause":
            return .pause

        case "resume":
            return .resume

        default:
            return nil
        }
    }
}

struct ConfigUpdate {
    let debounceMs: Double?
    let cooldownMs: Double?
    let confidenceThreshold: Float?
    let cursorSmoothing: Float?
}

// MARK: - JSON Helpers

func dictToJSON(_ dict: [String: Any]) -> String {
    guard let data = try? JSONSerialization.data(withJSONObject: dict, options: []),
          let str = String(data: data, encoding: .utf8) else {
        return "{}"
    }
    return str
}

func parseJSONLine(_ line: String) -> [String: Any]? {
    guard let data = line.data(using: .utf8),
          let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
        return nil
    }
    return obj
}
