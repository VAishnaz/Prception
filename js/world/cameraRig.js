import * as THREE from "three";

// Slow cinematic drift: the camera breathes through a gentle lissajous
// wander, always gazing out across the plain. No pointer input — the motion
// is purely time-driven (pointer parallax was tried 2026-07-17 and rolled
// back: the world must not move with the mouse). Scroll (setApproach) drives
// a separate push toward the settled energy core, layered on top of the
// same idle drift so the camera never goes perfectly still.

// low, near eye-level on the plain and gazing slightly up, so the horizon
// sits below centre and the sky owns most of the frame — like the reference
const BASE = new THREE.Vector3(0, 3.4, 18);
const LOOK = new THREE.Vector3(0, 8.5, -130);

// where the camera ends up once fully approached, and what it looks at —
// close enough to the core (SETTLE in energyCore.js, (0, 5.4, -10)) to fill
// the frame, but still offset so the sigil-burn framing isn't lost
const APPROACH_POS = new THREE.Vector3(0, 4.6, 2);
const APPROACH_LOOK = new THREE.Vector3(0, 5.4, -10);

const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

export function createCameraRig(camera) {
  let approachTarget = 0;
  let approach = 0;
  return {
    // scroll-driven 0..1: how far the camera has pushed in toward the core
    setApproach(v) { approachTarget = v <= 0 ? 0 : v >= 1 ? 1 : v; },
    update(t) {
      // lag the raw scroll input just enough to smooth out per-frame scroll
      // jitter, without the camera visibly trailing behind the scrollbar
      approach += (approachTarget - approach) * 0.16;
      const a = smooth(approach);

      const driftX = BASE.x + Math.sin(t * 0.05) * 1.6;
      const driftY = BASE.y + Math.sin(t * 0.038) * 0.45;
      const driftZ = BASE.z + Math.sin(t * 0.021) * 1.8;
      camera.position.x = THREE.MathUtils.lerp(driftX, APPROACH_POS.x, a);
      camera.position.y = THREE.MathUtils.lerp(driftY, APPROACH_POS.y, a);
      camera.position.z = THREE.MathUtils.lerp(driftZ, APPROACH_POS.z, a);

      // look-at X rides the SAME drift as the camera position (not its own
      // independent sine) so the settled core — fixed at world x0 — always
      // sits dead-center in frame instead of swinging left/right as the two
      // drifts dephase against each other
      const lookX = LOOK.x + (driftX - BASE.x);
      const tx = THREE.MathUtils.lerp(lookX, APPROACH_LOOK.x, a);
      const ty = THREE.MathUtils.lerp(LOOK.y, APPROACH_LOOK.y, a);
      const tz = THREE.MathUtils.lerp(LOOK.z, APPROACH_LOOK.z, a);
      camera.lookAt(tx, ty, tz);
    },
  };
}
