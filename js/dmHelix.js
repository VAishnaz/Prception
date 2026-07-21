// ============================================================
// Craft in Motion — weaving snake image ribbon
// ------------------------------------------------------------
// Images are joined edge-to-edge into ONE continuous cloth-like strip (no
// gaps between panels — adjacent panels share their border exactly), laid
// out along a single path parameter t that runs LEFT TO RIGHT across the
// screen. As t increases the path weaves in DEPTH (toward the camera, then
// away, then back toward it again) like a snake passing in front of an
// imaginary fixed point, then behind it, then in front again — both the
// near (front) and far (behind-the-point) images stay visible at once,
// unlike a ring where the back half is hidden from the camera.
//
// On scroll, `adv` (fed from state.spin) shifts every panel's t, so the
// whole weave streams left-to-right continuously — panels leaving the
// right edge recycle back in from the left, fully faded out so the loop
// never shows a seam.
//
// Depth cue: panels at the near peaks of the weave (closest to camera) are
// largest, brightest and sharpest; panels at the far troughs (furthest
// behind the imaginary point) shrink, darken and blur.
//
// PERF: this rewrites 30 panels x 13 vertices every rendered frame, so the
// per-vertex math is kept to a few sin/cos calls and no per-frame normal
// recompute (the material is unlit MeshBasicMaterial — normals are never
// sampled, so computing them was pure wasted work causing the stutter).
//
// Motion is driven by GSAP: a proxy object's `spin`/`enter` values are
// tweened by the caller (see index.html) as the page scrolls, and this
// module reads them once per rendered frame — GSAP owns all easing.
//
// Swap DM_IMAGES for real project photos anytime; nothing else changes.
// ============================================================
import * as THREE from "three";

const DM_IMAGES = [
  "assets/images/branding/Blackbox/Artboard 1.png",
  "assets/images/branding/Carb N Care/Artboard 1.png",
  "assets/images/branding/Cocogo/Artboard 1.png",
  "assets/images/branding/Digital Mugavari/Artboard 1.png",
  "assets/images/branding/Eco Cleanser/Artboard 1.png",
  "assets/images/branding/Photonvolt/Artboard 1.png",
  "assets/images/branding/Saki/Artboard 1.png",
  "assets/images/branding/Tech Grandha/Artboard 1.png",
  "assets/images/branding/Cocogo/Artboard 2.png",
  "assets/images/branding/Saki/Artboard 2.png",
];

