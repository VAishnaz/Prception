---
name: verify
description: How to run and visually verify the Prception site (static HTML + Three.js hero)
---

# Verifying the Prception site

Static site, no build step. Entry point is `index.html` at the repo root.

## Serve

```powershell
Start-Process -WindowStyle Hidden python -ArgumentList '-m','http.server','8734','-d','c:\Users\viswa\Documents\prception'
```

(Serving matters — the page loads Three.js/Lenis from CDN and the logo PNG; `file://` is fine too but a server avoids surprises.)

## Screenshot with Playwright

`npm i playwright` in the scratchpad, then a script with `chromium.launch()`. Collect
`pageerror` and console errors — the Three.js module failing shows a blank `.sign` div, not a crash.

**Gotcha: headless Chromium uses SwiftShader (software WebGL) — a few fps.**
The hero logo assembles via per-frame easing (`fanCur += (target - fanCur) * 0.12`),
so it needs ~50 rendered frames to settle. At software-GL frame rates that is
30–60 s of wall-clock waiting. Use a small viewport (960×540) to speed frames up
and wait ~45 s before the hero screenshot. Renders darker than on a real GPU; judge
shape/layout, not lighting.

**Always ALSO screenshot on the real GPU before calling a visual done:**
`chromium.launch({ args: ["--enable-gpu", "--use-gl=angle", "--use-angle=d3d11"] })`
— this uses the machine's actual GPU (AMD Radeon Vega 10 via ANGLE/D3D11), which is
what the user sees in Chrome, and it catches driver-level bugs SwiftShader silently
tolerates. Real case: `THREE.Reflector` render-to-texture inside an EffectComposer
pass blacks out the ENTIRE frame on D3D11 while looking perfect in SwiftShader
(hit on world.html 2026-07-16; fixed by removing Reflector). GPU frames are also
~10× faster, so waits can be much shorter.

## Flows worth driving

- Hero at scroll 0 after settling: assembled 3D mark (must match the official logo:
  P/play body with triangle inlet + detached rounded square with dot-hook).
- Mid-pin (`scrollTo` 50% of `intro.offsetHeight - innerHeight`): skin shards peeled,
  hollow outline visible, beat 02 text overlaid.
- ~95%: logo traveled down/off, beat 03 visible; pin releases into Focused Vision.
