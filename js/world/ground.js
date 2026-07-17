import * as THREE from "three";
import { makeNoise2D, fbm2, smooth } from "./noise.js";

// Rocky alien plain: broad swells broken into ridged shelves, slabs and
// rubble, another-planet surface under the teal haze. The bright same-hue
// fog does the aerial fade. The "reflections" are deliberately faked:
// a true mirror (Reflector / MeshReflectorMaterial) does a render-to-texture
// pass mid-frame, which blacks out the whole composer frame on ANGLE/D3D11
// GPUs (proven on this machine) — soft additive light pools instead.

const heightNoise = makeNoise2D(7);

// exported so other modules can place things on the terrain
export function groundHeightAt(x, z) {
  // near-flat plain like the reference: only a whisper of undulation so the
  // surface still catches light, no dunes, ridges or rubble
  let h = fbm2(heightNoise, x * 0.008 + 3.7, z * 0.008 + 9.1, 2) * 0.04;
  h *= 0.5 + 0.5 * smooth(15, 140, Math.hypot(x, z)); // calmer underfoot
  return h;
}

// clumpy multi-octave rock shading — reads as boulders and broken slabs
// under bump shading, like the surface of another planet
function rockTexture(size = 512) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  const img = ctx.createImageData(size, size);
  const n = makeNoise2D(31);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const u = px / size, v = py / size;
      // ridged fbm: sharp creases between rounded rock masses
      let r = 1 - Math.abs(fbm2(n, u * 14, v * 14, 4) * 2 - 1);
      r = Math.pow(r, 1.7);
      const lump = fbm2(n, u * 7 + 30, v * 7, 3);
      // crevice mask: deep cracks between boulders crush toward black
      const crevice = 1 - Math.pow(1 - Math.abs(fbm2(n, u * 20 + 60, v * 20, 3) * 2 - 1), 3.5);
      let val = 55 + r * 115 + lump * 60 + Math.random() * 12;
      val = Math.min(Math.max(val, 0), 255);
      val *= 1 - crevice * 0.6;
      const i = (py * size + px) * 4;
      img.data[i] = val * 0.62;
      img.data[i + 1] = val;
      img.data[i + 2] = val * 0.94;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  // mirrored wrap: the canvas noise isn't seamless, and plain repeat draws
  // visible tile seams across the foreground
  tex.wrapS = tex.wrapT = THREE.MirroredRepeatWrapping;
  tex.repeat.set(24, 17);
  return tex;
}

// scattered elongated pools of skylight on the plain
function poolsTexture() {
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = 512;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, c.width, c.height);
  for (let i = 0; i < 26; i++) {
    const x = Math.random() * c.width;
    const y = c.height * (0.15 + Math.random() * 0.8);
    const w = 40 + Math.random() * 180;
    const h = 6 + Math.random() * 22;
    const g = ctx.createRadialGradient(x, y, 0, x, y, w);
    g.addColorStop(0, `rgba(110,255,244,${0.15 + Math.random() * 0.2})`);
    g.addColorStop(1, "rgba(20,80,76,0)");
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1, h / w);
    ctx.translate(-x, -y);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, w, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createGround(scene) {
  const geo = new THREE.PlaneGeometry(720, 460, 220, 150);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, 0, -110);         // spans z +120 … -340
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    p.setY(i, groundHeightAt(p.getX(i), p.getZ(i)));
  }
  geo.computeVertexNormals();
  geo.computeBoundingSphere();

  const rock = rockTexture();
  scene.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    color: 0x2c6058, roughness: 0.95, metalness: 0.0,
    map: rock, bumpMap: rock, bumpScale: 0.05,
  })));

  // skylight pools riding just above the plain — faint damp patches
  const poolsMat = new THREE.MeshBasicMaterial({
    map: poolsTexture(), transparent: true, opacity: 0.06,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const pools = new THREE.Mesh(new THREE.PlaneGeometry(720, 460), poolsMat);
  pools.rotation.x = -Math.PI / 2;
  pools.position.set(0, 0.9, -110);
  scene.add(pools);

  return {
    update(t) {
      // the damp patches breathe — swell and dim almost imperceptibly
      poolsMat.opacity = 0.06 + Math.sin(t * 0.35) * 0.02;
    },
  };
}
