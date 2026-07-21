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
const SETTLE = new THREE.Vector3(0, 5.4, -10);

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
    // LIVE low-res cubemap of the world, re-captured from the blob's own
    // position every frame *before* the composer runs (the same safe slot
    // as the load-time bake — only mid-frame RTTs black out the composer
    // on this GPU). Its mip chain provides the blur: high mips = frosted
    // transmission, low-mid mips = the moving streak reflection.
    uLiveEnv: { value: null },
    // the sigil burn: the Prception mark charring itself into the gel's
    // face as the core settles. uLogo = rasterized brand mark (mask in .r),
    // uBurn = scroll-driven reveal 0..1, uCoreScale = current world radius
    // so the view-space projection stays unit-sized while the blob grows
    uLogo: { value: null },
    uBurn: { value: 0 },
    uCoreScale: { value: 1 },
  };

  // brand mark rasterized once — the EXACT contours the hero's 3D logo
  // extrudes (LOGO_DATA in index.html: auto-traced from the official
  // PRception Tm.png, normalized to 2-unit height, y-up, centered).
  //   [0] the P/play body — the play-triangle inlet is carried by the
  //       outer loop itself, so a plain nonzero fill renders it correctly
  //   [1] the detached rounded square with its dot-hook
  const LOGO_POLYS = [
    [-0.419,0.999,-0.406,1.0,-0.393,0.999,-0.36,0.996,-0.331,0.991,-0.292,0.979,-0.272,0.971,-0.239,0.955,0.576,0.484,0.598,0.469,0.63,0.444,0.649,0.424,0.674,0.393,0.692,0.364,0.708,0.33,0.72,0.299,0.729,0.263,0.735,0.218,0.735,0.193,0.731,0.154,0.724,0.116,0.714,0.086,0.697,0.047,0.674,0.01,0.649,-0.022,0.624,-0.047,0.595,-0.07,0.578,-0.081,0.253,-0.268,0.241,-0.274,0.23,-0.276,0.214,-0.277,0.201,-0.274,0.187,-0.268,0.178,-0.26,0.167,-0.248,0.065,-0.064,0.051,-0.038,0.049,-0.033,0.05,-0.028,0.056,-0.024,0.153,0.032,0.17,0.044,0.185,0.058,0.197,0.076,0.202,0.085,0.208,0.105,0.211,0.122,0.211,0.135,0.207,0.152,0.204,0.163,0.194,0.184,0.184,0.197,0.176,0.206,0.16,0.218,-0.115,0.377,-0.135,0.388,-0.147,0.393,-0.16,0.396,-0.18,0.399,-0.204,0.396,-0.215,0.393,-0.233,0.384,-0.247,0.376,-0.261,0.362,-0.272,0.347,-0.278,0.336,-0.283,0.322,-0.287,0.308,-0.288,0.295,-0.288,-0.397,-0.287,-0.41,-0.284,-0.419,-0.28,-0.426,-0.27,-0.438,-0.258,-0.446,-0.244,-0.45,-0.231,-0.45,0.004,-0.45,0.014,-0.452,0.017,-0.457,0.018,-0.467,0.018,-0.949,0.017,-0.956,0.013,-0.966,0.009,-0.974,0.003,-0.981,-0.005,-0.988,-0.014,-0.993,-0.031,-0.999,-0.047,-1.0,-0.503,-1.0,-0.538,-0.996,-0.562,-0.991,-0.601,-0.976,-0.63,-0.96,-0.652,-0.943,-0.678,-0.917,-0.697,-0.891,-0.712,-0.866,-0.72,-0.846,-0.731,-0.809,-0.734,-0.789,-0.735,-0.776,-0.735,0.688,-0.731,0.724,-0.723,0.759,-0.717,0.778,-0.708,0.801,-0.698,0.822,-0.674,0.86,-0.649,0.891,-0.635,0.906,-0.609,0.928,-0.584,0.946,-0.544,0.968,-0.516,0.979,-0.477,0.991,-0.445,0.996,-0.422,0.998],
    [0.212,-0.323,0.217,-0.321,0.225,-0.32,0.398,-0.32,0.411,-0.321,0.428,-0.324,0.444,-0.331,0.457,-0.341,0.47,-0.355,0.476,-0.364,0.481,-0.376,0.485,-0.395,0.486,-0.411,0.486,-0.632,0.485,-0.642,0.48,-0.663,0.472,-0.68,0.457,-0.696,0.442,-0.707,0.423,-0.714,0.398,-0.717,0.217,-0.717,0.203,-0.716,0.183,-0.711,0.17,-0.704,0.158,-0.696,0.147,-0.684,0.138,-0.668,0.133,-0.653,0.132,-0.643,0.132,-0.467,0.132,-0.459,0.135,-0.454,0.139,-0.452,0.146,-0.45,0.211,-0.45,0.221,-0.452,0.227,-0.455,0.235,-0.472,0.246,-0.483,0.259,-0.491,0.273,-0.493,0.289,-0.491,0.3,-0.486,0.308,-0.479,0.315,-0.472,0.321,-0.458,0.321,-0.448,0.32,-0.435,0.317,-0.426,0.311,-0.416,0.3,-0.407,0.283,-0.401,0.271,-0.4,0.256,-0.403,0.251,-0.401,0.222,-0.351,0.212,-0.331,0.211,-0.324],
  ];
  const logoTex = (() => {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, 256, 256);
    // slight blur feathers the edge so the burn front never aliases
    ctx.filter = "blur(1px)";
    // data is y-up centered at origin, 2 units tall — center on the canvas
    // and flip y for the y-down canvas (drawn visually upright; the
    // CanvasTexture flipY + view-space uv mapping expect exactly that)
    ctx.setTransform(108, 0, 0, -108, 128, 128);
    ctx.fillStyle = "#fff";
    for (const poly of LOGO_POLYS) {
      ctx.beginPath();
      ctx.moveTo(poly[0], poly[1]);
      for (let i = 2; i < poly.length; i += 2) ctx.lineTo(poly[i], poly[i + 1]);
      ctx.closePath();
      ctx.fill();
    }
    return new THREE.CanvasTexture(c);
  })();
  uniforms.uLogo.value = logoTex;
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
    color: 0x0b3834, metalness: 0.4, roughness: 0.045,
    envMap: envTex, envMapIntensity: 3.1,
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
      uniform float uTime, uAmp, uFreq, uCoreScale;
      varying float vJN;
      varying vec3 vDirF;
      varying vec3 vLogoP;
      vec3 coreOrth(vec3 v) {
        return normalize(abs(v.x) > 0.5 ? vec3(-v.y, v.x, 0.0) : vec3(0.0, -v.z, v.y));
      }
      float jellyN(vec3 dir) {
        // low-frequency lobe field, kept slow-rolling — anything higher
        // frequency turns the surface crinkly like foil instead of a
        // fluid gel. Domain-warped: the sample direction itself drifts
        // through a slower noise field first, so lobes don't just breathe
        // in place — they smear and pour into each other like liquid
        float sw = uTime * 0.14;
        vec3 warp = vec3(
          snoise(dir * 0.7 + vec3(0.0, sw, 1.7)),
          snoise(dir * 0.7 + vec3(sw, 0.0, 5.2)),
          snoise(dir * 0.7 + vec3(3.1, sw, 0.0)));
        vec3 fd = dir + warp * 0.45;
        float n = snoise(fd * uFreq + vec3(0.0, uTime * 0.32, uTime * 0.22));
        n += 0.35 * snoise(fd * 1.1 - vec3(uTime * 0.26, uTime * 0.18, 0.0));
        n += 0.18 * snoise(fd * 1.6 + vec3(uTime * 0.15, -uTime * 0.2, 2.0));
        // gravity drip: a slow wave sliding DOWN the body so the gel always
        // has a direction of flow, like it's on the verge of sagging off
        n += 0.22 * snoise(vec3(dir.x * 0.9, dir.y * 0.6 - uTime * 0.3, dir.z * 0.9));
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
        // view-space offset from the blob's center, normalized to a unit
        // face — the sigil projects onto this so it always faces the
        // viewer, screen-stable while the gel tumbles and flows beneath it
        vec4 lvC = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        vec4 lvP = modelViewMatrix * vec4(jP0, 1.0);
        vLogoP = (lvP.xyz - lvC.xyz) / max(uCoreScale, 0.001);
      `);
    // lit from within: a milky cyan glow blooming where the surface faces
    // the eye, swirled by the same lobe noise (bright washes sliding over a
    // luminous heart), falling away to a dark deep-teal silhouette rim —
    // the reference's "light trapped inside the gel" look, no transmission
    shader.fragmentShader = NOISE_GLSL + "uniform float uTime, uBurn;\nuniform samplerCube uLiveEnv;\nuniform sampler2D uLogo;\nuniform vec3 uColBase, uColMid, uColHi, uColDeep;\nvarying float vJN;\nvarying vec3 vDirF;\nvarying vec3 vLogoP;\n" + shader.fragmentShader.replace(
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
        totalEmissiveRadiance += heart * (0.03 + 0.12 * pow(facing, 1.5));
        // NEON ENERGY: a saturated electric-teal charge breathing in the
        // heart of the gel, gently pulsing — kept well under the frost so
        // the blob reads transparent first, energized second
        totalEmissiveRadiance += vec3(0.0, 1.0, 0.84)
          * pow(facing, 2.2) * (0.12 + 0.24 * clouds)
          * (0.75 + 0.25 * sin(uTime * 1.7));
        // fresnel rim: base -> cyan -> almost-white, brighter than the
        // center — the "glowing edges" pass, additive on top of the heart
        vec3 rimCol = mix(uColMid, uColHi, smoothstep(0.4, 1.0, edgeGlow));
        totalEmissiveRadiance += rimCol * edgeGlow * 1.1;
        // rim folds collapse to dark glassy creases like the reference,
        // but the fresnel term above is allowed to punch back through
        totalEmissiveRadiance *= 0.06 + 0.94 * smoothstep(0.0, 0.55, facing);
        totalEmissiveRadiance += rimCol * edgeGlow * 0.55;
        // THE core effect — frosted transmission: sample the LIVE world
        // cubemap along the refracted view dir at deep mip levels so it
        // arrives heavily blurred (soft color pools, no sharp shapes),
        // then push it through a teal-neon grade so whatever the blob
        // stands in front of glows through the body instead of just
        // tinting it faintly — a lit gel lens, not a clear window. The
        // cube is re-captured per frame from the blob's position, so the
        // colors mixing through the body track the streaks' motion and
        // the blob's own travel instead of a frozen load-time snapshot.
        {
          // CHROMATIC liquid refraction: each channel bends at a slightly
          // different ratio, so the background's colors fringe and smear
          // through the body the way light splits inside real thick gel —
          // reads as liquid depth, not a flat frosted decal
          vec3 vDir = -normalize(vViewPosition);
          mat3 v2w = transpose(mat3(viewMatrix));
          vec3 wRefrR = v2w * refract(vDir, normal, 0.915);
          vec3 wRefrG = v2w * refract(vDir, normal, 0.94);
          vec3 wRefrB = v2w * refract(vDir, normal, 0.965);
          // SHALLOW mips: deep mips (4.5+) average the whole world into one
          // flat teal and nothing reads through the body — mip ~1 keeps the
          // streak/mountain/sky SHAPES recognizable, mip 3 adds a soft gel
          // halo around them; the jelly normals already smear them liquidly
          vec3 bgBlur;
          bgBlur.r = mix(textureLod(uLiveEnv, wRefrR, 1.0).r, textureLod(uLiveEnv, wRefrR, 3.0).r, 0.45);
          bgBlur.g = mix(textureLod(uLiveEnv, wRefrG, 1.0).g, textureLod(uLiveEnv, wRefrG, 3.0).g, 0.45);
          bgBlur.b = mix(textureLod(uLiveEnv, wRefrB, 1.0).b, textureLod(uLiveEnv, wRefrB, 3.0).b, 0.45);
          // push whatever's behind the blob into a brighter, saturated
          // glow — never darker than the raw sample, so bright aurora
          // passing behind visibly lights the body up. The background's
          // OWN hue leads; the teal grade only lifts it, never replaces it
          float bgLum = dot(bgBlur, vec3(0.299, 0.587, 0.114));
          // CONTRAST, not just lift: darken the dim world regions and let
          // the bright ones blaze, so the streak/ridge shapes pop INSIDE
          // the body instead of everything averaging to one glow level
          vec3 bgGlow = bgBlur * (0.9 + bgLum * 2.2) + uColMid * bgLum * 0.15;
          // was a flat 0.4 pull toward uColHi on every bright hit — that
          // flattened colorful surroundings toward one teal highlight.
          // Now only the truly hot spots get lifted, and less aggressively,
          // so the body blends whatever color is actually behind it
          bgGlow = mix(bgGlow, uColHi, smoothstep(1.1, 2.2, bgLum) * 0.22);
          // near-full facing weight everywhere, not just at grazing angles
          // — the center of the blob must glow with the world behind it too
          float frost = (0.85 + 0.15 * facing) * (0.85 + 0.15 * clouds);
          totalEmissiveRadiance += bgGlow * frost * 3.4;
          // the rim borrows the background's color too, so the glowing
          // edge is LIT BY the world behind it instead of a fixed teal
          totalEmissiveRadiance += bgGlow * edgeGlow * 1.3;

          // TRUE reflection: the streaks/sky/ground behind and around the
          // blob bounce off the shell via the mirror direction, from the
          // same live capture — a softer mid mip so the streak keeps its
          // shape but reads as a blurred wet-glass smear, strongest at
          // grazing angles, sliding across the surface as the blob moves
          vec3 reflDir = reflect(-normalize(vViewPosition), normal);
          vec3 wRefl = transpose(mat3(viewMatrix)) * reflDir;
          // sharper mip (was 1.5) + a crisp 0.4-mip sample blended in so the
          // reflection carries recognizable shape, not just color-smear —
          // this is what reads as "reflecting its surroundings" vs a glow
          vec3 reflColSharp = textureLod(uLiveEnv, wRefl, 0.4).rgb;
          vec3 reflColSoft = textureLod(uLiveEnv, wRefl, 1.5).rgb;
          vec3 reflCol = mix(reflColSoft, reflColSharp, 0.55);
          float reflLum = dot(reflCol, vec3(0.299, 0.587, 0.114));
          // let saturated surroundings punch through at full color instead of
          // being pulled toward uColHi — only the brightest hits get lifted,
          // so a red/lilac/mint streak reflects as ITSELF, blended live
          vec3 reflGlow = mix(reflCol * 1.15, uColHi, smoothstep(0.9, 2.0, reflLum) * 0.25);
          totalEmissiveRadiance += reflGlow * (0.4 + edgeGlow * 1.9);
        }
        // low, mostly-flat alpha: the body reads as a clear lens with a
        // teal tint, not a dense object — rim stays a touch denser so the
        // silhouette still has an edge to catch light against
        float ink = mix(0.16, 0.3, pow(1.0 - clouds, 1.4));
        diffuseColor.a = mix(ink, 0.5, pow(1.0 - facing, 2.3));

        // THE SIGIL BURN — as the core settles, the Prception mark chars
        // itself into the front face like paper catching fire: a noisy
        // burn front eats across the glyph, leaving a dark scorched core
        // with a hot ember edge licking along the boundary. Not "written"
        // — formed by burning. Runs last so the char smothers every glow
        // layer (heart, transmission, reflection) beneath it.
        {
          vec2 lUv = clamp(vLogoP.xy * 0.62 + 0.5, 0.0, 1.0);
          // only the viewer-facing hemisphere carries the mark
          float lFront = smoothstep(0.05, 0.45, vLogoP.z);
          float mark = texture2D(uLogo, lUv).r * lFront;
          if (mark > 0.003 && uBurn > 0.001) {
            // SCRUB-LOCKED spread: the burn ignites at the heart of the
            // mark and creeps radially OUTWARD — a monotonic radial ramp
            // means every increment of scroll chars exactly the next ring,
            // so the reveal tracks the scrub 1:1 little by little (pure
            // noise fields cluster mid-range and dump most of the glyph in
            // one narrow scroll stretch — learned the hard way). The noise
            // only raggeds the ring so it reads as fire, not a wipe.
            float g = clamp(length(lUv - vec2(0.5)) / 0.48, 0.0, 1.0);
            float bn = 0.12 + 0.76 * g + 0.2 * fbm(vec3(lUv * 5.0, 3.7));
            // live flicker: the front shivers like flame licking an edge
            bn += 0.05 * snoise(vec3(lUv * 12.0, uTime * 1.1));
            bn += 0.025 * snoise(vec3(lUv * 26.0, uTime * 2.6));
            // 1.55 scale: covers bn's max + the smoulder band so the mark
            // still fully chars by the end of the track
            float bt = uBurn * 1.55;
            // signed distance to the burn front: <0 not yet reached,
            // 0..0.34 the live combustion band, >0.34 fully charred
            float d = bt - bn;
            // EXTRA-wide transition band: each spot burns for a long
            // stretch of scroll — toasting, igniting, glowing, cooling —
            // before it finally goes dark
            float charred = smoothstep(0.0, 0.34, d);
            float m = mark * charred;

            // combustion grading, kept in the brand's TEAL family (warm
            // orange was tried and rolled back by user direction):
            // 1) SINGE — the gel darkens just ahead of the flame
            float singe = smoothstep(0.14, 0.0, -d) * (1.0 - charred);
            // 2) INCANDESCENT FRONT — a thin blazing hot-teal edge right
            //    where the material is actively burning, flickering fast
            float flicker = 0.7
              + 0.3 * snoise(vec3(lUv * 9.0, uTime * 2.6))
              + 0.2 * sin(uTime * 9.0 + bn * 24.0);
            float front = exp(-pow(d - 0.035, 2.0) * 700.0);
            // 3) COOLING EMBERS — behind the front, patches of fresh char
            //    keep pulsing a deeper teal glow before dying out
            float coolBand = smoothstep(0.02, 0.08, d) * smoothstep(0.32, 0.12, d);
            float emberPatch = smoothstep(0.2, 0.8,
              snoise(vec3(lUv * 16.0, uTime * 0.9)) * 0.5 + 0.5);

            // scorch: collapse the gel's light to a near-black smoked teal
            totalEmissiveRadiance *= 1.0 - m * 0.96 - mark * singe * 0.45;
            totalEmissiveRadiance += vec3(0.008, 0.028, 0.026) * m;
            // the burning edge itself: blazing hot teal, bloom fodder
            totalEmissiveRadiance += vec3(0.30, 1.0, 0.82)
              * front * mark * 3.2 * max(flicker, 0.2);
            // deep-teal ember patches smouldering in the fresh char
            totalEmissiveRadiance += vec3(0.08, 0.75, 0.55)
              * coolBand * emberPatch * mark * (1.1 + 0.5 * sin(uTime * 3.0 + bn * 12.0));
            // crackling sparks: tiny mint pops flashing along the front
            float crackle = snoise(vec3(lUv * 30.0, uTime * 3.8));
            float spark = smoothstep(0.55, 0.9, crackle)
              * smoothstep(0.2, 0.0, abs(d - 0.05)) * mark;
            totalEmissiveRadiance += vec3(0.45, 1.0, 0.9) * spark * 3.5;
            // char is dense — the mark reads as a solid scorched shape
            diffuseColor.a = mix(diffuseColor.a, 0.96, m);
          }
        }
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
  halo.scale.setScalar(8.4);
  group.add(halo);
  const light = new THREE.PointLight(0x1fe6dc, 0, 60, 1.6);
  group.add(light);

  group.visible = false;
  scene.add(group);

  // scroll progress arrives from outside (the-world.html / index.html pin);
  // smoothed here so the blob glides even on a notched trackpad
  let pTarget = 0, p = 0;

  let worldEnvTex = null;

  // live environment capture: a tiny 128px cubemap re-rendered from the
  // blob's position. 6 faces at 128px ≈ 98k pixels — a rounding error next
  // to the main frame — and it runs in the update phase, BEFORE the
  // composer's passes, so it never trips this GPU's mid-frame-RTT blackout.
  // Mipmapped so the shader can pick its blur level per effect.
  const cubeRT = new THREE.WebGLCubeRenderTarget(128, {
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
  });
  const cubeCam = new THREE.CubeCamera(0.5, 500, cubeRT);
  scene.add(cubeCam);
  let frame = 0;

  const captureWorld = () => {
    // never let the blob see itself — a feedback loop reads as dirt
    const wasVisible = group.visible;
    group.visible = false;
    cubeCam.position.copy(group.position);
    cubeCam.update(renderer, scene);
    group.visible = wasVisible;
    uniforms.uLiveEnv.value = cubeRT.texture;
  };

  // the core EMITS the world's light back out: average a few pixels from
  // the live cube and drive the halo + ground pool light with that color,
  // so the glow it casts is genuinely the background's light, live.
  // 4×4 reads are a rounding error; still throttled — readbacks stall.
  const bgTint = new THREE.Color(0x1fe6dc);
  const tintTarget = new THREE.Color(0x1fe6dc);
  const tintBuf = new Uint8Array(4 * 16);
  const sampleBgTint = () => {
    let r = 0, g = 0, b = 0, n = 0;
    for (let face = 0; face < 6; face++) {
      renderer.readRenderTargetPixels(cubeRT, 62, 62, 4, 4, tintBuf, face);
      for (let i = 0; i < tintBuf.length; i += 4) {
        r += tintBuf[i]; g += tintBuf[i + 1]; b += tintBuf[i + 2]; n++;
      }
    }
    tintTarget.setRGB(r / n / 255, g / n / 255, b / n / 255);
    // normalize brightness up — it's a tint, intensity is handled separately
    const max = Math.max(tintTarget.r, tintTarget.g, tintTarget.b, 0.02);
    tintTarget.multiplyScalar(1 / max);
  };

  return {
    // called by world.js ONCE after every environment part exists. The PMREM
    // bake feeds the material's built-in IBL; the first live cube capture
    // primes uLiveEnv so the shell never renders a black world.
    bakeSurroundings() {
      const pm = new THREE.PMREMGenerator(renderer);
      worldEnvTex = pm.fromScene(scene, 0, 0.1, 500).texture;
      pm.dispose();
      mat.envMap = worldEnvTex;
      group.position.copy(SETTLE);
      captureWorld();
    },
    setProgress(v) { pTarget = clamp01(v); },
    // the smoothed, ACTUAL progress the shader is rendering right now (p
    // lags pTarget by the 0.07/frame lerp above) — pages driving DOM
    // elements off the same scroll (e.g. the service cards in index.html)
    // need THIS, not their own raw scroll math, or they visibly race ahead
    // of what the core is doing on screen.
    getProgress() { return p; },
    update(t) {
      p += (pTarget - p) * 0.07;
      uniforms.uTime.value = t;

      // travel finishes by mid-track: the whole second half of the scroll
      // belongs to the sigil burn, so the reveal can be scrubbed slowly
      const enter = easeOutCubic(smooth(0.04, 0.55, p));   // travel + growth
      const settle = smooth(0.5, 0.75, p);                 // final hold

      group.visible = enter > 0.002;
      group.position.lerpVectors(START, SETTLE, enter);
      // gentle idle float once it has arrived
      group.position.y += Math.sin(t * 0.8) * 0.14 * settle;

      // grows as it falls: a distant droplet into the centrepiece
      const baseScale = lerp(0.3, 2.75, enter);
      // once settled, a near-invisible squash/stretch breathing cycle so
      // it never sits perfectly still — x/y trade off, z stays neutral
      // two offset harmonics so the jiggle never settles into a metronome
      const squash = (Math.sin(t * 0.33) * 0.035 + Math.sin(t * 0.9 + 1.3) * 0.018) * settle;
      blob.scale.set(baseScale * (1 + squash), baseScale * (1 - squash), baseScale);
      // tumbles in (scroll-driven turns) and keeps a lazy spin at rest
      blob.rotation.y = enter * Math.PI * 2.5 + t * 0.12;
      blob.rotation.x = enter * Math.PI * 0.7 + Math.sin(t * 0.3) * 0.06;
      blob.rotation.z = Math.sin(enter * Math.PI) * 0.35 + Math.sin(t * 0.3) * 0.03 * settle;

      // wobbles hardest mid-flight, relaxes to a slow simmer when settled
      uniforms.uAmp.value = 0.16 + Math.sin(enter * Math.PI) * 0.08 + settle * 0.05;

      // the sigil waits until the core has ARRIVED at dead center (travel
      // completes at p≈0.55), then burns in across the WHOLE second half
      // of the track — a long scroll-scrubbed reveal: the blob lands
      // clean, settles, and the mark creeps in as you keep scrolling
      uniforms.uBurn.value = smooth(0.58, 1.0, p);
      // normalize the view-space logo projection to the blob's current
      // world radius (geometry radius 1.6 × animated scale)
      uniforms.uCoreScale.value = baseScale * 1.6;

      haloMat.opacity = enter * 0.26;
      light.intensity = enter * (26 + Math.sin(t * 2.2) * 4);
      light.position.y = -1.5;
      // glide the emitted color toward the latest world sample — slow lerp
      // so the cast light breathes with the background, never flickers
      bgTint.lerp(tintTarget, 0.04);
      light.color.copy(bgTint);
      haloMat.color.copy(bgTint);

      // re-capture the world every other frame while the blob is on screen
      // — the streaks' flow and the sky keep moving in the reflection, and
      // the capture point rides the blob so what it mirrors shifts with
      // its travel. Every-other-frame halves the cost and is invisible
      // through this much blur.
      frame++;
      if (group.visible && frame % 2 === 0) captureWorld();
      // resample the emitted-light color ~1.5×/sec — readbacks stall the
      // GPU, and the slow lerp above hides the low refresh rate anyway
      if (group.visible && frame % 40 === 0) sampleBgTint();
    },
    dispose() {
      scene.remove(group);
      blob.geometry.dispose();
      mat.dispose();
      envTex.dispose();
      worldEnvTex && worldEnvTex.dispose();
      scene.remove(cubeCam);
      cubeRT.dispose();
      logoTex.dispose();
      haloTex.dispose();
      haloMat.dispose();
    },
  };
}
