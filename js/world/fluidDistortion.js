import * as THREE from "three";

// Screen-space fluid distortion, the same trick behind the Sidewave hero:
// the cursor splats velocity into a low-res field each frame, that field
// decays/diffuses like a simple fluid, and the final composite pass reads
// it back as a UV offset so the rendered world ripples where the pointer
// has been. No 3D geometry involved — this warps the finished frame.
export function createFluidDistortion(renderer, container) {
  const SIM_SIZE = 256; // velocity field resolution — coarse on purpose, blurred by sampling

  const simScene = new THREE.Scene();
  const simCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new THREE.PlaneGeometry(2, 2);

  const rtOptions = {
    type: THREE.HalfFloatType,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    depthBuffer: false,
    stencilBuffer: false,
  };
  let rtA = new THREE.WebGLRenderTarget(SIM_SIZE, SIM_SIZE, rtOptions);
  let rtB = new THREE.WebGLRenderTarget(SIM_SIZE, SIM_SIZE, rtOptions);

  const simMaterial = new THREE.ShaderMaterial({
    uniforms: {
      tPrev: { value: null },
      uSplatPos: { value: new THREE.Vector2(-1, -1) },
      uSplatPosPrev: { value: new THREE.Vector2(-1, -1) },
      uSplatVel: { value: new THREE.Vector2(0, 0) },
      uSplatRadius: { value: 0.0014 },
      uDecay: { value: 0.72 },
      uAspect: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D tPrev;
      uniform vec2 uSplatPos;
      uniform vec2 uSplatPosPrev;
      uniform vec2 uSplatVel;
      uniform float uSplatRadius;
      uniform float uDecay;
      uniform float uAspect;
      varying vec2 vUv;

      void main() {
        // gentle diffusion: blend in neighbours so splats spread like a fluid
        vec2 texel = vec2(1.0) / vec2(256.0);
        vec2 n = texture2D(tPrev, vUv + vec2(0.0, texel.y)).xy;
        vec2 s = texture2D(tPrev, vUv - vec2(0.0, texel.y)).xy;
        vec2 e = texture2D(tPrev, vUv + vec2(texel.x, 0.0)).xy;
        vec2 w = texture2D(tPrev, vUv - vec2(texel.x, 0.0)).xy;
        vec2 self = texture2D(tPrev, vUv).xy;
        vec2 diffused = self * 0.975 + (n + s + e + w) * 0.006;

        vec2 velocity = diffused * uDecay;

        // inject the cursor's velocity as a splat along the segment from the
        // previous to the current pointer sample (not just a point at the
        // latest position) — a fast flick can jump several pixels between
        // two mousemove events, and splatting only the endpoint leaves gaps
        // that read as separate dots instead of one continuous stroke
        vec2 uv = vUv;
        uv.x *= uAspect;
        vec2 a = uSplatPos; a.x *= uAspect;
        vec2 b = uSplatPosPrev; b.x *= uAspect;
        vec2 ab = b - a;
        float t = clamp(dot(uv - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
        vec2 closest = a + ab * t;
        vec2 d = uv - closest;
        float falloff = exp(-dot(d, d) / uSplatRadius);
        velocity += uSplatVel * falloff;

        gl_FragColor = vec4(velocity, 0.0, 1.0);
      }
    `,
  });
  const simMesh = new THREE.Mesh(quad, simMaterial);
  simScene.add(simMesh);

  const pointer = new THREE.Vector2(-1, -1);
  const pointerPrev = new THREE.Vector2(-1, -1);
  const pointerVel = new THREE.Vector2(0, 0);
  const splatPosPrevFrame = new THREE.Vector2(-1, -1);
  let hasPointer = false;

  function onPointerMove(e) {
    const rect = container.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const x = (e.clientX - rect.left) / rect.width;
    const y = 1.0 - (e.clientY - rect.top) / rect.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) { hasPointer = false; return; }
    if (hasPointer) {
      pointerVel.set(x - pointerPrev.x, y - pointerPrev.y);
    }
    pointerPrev.set(x, y);
    pointer.set(x, y);
    hasPointer = true;
  }
  function onPointerLeave() { hasPointer = false; }

  // listen on window, not the container: the container's children (service
  // cards, UI text) sit above it in z-index and would otherwise swallow the
  // hit-test before it ever reaches #focusWorld's own listener
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerleave", onPointerLeave);

  function update() {
    const rect = container.getBoundingClientRect();
    const aspect = rect.height > 0 ? rect.width / rect.height : 1;
    simMaterial.uniforms.uAspect.value = aspect;
    simMaterial.uniforms.tPrev.value = rtA.texture;

    if (hasPointer) {
      simMaterial.uniforms.uSplatPos.value.copy(pointer);
      simMaterial.uniforms.uSplatPosPrev.value.copy(splatPosPrevFrame);
      // scale so a fast flick reads as a strong ripple, a slow drift still
      // shows as a gentle blend — clamped so a very fast flick (which can
      // arrive as one large delta between sparse mousemove events) doesn't
      // blow out into a harsh streak
      const vx = Math.max(-0.12, Math.min(0.12, pointerVel.x * 6.0));
      const vy = Math.max(-0.12, Math.min(0.12, pointerVel.y * 6.0));
      simMaterial.uniforms.uSplatVel.value.set(vx, vy);
    } else {
      simMaterial.uniforms.uSplatPos.value.set(-1, -1);
      simMaterial.uniforms.uSplatPosPrev.value.set(-1, -1);
      simMaterial.uniforms.uSplatVel.value.set(0, 0);
    }
    // remember this frame's pointer so next frame's splat can draw the
    // segment from here to wherever the cursor lands next, instead of a
    // single point — this is what closes the gap during a fast flick
    splatPosPrevFrame.copy(pointer);
    // velocity impulse is one-shot per frame — consume it so a held-still
    // cursor stops injecting energy and the field settles back to calm
    pointerVel.set(0, 0);

    const prevTarget = renderer.getRenderTarget();
    renderer.setRenderTarget(rtB);
    renderer.render(simScene, simCamera);
    renderer.setRenderTarget(prevTarget);

    const tmp = rtA;
    rtA = rtB;
    rtB = tmp;
  }

  function getTexture() {
    return rtA.texture;
  }

  function dispose() {
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerleave", onPointerLeave);
    rtA.dispose();
    rtB.dispose();
    quad.dispose();
    simMaterial.dispose();
  }

  return { update, getTexture, dispose };
}
