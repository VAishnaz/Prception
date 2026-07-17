import * as THREE from "three";

// Slow cinematic drift: the camera breathes through a gentle lissajous
// wander, always gazing out across the plain. No pointer input — the motion
// is purely time-driven. Phase 3 (scroll) will drive this rig; keep all
// camera motion in here.

// low, near eye-level on the plain and gazing slightly up, so the horizon
// sits below centre and the sky owns most of the frame — like the reference
const BASE = new THREE.Vector3(0, 3.4, 18);
const LOOK = new THREE.Vector3(0, 8.5, -130);

export function createCameraRig(camera) {
  return {
    update(t) {
      camera.position.x = BASE.x + Math.sin(t * 0.05) * 1.6;
      camera.position.y = BASE.y + Math.sin(t * 0.038) * 0.45;
      camera.position.z = BASE.z + Math.sin(t * 0.021) * 1.8;
      camera.lookAt(LOOK.x + Math.sin(t * 0.03) * 3, LOOK.y, LOOK.z);
    },
  };
}
