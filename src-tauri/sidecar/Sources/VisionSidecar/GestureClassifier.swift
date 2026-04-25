import Foundation

/// A stored gesture template (normalized 21-landmark array).
struct GestureTemplate {
    let name: String
    let landmarks: [Float] // 63 values: [x0,y0,z0, x1,y1,z1, ...]
}

/// Result of gesture classification.
struct GestureResult {
    let gesture: String
    let confidence: Float
    let handIndex: Int
    let handedness: String
}

/// Classifies hand poses against stored templates + hardcoded open_palm.
/// Ported from gestureClassifier.ts
final class GestureClassifier {
    var templates: [GestureTemplate] = []

    // MARK: - Normalization

    /// Normalize landmarks: translate so wrist is origin, scale by wrist-to-MCP9 distance.
    /// Returns flat array of 63 values.
    static func normalizeLandmarks(_ landmarks: [LandmarkPoint]) -> [Float] {
        guard landmarks.count == 21 else { return [] }

        let wrist = landmarks[0]
        let mcp9 = landmarks[9]

        let dx = mcp9.x - wrist.x
        let dy = mcp9.y - wrist.y
        let dz = mcp9.z - wrist.z
        let scale = max(sqrt(dx * dx + dy * dy + dz * dz), 1e-6)

        var result: [Float] = []
        result.reserveCapacity(63)

        for lm in landmarks {
            result.append((lm.x - wrist.x) / scale)
            result.append((lm.y - wrist.y) / scale)
            result.append((lm.z - wrist.z) / scale)
        }

        return result
    }

    // MARK: - Comparison

    /// Compare two normalized landmark arrays. Returns similarity 0..1 (1 = identical).
    private static func compareLandmarks(_ a: [Float], _ b: [Float]) -> Float {
        guard a.count == b.count, !a.isEmpty else { return 0 }

        var sumSqDiff: Float = 0
        for i in 0..<a.count {
            let diff = a[i] - b[i]
            sumSqDiff += diff * diff
        }

        let rmsDist = sqrt(sumSqDiff / Float(a.count))
        return max(0, 1 - rmsDist * 1.5)
    }

    // MARK: - Open Palm Detection

    private static func distance(_ a: LandmarkPoint, _ b: LandmarkPoint) -> Float {
        let dx = a.x - b.x
        let dy = a.y - b.y
        let dz = a.z - b.z
        return sqrt(dx * dx + dy * dy + dz * dz)
    }

    private static func isFingerExtended(
        _ landmarks: [LandmarkPoint],
        tip: Int, dip: Int, pip: Int, mcp: Int
    ) -> Bool {
        let wrist = landmarks[0]
        let tipDist = distance(landmarks[tip], wrist)
        let pipDist = distance(landmarks[pip], wrist)
        let tipToMcp = distance(landmarks[tip], landmarks[mcp])
        let dipToMcp = distance(landmarks[dip], landmarks[mcp])
        return tipDist > pipDist && tipToMcp > dipToMcp
    }

    private static func detectOpenPalm(_ landmarks: [LandmarkPoint]) -> Float {
        let fingers = [
            isFingerExtended(landmarks, tip: 8, dip: 7, pip: 6, mcp: 5),
            isFingerExtended(landmarks, tip: 12, dip: 11, pip: 10, mcp: 9),
            isFingerExtended(landmarks, tip: 16, dip: 15, pip: 14, mcp: 13),
            isFingerExtended(landmarks, tip: 20, dip: 19, pip: 18, mcp: 17),
        ]
        let thumbSpread = distance(landmarks[4], landmarks[5]) > 0.08
        let extendedCount = fingers.filter { $0 }.count

        if extendedCount >= 4 && thumbSpread { return 1.0 }
        if extendedCount >= 3 && thumbSpread { return 0.6 }
        return 0
    }

    // MARK: - Classification

    /// Classify a hand against stored templates + hardcoded open_palm.
    func classify(
        landmarks: [LandmarkPoint],
        handIndex: Int,
        handedness: String
    ) -> GestureResult {
        // Always check open palm (activation gesture)
        let palmConf = Self.detectOpenPalm(landmarks)
        if palmConf >= 0.6 {
            return GestureResult(gesture: "open_palm", confidence: palmConf, handIndex: handIndex, handedness: handedness)
        }

        // Match against user-defined templates
        if templates.isEmpty {
            return GestureResult(gesture: "none", confidence: 0, handIndex: handIndex, handedness: handedness)
        }

        let normalized = Self.normalizeLandmarks(landmarks)
        var bestName = "none"
        var bestConf: Float = 0

        for template in templates {
            let similarity = Self.compareLandmarks(normalized, template.landmarks)
            if similarity > bestConf {
                bestName = template.name
                bestConf = similarity
            }
        }

        if bestConf < 0.55 {
            return GestureResult(gesture: "none", confidence: 0, handIndex: handIndex, handedness: handedness)
        }

        return GestureResult(gesture: bestName, confidence: bestConf, handIndex: handIndex, handedness: handedness)
    }
}
