import * as THREE from "three";
import { NOISE_GLSL } from "./noise.js";

// Sky streaks — the "alive sky" layer, modeled on sidewave.it's hero:
// bundles of soft, blended aurora-like light bands sweep diagonally across
// the sky, pulses of brightness race along their length, and the bundles
// slowly scissor and drift so the sky never sits still. A single
// additive-blended dome shell (one draw call, no render-to-texture, per the
// GPU notes in world.js). Motion is purely time-driven — no pointer input.
export function createAurora(scene) {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
    },
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

      // one soft aurora band shaped like the reference photo: a gently
      // diffuse ribbon that keeps the same width along its whole run, left
      // to right, so the right-side exit reads as a streak like the left
      // side instead of flaring into a filled wash. h0/h1 are the path
      // height at the left/right edges, width is the band thickness.
      // Returns (core, halo) so the two can be tinted separately while both
      // stay soft-edged.
      vec2 streak(float h, float ang, float h0, float h1, float width, float seed) {
        // 0 at the left screen edge, 1 well past the right edge — pushing
        // the far end off-frame keeps the flare widening in view all the
        // way to the right, instead of hitting u=1 and cutting off
        float u = clamp((ang + 0.8) / 2.1, 0.0, 1.0);

        // a gentle curved path, level-ish on the left, dipping and sweeping
        // down to the right exit — a soft curve rather than a ruled line,
        // plus a slow breathing wobble so the path itself isn't static
        float wobble = 0.012 * sin(uTime * 0.12 + seed * 2.3);
        float bend = -0.1 * sin(u * 3.14159265) + wobble;
        float path = mix(h0, h1, smoothstep(0.0, 1.0, u)) + bend;
        float dpath = (h1 - h0) - 0.1 * 3.14159265 * cos(u * 3.14159265);
        float c = (h - path) / sqrt(1.0 + dpath * dpath);

        // gentle hourglass profile: slightly slimmer through the middle,
        // broadening evenly toward both the left and right ends — a soft
        // waist, not a hard pinch, so the band never breaks apart
        // extra flare on the left entry so the bands pour in broad before
        // slimming through the waist
        float w = width * (0.82 + 0.5 * abs(u - 0.5) + 1.8 * (1.0 - smoothstep(0.0, 0.55, u)));

        // brightness pulses travel along the band's length, left to right,
        // so the sky keeps a living, animated current running through it
        // rather than sitting static — fast and high-contrast enough that
        // the motion clearly reads, with a floor that never opens a gap
        float travel = uTime * (0.09 + seed * 0.015);
        float shimmer = 0.58 + 0.42 * snoise(vec3(u * 3.5 - travel * 11.0, seed, 0.0));

        // diffuse aurora profile: a gentle mid glow blended into a wide soft
        // outer halo, both governed by the same wide gaussian width so
        // nothing reads as a hard line
        // where the band broadens, thin its light out — the same energy
        // spread over more width — so the wide left entry reads as a soft
        // dim veil rather than a solid neon wash
        float spread = mix(1.0, width / w, 0.75);
        float glow = exp(-(c * c) / (w * w * 1.2)) * 0.6;
        float halo = exp(-(c * c) / (w * w * 4.5)) * 0.4 * 0.3;
        return vec2(glow, halo) * shimmer * spread;
      }

      float hash(float n) { return fract(sin(n) * 43758.5453123); }

      // a field of hundreds of hairline streaks, all riding the same curved
      // path family/flow direction as the main bands. The band is sliced
      // into many thin lanes across its width (perpendicular to flow); each
      // lane gets its own hashed offset, speed and segment length so the
      // lines feel countless and independent rather than a repeating
      // pattern. Returns (lines, shade): crisp hairline cores, plus a wide
      // low density haze from the same lanes so the area between visible
      // lines still reads as gently shaded, not bare black.
      vec2 threadField(float h, float ang, float h0, float h1, float bandW, float seed) {
        float u = clamp((ang + 0.8) / 2.1, 0.0, 1.0);
        float wobble = 0.012 * sin(uTime * 0.12 + seed * 2.3);
        float bend = -0.1 * sin(u * 3.14159265) + wobble;
        float path = mix(h0, h1, smoothstep(0.0, 1.0, u)) + bend;
        float dpath = (h1 - h0) - 0.1 * 3.14159265 * cos(u * 3.14159265);
        float c = (h - path) / sqrt(1.0 + dpath * dpath);

        // band falls off softly at its edges instead of a hard cutoff, so
        // the hairlines fade with the same profile as the glow band they
        // ride inside rather than clipping visibly
        float edge = 1.0 - smoothstep(bandW * 0.6, bandW, abs(c));
        if (edge <= 0.001) return vec2(0.0);

        float lanes = 26.0;
        float p = (c / bandW) * 0.5 + 0.5; // 0..1 across the band
        float laneF = p * lanes + seed * 17.0;
        float lane = floor(laneF);
        float frac_ = fract(laneF);

        float lines = 0.0;
        float shade = 0.0;
        // sample this lane and its two neighbors so a hairline crossing a
        // lane boundary doesn't get clipped
        for (int k = -1; k <= 1; k++) {
          float li = lane + float(k);
          float rnd = hash(li + seed * 91.7);
          float rnd2 = hash(li * 3.13 + seed * 7.7 + 4.2);
          // only a third of lanes actually carry a visible hairline — the
          // rest stay dark, so lit lines read as distinct threads with gaps
          // between them instead of a solid filled band
          if (hash(li * 2.03 + seed * 5.5) > 0.35) continue;
          float offset = (float(k) - frac_) / lanes * bandW * 2.0;
          float w = mix(0.0006, 0.0014, rnd);
          // perpendicular distance from this lane's own center line
          float d = abs(offset);
          float speed = 0.03 + rnd * 0.05;
          float segLen = mix(0.1, 0.3, rnd2);
          float center = fract(uTime * speed + rnd * 6.28) * (1.0 + segLen) - segLen * 0.5;
          float dist = abs(u - center);
          float segment = 1.0 - smoothstep(segLen * 0.15, segLen * 0.5, dist);
          float core = exp(-(d * d) / (w * w));
          float bright = 0.3 + 0.5 * hash(li * 5.11 + seed);
          lines += core * segment * bright;
        }
        // one wide, low-density shade term for the whole band (not per
        // lane) — a gentle gradient across the band width so the space
        // around the hairlines still reads as softly lit, not bare black
        shade = exp(-(c * c) / (bandW * bandW * 0.5)) * 0.5;

        return vec2(lines, shade) * edge;
      }

      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        float ang = atan(d.x, -d.z); // azimuth, 0 = straight ahead

        // live only in the upper front sky; fade at horizon, overhead, behind
        float mask = smoothstep(0.02, 0.08, h)
                   * (1.0 - smoothstep(0.55, 0.85, h))
                   * smoothstep(-0.35, 0.10, -d.z);
        if (mask <= 0.002) { gl_FragColor = vec4(0.0); return; }

        // six soft bands: level-ish entries from the top-left, crossing
        // through the middle, sweeping down and exiting toward the right
        // mountain at constant width throughout — the reference's woven
        // crossing bundle
        vec2 s = vec2(0.0);
        s += streak(h, ang, 0.30, 0.130, 0.020, 1.0) * 1.00;
        s += streak(h, ang, 0.34, 0.105, 0.018, 2.0) * 0.90;
        s += streak(h, ang, 0.38, 0.160, 0.019, 3.0) * 0.85;
        s += streak(h, ang, 0.42, 0.085, 0.016, 4.0) * 0.80;
        s += streak(h, ang, 0.46, 0.180, 0.021, 5.0) * 0.70;
        s += streak(h, ang, 0.32, 0.118, 0.015, 6.0) * 0.85;

        // hundreds of hairline threads laced across the same band paths as
        // the wide bundles, each running independently so the sky reads as
        // countless minute streaks moving through — plus a shaded haze from
        // the same field so it never looks like bare lines on black
        vec2 tf = vec2(0.0);
        tf += threadField(h, ang, 0.30, 0.130, 0.020, 1.0) * 1.0;
        tf += threadField(h, ang, 0.34, 0.105, 0.018, 2.0) * 0.9;
        tf += threadField(h, ang, 0.38, 0.160, 0.019, 3.0) * 0.85;
        tf += threadField(h, ang, 0.42, 0.085, 0.016, 4.0) * 0.8;
        tf += threadField(h, ang, 0.46, 0.180, 0.021, 5.0) * 0.7;
        tf += threadField(h, ang, 0.32, 0.118, 0.015, 6.0) * 0.85;

        // teal glow blended into a dimmer teal halo — blue is kept well
        // below green (a true teal ratio, not cyan) and red near zero so
        // overlap/bloom pushes brightness, never hue, toward white; clamp
        // is per-channel and low enough that the ratio between channels
        // survives even where several bands stack
        vec3 col = vec3(0.0, 0.5, 0.28) * s.x
                 + vec3(0.0, 0.32, 0.18) * s.y
                 + vec3(0.0, 0.62, 0.36) * tf.x
                 + vec3(0.0, 0.24, 0.13) * tf.y;
        col = min(col, vec3(0.03, 0.68, 0.4));
        gl_FragColor = vec4(col * mask, 1.0);
      }
    `,
  });

  const mesh = new THREE.Mesh(new THREE.SphereGeometry(390, 64, 48), material);
  mesh.frustumCulled = false;
  scene.add(mesh);

  return {
    update(t) {
      material.uniforms.uTime.value = t;
    },
    dispose() {
      scene.remove(mesh);
      mesh.geometry.dispose();
      material.dispose();
    },
  };
}
