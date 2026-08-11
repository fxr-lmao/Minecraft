// swift-tools-version: 5.9

// Swift Playgrounds app project.
//
// Open the enclosing Minecraft.swiftpm folder with Swift Playgrounds on the
// iPad (App Projects), press Run, then use the ••• menu to add it to the Home
// Screen. No Mac and no developer account are needed, and unlike a sideloaded
// build it does not expire after seven days.

import PackageDescription
import AppleProductTypes

let package = Package(
    name: "Minecraft",
    platforms: [
        .iOS("16.0")
    ],
    products: [
        .iOSApplication(
            name: "Minecraft",
            targets: ["AppModule"],
            bundleIdentifier: "com.fxr.minecraft",
            displayVersion: "1.0",
            bundleVersion: "1",
            accentColor: .presetColor(.green),
            supportedDeviceFamilies: [
                .pad
            ],
            // Pointer lock only engages full screen, and the game is a
            // landscape game, so portrait is not offered.
            supportedInterfaceOrientations: [
                .landscapeRight,
                .landscapeLeft
            ],
            appCategory: .games
        )
    ],
    targets: [
        .executableTarget(
            name: "AppModule",
            path: "."
        )
    ]
)
