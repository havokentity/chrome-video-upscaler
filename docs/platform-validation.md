# Platform Validation

This runbook is for collecting comparable Windows, macOS, and Linux release evidence for Chrome Video Upscaler. Use Chrome Stable for sign-off. Chrome Beta, Canary, or Playwright Chromium can add useful regression notes, but they do not replace Stable captures.

## Shared Setup

Run from the repository root:

```sh
corepack enable pnpm
pnpm install
pnpm verify
pnpm test:e2e
pnpm package:store
```

Record:

- Commit SHA from `git rev-parse HEAD`.
- Clean or dirty status from `git status --short`.
- Node and pnpm versions from `node --version` and `pnpm --version`.
- Chrome version from `chrome://version`.
- GPU status from `chrome://gpu`.
- `dist/manifest.json` name, version, permissions, host permissions, and web-accessible resources summary.
- `du -sh dist`, release zip size, and SHA256 from `pnpm package:store`.

Create the platform artifact folder using the commands in [benchmark-local.md](benchmark-local.md).

## Build And Package Commands

macOS/Linux:

```sh
pnpm package:store
du -sh dist
du -sh chrome-video-upscaler-v$(node -p "require('./package.json').version").zip
```

Windows PowerShell:

```powershell
pnpm package:store
Get-ChildItem -Recurse dist | Measure-Object -Property Length -Sum
$Version = (node -p "require('./package.json').version").Trim()
Get-Item "chrome-video-upscaler-v$Version.zip" | Select-Object FullName, Length
```

## Manual Chrome Load

1. Open `chrome://extensions`.
2. Enable Developer Mode.
3. Choose `Load unpacked`.
4. Select `dist`.
5. Open the local fixture or a permitted non-DRM HTML5 video.
6. Toggle the HUD with `Ctrl+Shift+U`.
7. Change modes from the extension popup/options UI.
8. Reload the page and confirm settings persist.
9. Disable the site and confirm the original video stays visible.

## Platform Matrix

| Platform | Required Checks | Commands | Evidence |
| --- | --- | --- | --- |
| macOS Apple Silicon | Auto, Crisp, Sharpen, Anime, Smooth, Neural-Lite, and Neural-Pro on the local fixture. Confirm WebGPU path where available and WebGL2 fallback. Run native comparison when Xcode/Swift is installed. | `pnpm verify`; `pnpm test:e2e`; `node scripts/collect-benchmark.mjs --mode auto,crisp,sharpen,anime,smooth --duration-ms 5000 --output json --output-path "$OUT/benchmarks/benchmark-smoke.json"`; `pnpm native:build`; `pnpm native:sample` | HUD screenshots per mode, benchmark smoke JSON/Markdown, Chrome version, `chrome://gpu`, native output or failure reason. |
| macOS Intel | Auto, Crisp, Sharpen, Anime, and Smooth on the local fixture. Try Neural-Lite and Neural-Pro, but record fallback or performance limits clearly. | `pnpm verify`; `pnpm test:e2e`; benchmark smoke command above | HUD screenshots, fallback notes, performance notes, Chrome/GPU evidence. |
| Windows 11 | Test Intel, AMD, or Nvidia GPU path available to the tester. Disable or record RTX VSR/driver video enhancement state before comparing visuals. Confirm no macOS-only wording appears in UI or store capture text. | `pnpm verify`; `pnpm test:e2e`; benchmark smoke command with PowerShell `$Out` path | HUD screenshots, driver version, Chrome/GPU evidence, RTX VSR or driver enhancement state. |
| Linux | Test Chrome Stable on the active display server. Record X11 or Wayland, GPU driver stack, WebGPU availability, and WebGL2 fallback behavior. | `pnpm verify`; `pnpm test:e2e`; benchmark smoke command above | HUD screenshots, display server notes, sandbox/codec issues, Chrome/GPU evidence. |

Windows PowerShell benchmark command:

