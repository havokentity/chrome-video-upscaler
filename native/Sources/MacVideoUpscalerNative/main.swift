/*
 * Copyright (c) 2026 Rajesh Peter D'Monte
 * SPDX-License-Identifier: MIT
 */

import AVFoundation
import CoreGraphics
import CoreImage
import CoreMedia
import CoreVideo
import Darwin
import Foundation
import Metal

enum NativeUpscaleMode: String {
  case crisp
  case smooth
  case sharpen
}

struct NativeUpscaleOptions {
  var inputURL: URL?
  var outputURL: URL?
  var mode: NativeUpscaleMode = .crisp
  var scale: Double = 2.0
  var sharpness: Double = 0.75
  var bitrate: Int?
  var openCompare = false
}

enum NativeUpscaleError: Error, CustomStringConvertible {
  case invalidArguments(String)
  case missingVideoTrack
  case readerCannotAddTrack
  case writerCannotAddInput
  case pixelBufferPoolUnavailable
  case pixelBufferAllocationFailed
  case sampleMissingImageBuffer
  case readerFailed(String)
  case writerFailed(String)
  case metalUnavailable

  var description: String {
    switch self {
    case .invalidArguments(let message):
      return message
    case .missingVideoTrack:
      return "Input asset does not contain a video track."
    case .readerCannotAddTrack:
      return "AVAssetReader could not add the video track output."
    case .writerCannotAddInput:
      return "AVAssetWriter could not add the video input."
    case .pixelBufferPoolUnavailable:
      return "AVAssetWriter did not create a pixel buffer pool."
    case .pixelBufferAllocationFailed:
      return "Could not allocate an output pixel buffer."
    case .sampleMissingImageBuffer:
      return "Decoded sample did not contain a CVPixelBuffer."
    case .readerFailed(let message):
      return "Reader failed: \(message)"
    case .writerFailed(let message):
      return "Writer failed: \(message)"
    case .metalUnavailable:
      return "Metal is unavailable on this Mac."
    }
  }
}

@main
struct MacVideoUpscalerNative {
  static func main() async {
    do {
      let options = try parseArguments(CommandLine.arguments)
      try await upscaleVideo(options: options)
    } catch {
      fputs("mac-video-upscaler-native: \(error)\n\n", stderr)
      fputs(Self.usage, stderr)
      exit(1)
    }
  }

  private static let usage = """
  Usage:
    swift run mac-video-upscaler-native --input input.mp4 --output output.mp4 [options]

  Options:
    --mode crisp|smooth|sharpen   Upscale/enhance mode. Default: crisp.
    --scale 1.0...4.0             Output scale. Default: 2.0.
    --sharpness 0.0...2.0         Enhancement strength. Default: 0.75.
    --bitrate bits                Optional H.264 average bitrate.
    --open-compare                Open the generated side-by-side compare page.

  Notes:
    This native bench is video-only for now. It intentionally avoids browser,
    DOM, canvas, and YouTube compositor behavior so we can judge the algorithm.

  """
}

