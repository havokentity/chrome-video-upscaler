# Local Benchmark Collection

Use this file as the working benchmark ledger for release-candidate captures. Keep measured platform rows here or copy the filled tables into the release notes. The automated helper is a smoke benchmark only: it confirms the built extension loads, draws an overlay, exposes HUD text, and receives video callbacks on the bundled fixture. It does not report real GPU frame time.

## Artifact Folder

Create one folder per platform and commit. Attach the whole folder, or zip it, to the release candidate.

macOS/Linux:

```sh
SHA=$(git rev-parse --short HEAD)
STAMP=$(date +%Y%m%d-%H%M)
OUT="release-captures/${STAMP}-${SHA}-$(uname -s | tr '[:upper:]' '[:lower:]')"
mkdir -p "$OUT"/{benchmarks,screenshots,gpu,logs}
```

Windows PowerShell:

```powershell
$Sha = (git rev-parse --short HEAD).Trim()
$Stamp = Get-Date -Format yyyyMMdd-HHmm
$Out = "release-captures\$Stamp-$Sha-windows"
New-Item -ItemType Directory -Force "$Out\benchmarks", "$Out\screenshots", "$Out\gpu", "$Out\logs"
```

## Automated Smoke Benchmark

Exact script:

```sh
pnpm build
node scripts/collect-benchmark.mjs --mode auto,crisp,sharpen,anime,smooth --duration-ms 5000 --output json --output-path "$OUT/benchmarks/benchmark-smoke.json"
node scripts/collect-benchmark.mjs --mode auto,crisp,sharpen,anime,smooth --duration-ms 5000 --output markdown --output-path "$OUT/benchmarks/benchmark-smoke.md"
```

Visible troubleshooting run:

```sh
node scripts/collect-benchmark.mjs --headed --mode crisp,smooth --duration-ms 5000
```

Strict CI-style run:

```sh
node scripts/collect-benchmark.mjs --strict --mode auto,crisp,sharpen,anime,smooth --duration-ms 5000 --output json --output-path "$OUT/benchmarks/benchmark-smoke-strict.json"
```

Supported options from `scripts/collect-benchmark.mjs`:

| Option | Meaning |
| --- | --- |
| `--mode auto,crisp` | Comma-separated modes. Supported modes are `auto`, `crisp`, `sharpen`, `anime`, and `smooth`. |
| `--duration-ms 5000` | Sampling window per mode. Must be at least `250`. |
| `--output json|markdown` | Output format. JSON is best for attachments; Markdown is best for release notes. |
| `--output-path <file>` | Writes output to a file. Without this, the result prints to stdout. |
| `--extension <dir>` | Built extension directory. Defaults to `dist`. |
| `--fixtures <dir>` | Fixture directory. Defaults to `tests/fixtures`. |
| `--scale 1.5` | Extension scale setting. Must be between `1` and `2`. |
| `--sharpness 0.2` | FSR/CAS sharpness setting. Must be between `0` and `1`. |
| `--headed` | Opens a visible Chromium window for debugging. |
| `--strict` | Exits nonzero when the build/browser/fixture is unavailable instead of returning a skipped result. |
| `--help` | Prints script usage. |

Expected JSON output:

- `skipped`: `false` when the run completed; `true` when the build, fixtures, browser, or extension context could not run.
- `reason`: present when `skipped` is `true`.
- `generatedAt`: ISO timestamp.
- `options`: public script options used for the run.
- `runs[]`: one row per mode with `mode`, `hudText`, `sourceWidth`, `sourceHeight`, `canvasWidth`, `canvasHeight`, `cssWidth`, `cssHeight`, `videoFrameCallbacks`, `approxVideoCallbackFps`, `animationFrames`, `approxAnimationFps`, and `elapsedMs`.
- `manualRows[]`: placeholder rows for real manual timing notes.

Expected Markdown output:

- `# Benchmark Smoke Results`
- Generated timestamp and completed/skipped status.
- `Smoke Samples` table with mode, HUD/backend text, source size, canvas size, CSS box, callback count, and approximate callback FPS.
- `Manual Apple Silicon Benchmark Rows` placeholder table. Replace or supplement this table with measured platform results before publishing.

## Manual HUD Benchmark Pass

Use Chrome Stable with the release candidate loaded from `dist`.

```sh
pnpm build
```

Manual load:

1. Open `chrome://extensions`.
2. Enable Developer Mode.
3. Choose `Load unpacked`.
4. Select the repository `dist` folder.
5. Open `tests/fixtures/sample-video-page.html` through a local server or use a non-DRM public-domain HTML5 video page.
6. Toggle the HUD with `Ctrl+Shift+U`.
7. Capture one HUD screenshot per tested mode.

Local fixture server options:

```sh
pnpm dev
```

or:

```sh
python3 -m http.server 4173 --directory tests/fixtures
```

Then open one of:

```text
http://127.0.0.1:5173/tests/fixtures/sample-video-page.html
http://127.0.0.1:4173/sample-video-page.html
```

Record browser and GPU state:

- Save a screenshot of `chrome://version` to `$OUT/gpu/chrome-version.png`.
- Save a screenshot or text notes from `chrome://gpu` to `$OUT/gpu/chrome-gpu.png` or `$OUT/gpu/chrome-gpu.txt`.
- Record display refresh rate and display scaling.
- Note whether Chrome hardware acceleration is enabled.

