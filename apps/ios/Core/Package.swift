// swift-tools-version: 5.9
import PackageDescription
let package = Package(name: "NegroniCore", platforms: [.iOS(.v17), .macOS(.v13)], products: [.library(name: "NegroniCore", targets: ["NegroniCore"])], targets: [.target(name: "NegroniCore", resources: [.process("Resources")]), .testTarget(name: "NegroniCoreTests", dependencies: ["NegroniCore"], resources: [.process("Resources")])])
