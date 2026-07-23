import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

// fluid distortion pass: pixels get dragged along the cursor's direction of
// travel — true advection, read straight from the velocity field that
// fluidDistortion.js simulates (splat + diffuse + decay). This is what makes
// it read as the image itself smearing/meshing into its neighbours (the
// Sidewave-hero look) instead of a lens bulging inward toward a center point.
// No separate radial term — the flow field alone carries the effect, so
// there's nothing shaped like a "blob" for the eye to lock onto.
// Sits after the sanitizer so it warps clean pixels, and before bloom so
// bloom reacts to the already-rippled frame instead of stale UVs.
const FluidDistortionShader = {
  uniforms: {
    tDiffuse: { value: null },
    tFluid: { value: null },
    uStrength: { value: 1.5 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform sampler2D tFluid;
    uniform float uStrength;
    varying vec2 vUv;

    void main() {
      vec2 velocity = texture2D(tFluid, vUv).xy;
      vec2 warped = vUv - velocity * uStrength;

      // beyond just displacing the sample point, actually blend colour
      // along the flow direction — a handful of taps stepping back through
      // the velocity, averaged together. This is what reads as pixels
      // physically mixing into their neighbours (liquid), rather than the
      // image staying sharp but shifted (a lens).
      vec3 color = texture2D(tDiffuse, warped).rgb;
      float total = 1.0;
      vec2 step = velocity * uStrength * 0.35;
      vec2 samplePos = warped;
      for (int i = 1; i <= 4; i++) {
        samplePos -= step;
        float w = 1.0 / float(i + 1);
        color += texture2D(tDiffuse, samplePos).rgb * w;
        total += w;
      }
      color /= total;

      gl_FragColor = vec4(color, 1.0);
    }
  `,
};

// Composer chain: render → sanitize → fluid distortion → bloom → output.
// The sanitizer matters: one stray NaN/Inf pixel gets smeared over the WHOLE
// frame by the bloom blur — an intermittent full-black "blink" (hit on this
// machine before). Zero out non-finite pixels and clamp the HDR range first.
export function createPostProcessing(renderer, scene, camera, width, height) {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new ShaderPass({
    uniforms: { tDiffuse: { value: null } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse;
      varying vec2 vUv;
      void main() {
        vec4 c = texture2D(tDiffuse, vUv);
        if (any(isnan(c)) || any(isinf(c))) c = vec4(0.0, 0.0, 0.0, 1.0);
        gl_FragColor = clamp(c, 0.0, 8.0);
      }
    `,
  }));
  const fluidPass = new ShaderPass(FluidDistortionShader);
  composer.addPass(fluidPass);
  // threshold sits above the bright hazy sky so only the streak cores and
  // the buried sun bloom — a lower threshold washes the whole frame white
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(width, height), 0.28, 0.9, 1.25));
  composer.addPass(new OutputPass());
  composer.fluidPass = fluidPass;
  return composer;
}
