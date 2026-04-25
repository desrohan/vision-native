import Vision
import CoreMedia

/// Landmark point with x, y, z coordinates (0..1 range, Vision framework coords).
struct LandmarkPoint {
    let x: Float
    let y: Float
    let z: Float
}

/// Result of hand pose detection for one hand.
struct HandDetection {
    let landmarks: [LandmarkPoint] // 21 landmarks
    let handedness: String // "Left" or "Right"
}

/// Uses Vision framework VNDetectHumanHandPoseRequest to extract 21 hand landmarks.
final class HandTracker {
    /// Vision joint names in the order we need (matches MediaPipe 21-landmark convention).
    /// Vision uses named joints; we map them to indices 0-20.
    private static let jointOrder: [VNHumanHandPoseObservation.JointName] = [
        .wrist,                                           // 0
        .thumbCMC, .thumbMP, .thumbIP, .thumbTip,         // 1-4
        .indexMCP, .indexPIP, .indexDIP, .indexTip,        // 5-8
        .middleMCP, .middlePIP, .middleDIP, .middleTip,  // 9-12
        .ringMCP, .ringPIP, .ringDIP, .ringTip,           // 13-16
        .littleMCP, .littlePIP, .littleDIP, .littleTip   // 17-20
    ]

    private let request = VNDetectHumanHandPoseRequest()

    init() {
        request.maximumHandCount = 2
    }

    /// Process a sample buffer and return detected hands.
    func detect(sampleBuffer: CMSampleBuffer) -> [HandDetection] {
        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else {
            return []
        }

        let handler = VNImageRequestHandler(cvPixelBuffer: pixelBuffer, options: [:])

        do {
            try handler.perform([request])
        } catch {
            return []
        }

        guard let observations = request.results else {
            return []
        }

        var hands: [HandDetection] = []

        for observation in observations {
            var landmarks: [LandmarkPoint] = []
            var valid = true

            for joint in Self.jointOrder {
                guard let point = try? observation.recognizedPoint(joint),
                      point.confidence > 0.3 else {
                    valid = false
                    break
                }
                // Vision coordinates: origin bottom-left, y goes up.
                // We flip y to match MediaPipe convention (origin top-left, y goes down).
                landmarks.append(LandmarkPoint(
                    x: Float(point.location.x),
                    y: Float(1.0 - point.location.y),
                    z: 0 // Vision 2D only; z = 0
                ))
            }

            if valid && landmarks.count == 21 {
                let chirality = observation.chirality
                let handedness: String
                switch chirality {
                case .left: handedness = "Left"
                case .right: handedness = "Right"
                default: handedness = "Unknown"
                }
                hands.append(HandDetection(landmarks: landmarks, handedness: handedness))
            }
        }

        return hands
    }
}
