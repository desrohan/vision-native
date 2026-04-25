import AVFoundation
import CoreImage

/// Captures frames from the default camera using AVFoundation.
/// Delivers CMSampleBuffer to a callback on each frame.
final class CameraCapture: NSObject {
    private let captureSession = AVCaptureSession()
    private let outputQueue = DispatchQueue(label: "com.vision.camera", qos: .userInteractive)
    private var frameHandler: ((CMSampleBuffer) -> Void)?

    var isRunning: Bool { captureSession.isRunning }

    func start(frameHandler: @escaping (CMSampleBuffer) -> Void) throws {
        self.frameHandler = frameHandler

        captureSession.beginConfiguration()
        captureSession.sessionPreset = .medium // 480p — fast enough for hand tracking

        guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .unspecified) else {
            throw CameraError.noDevice
        }

        let input = try AVCaptureDeviceInput(device: device)
        guard captureSession.canAddInput(input) else {
            throw CameraError.cannotAddInput
        }
        captureSession.addInput(input)

        let output = AVCaptureVideoDataOutput()
        output.videoSettings = [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA
        ]
        output.alwaysDiscardsLateVideoFrames = true
        output.setSampleBufferDelegate(self, queue: outputQueue)

        guard captureSession.canAddOutput(output) else {
            throw CameraError.cannotAddOutput
        }
        captureSession.addOutput(output)

        captureSession.commitConfiguration()
        captureSession.startRunning()
    }

    func stop() {
        captureSession.stopRunning()
        frameHandler = nil
    }
}

extension CameraCapture: AVCaptureVideoDataOutputSampleBufferDelegate {
    func captureOutput(
        _ output: AVCaptureOutput,
        didOutput sampleBuffer: CMSampleBuffer,
        from connection: AVCaptureConnection
    ) {
        frameHandler?(sampleBuffer)
    }
}

enum CameraError: Error, CustomStringConvertible {
    case noDevice
    case cannotAddInput
    case cannotAddOutput

    var description: String {
        switch self {
        case .noDevice: return "No camera device found"
        case .cannotAddInput: return "Cannot add camera input"
        case .cannotAddOutput: return "Cannot add video output"
        }
    }
}
