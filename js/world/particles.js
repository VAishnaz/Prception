import * as THREE from "three";

// Drifting dust motes in the air between camera and mountains — the cheap
// detail that makes the world feel inhabited by atmosphere, not a backdrop.
const COUNT = 380;

// soft round sprite; without a map, points draw as hard squares
function moteTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.4, "rgba(255,255,255,0.5)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export function createParticles(scene) {
  const pos = new Float32Array(COUNT * 3);
  for (let i = 0; i < COUNT; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 160;
    pos[i * 3 + 1] = 1 + Math.random() * 30;
    pos[i * 3 + 2] = 15 - Math.random() * 180;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));

  const points = new THREE.Points(geo, new THREE.PointsMaterial({
    color: 0x9ffff4, map: moteTexture(),
    size: 0.35, sizeAttenuation: true,
    transparent: true, opacity: 0.4,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  points.frustumCulled = false;

  const group = new THREE.Group();
  group.add(points);
  scene.add(group);

  return {
    update(t) {
      // the whole field drifts sideways and breathes vertically, very slowly
      group.position.x = Math.sin(t * 0.03) * 4;
      group.position.y = Math.sin(t * 0.05) * 0.8;
      group.rotation.y = t * 0.002;
    },
  };
}
