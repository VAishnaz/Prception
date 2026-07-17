import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

// Composer chain: render → sanitize → bloom → output.
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
  // threshold sits above the bright hazy sky so only the streak cores and
  // the buried sun bloom — a lower threshold washes the whole frame white
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(width, height), 0.28, 0.9, 1.25));
  composer.addPass(new OutputPass());
  return composer;
}