func parseArguments(_ arguments: [String]) throws -> NativeUpscaleOptions {
  var options = NativeUpscaleOptions()
  var index = 1

  func requireValue(after flag: String) throws -> String {
    guard index + 1 < arguments.count else {
      throw NativeUpscaleError.invalidArguments("Missing value after \(flag).")
    }
    index += 1
    return arguments[index]
  }

  while index < arguments.count {
    let argument = arguments[index]
    switch argument {
    case "--input", "-i":
      options.inputURL = URL(fileURLWithPath: try requireValue(after: argument))
    case "--output", "-o":
      options.outputURL = URL(fileURLWithPath: try requireValue(after: argument))
    case "--mode":
      let value = try requireValue(after: argument)
      guard let mode = NativeUpscaleMode(rawValue: value) else {
        throw NativeUpscaleError.invalidArguments("Unknown mode: \(value).")
      }
      options.mode = mode
    case "--scale":
      let value = try requireValue(after: argument)
      guard let scale = Double(value), scale.isFinite, scale >= 1.0, scale <= 4.0 else {
        throw NativeUpscaleError.invalidArguments("--scale must be between 1.0 and 4.0.")
      }
      options.scale = scale
    case "--sharpness":
      let value = try requireValue(after: argument)
      guard let sharpness = Double(value), sharpness.isFinite, sharpness >= 0.0, sharpness <= 2.0 else {
        throw NativeUpscaleError.invalidArguments("--sharpness must be between 0.0 and 2.0.")
      }
      options.sharpness = sharpness
    case "--bitrate":
      let value = try requireValue(after: argument)
      guard let bitrate = Int(value), bitrate > 0 else {
        throw NativeUpscaleError.invalidArguments("--bitrate must be a positive integer.")
      }
      options.bitrate = bitrate
    case "--open-compare":
      options.openCompare = true
    case "--help", "-h":
      throw NativeUpscaleError.invalidArguments("")
    default:
      throw NativeUpscaleError.invalidArguments("Unknown argument: \(argument).")
    }
    index += 1
  }

  guard options.inputURL != nil else {
    throw NativeUpscaleError.invalidArguments("--input is required.")
  }

  guard options.outputURL != nil else {
    throw NativeUpscaleError.invalidArguments("--output is required.")
  }

  return options
}

