import * as THREE from "three";
import { groundHeightAt } from "./ground.js";

// The lone figure standing out on the plain — the reference's scale anchor.
// Built from a handful of primitives: at ~40 units away, half-swallowed by
// the haze, it reads as a person without needing a rigged model. Phase 2+
// can swap this for an animated GLB without touching anything else.
export function createFigure(scene) {
  const mat = new THREE.MeshStandardMaterial({ color: 0x08201c, roughness: 1 });
  const group = new THREE.Group();

  const add = (geo, x, y, z, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.z = rz;
    group.add(m);
  };

  add(new THREE.CapsuleGeometry(0.16, 0.52, 4, 12), 0, 1.12, 0);           // torso
  add(new THREE.SphereGeometry(0.115, 16, 12), 0, 1.58, 0);                // head
  add(new THREE.CapsuleGeometry(0.06, 0.5, 4, 8), -0.09, 0.32, 0, 0.05);   // legs
  add(new THREE.CapsuleGeometry(0.06, 0.5, 4, 8), 0.09, 0.32, 0, -0.05);
  add(new THREE.CapsuleGeometry(0.05, 0.42, 4, 8), -0.21, 1.05, 0, 0.1);   // arms
  add(new THREE.CapsuleGeometry(0.05, 0.42, 4, 8), 0.21, 1.05, 0, -0.1);

  const x = 4, z = -22;
  const baseY = groundHeightAt(x, z);
  group.position.set(x, baseY, z);
  scene.add(group);

  return {
    update(t) {
      // barely-there idle sway — alive, not animated
      group.rotation.z = Math.sin(t * 0.6) * 0.01;
      group.position.y = baseY + Math.sin(t * 0.8) * 0.008;
    },
  };
}