## Manual Results Template

| Platform | OS Version | CPU/GPU/Driver | Chrome Version | Source -> Display | Mode | Scale | Sharpness | Backend/HUD | Callback FPS | Visual Result | Notes |
| --- | --- | --- | --- | --- | --- | ---: | ---: | --- | ---: | --- | --- |
| macOS | TBD | TBD | TBD | 320x180 -> TBD | Auto | 1.5 | 0.2 | TBD | TBD | TBD | TBD |
| macOS | TBD | TBD | TBD | 320x180 -> TBD | Crisp | 1.5 | 0.2 | TBD | TBD | TBD | TBD |
| macOS | TBD | TBD | TBD | 320x180 -> TBD | Sharpen | 1.5 | 0.2 | TBD | TBD | TBD | TBD |
| macOS | TBD | TBD | TBD | 320x180 -> TBD | Anime | 1.5 | 0.2 | TBD | TBD | TBD | TBD |
| macOS | TBD | TBD | TBD | 320x180 -> TBD | Smooth | 1.5 | 0.2 | TBD | TBD | TBD | TBD |
| macOS | TBD | TBD | TBD | 320x180 -> TBD | Neural-Lite | 1.5 | 0.2 | TBD | TBD | TBD | TBD |
| macOS | TBD | TBD | TBD | 320x180 -> TBD | Neural-Pro | 1.5 | 0.2 | TBD | TBD | TBD | TBD |
| Windows | TBD | TBD | TBD | 320x180 -> TBD | Auto | 1.5 | 0.2 | TBD | TBD | TBD | TBD |
| Windows | TBD | TBD | TBD | 320x180 -> TBD | Crisp | 1.5 | 0.2 | TBD | TBD | TBD | TBD |
| Windows | TBD | TBD | TBD | 320x180 -> TBD | Sharpen | 1.5 | 0.2 | TBD | TBD | TBD | TBD |
| Windows | TBD | TBD | TBD | 320x180 -> TBD | Anime | 1.5 | 0.2 | TBD | TBD | TBD | TBD |
| Windows | TBD | TBD | TBD | 320x180 -> TBD | Smooth | 1.5 | 0.2 | TBD | TBD | TBD | TBD |
| Windows | TBD | TBD | TBD | 320x180 -> TBD | Neural-Lite | 1.5 | 0.2 | TBD | TBD | TBD | TBD |
| Windows | TBD | TBD | TBD | 320x180 -> TBD | Neural-Pro | 1.5 | 0.2 | TBD | TBD | TBD | TBD |
| Linux | TBD | TBD | TBD | 320x180 -> TBD | Auto | 1.5 | 0.2 | TBD | TBD | TBD | TBD |
| Linux | TBD | TBD | TBD | 320x180 -> TBD | Crisp | 1.5 | 0.2 | TBD | TBD | TBD | TBD |
| Linux | TBD | TBD | TBD | 320x180 -> TBD | Sharpen | 1.5 | 0.2 | TBD | TBD | TBD | TBD |
| Linux | TBD | TBD | TBD | 320x180 -> TBD | Anime | 1.5 | 0.2 | TBD | TBD | TBD | TBD |
| Linux | TBD | TBD | TBD | 320x180 -> TBD | Smooth | 1.5 | 0.2 | TBD | TBD | TBD | TBD |
| Linux | TBD | TBD | TBD | 320x180 -> TBD | Neural-Lite | 1.5 | 0.2 | TBD | TBD | TBD | TBD |
| Linux | TBD | TBD | TBD | 320x180 -> TBD | Neural-Pro | 1.5 | 0.2 | TBD | TBD | TBD | TBD |

## macOS Native Comparison

Run only on macOS when Xcode/Swift is available:

```sh
pnpm native:build
pnpm native:sample
cp /tmp/chrome-video-upscaler-native-sample.mp4 "$OUT/benchmarks/native-crisp-sample.mp4"
```

Record the native output path, file size, command result, and whether the generated MP4 opens correctly. Native Metal output is an offline comparison artifact and is not an extension feature.

## Release Attachments

Attach these files for each platform run:

- `$OUT/benchmarks/benchmark-smoke.json`
- `$OUT/benchmarks/benchmark-smoke.md`
- `$OUT/benchmarks/native-crisp-sample.mp4`, macOS only when available
- `$OUT/screenshots/hud-<platform>-<mode>.png` for each captured mode
- `$OUT/screenshots/store-popup-<platform>.png`
- `$OUT/screenshots/store-hud-<platform>.png`
- `$OUT/screenshots/before-after-<platform>.png`
- `$OUT/gpu/chrome-version.png`
- `$OUT/gpu/chrome-gpu.png` or `$OUT/gpu/chrome-gpu.txt`
- `$OUT/logs/platform-notes.md`
- `chrome-video-upscaler-v<version>.zip`
- SHA256 printed by `pnpm package:store`

Optional zip:

```sh
zip -r "$OUT.zip" "$OUT"
```

Windows PowerShell zip:

```powershell
Compress-Archive -Path "$Out\*" -DestinationPath "$Out.zip" -Force
```
