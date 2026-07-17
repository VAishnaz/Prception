import * as THREE from "three";
import { NOISE_GLSL, clamp01, smooth } from "./noise.js";

// Phase 2 — the floating liquid energy core: a glossy jelly blob (sidewave.it
// hero reference, re-graded into the brand's teal family). Scroll story:
// it drops in from above the top of frame, small and tumbling, swelling as it
// falls, and settles large at dead center.
//
// Jelly, not chrome: reflections come from a prebaked PMREM softbox panel
// env (NO transmission / Reflector — mid-frame RTT blacks out the composer
// on this machine), the translucency is faked with a fresnel rim glow +
// a soft inner emissive, and the surface flows via fbm displacement injected
// into MeshStandardMaterial's vertex stage with neighbour-sampled normals.

const lerp = (a, b, t) => a + (b - a) * t;
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

// path: starts above the top edge of the frame (camera at y3.4 looking up
// toward y8.5@-130 — top of frame at z-10 is ~y18), lands frame-center
const START = new THREE.Vector3(0.8, 21, -16);
const SETTLE = new THREE.Vector3(0, 5.1, -10);

export function createEnergyCore(scene, renderer) {
  // -- prebaked studio env: teal softboxes with a mint key and a cool
  //    lilac accent so the jelly reads as a *mixed* teal, not one flat hue
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const panel = (hex, intensity, w, h, x, y, z) => {
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(intensity) });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    mesh.position.set(x, y, z);
    mesh.lookAt(0, 0, 0);
    envScene.add(mesh);
  };
  // intensities stay low: a hot panel clips through ACES into a WHITE
  // specular dot — the brief bans any white on the core
  panel(0x36f2e4, 2.6, 6, 2.2, -5, 6, 5);  // saturated-teal key, upper-left
  panel(0x1fe6dc, 2.2, 9, 4, 7, 1.5, -3);  // broad brand-teal wash, right
  panel(0x25d8cc, 2.4, 4, 0.7, 0, 8, -1);  // teal strip overhead
  panel(0x8fd8ff, 1.2, 5, 3, -7, -2, -4);  // cool ice-cyan accent — the "mix"
  panel(0x0a4a44, 2, 14, 9, 0, -7, 2);     // deep sea-teal floor bounce
  panel(0x06302c, 1.8, 18, 12, 0, 0, -9);  // dim back wall, lobes never go dead
  const envTex = pmrem.fromScene(envScene, 0.04).texture;
  envScene.traverse((o) => o.material && o.material.dispose());
  pmrem.dispose();

  const uniforms = {
    uTime: { value: 0 },
    uAmp: { value: 0.16 },    // displacement amplitude — most alive mid-flight
    uFreq: { value: 0.5 },    // low frequency = big slow jelly lobes
    // one-time PMREM snapshot of the finished world (sky/aurora/mountains),
    // baked by bakeSurroundings() below — the gel samples it blurred along
    // the refracted view dir to fake frosted transmission (real transmission
    // RTTs mid-frame and blacks out the composer on this GPU)
    uWorldEnv: { value: null },
  };
  // brief palette: base/mid/highlight/deep-shadow teal-glass family
  const COL_BASE = new THREE.Color(0x0b8e8c);
  const COL_MID = new THREE.Color(0x22d3c5);
  const COL_HI = new THREE.Color(0x9ffff5);
  const COL_DEEP = new THREE.Color(0x043b3b);

  // dark glassy shell, softly reflective — the light comes from INSIDE
  // (fragment glow below), so the base surface stays deep sea-teal.
  // Transparent: the atmosphere shows through the heart of the gel (alpha is
  // a fresnel gradient set in the fragment patch — real transmission is
  // banned on this GPU, it RTTs mid-frame and blacks out the composer)
  // wet-glass shell: near-zero roughness so the world's aurora streaks and
  // sky gradient reflect on the surface as crisp colored sweeps. The softbox
  // env is only a placeholder — bakeSurroundings() swaps in the real world
  // snapshot, so the core visibly mirrors the background it sits in.
  const mat = new THREE.MeshStandardMaterial({
    color: 0x0b3834, metalness: 0.35, roughness: 0.07,
    envMap: envTex, envMapIntensity: 2.6,
    emissive: 0x041e1c, emissiveIntensity: 0.6,
    transparent: true,
  });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms, {
      uColBase: { value: COL_BASE },
      uColMid: { value: COL_MID },
      uColHi: { value: COL_HI },
      uColDeep: { value: COL_DEEP },
    });
    shader.vertexShader = NOISE_GLSL + /* glsl */`
      uniform float uTime, uAmp, uFreq;
      varying float vJN;
      varying vec3 vDirF;
      vec3 coreOrth(vec3 v) {
        return normalize(abs(v.x) > 0.5 ? vec3(-v.y, v.x, 0.0) : vec3(0.0, -v.z, v.y));
      }
      float jellyN(vec3 dir) {
        // single low-frequency lobe field — anything higher frequency turns
        // the surface crinkly like foil instead of smooth flowing gel
        float n = snoise(dir * uFreq + vec3(0.0, uTime * 0.2, uTime * 0.13));
        n += 0.35 * snoise(dir * 1.1 - vec3(uTime * 0.16, uTime * 0.11, 0.0));
        return n;
      }
      vec3 jelly(vec3 p) {
        vec3 dir = normalize(p);
        return dir * (length(p) * (1.0 + jellyN(dir) * uAmp));
      }
    ` + shader.vertexShader
      .replace("#include <beginnormal_vertex>", /* glsl */`
        vec3 jDir = normalize(position);
        vDirF = jDir;
        vec3 jTng = coreOrth(jDir);
        vec3 jBtn = cross(jDir, jTng);
        float jE = 0.08;
        vec3 jP0 = jelly(position);
        vec3 jP1 = jelly(position + jTng * jE);
        vec3 jP2 = jelly(position + jBtn * jE);
        // epsilon: a degenerate cross must never NaN into a black-frame blink
        vec3 objectNormal = normalize(cross(jP1 - jP0, jP2 - jP0) + vec3(1e-6));
        vJN = jellyN(jDir);
      `)
      .replace("#include <begin_vertex>", /* glsl */`
        vec3 transformed = jP0;
      `);
    // lit from within: a milky cyan glow blooming where the surface faces
    // the eye, swirled by the same lobe noise (bright washes sliding over a
    // luminous heart), falling away to a dark deep-teal silhouette rim —
    // the reference's "light trapped inside the gel" look, no transmission
    shader.fragmentShader = NOISE_GLSL + "uniform float uTime;\nuniform sampler2D uWorldEnv;\nuniform vec3 uColBase, uColMid, uColHi, uColDeep;\nvarying float vJN;\nvarying vec3 vDirF;\n" + shader.fragmentShader.replace(
      // the world's hot key lights (sunrise@30, rake) throw specular glints
      // that ACES clips to WHITE on this glossy shell — tint every specular
      // path teal and cap its energy so highlights can never leave the family
      "#include <lights_fragment_end>", /* glsl */`
      #include <lights_fragment_end>
      {
        const vec3 tealTint = vec3(0.30, 1.0, 0.90);
        // cap is generous enough to let the world's reflected aurora blaze
        // on the shell, but the low red ceiling keeps every glint teal
        reflectedLight.directSpecular = min(reflectedLight.directSpecular * tealTint, vec3(0.3, 1.35, 1.15));
        reflectedLight.indirectSpecular = min(reflectedLight.indirectSpecular * tealTint, vec3(0.3, 1.35, 1.15));
      }
    `).replace(
      "#include <emissivemap_fragment>", /* glsl */`
      #include <emissivemap_fragment>
      {
        float facing = clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0);
        // fresnel edge glow: edges brighter than the center, brief spec —
        // edgeGlow = pow(1 - dot(N, V), 4)
        float edgeGlow = pow(1.0 - facing, 4.0);
        // sidewave-style luminous interior: THREE layered noise fields —
        // "clouds trapped in glass" — object space so they tumble with the
        // blob, wide smoothsteps keep every edge out-of-focus, never crisp
        vec3 d = normalize(vDirF);
        float w1 = snoise(d * 1.1 + vec3(0.0, uTime * 0.06, uTime * 0.04));
        float w2 = snoise(d * 1.9 - vec3(uTime * 0.05, 0.0, uTime * 0.03) + 7.0);
        float w3 = snoise(d * 1.4 + vec3(uTime * 0.03, -uTime * 0.045, 3.1));
        float clouds = smoothstep(-0.75, 1.25, w1 + 0.35 * w2 + 0.25 * w3 + vJN * 0.4);
        // base -> mid -> highlight teal-glass gradient, deep shadow in the
        // murky pockets — the brief's four-stop palette, brought in as
        // uniforms so art direction lives in JS, not buried in GLSL
        vec3 heart = mix(uColDeep, uColBase, smoothstep(0.0, 0.55, clouds));
        heart = mix(heart, uColMid, smoothstep(0.35, 0.85, clouds));
        heart = mix(heart, uColHi, pow(clouds, 3.5) * smoothstep(0.1, 0.8, facing) * 0.35);
        // a faint inner sheen only — the body's content is the BLURRED
        // world behind it, not self-glow; the gradients just tint it
        totalEmissiveRadiance += heart * (0.05 + 0.22 * pow(facing, 1.5));
        // NEON ENERGY: a saturated electric-teal charge breathing in the
        // heart of the gel, gently pulsing — kept well under the frost so
        // the blob reads transparent first, energized second
        totalEmissiveRadiance += vec3(0.0, 1.0, 0.84)
          * pow(facing, 2.2) * (0.2 + 0.35 * clouds)
          * (0.75 + 0.25 * sin(uTime * 1.7));
        // fresnel rim: base -> cyan -> almost-white, brighter than the
        // center — the "glowing edges" pass, additive on top of the heart
        vec3 rimCol = mix(uColMid, uColHi, smoothstep(0.4, 1.0, edgeGlow));
        totalEmissiveRadiance += rimCol * edgeGlow * 1.1;
        // rim folds collapse to dark glassy creases like the reference,
        // but the fresnel term above is allowed to punch back through
        totalEmissiveRadiance *= 0.06 + 0.94 * smoothstep(0.0, 0.55, facing);
        totalEmissiveRadiance += rimCol * edgeGlow * 0.55;
        // THE core effect — frosted transmission: sample the baked world
        // snapshot along the refracted view dir at a HIGH roughness mip so
        // it arrives heavily blurred (soft color pools, no sharp shapes),
        // then push it through a teal-neon grade so whatever the blob
        // stands in front of glows through the body instead of just
        // tinting it faintly — a lit gel lens, not a clear window.
        #ifdef ENVMAP_TYPE_CUBE_UV
        {
          vec3 refr = refract(-normalize(vViewPosition), normal, 0.94);
          vec3 wRefr = transpose(mat3(viewMatrix)) * refr;
          // two samples at different (high) roughness mips, blended, so the
          // background dissolves into soft glowing blobs of color with no
          // residual sharpness at any viewing angle
          vec3 bgBlurA = textureCubeUV(uWorldEnv, wRefr, 0.75).rgb;
          vec3 bgBlurB = textureCubeUV(uWorldEnv, wRefr, 0.95).rgb;
          vec3 bgBlur = mix(bgBlurA, bgBlurB, 0.5);
          // push whatever's behind the blob into a brighter, saturated
          // neon-teal glow — never darker than the raw sample, so bright
          // aurora passing behind visibly lights the body up
          float bgLum = dot(bgBlur, vec3(0.299, 0.587, 0.114));
          vec3 bgGlow = bgBlur + uColMid * bgLum * 0.6;
          bgGlow = mix(bgGlow, uColHi, smoothstep(0.5, 1.6, bgLum) * 0.6);
          // near-full facing weight everywhere, not just at grazing angles
          // — the center of the blob must glow with the world behind it too
          float frost = (0.85 + 0.15 * facing) * (0.8 + 0.2 * clouds);
          totalEmissiveRadiance += bgGlow * frost * 3.2;
        }
        #endif
        // low, mostly-flat alpha: the body reads as a clear lens with a
        // teal tint, not a dense object — rim stays a touch denser so the
        // silhouette still has an edge to catch light against
        float ink = mix(0.22, 0.36, pow(1.0 - clouds, 1.4));
        diffuseColor.a = mix(ink, 0.55, pow(1.0 - facing, 2.3));
      }
    `);
  };

  const blob = new THREE.Mesh(new THREE.IcosahedronGeometry(1.6, 48), mat);
  // displacement is GPU-side: the stock bounding sphere is too tight and
  // culls the blob at frame edges — never let it
  blob.frustumCulled = false;

  const group = new THREE.Group();
  group.add(blob);

  // soft halo behind the body + its own light pooling on the ground
  const haloTex = (() => {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const ctx = c.getContext("2d");
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, "rgba(45,235,220,1)");
    g.addColorStop(1, "rgba(20,80,76,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  })();
  const haloMat = new THREE.SpriteMaterial({
    map: haloTex, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const halo = new THREE.Sprite(haloMat);
  halo.scale.setScalar(7);
  group.add(halo);
  const light = new THREE.PointLight(0x1fe6dc, 0, 60, 1.6);
  group.add(light);

  group.visible = false;
  scene.add(group);

  // scroll progress arrives from outside (the-world.html / index.html pin);
  // smoothed here so the blob glides even on a notched trackpad
  let pTarget = 0, p = 0;

  let worldEnvTex = null;

  return {
    // called by world.js ONCE after every environment part exists — a single
    // load-time cubemap bake of the world (the blob group is still hidden),
    // never repeated per-frame. Must run before the composer's warm-up render.
    bakeSurroundings() {
      const pm = new THREE.PMREMGenerator(renderer);
      worldEnvTex = pm.fromScene(scene, 0, 0.1, 500).texture;
      pm.dispose();
      uniforms.uWorldEnv.value = worldEnvTex;
      // the shell now MIRRORS the world it sits in — aurora sweeps and the
      // sky gradient reflect on the surface (same CUBE_UV layout as the
      // softbox placeholder, so no shader recompile)
      mat.envMap = worldEnvTex;
    },
    setProgress(v) { pTarget = clamp01(v); },
    update(t) {
      p += (pTarget - p) * 0.07;
      uniforms.uTime.value = t;

      const enter = easeOutCubic(smooth(0.04, 0.85, p));   // travel + growth
      const settle = smooth(0.75, 1.0, p);                 // final hold

      group.visible = enter > 0.002;
      group.position.lerpVectors(START, SETTLE, enter);
      // gentle idle float once it has arrived
      group.position.y += Math.sin(t * 0.8) * 0.14 * settle;

      // grows as it falls: a distant droplet into the centrepiece
      const baseScale = lerp(0.3, 2.3, enter);
      // once settled, a near-invisible squash/stretch breathing cycle so
      // it never sits perfectly still — x/y trade off, z stays neutral
      const squash = Math.sin(t * 0.33) * 0.03 * settle;
      blob.scale.set(baseScale * (1 + squash), baseScale * (1 - squash), baseScale);
      // tumbles in (scroll-driven turns) and keeps a lazy spin at rest
      blob.rotation.y = enter * Math.PI * 2.5 + t * 0.12;
      blob.rotation.x = enter * Math.PI * 0.7 + Math.sin(t * 0.3) * 0.06;
      blob.rotation.z = Math.sin(enter * Math.PI) * 0.35 + Math.sin(t * 0.3) * 0.03 * settle;

      // wobbles hardest mid-flight, relaxes to a slow simmer when settled
      uniforms.uAmp.value = 0.14 + Math.sin(enter * Math.PI) * 0.08 + settle * 0.04;

      haloMat.opacity = enter * 0.26;
      light.intensity = enter * (26 + Math.sin(t * 2.2) * 4);
      light.position.y = -1.5;
    },
    dispose() {
      scene.remove(group);
      blob.geometry.dispose();
      mat.dispose();
      envTex.dispose();
      worldEnvTex && worldEnvTex.dispose();
      haloTex.dispose();
      haloMat.dispose();
    },
  };
}