func upscaleVideo(options: NativeUpscaleOptions) async throws {
  guard let inputURL = options.inputURL, let outputURL = options.outputURL else {
    throw NativeUpscaleError.invalidArguments("--input and --output are required.")
  }

  guard let metalDevice = MTLCreateSystemDefaultDevice() else {
    throw NativeUpscaleError.metalUnavailable
  }

  if FileManager.default.fileExists(atPath: outputURL.path) {
    try FileManager.default.removeItem(at: outputURL)
  }

  let asset = AVURLAsset(url: inputURL)
  let videoTracks = try await asset.loadTracks(withMediaType: .video)
  guard let videoTrack = videoTracks.first else {
    throw NativeUpscaleError.missingVideoTrack
  }

  let naturalSize = try await videoTrack.load(.naturalSize)
  let preferredTransform = try await videoTrack.load(.preferredTransform)
  let frameRate = try await videoTrack.load(.nominalFrameRate)
  let duration = try await asset.load(.duration)
  let displaySize = orientedDisplaySize(naturalSize: naturalSize, transform: preferredTransform)
  let outputSize = evenSize(width: displaySize.width * options.scale, height: displaySize.height * options.scale)
  let bitrate = options.bitrate ?? defaultBitrate(width: outputSize.width, height: outputSize.height, frameRate: frameRate)

  print("Input:  \(inputURL.path)")
  print("Output: \(outputURL.path)")
  print("Mode:   \(options.mode.rawValue), scale \(String(format: "%.2f", options.scale))x, sharpness \(String(format: "%.2f", options.sharpness))")
  print("Size:   \(Int(displaySize.width))x\(Int(displaySize.height)) -> \(Int(outputSize.width))x\(Int(outputSize.height))")

  let reader = try AVAssetReader(asset: asset)
  let readerOutput = AVAssetReaderTrackOutput(
    track: videoTrack,
    outputSettings: [
      kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
      kCVPixelBufferMetalCompatibilityKey as String: true,
      kCVPixelBufferIOSurfacePropertiesKey as String: [:],
    ]
  )
  readerOutput.alwaysCopiesSampleData = false

  guard reader.canAdd(readerOutput) else {
    throw NativeUpscaleError.readerCannotAddTrack
  }
  reader.add(readerOutput)

  let writer = try AVAssetWriter(outputURL: outputURL, fileType: .mp4)
  let writerInput = AVAssetWriterInput(
    mediaType: .video,
    outputSettings: [
      AVVideoCodecKey: AVVideoCodecType.h264,
      AVVideoWidthKey: Int(outputSize.width),
      AVVideoHeightKey: Int(outputSize.height),
      AVVideoCompressionPropertiesKey: [
        AVVideoAverageBitRateKey: bitrate,
        AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
      ],
    ]
  )
  writerInput.expectsMediaDataInRealTime = false

  let adaptor = AVAssetWriterInputPixelBufferAdaptor(
    assetWriterInput: writerInput,
    sourcePixelBufferAttributes: [
      kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
      kCVPixelBufferWidthKey as String: Int(outputSize.width),
      kCVPixelBufferHeightKey as String: Int(outputSize.height),
      kCVPixelBufferMetalCompatibilityKey as String: true,
      kCVPixelBufferIOSurfacePropertiesKey as String: [:],
    ]
  )

  guard writer.canAdd(writerInput) else {
    throw NativeUpscaleError.writerCannotAddInput
  }
  writer.add(writerInput)

  let context = CIContext(mtlDevice: metalDevice, options: [
    .workingColorSpace: CGColorSpaceCreateDeviceRGB(),
    .outputColorSpace: CGColorSpaceCreateDeviceRGB(),
  ])

  guard reader.startReading() else {
    throw NativeUpscaleError.readerFailed(reader.error?.localizedDescription ?? "unknown error")
  }

  guard writer.startWriting() else {
    throw NativeUpscaleError.writerFailed(writer.error?.localizedDescription ?? "unknown error")
  }
  writer.startSession(atSourceTime: .zero)

  guard let pixelBufferPool = adaptor.pixelBufferPool else {
    throw NativeUpscaleError.pixelBufferPoolUnavailable
  }

  var frameCount = 0
  var lastProgressTime = CFAbsoluteTimeGetCurrent()
  let durationSeconds = max(0.001, CMTimeGetSeconds(duration))
  let renderBounds = CGRect(origin: .zero, size: outputSize)
  let colorSpace = CGColorSpaceCreateDeviceRGB()

  while let sampleBuffer = readerOutput.copyNextSampleBuffer() {
    guard let sourcePixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else {
      throw NativeUpscaleError.sampleMissingImageBuffer
    }

    let presentationTime = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
    let sourceImage = normalizedImage(
      from: sourcePixelBuffer,
      preferredTransform: preferredTransform
    )
    let outputImage = processFrame(
      sourceImage,
      mode: options.mode,
      outputSize: outputSize,
      scale: options.scale,
      sharpness: options.sharpness
    )

    var outputPixelBuffer: CVPixelBuffer?
    let allocationStatus = CVPixelBufferPoolCreatePixelBuffer(nil, pixelBufferPool, &outputPixelBuffer)
    guard allocationStatus == kCVReturnSuccess, let outputPixelBuffer else {
      throw NativeUpscaleError.pixelBufferAllocationFailed
    }

    context.render(outputImage, to: outputPixelBuffer, bounds: renderBounds, colorSpace: colorSpace)

    while !writerInput.isReadyForMoreMediaData {
      try await Task.sleep(nanoseconds: 2_000_000)
    }

    if !adaptor.append(outputPixelBuffer, withPresentationTime: presentationTime) {
      throw NativeUpscaleError.writerFailed(writer.error?.localizedDescription ?? "append failed")
    }

    frameCount += 1
    let now = CFAbsoluteTimeGetCurrent()
    if now - lastProgressTime > 1.0 {
      let progress = min(100.0, max(0.0, CMTimeGetSeconds(presentationTime) / durationSeconds * 100.0))
      print("Progress: \(String(format: "%.1f", progress))% (\(frameCount) frames)")
      lastProgressTime = now
    }
  }

  if reader.status == .failed {
    throw NativeUpscaleError.readerFailed(reader.error?.localizedDescription ?? "unknown error")
  }

  writerInput.markAsFinished()

  try await finishWriting(writer)

  if writer.status != .completed {
    throw NativeUpscaleError.writerFailed(writer.error?.localizedDescription ?? "unknown error")
  }

  let lastCompareURL = try writeLastRunComparePage(inputURL: inputURL, outputURL: outputURL, options: options)
  if options.openCompare {
    try openInDefaultBrowser(lastCompareURL)
  }
  print("Done: \(frameCount) frames")
}

