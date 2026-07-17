import * as THREE from "three";
import { makeNoise2D, fbm2 } from "./noise.js";

// Matching the reference's horizon: ONE soft, eroded range right of centre
// that barely rises above the plain, a few low mounds drifting off to the
// left, and a faint full-width ridge pinning the far horizon. Rounded
// weathered summits — no jagged spikes — reading as dark silhouettes against
// the bright horizon haze, with the fog doing the aerial-perspective fade.
function ridgeGeometry({ len, wid, hgt, seed }) {
  const geo = new THREE.PlaneGeometry(len, wid, 240, 24);
  geo.rotateX(-Math.PI / 2);
  const noise = makeNoise2D(seed);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const u = p.getX(i) / len + 0.5;
    const v = p.getZ(i) / wid + 0.5;
    // broad envelope + rounded secondary bumps = soft eroded summits
    const macro = Math.max(0, 1 - Math.abs(fbm2(noise, u * 2.6, v * 0.9, 3) * 2 - 1));
    const mid = Math.max(0, 1 - Math.abs(fbm2(noise, u * 6.5 + 4, v * 1.8, 3) * 2 - 1));
    let r = Math.pow(macro, 1.25) * 0.72 + Math.pow(mid, 2.0) * 0.45;
    // only a whisper of fine erosion — the reference slopes are smooth
    const fine = fbm2(noise, u * 22, v * 8, 3) * 0.035;
    // taper into the plain at both ends of the range
    const edge = Math.pow(Math.sin(Math.min(Math.max(u, 0), 1) * Math.PI), 0.45);
    // asymmetric front-to-back falloff — steeper camera-facing slope
    const vc = Math.min(Math.max(v, 0), 1);
    const prof = vc < 0.45
      ? Math.pow(vc / 0.45, 0.8)
      : Math.pow(Math.max(1 - (vc - 0.45) / 0.55, 0), 1.5);
    p.setY(i, (r + fine) * prof * edge * hgt);
  }
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

// soft low-contrast rock shading — under this much haze the silhouette does
// the work; the texture just keeps lit slopes from reading dead flat
function rockTexture(seed, size = 512) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  const img = ctx.createImageData(size, size);
  const n = makeNoise2D(seed);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const u = px / size, v = py / size;
      let r = 1 - Math.abs(fbm2(n, u * 8, v * 18, 4) * 2 - 1);
      r = Math.pow(r, 1.5);
      const streak = fbm2(n, u * 3 + 20, v * 30, 2);
      let val = 110 + r * 60 + streak * 25 + Math.random() * 8;
      val = Math.min(Math.max(val, 0), 255);
      const i = (py * size + px) * 4;
      img.data[i] = val; img.data[i + 1] = val * 0.98; img.data[i + 2] = val * 0.96;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

const LAYERS = [
  // hero range right of centre — the reference's main silhouette
  { len: 260, wid: 70, hgt: 21, seed: 47, pos: [70, 0, -175], color: 0x0f2e29 },
  // low mounds drifting off to the left, deeper in the haze
  { len: 360, wid: 55, hgt: 6, seed: 21, pos: [-150, 0, -260], color: 0x143631 },
  // faint full-width ridge pinning the far horizon
  { len: 900, wid: 60, hgt: 8, seed: 88, pos: [0, 0, -320], color: 0x193e38 },
];

// soft round glow sprite, used for the sun sitting just behind the ridge
function glowTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, "rgba(60,150,135,1)");
  g.addColorStop(0.25, "rgba(35,120,105,0.85)");
  g.addColorStop(0.6, "rgba(20,90,80,0.28)");
  g.addColorStop(1, "rgba(20,90,80,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(c);
}

export function createMountains(scene) {
  for (const l of LAYERS) {
    const rock = rockTexture(l.seed);
    rock.repeat.set(l.len / 110, 2.5);
    const material = new THREE.MeshStandardMaterial({
      color: l.color, roughness: 1, metalness: 0, fog: true,
      map: rock, bumpMap: rock, bumpScale: 0.22,
    });
    const mesh = new THREE.Mesh(ridgeGeometry(l), material);
    mesh.position.set(...l.pos);
    mesh.layers.enable(1);
    scene.add(mesh);
  }

  // the low sun burning through the haze right where the hero range meets
  // the plain — wide and low like the reference, not a tight point
  const glowMat = new THREE.SpriteMaterial({
    map: glowTexture(), color: 0x2d8577, transparent: true,
    depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.55,
  });
  const glow = new THREE.Sprite(glowMat);
  glow.scale.set(80, 36, 1);
  glow.position.set(58, 6, -168);
  scene.add(glow);

  return {};
}
