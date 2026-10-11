// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "CharpKeyboard",
    platforms: [.macOS(.v13)],
    dependencies: [
        .package(url: "https://github.com/raycast/extensions-swift-tools", exact: "1.1.0")
    ],
    targets: [
        .target(name: "KeyboardLayout"),
        .executableTarget(
            name: "CharpKeyboard",
            dependencies: [
                "KeyboardLayout",
                .product(name: "RaycastSwiftMacros", package: "extensions-swift-tools"),
                .product(name: "RaycastSwiftPlugin", package: "extensions-swift-tools"),
                .product(name: "RaycastTypeScriptPlugin", package: "extensions-swift-tools"),
            ]
        ),
        .testTarget(name: "KeyboardLayoutTests", dependencies: ["KeyboardLayout"]),
    ]
)
