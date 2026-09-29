// swift-tools-version: 5.9
import PackageDescription
let package = Package(name: "NegroniCore", platforms: [.iOS(.v17), .macOS(.v13)], products: [.library(name: "NegroniCore", targets: ["NegroniCore"])], targets: [.target(name: "NegroniCore"), .testTarget(name: "NegroniCoreTests", dependencies: ["NegroniCore"])])
