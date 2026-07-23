import * as THREE from "three";
import { createSky } from "./sky.js";
import { createAurora } from "./aurora.js";
import { createMountains } from "./mountains.js";
import { createGround } from "./ground.js";
import { createGroundFog } from "./groundFog.js";
import { createCameraRig } from "./cameraRig.js";
import { createEnergyCore } from "./energyCore.js";
import { createPostProcessing } from "./postProcessing.js";
import { createFluidDistortion } from "./fluidDistortion.js";

// Phase 1 — The World. One call mounts the whole living environment into any
// container element (a fullscreen div, or a pinned section of index.html):
//
//   import { mountWorld } from "./js/world/world.js";
//   const world = mountWorld(document.getElementById("worldSection"));
//   // later, if the section unmounts: world.dispose();
//
// Phases 2+ (EnergyCore, Scroll, Logo, Services) will hook into the returned
// handle without modifying these environment modules.
//
// GPU notes for this machine (AMD Vega 10, ANGLE/D3D11), learned the hard way:
//  - device pixel ratio capped at 1.25 — heavier loads drop black frames
//  - antialias off — the scene renders offscreen through the composer anyway
//  - never add a mid-frame render-to-texture (Reflector, transmission) — it
//    blacks out the entire composer frame

export function mountWorld(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.25));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.7;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0d2b27);
  // thick luminous haze, slightly darker than the sky's horizon glow: the
  // mountains fade into it as flat silhouettes while still reading darker
  // than the bright sky behind them — the reference's aerial perspective
  scene.fog = new THREE.FogExp2(0x2f7d72, 0.0055);

  const camera = new THREE.PerspectiveCamera(
    45, container.clientWidth / container.clientHeight, 0.1, 900);
  camera.position.set(0, 3.4, 18);

  // lighting: bright sky dome washing the whole plain (the reference scene
  // is lit by its sky, not by point sources) + a horizon glow behind the
  // range + a soft fill so the near ground keeps its relief
  scene.add(new THREE.HemisphereLight(0x3fa392, 0x0a231f, 1.7));
  const furnace = new THREE.PointLight(0x2fe6d8, 45, 0, 1.3);
  furnace.position.set(70, 12, -190);
  scene.add(furnace);
  const rake = new THREE.DirectionalLight(0xaefff4, 0.5);
  rake.position.set(90, 25, -180);
  scene.add(rake);
  // low raking angle so the rocky bump relief casts visible shading
  const fill = new THREE.DirectionalLight(0x3f8c80, 2.4);
  fill.position.set(-60, 18, 60);
  fill.target.position.set(0, 0, 18);
  scene.add(fill);
  scene.add(fill.target);
  // low sun grazing in from the right — catches the hero range's
  // summits and right-facing slopes with a bright teal rim. Scoped to the
  // mountains only so it doesn't flood the ground plane.
  const sunrise = new THREE.DirectionalLight(0x8fe6d4, 30);
  sunrise.position.set(300, 30, 80);
  sunrise.target.position.set(60, 4, -175);
  scene.add(sunrise);
  scene.add(sunrise.target);
  sunrise.layers.set(1);
  // cool cross-light from high camera-left — carves the far side of each
  // ridge into a darker plane against the sunrise-lit side, so the range
  // reads as faceted terrain rather than one flat-shaded silhouette
  const crossLight = new THREE.DirectionalLight(0x2a6a5f, 14);
  crossLight.position.set(-220, 60, -40);
  crossLight.target.position.set(0, 4, -220);
  scene.add(crossLight);
  scene.add(crossLight.target);
  crossLight.layers.set(1);

  const energyCore = createEnergyCore(scene, renderer);
  const cameraRig = createCameraRig(camera);
  const parts = [
    createSky(scene),
    createAurora(scene),
    createMountains(scene),
    createGround(scene),
    createGroundFog(scene),
    cameraRig,
    energyCore,
  ];

  // one-time snapshot of the finished environment for the core's frosted
  // transmission fake — must happen after every part exists, before any
  // composer frame (this is a load-time bake, not a mid-frame RTT)
  energyCore.bakeSurroundings();

  const composer = createPostProcessing(
    renderer, scene, camera, container.clientWidth, container.clientHeight);
  const fluid = createFluidDistortion(renderer, container);

  const resize = () => {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    composer.setSize(w, h);
  };
  const observer = new ResizeObserver(resize);
  observer.observe(container);

  // one warm-up frame at mount so every shader compiles NOW, during page
  // load, instead of causing a hitch the first time the world fades in
  composer.render();

  // render only while the world can actually be seen. Two gates:
  //  - IntersectionObserver: container scrolled anywhere off screen
  //  - data-paused="1" on the container (set by index.html while the Key
  //    Facts sheet still fully covers the world, i.e. --world is 0)
  // Paused, the loop keeps its rAF alive but does zero update/GPU work —
  // this scene was silently eating half the frame budget behind the hero.
  let onScreen = false;
  const io = new IntersectionObserver((entries) => {
    onScreen = entries[entries.length - 1].isIntersecting;
  });
  io.observe(container);

  const clock = new THREE.Clock();
  let disposed = false;
  (function loop() {
    if (disposed) return;
    requestAnimationFrame(loop);
    if (!onScreen || container.dataset.paused === "1") return;
    const t = clock.getElapsedTime();
    for (const p of parts) p.update && p.update(t);
    fluid.update();
    composer.fluidPass.uniforms.tFluid.value = fluid.getTexture();
    composer.render();
  })();

  return {
    scene,
    camera,
    renderer,
    // scroll progress 0..1 for the energy core's arrival — driven by the
    // page owning the pin (the-world.html demo track, or index.html section)
    setScroll(p) { energyCore.setProgress(p); },
    // the core's actual smoothed progress (lags the raw setScroll target by
    // its internal lerp) — pages driving other DOM elements off this same
    // scrub (card climbs, etc.) should read THIS so they stay in lockstep
    // with what's visually happening in the scene, not the raw input.
    getScroll() { return energyCore.getProgress ? energyCore.getProgress() : 0; },
    // scroll progress 0..1 for the camera's push toward the settled core,
    // driven separately from the core's own arrival (setScroll) so the page
    // can start the approach only once the sigil burn + cards have finished
    setApproach(p) { cameraRig.setApproach(p); },
    dispose() {
      disposed = true;
      observer.disconnect();
      io.disconnect();
      for (const p of parts) p.dispose && p.dispose();
      fluid.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
