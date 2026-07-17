import * as THREE from "three";
import { NOISE_GLSL } from "./noise.js";

// Inward-facing dome, graded like the reference: a bright luminous haze at
// the horizon lifting into a deep-teal zenith — the sky owns most of the
// frame and never falls to black. A wide warm glow sits low on the right,
// the sun buried behind the mountain range.
export function createSky(scene) {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: NOISE_GLSL + /* glsl */ `
      uniform float uTime;
      varying vec3 vDir;
      void main() {
  vec3 d = normalize(vDir);
        float y = max(d.y, -0.05);
        // teal atmosphere throughout — every stop, including the horizon and
        // the sun glow, stays inside the teal family. Sunrays read as a
        // brighter, warmer-leaning teal, never crossing into orange/tan
        vec3 horizon = vec3(0.025, 0.145, 0.145);
        vec3 low     = vec3(0.017, 0.12, 0.12);
        vec3 mid     = vec3(0.008, 0.06, 0.065);
        vec3 zenith  = vec3(0.002, 0.02, 0.028);
        vec3 col = mix(horizon, low, smoothstep(-0.02, 0.16, y));
        col = mix(col, mid, smoothstep(0.14, 0.46, y));
        col = mix(col, zenith, smoothstep(0.42, 0.88, y));
        // sunray shafts: broad diagonal rays of brighter teal light raking
        // across the sky, mixed in rather than a solid band
        vec3 sunDir = normalize(vec3(0.42, 0.05, -1.0));
        float s = max(dot(d, sunDir), 0.0);
        float rayAngle = d.x * 2.2 - d.y * 1.1;
        float rays = 0.5 + 0.5 * sin(rayAngle * 3.0);
        rays = pow(rays, 2.5);
        float sunFalloff = pow(s, 2.5);
        col += vec3(0.006, 0.045, 0.045) * rays * sunFalloff * 0.35;
        // the buried sun: deep, saturated teal core low on the right — glow, not glare
        col += vec3(0.006, 0.06, 0.055) * (pow(s, 40.0) * 0.35 + pow(s, 10.0) * 0.05);
        // thin extra-bright teal band hugging the horizon line all the way round
        float band = pow(max(1.0 - abs(d.y - 0.02), 0.0), 8.0);
        col += vec3(0.01, 0.04, 0.038) * band;
        // slow-drifting wisps so the sky is never a dead gradient
        vec3 q = vec3(d.x * 1.6 - d.y * 2.0, d.y * 4.2 + d.x * 1.2, d.z * 1.6)
               + vec3(0.0, uTime * 0.006, 0.0);
        float neb = smoothstep(-0.1, 0.9, fbm(q));
        col += vec3(0.004, 0.015, 0.014) * neb * smoothstep(0.05, 0.6, y);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });

  const mesh = new THREE.Mesh(new THREE.SphereGeometry(400, 48, 32), material);
  mesh.frustumCulled = false;
  scene.add(mesh);

  return {
    update(t) { material.uniforms.uTime.value = t; },
  };
}
