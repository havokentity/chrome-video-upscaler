# Screenshot And HUD Capture

Use this runbook to collect release screenshots and HUD captures that can be compared across macOS, Windows, and Linux. Capture Chrome Stable with the release candidate loaded from `dist`.

## File Names

Use lowercase platform names: `macos`, `windows`, or `linux`.

```text
screenshots/store-popup-<platform>.png
screenshots/store-hud-<platform>.png
screenshots/before-after-<platform>.png
screenshots/site-controls-<platform>.png
screenshots/hud-<platform>-none.png
screenshots/hud-<platform>-auto.png
screenshots/hud-<platform>-crisp.png
screenshots/hud-<platform>-sharpen.png
screenshots/hud-<platform>-anime.png
screenshots/hud-<platform>-smooth.png
screenshots/hud-<platform>-neural-lite.png
screenshots/hud-<platform>-neural-pro.png
gpu/chrome-version.png
gpu/chrome-gpu.png
```

## Capture Setup

```sh
pnpm build
```

1. Open `chrome://extensions`.
2. Enable Developer Mode.
3. Load unpacked `dist`.
4. Pin or open the extension popup for popup/control captures.
5. Open a local fixture or a permitted non-DRM public-domain HTML5 video.
6. Toggle the HUD with `Ctrl+Shift+U`.
7. Set scale and sharpness before each capture and record them in `logs/platform-notes.md`.
8. Avoid DRM streaming pages and pages where the source license is unclear.

Local fixture server:

```sh
python3 -m http.server 4173 --directory tests/fixtures
```

Open:

```text
http://127.0.0.1:4173/sample-video-page.html
```

## OS Capture Commands

macOS full-screen capture after a 2-second delay:

```sh
screencapture -x -T 2 "$OUT/screenshots/hud-macos-crisp.png"
screencapture -x -T 2 "$OUT/gpu/chrome-version.png"
screencapture -x -T 2 "$OUT/gpu/chrome-gpu.png"
```

macOS selected-window capture:

```sh
screencapture -x -W "$OUT/screenshots/store-popup-macos.png"
```

Windows PowerShell full-screen capture:

```powershell
Add-Type -AssemblyName System.Windows.Forms,System.Drawing
$Bounds = [Windows.Forms.Screen]::PrimaryScreen.Bounds
$Bitmap = New-Object Drawing.Bitmap $Bounds.Width, $Bounds.Height
$Graphics = [Drawing.Graphics]::FromImage($Bitmap)
$Graphics.CopyFromScreen($Bounds.Location, [Drawing.Point]::Empty, $Bounds.Size)
$Bitmap.Save("$Out\screenshots\hud-windows-crisp.png", [Drawing.Imaging.ImageFormat]::Png)
$Graphics.Dispose()
$Bitmap.Dispose()
```

Windows interactive crop option:

```powershell
Start-Process ms-screenclip:
```

Save the result into the expected `$Out\screenshots\...` filename.

Linux GNOME/X11 or GNOME Wayland:

```sh
gnome-screenshot -f "$OUT/screenshots/hud-linux-crisp.png"
gnome-screenshot -f "$OUT/gpu/chrome-version.png"
gnome-screenshot -f "$OUT/gpu/chrome-gpu.png"
```

Linux Wayland with `grim`:

```sh
grim "$OUT/screenshots/hud-linux-crisp.png"
```

Linux X11 with ImageMagick:

```sh
import -window root "$OUT/screenshots/hud-linux-crisp.png"
```

## Required Store Captures

| File | Required Content | Notes |
| --- | --- | --- |
| `store-popup-<platform>.png` | Popup/options UI with `Chrome Video Upscaler` branding and core controls visible. | Capture from Chrome Stable with `dist` loaded. |
| `store-hud-<platform>.png` | HTML5 video with HUD visible. | HUD should show mode, backend/status, resolution, and FPS/status. |
| `before-after-<platform>.png` | Before/after or side-by-side quality comparison. | Use bundled fixture or a source with a recorded license/URL. |
| `site-controls-<platform>.png` | Site allow/block behavior or known-limit messaging. | Helps explain broad host permissions. |
| `chrome-version.png` | `chrome://version`. | Include Chrome channel/version and command line. |
| `chrome-gpu.png` | `chrome://gpu`. | Include WebGPU/WebGL status and adapter/driver details where visible. |

## HUD Mode Captures

Capture the same fixture and display size for each mode when possible.

| File | Mode | Required HUD Evidence |
| --- | --- | --- |
| `hud-<platform>-none.png` | None/disabled | Native video remains visible and no processing claim is active. |
| `hud-<platform>-auto.png` | Auto | Auto mode reaches a usable backend or shows a clear fallback. |
| `hud-<platform>-crisp.png` | Crisp | WebGL2/Crisp path and visible detail change. |
| `hud-<platform>-sharpen.png` | Sharpen | Sharpen path and visible paused-frame change. |
| `hud-<platform>-anime.png` | Anime | Anime/WebGL2 path and visible output difference. |
| `hud-<platform>-smooth.png` | Smooth | Smooth/WebGPU path where available, or explicit unavailable/fallback text. |
| `hud-<platform>-neural-lite.png` | Neural-Lite | ArtCNN/ONNX path, WebGPU/WASM fallback, or explicit runtime error. |
| `hud-<platform>-neural-pro.png` | Neural-Pro | RAVU-Lite or RAVU-Zoom path, or explicit performance/fallback limit. |

## Screenshot Record Template

Save this in `$OUT/logs/platform-notes.md` or next to the screenshots.

```md
## Screenshot Record

Platform:
Chrome version:
Display resolution:
Display scale:
Screenshot tool:
Source video path or URL:
Source license:
Source resolution:
Displayed CSS size:

| File | Mode/View | Scale | Sharpness | Frame Generation | HUD Text | Edited/Cropped | Notes |
| --- | --- | ---: | ---: | --- | --- | --- | --- |
| screenshots/store-popup-platform.png | Popup | n/a | n/a | n/a | n/a | No | TBD |
| screenshots/store-hud-platform.png | HUD | 1.5 | 0.2 | Off | TBD | No | TBD |
| screenshots/before-after-platform.png | Comparison | 1.5 | 0.2 | Off | TBD | Yes/No | TBD |
| screenshots/site-controls-platform.png | Site controls | n/a | n/a | n/a | TBD | No | TBD |
| screenshots/hud-platform-auto.png | Auto | 1.5 | 0.2 | Off | TBD | No | TBD |
| screenshots/hud-platform-crisp.png | Crisp | 1.5 | 0.2 | Off | TBD | No | TBD |
```

## Release Attachment Set

Each platform capture should attach:

- All required store captures.
- All HUD mode captures that were tested.
- `chrome://version` and `chrome://gpu` captures.
- `logs/platform-notes.md`.
- Benchmark files from [benchmark-local.md](benchmark-local.md).
- Release zip and SHA256 from the same commit.