export function mountDmHelix(canvas, opts = {}) {
  const base = opts.images || DM_IMAGES;
  const images = base.concat(base);   // enough panels to tile the visible span with no gaps
  const N = images.length;

  // ---- joined ribbon geometry along the snake path ----
  const STEP = 1.15;                    // path-parameter distance between adjacent panel centres
  const SPAN = N * STEP;                // total path length spanned by the panel set (recycles every SPAN)
  const PLANE_H = 1.55;                 // shorter -> smaller pictures
  const SEG = 5;                        // width subdivisions -> smooth weave bend (kept low: perf)
  const SEAM = STEP * 0.08;             // tiny overlap into neighbours -> no visible gap in the cloth
  const X_SPACING = 2.35;               // world units of X per unit of path parameter
  const WEAVE_FREQ = (Math.PI * 2) / (STEP * 6.5); // one full near/far weave cycle every ~6.5 panels
  const WEAVE_DEPTH = 7.5;              // world units the path swings toward/away from camera
  const Y_DRIFT_FREQ = WEAVE_FREQ * 0.5;
  const Y_DRIFT_AMP = 1.1;
  const MIN_SCALE = 0.28;               // size at the furthest (behind-the-point) troughs

  // ---- renderer / scene / camera ----
  const renderer = new THREE.WebGLRenderer({
    // MSAA off: real per-frame cost on this GPU class, and panel seams are
    // already handled geometrically (overlap), not by edge antialiasing.
    canvas, antialias: false, alpha: true, powerPreference: "high-performance",
  });
  // DPR capped at 1.5: this project's GPU (Vega 10 class) drops frames hard
  // above that on canvases with real per-frame raster cost — same lesson as
  // the world scene and the hero logo.
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0xc9c9c6, 0.028);

  // camera looks straight down the weave's centre so near peaks swell
  // toward it and far troughs recede behind the imaginary fixed point.
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
  camera.position.set(0, 1.8, 20);
  camera.lookAt(0, 1.8, 0);

  const helix = new THREE.Group();
  scene.add(helix);

  const loader = new THREE.TextureLoader();
  const planes = [];

  for (let i = 0; i < N; i++) {
    // each panel is a subdivided strip; vertices are rewritten onto the
    // weave path every frame so the whole run is ONE smooth curved sheet
    const geo = new THREE.PlaneGeometry(1, PLANE_H, SEG, 1);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 1,
      side: THREE.DoubleSide, depthWrite: false, fog: true, toneMapped: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    // capture each vertex's U (0..1 across width) + Y once, for the bend math
    const pos = geo.attributes.position;
    const u = new Float32Array(pos.count), vy = new Float32Array(pos.count);
    for (let k = 0; k < pos.count; k++) { u[k] = pos.getX(k) + 0.5; vy[k] = pos.getY(k); }
    mesh.userData = { u, vy };
    helix.add(mesh);
    planes.push(mesh);

    loader.load(
      encodeURI(images[i % images.length]),
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
        tex.generateMipmaps = true;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        mat.map = tex; mat.needsUpdate = true;
      },
      undefined,
      () => { mat.color.setHex(0xb9b6ae); }
    );
  }

  // ---- progress state ----
  // GSAP tweens THIS object's properties directly (see index.html) — no
  // lerping happens in this module. `spin` is unbounded, so the weave
  // streams left-to-right continuously instead of stopping. `enter` is
  // 0..1: 0 = fully off-screen bottom-left, 1 = settled at rest.
  const state = { spin: 0, enter: 0 };
  let active = false, raf = 0;

  // path-space centre: t=0 sits under the camera's look-at; panels are
  // windowed to the band centred there so only the visible run is bright.
  const REST_X = 0, REST_Y = 1.6, REST_Z = 0;
  // bottom-left staging point the LEADING TIP of the ribbon pokes out from —
  // a single fixed world offset, applied per-VERTEX (see REVEAL_SOFTEN below),
  // never a per-panel body translation. That's what keeps every panel's
  // shared border vertex identical to its neighbour's at all times, so the
  // whole run reads as one joined chain sliding out of the corner instead of
  // a stack of independently-tweened cards.
  const ENTER_FROM_X = -13, ENTER_FROM_Y = -8, ENTER_FROM_Z = 5;

  // entrance is a REVEAL WAVE that sweeps left-to-right along the shared path
  // parameter t (not per-panel index/centre): a vertex at path position t is
  // "revealed" once the wave has passed it, and sits pulled toward the
  // bottom-left staging point before that. Because this is keyed purely off
  // t — identical for two panels' touching edge vertices — the join between
  // any two neighbouring panels stays glued shut throughout the whole
  // entrance; only the single leading tip (the most-revealed edge) is ever
  // unjoined, exactly like a chain paying out from one end.
  const REVEAL_SOFTEN = STEP * 2.2; // path-length over which a vertex eases from staged -> settled

  // scratch (avoid per-frame allocation) — two separate vectors since the
  // per-vertex loop below calls pathPoint() again while the panel centre
  // computed earlier in the same iteration is still needed; sharing one
  // vector would silently overwrite the centre with the last vertex sampled.
  const _pos3 = new THREE.Vector3();
  const _centre3 = new THREE.Vector3();

  function pathPoint(t, out) {
    // x runs left-to-right with the path parameter; z weaves toward (+)
    // and away (-) from the camera — "in front of the point, then behind
    // it, then in front again"; y drifts gently so it reads as a cloth
    // ribbon rather than a rigid ruler.
    out.x = t * X_SPACING;
    out.z = Math.sin(t * WEAVE_FREQ) * WEAVE_DEPTH;
    out.y = Math.sin(t * Y_DRIFT_FREQ) * Y_DRIFT_AMP;
    return out;
  }

  function layout() {
    const adv = state.spin * SPAN * 0.6;   // path distance travelled so far

    // the group itself stays put at rest now — entrance motion happens
    // PER PANEL below so each image travels its own path from the bottom
    // left corner rather than the whole ribbon dragging in as one block.
    helix.position.set(REST_X, REST_Y, REST_Z);
    helix.scale.setScalar(1);

    // window of path-parameter that's actually near the camera: recycle
    // panels through this window so the visible run always looks freshly
    // populated, however far `adv` has climbed.
    const half = SPAN / 2;

    for (let i = 0; i < N; i++) {
      const p = planes[i];
      const { u, vy } = p.userData;

      // this panel's raw position along the infinite path, then wrapped
      // into the [-half, half) window centred on the camera so it always
      // recycles smoothly through view instead of drifting off to infinity
      let tC = (i * STEP - adv) % SPAN;
      if (tC < -half) tC += SPAN;
      if (tC >= half) tC -= SPAN;
      const tBase = tC - STEP / 2;   // panel start, in the same wrapped frame

      // the panel's own centre reveal fraction (used only for the uniform
      // per-panel stats below: colour/opacity/render-order/height-scale) —
      // per-VERTEX reveal is computed separately inside the loop below off
      // each vertex's own t, which is what actually keeps seams glued.
      const revealT = -half + state.enter * SPAN;
      const centreReveal = THREE.MathUtils.clamp((revealT - tC) / REVEAL_SOFTEN, 0, 1);
      const centreSmooth = centreReveal * centreReveal * (3 - 2 * centreReveal);

      // write every vertex onto the path RELATIVE TO THE PANEL'S OWN
      // CENTRE (not world origin). CRITICAL: the WIDTH edges (u=0 and u=1)
      // are placed EXACTLY on the shared path — never scaled — so adjacent
      // panels' edges always meet exactly regardless of each panel's own
      // depth-driven size, keeping the whole run one joined cloth with no
      // gaps. Only the vertical extent (vy) is scaled per panel for the
      // "near = bigger, far = smaller" depth read, since shrinking height
      // alone can't open a horizontal gap between neighbours.
      const centreAtRest = pathPoint(tC, _centre3);
      p.position.set(0, 0, 0); // mesh sits at the origin; every vertex already carries its own world position

      // depth cue off how close this panel's weave point is to the camera:
      // near peaks (z close to +WEAVE_DEPTH) are nearest, far troughs
      // (z close to -WEAVE_DEPTH) are furthest "behind the point".
      const depth01 = THREE.MathUtils.clamp((centreAtRest.z / WEAVE_DEPTH + 1) / 2, 0, 1);
      const eased = depth01 * depth01 * (3 - 2 * depth01);
      const heightScale = MIN_SCALE + eased * (1 - MIN_SCALE);

      const pos = p.geometry.attributes.position;
      const span = STEP + 2 * SEAM;
      const tStart = tBase - SEAM;
      for (let k = 0; k < pos.count; k++) {
        const t = tStart + u[k] * span;
        const v = pathPoint(t, _pos3);

        // reveal wave keyed on THIS VERTEX'S OWN t — identical for any two
        // panels' touching edge vertices (they share the same t by
        // construction), so the join between neighbours never separates.
        // Only the leading edge of the whole ribbon (highest revealed t)
        // is ever a free, unjoined tip.
        const vReveal = THREE.MathUtils.clamp((revealT - t) / REVEAL_SOFTEN, 0, 1);
        const vSmooth = vReveal * vReveal * (3 - 2 * vReveal);

        // staged (bottom-left) position for this vertex: same path shape,
        // just carried bodily to the staging offset and shrunk, so the
        // unrevealed run still reads as ribbon-shaped, not a random blob.
        const stagedX = v.x + ENTER_FROM_X;
        const stagedY = v.y * MIN_SCALE + ENTER_FROM_Y;
        const stagedZ = v.z + ENTER_FROM_Z;

        const vx = stagedX + (v.x - stagedX) * vSmooth;
        const vyFinal = stagedY + (vy[k] * heightScale + v.y - stagedY) * vSmooth;
        const vz = stagedZ + (v.z - stagedZ) * vSmooth;
        pos.setXYZ(k, vx, vyFinal, vz);
      }
      pos.needsUpdate = true;
      // no computeVertexNormals(): material is unlit (MeshBasicMaterial),
      // so normals are never sampled — recomputing them every frame for
      // 30 panels was pure wasted work.

      p.material.color.setScalar(0.55 + eased * 0.45);

      // fade only the panels at the very edge of the visible window, so
      // recycling in/out at the sides is invisible rather than a pop —
      // combined with the panel's own reveal progress so it fades IN as
      // it slithers up from the bottom-left rather than popping to full
      // opacity immediately.
      const edge = Math.abs(tC) / half;
      const edgeFade = THREE.MathUtils.clamp((1 - edge) / 0.12, 0, 1);
      p.material.opacity = edgeFade * centreSmooth;
      p.visible = edgeFade > 0.02 && centreSmooth > 0.02;
      p.renderOrder = Math.round(eased * 100);
    }
  }

  function resize() {
    const w = canvas.clientWidth || canvas.offsetWidth || 1;
    const h = canvas.clientHeight || canvas.offsetHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function frame() {
    raf = requestAnimationFrame(frame);
    layout();
    renderer.render(scene, camera);
  }

  function start() {
    if (!raf) {
      resize();
      layout();
      frame();
    }
  }
  function stop() { if (raf) { cancelAnimationFrame(raf); raf = 0; } }

  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  addEventListener("resize", resize);
  resize();

  return {
    state,
    setActive(on) { if (on !== active) { active = on; on ? start() : stop(); } },
    dispose() {
      stop(); ro.disconnect();
      planes.forEach((p) => { p.geometry.dispose(); p.material.map && p.material.map.dispose(); p.material.dispose(); });
      renderer.dispose();
    },
  };
}