func writeLastRunComparePage(
  inputURL: URL,
  outputURL: URL,
  options: NativeUpscaleOptions
) throws -> URL {
  let compareDirectory = findCompareDirectory()
  try FileManager.default.createDirectory(at: compareDirectory, withIntermediateDirectories: true)

  let lastRunURL = compareDirectory.appendingPathComponent("last-run.json")
  let lastCompareURL = compareDirectory.appendingPathComponent("last-compare.html")
  let createdAt = ISO8601DateFormatter().string(from: Date())
  let json = """
  {
    "createdAt": "\(escapeJSON(createdAt))",
    "input": "\(escapeJSON(inputURL.path))",
    "output": "\(escapeJSON(outputURL.path))",
    "mode": "\(escapeJSON(options.mode.rawValue))",
    "scale": \(String(format: "%.3f", options.scale)),
    "sharpness": \(String(format: "%.3f", options.sharpness))
  }
  """
  try json.write(to: lastRunURL, atomically: true, encoding: .utf8)

  let html = """
  <!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>Last Native Upscale Compare</title>
      <style>
        :root { color-scheme: dark; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #070b10; color: #f8fafc; }
        body { margin: 0; min-height: 100vh; display: grid; grid-template-rows: auto 1fr auto; background: #070b10; }
        header, footer { padding: 12px 16px; border-color: rgb(255 255 255 / 12%); }
        header { border-bottom: 1px solid rgb(255 255 255 / 12%); display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; align-items: center; }
        h1 { margin: 0; font-size: 16px; }
        main { min-height: 0; display: grid; grid-template-columns: 1fr 1fr; }
        section { min-width: 0; display: grid; grid-template-rows: auto 1fr; border-right: 1px solid rgb(255 255 255 / 12%); }
        section:last-child { border-right: 0; }
        .title { padding: 10px 12px; background: rgb(255 255 255 / 5%); color: #cbd5e1; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        video { width: 100%; height: 100%; min-height: 0; object-fit: contain; background: #000; }
        footer { border-top: 1px solid rgb(255 255 255 / 12%); display: grid; grid-template-columns: auto auto auto 1fr auto; gap: 10px; align-items: center; }
        button, select { min-height: 34px; border: 1px solid rgb(255 255 255 / 14%); border-radius: 6px; background: #172033; color: #f8fafc; font: inherit; }
        button { min-width: 38px; cursor: pointer; }
        input[type="range"] { width: 100%; }
        .time { min-width: 112px; text-align: right; font-variant-numeric: tabular-nums; color: #cbd5e1; }
        @media (max-width: 820px) { main { grid-template-columns: 1fr; } section { min-height: 40vh; border-right: 0; border-bottom: 1px solid rgb(255 255 255 / 12%); } footer { grid-template-columns: 1fr; } .time { text-align: left; } }
      </style>
    </head>
    <body>
      <header>
        <h1>Last Native Upscale Compare</h1>
        <div>\(escapeHTML(options.mode.rawValue)) · \(String(format: "%.2f", options.scale))x · sharpness \(String(format: "%.2f", options.sharpness))</div>
      </header>
      <main>
        <section>
          <div class="title">Original: \(escapeHTML(inputURL.lastPathComponent))</div>
          <video id="left" src="\(escapeHTMLAttribute(inputURL.absoluteString))" playsinline muted></video>
        </section>
        <section>
          <div class="title">Upscaled: \(escapeHTML(outputURL.lastPathComponent))</div>
          <video id="right" src="\(escapeHTMLAttribute(outputURL.absoluteString))" playsinline muted></video>
        </section>
      </main>
      <footer>
        <button id="play" type="button">▶</button>
        <button id="back" type="button">‹</button>
        <button id="forward" type="button">›</button>
        <input id="scrub" type="range" min="0" max="1" step="0.001" value="0" />
        <div id="time" class="time">0.00 / 0.00</div>
      </footer>
      <script>
        const left = document.querySelector('#left');
        const right = document.querySelector('#right');
        const play = document.querySelector('#play');
        const back = document.querySelector('#back');
        const forward = document.querySelector('#forward');
        const scrub = document.querySelector('#scrub');
        const time = document.querySelector('#time');
        let syncing = false;
        const syncTime = (source, target) => {
          if (syncing || Math.abs(target.currentTime - source.currentTime) < 0.04) return;
          syncing = true;
          target.currentTime = source.currentTime;
          syncing = false;
        };
        const update = () => {
          const duration = Math.max(left.duration || 0, right.duration || 0);
          const current = Math.max(left.currentTime || 0, right.currentTime || 0);
          scrub.max = String(Math.max(0.001, duration));
          scrub.value = String(Math.min(duration, current));
          time.textContent = `${current.toFixed(2)} / ${duration.toFixed(2)}`;
          play.textContent = left.paused && right.paused ? '▶' : 'Ⅱ';
          requestAnimationFrame(update);
        };
        left.addEventListener('timeupdate', () => syncTime(left, right));
        right.addEventListener('timeupdate', () => syncTime(right, left));
        play.addEventListener('click', async () => {
          if (left.paused && right.paused) {
            const next = Math.max(left.currentTime, right.currentTime);
            left.currentTime = next;
            right.currentTime = next;
            await Promise.allSettled([left.play(), right.play()]);
          } else {
            left.pause();
            right.pause();
          }
        });
        back.addEventListener('click', () => {
          const next = Math.max(0, Math.max(left.currentTime, right.currentTime) - 1 / 30);
          left.currentTime = next;
          right.currentTime = next;
        });
        forward.addEventListener('click', () => {
          const next = Math.max(left.currentTime, right.currentTime) + 1 / 30;
          left.currentTime = next;
          right.currentTime = next;
        });
        scrub.addEventListener('input', () => {
          left.currentTime = Number(scrub.value);
          right.currentTime = Number(scrub.value);
        });
        update();
      </script>
    </body>
  </html>
  """
  try html.write(to: lastCompareURL, atomically: true, encoding: .utf8)

  print("Compare: \(lastCompareURL.path)")
  return lastCompareURL
}

