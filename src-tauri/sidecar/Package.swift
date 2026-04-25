// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "VisionSidecar",
    platforms: [
        .macOS(.v14)
    ],
    targets: [
        .executableTarget(
            name: "vision-sidecar",
            path: "Sources/VisionSidecar",
            linkerSettings: [
                .linkedFramework("AVFoundation"),
                .linkedFramework("Vision"),
                .linkedFramework("CoreGraphics"),
                .linkedFramework("AppKit"),
            ]
        )
    ]
)
