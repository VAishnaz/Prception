import * as THREE from "three";

// Patchy ground fog: soft billboard clumps drifting low over the plain and
// banked up against the mountain bases, on top of the scene's uniform
// FogExp2 — real fog is never a flat gradient, it pools and thins unevenly.

function wispTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, "rgba(255,255,255,0.5)");
  g.addColorStop(0.4, "rgba(255,255,255,0.22)");
  g.addColorStop(0.75, "rgba(255,255,255,0.06)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(c);
}

// One low patch: a handful of overlapping soft quads at slightly different
// sizes/rotations so it reads as an irregular clump, not a single disc.
function makePatch(map, color, baseScale) {
  const group = new THREE.Group();
  const puffs = 5;
  for (let i = 0; i < puffs; i++) {
    const s = baseScale * (0.55 + Math.random() * 0.7);
    const mat = new THREE.SpriteMaterial({
      map, color, transparent: true, depthWrite: false,
      opacity: 0.06 + Math.random() * 0.05,
      blending: THREE.NormalBlending,
    });
    const spr = new THREE.Sprite(mat);
    spr.scale.set(s * (1.3 + Math.random() * 0.6), s * 0.4, 1);
    spr.position.set(
      (Math.random() - 0.5) * baseScale * 1.4,
      Math.random() * baseScale * 0.12,
      (Math.random() - 0.5) * baseScale * 0.6
    );
    group.add(spr);
  }
  return group;
}

export function createGroundFog(scene) {
  const map = wispTexture();
  const color = new THREE.Color(0x8fb5ac);

  const patches = [];
  // banked against the mountain bases, low across the horizon line
  const ridgeSpots = [
    [-200, -250, 36], [-80, -240, 32], [40, -200, 28], [110, -180, 26],
    [190, -200, 30], [-280, -280, 38],
  ];
  for (const [x, z, s] of ridgeSpots) {
    const patch = makePatch(map, color, s);
    patch.position.set(x, 1.2 + Math.random() * 1.5, z);
    scene.add(patch);
    patches.push({ group: patch, baseX: x, baseZ: z, speed: 0.02 + Math.random() * 0.02, phase: Math.random() * 10 });
  }

  // low drifting patches scattered over the mid ground plain — kept far
  // enough back that they read as discrete clumps, not a wall filling frame
  const groundSpots = [
    [-70, -60, 20], [60, -75, 18], [-25, -95, 22], [100, -115, 18],
    [-120, -140, 20], [-160, -80, 18], [130, -60, 16],
  ];
  for (const [x, z, s] of groundSpots) {
    const patch = makePatch(map, color, s);
    patch.position.set(x, 0.8 + Math.random() * 1.0, z);
    scene.add(patch);
    patches.push({ group: patch, baseX: x, baseZ: z, speed: 0.03 + Math.random() * 0.03, phase: Math.random() * 10 });
  }

  return {
    update(t) {
      for (const p of patches) {
        p.group.position.x = p.baseX + Math.sin(t * p.speed + p.phase) * 6;
        p.group.position.z = p.baseZ + Math.cos(t * p.speed * 0.7 + p.phase) * 4;
      }
    },
  };
}