func openInDefaultBrowser(_ url: URL) throws {
  let process = Process()
  process.executableURL = URL(fileURLWithPath: "/usr/bin/open")
  process.arguments = [url.path]
  try process.run()
}

func findCompareDirectory() -> URL {
  let current = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
  let nativeFromRoot = current.appendingPathComponent("native/compare.html")
  if FileManager.default.fileExists(atPath: nativeFromRoot.path) {
    return current.appendingPathComponent("native")
  }

  let compareInCurrent = current.appendingPathComponent("compare.html")
  if FileManager.default.fileExists(atPath: compareInCurrent.path) {
    return current
  }

  return current
}

func escapeJSON(_ value: String) -> String {
  value
    .replacingOccurrences(of: "\\", with: "\\\\")
    .replacingOccurrences(of: "\"", with: "\\\"")
    .replacingOccurrences(of: "\n", with: "\\n")
}

func escapeHTML(_ value: String) -> String {
  value
    .replacingOccurrences(of: "&", with: "&amp;")
    .replacingOccurrences(of: "<", with: "&lt;")
    .replacingOccurrences(of: ">", with: "&gt;")
}

func escapeHTMLAttribute(_ value: String) -> String {
  escapeHTML(value)
    .replacingOccurrences(of: "\"", with: "&quot;")
}

func finishWriting(_ writer: AVAssetWriter) async throws {
  await withCheckedContinuation { continuation in
    writer.finishWriting {
      continuation.resume()
    }
  }
}

