import * as THREE from "three";
import { NOISE_GLSL } from "./noise.js";

// The aurora ribbons: wide additive planes high in the sky, their light
// flowing horizontally through fbm noise — bloom turns them into the
// reference's volumetric sweeps pouring in from the right.

const RIBBONS = [
  // y, z, length, thickness, z-tilt, flow speed, intensity — a fan filling
  // the upper sky, dipping toward the bright right horizon
  { y: 40, z: -195, len: 480, th: 30, tilt: -0.1, speed: 0.045, i: 0.5 },
  { y: 38, z: -190, len: 460, th: 24, tilt: -0.103, speed: 0.06, i: 0.6 },
  { y: 36, z: -185, len: 440, th: 20, tilt: -0.098, speed: 0.075, i: 0.7 },
  { y: 34, z: -180, len: 420, th: 15, tilt: -0.096, speed: 0.09, i: 0.75 },
  // two brighter lines riding the pack — kept wide enough to stay soft
  { y: 32, z: -175, len: 400, th: 12, tilt: -0.094, speed: 0.1, i: 0.85 },
  { y: 39, z: -192, len: 460, th: 16, tilt: -0.101, speed: 0.05, i: 0.75 },
];

export function createLightStreaks(scene) {
  const materials = [];
  for (const r of RIBBONS) {
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: Math.random() * 100 },
        uSpeed: { value: r.speed },
        uIntensity: { value: r.i },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: NOISE_GLSL + /* glsl */ `
        uniform float uTime, uSpeed, uIntensity;
        varying vec2 vUv;
        void main() {
          // the ribbon's spine undulates: a slow noise wave bends it so it
          // sweeps like the reference's aurora instead of a ruler line
          float wave = fbm(vec3(vUv.x * 1.6 - uTime * uSpeed * 2.0, 7.31, uTime * 0.02)) * 0.2;
          float y = vUv.y - 0.5 - wave;
          // width itself drifts along x, like aurora curtains breathing —
          // mirrored about the spine's midpoint so the taper toward each
          // end is even, instead of ballooning wider on one side
          float distFromMid = abs(vUv.x - 0.5);
          // hourglass waist: broad at the ends, gently pinched at the
          // center — a shallow curve, not a full hourglass squeeze
          float waist = 0.88 + 0.32 * smoothstep(0.0, 0.5, distFromMid);
          float widthMod = waist * (0.7 + 0.6 * fbm(vec3(distFromMid * 2.2 - uTime * uSpeed * 1.5, 2.9, uTime * 0.015)));
          // single wide gaussian, no tight core at all — pure soft glow
          float d = (y * y) / (widthMod * widthMod);
          float band = exp(-d * 5.5);
          // light flowing along it — the aurora shimmer, pushed faster and
          // punchier so the motion actually reads instead of just glowing
          float flow = fbm(vec3(vUv.x * 4.5 - uTime * uSpeed * 26.0, vUv.y * 2.0, uTime * 0.08));
          flow = 0.55 + 0.75 * smoothstep(0.0, 0.6, flow);
          // fade the ends so ribbons never cut off hard
          float ends = smoothstep(0.0, 0.08, vUv.x) * smoothstep(1.0, 0.9, vUv.x);
          float a = band * ends * flow * uIntensity * 0.55;
          a = min(a, 0.7);
          vec3 col = mix(vec3(0.0, 0.5, 0.44), vec3(0.05, 0.85, 0.72), band * 0.5);
          gl_FragColor = vec4(col * a, a);
        }
      `,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(r.len, r.th, 1, 1), mat);
    mesh.position.set(r.len * 0.05, r.y, r.z);
    mesh.rotation.z = r.tilt;
    mesh.frustumCulled = false;
    scene.add(mesh);
    materials.push(mat);
  }

  return {
    update(t) {
      for (const m of materials) m.uniforms.uTime.value = t;
    },
  };
}