```powershell
node scripts/collect-benchmark.mjs --mode auto,crisp,sharpen,anime,smooth --duration-ms 5000 --output json --output-path "$Out\benchmarks\benchmark-smoke.json"
node scripts/collect-benchmark.mjs --mode auto,crisp,sharpen,anime,smooth --duration-ms 5000 --output markdown --output-path "$Out\benchmarks\benchmark-smoke.md"
```

macOS/Linux benchmark command:

```sh
node scripts/collect-benchmark.mjs --mode auto,crisp,sharpen,anime,smooth --duration-ms 5000 --output json --output-path "$OUT/benchmarks/benchmark-smoke.json"
node scripts/collect-benchmark.mjs --mode auto,crisp,sharpen,anime,smooth --duration-ms 5000 --output markdown --output-path "$OUT/benchmarks/benchmark-smoke.md"
```

## Mode Evidence

Capture at least one HUD screenshot for each result:

| Mode | Pass Evidence | Failure Evidence |
| --- | --- | --- |
| None | Original video visible and usable; no active processing claim. | Disabled reason or native playback problem. |
| Auto | HUD reaches Auto and selects a backend. | HUD error, unsupported status, or fallback reason. |
| Crisp | HUD shows WebGL2/Crisp path and visual sharpening is visible. | No overlay, no visual change, or shader error. |
| Sharpen | HUD shows Sharpen path and paused-frame detail changes. | No visible change or console error. |
| Anime | HUD shows Anime/WebGL2 path and output differs from native frame. | Initialization or shader compile error. |
| Smooth | HUD shows Smooth/WebGPU path where available. | WebGPU unavailable, fallback, or browser block reason. |
| Neural-Lite | ArtCNN/ONNX path initializes, or a clear WebGPU/WASM fallback/error is shown. | Silent no-op or missing model/runtime asset. |
| Neural-Pro | RAVU-Lite or RAVU-Zoom path initializes, or performance limits are clear. | Silent no-op, severe responsiveness issue, or missing shader asset. |

For every mode, record:

- Page URL or fixture filename.
- Source resolution and displayed CSS size.
- Scale, sharpness, frame-generation setting, force WebGL2, force F32, and workgroup size.
- HUD text exactly as shown.
- Whether native video hiding/restoration behaves correctly.
- Console errors from the page, service worker, popup/options page, and content script.

## Platform Notes Template

Save as `$OUT/logs/platform-notes.md`.

```md
# Platform Notes

Release candidate:
Commit SHA:
Tree status:
Tester:
Date:

## Machine

OS/version:
CPU:
GPU:
Driver:
Display refresh rate:
Display scale:
Chrome channel/version:
Hardware acceleration:
WebGPU status:
WebGL status:

## Commands

- pnpm verify:
- pnpm test:e2e:
- pnpm build:
- benchmark smoke JSON:
- benchmark smoke Markdown:
- native build/sample, macOS only:

## Mode Results

| Mode | Result | HUD Text | Screenshot | Notes |
| --- | --- | --- | --- | --- |
| None | TBD | TBD | TBD | TBD |
| Auto | TBD | TBD | TBD | TBD |
| Crisp | TBD | TBD | TBD | TBD |
| Sharpen | TBD | TBD | TBD | TBD |
| Anime | TBD | TBD | TBD | TBD |
| Smooth | TBD | TBD | TBD | TBD |
| Neural-Lite | TBD | TBD | TBD | TBD |
| Neural-Pro | TBD | TBD | TBD | TBD |

## Blockers

- TBD
```

## Release Attachment Checklist

Attach these to the release candidate:

- Platform `logs/platform-notes.md`.
- Smoke benchmark JSON and Markdown.
- HUD screenshots for all tested modes.
- Store-facing screenshots listed in [screenshot-capture.md](screenshot-capture.md).
- `chrome://version` and `chrome://gpu` captures.
- Release zip and SHA256.
- Native comparison MP4 for macOS when available.