func normalizedImage(from pixelBuffer: CVPixelBuffer, preferredTransform: CGAffineTransform) -> CIImage {
  let transformed = CIImage(cvPixelBuffer: pixelBuffer).transformed(by: preferredTransform)
  let extent = transformed.extent
  return transformed.transformed(
    by: CGAffineTransform(translationX: -extent.origin.x, y: -extent.origin.y)
  )
}

func processFrame(
  _ image: CIImage,
  mode: NativeUpscaleMode,
  outputSize: CGSize,
  scale: Double,
  sharpness: Double
) -> CIImage {
  let sourceExtent = image.extent
  let scaleX = outputSize.width / max(1.0, sourceExtent.width)
  let scaleY = outputSize.height / max(1.0, sourceExtent.height)
  let baseScale = min(scaleX, scaleY)

  let scaled: CIImage
  if mode == .sharpen {
    scaled = image.transformed(by: CGAffineTransform(scaleX: scaleX, y: scaleY))
  } else {
    scaled = image.applyingFilter("CILanczosScaleTransform", parameters: [
      kCIInputScaleKey: baseScale,
      kCIInputAspectRatioKey: scaleX / max(0.0001, scaleY),
    ])
  }

  let cropped = scaled.cropped(to: CGRect(origin: .zero, size: outputSize))

  switch mode {
  case .smooth:
    return cropped
  case .sharpen:
    return applySharpen(cropped, sharpness: sharpness, rescue: 0.0)
  case .crisp:
    let rescue = min(1.0, max(0.0, (scale - 1.4) / 2.2))
    return applyCrispRescue(cropped, sharpness: sharpness, rescue: rescue)
  }
}

func applyCrispRescue(_ image: CIImage, sharpness: Double, rescue: Double) -> CIImage {
  var output = image
  let clampedSharpness = min(2.0, max(0.0, sharpness))

  output = output.applyingFilter("CIUnsharpMask", parameters: [
    kCIInputRadiusKey: 0.85 + rescue * 1.25,
    kCIInputIntensityKey: 0.45 + clampedSharpness * 0.85 + rescue * 0.65,
  ])

  output = output.applyingFilter("CISharpenLuminance", parameters: [
    kCIInputSharpnessKey: 0.18 + clampedSharpness * 0.55 + rescue * 0.38,
  ])

  output = output.applyingFilter("CIColorControls", parameters: [
    kCIInputContrastKey: 1.0 + clampedSharpness * 0.055 + rescue * 0.075,
    kCIInputSaturationKey: 1.0 + rescue * 0.025,
  ])

  return output
}

func applySharpen(_ image: CIImage, sharpness: Double, rescue: Double) -> CIImage {
  let clampedSharpness = min(2.0, max(0.0, sharpness))
  return image
    .applyingFilter("CISharpenLuminance", parameters: [
      kCIInputSharpnessKey: 0.25 + clampedSharpness * 0.65 + rescue * 0.2,
    ])
    .applyingFilter("CIUnsharpMask", parameters: [
      kCIInputRadiusKey: 0.75 + rescue * 0.5,
      kCIInputIntensityKey: 0.25 + clampedSharpness * 0.6,
    ])
}

func orientedDisplaySize(naturalSize: CGSize, transform: CGAffineTransform) -> CGSize {
  let transformed = CGRect(origin: .zero, size: naturalSize).applying(transform)
  return CGSize(width: abs(transformed.width), height: abs(transformed.height))
}

func evenSize(width: Double, height: Double) -> CGSize {
  let evenWidth = max(2, Int(width.rounded(.toNearestOrAwayFromZero)) / 2 * 2)
  let evenHeight = max(2, Int(height.rounded(.toNearestOrAwayFromZero)) / 2 * 2)
  return CGSize(width: evenWidth, height: evenHeight)
}

func defaultBitrate(width: Double, height: Double, frameRate: Float) -> Int {
  let fps = Double(frameRate.isFinite && frameRate > 0 ? frameRate : 30)
  let pixels = width * height
  return max(8_000_000, min(80_000_000, Int(pixels * fps * 0.16)))
}
