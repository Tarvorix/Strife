// ============================================================================
// Strife — Main Orchestrator
// Engine init (WebGPU/WebGL2), scene setup, lighting rig, post-processing,
// atmospheric particles, and wiring all game systems together.
// ============================================================================

import { Engine } from "@babylonjs/core/Engines/engine";
import { WebGPUEngine } from "@babylonjs/core/Engines/webgpuEngine";
import { Scene } from "@babylonjs/core/scene";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { KeyboardEventTypes } from "@babylonjs/core/Events/keyboardEvents";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { DefaultRenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline";
import { SSAO2RenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/ssao2RenderingPipeline";
import { ColorCurves } from "@babylonjs/core/Materials/colorCurves";
import { CubeTexture } from "@babylonjs/core/Materials/Textures/cubeTexture";

// ---- Side-effect imports (required for tree-shaking with Babylon.js) ----
// glTF loader registration
import "@babylonjs/loaders/glTF";
// scene.beginAnimation() — patches Scene.prototype
import "@babylonjs/core/Animations/animatable";
// scene.pick() / createPickingRay — patches Scene.prototype
import "@babylonjs/core/Culling/ray";
// ParticleSystem scene integration
import "@babylonjs/core/Particles/particleSystemComponent";
// ShadowGenerator scene component
import "@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent";
// DynamicTexture engine extension (WebGL path — needed for GUI's AdvancedDynamicTexture)
import "@babylonjs/core/Engines/Extensions/engine.dynamicTexture";
// DynamicTexture engine extension (WebGPU path — WebGPUEngine.prototype.createDynamicTexture)
import "@babylonjs/core/Engines/WebGPU/Extensions/engine.dynamicTexture";
// Multi-render target (WebGPU path — needed by SSAO2's GeometryBufferRenderer)
import "@babylonjs/core/Engines/WebGPU/Extensions/engine.multiRender";
// scene.enableGeometryBufferRenderer() — needed by SSAO2
import "@babylonjs/core/Rendering/geometryBufferRendererSceneComponent";
// scene.enablePrePassRenderer() — needed by SSAO2
import "@babylonjs/core/Rendering/prePassRendererSceneComponent";
// scene.enableDepthRenderer() — needed by SSAO2/DefaultRenderingPipeline
import "@babylonjs/core/Rendering/depthRendererSceneComponent";

import { loadMap } from "./map-loader";
import { setupCamera } from "./camera";
import type { CameraSystem } from "./camera";
import { createGrid } from "./grid";
import { generateMapObjects } from "./procedural";
import { loadAllUnits } from "./units";
import { initGameState, startGame, onTurnEvent, setPhase } from "./turns";
import { executeAITurn } from "./ai";
import { setupInput, createActionHandlers } from "./input";
import { setupGUI } from "./gui";
import type { GUISystem } from "./gui";
import { setupAtmosphere } from "./vfx";
import { initSoundSystem } from "./sound";
import { hexToRgb } from "@shared/utils";

import type { GameState, GridSystem, MapData } from "@shared/types";

import {
  SCENE_CLEAR_COLOR,
  KEY_LIGHT_DIRECTION,
  KEY_LIGHT_INTENSITY,
  KEY_LIGHT_DIFFUSE,
  KEY_LIGHT_SPECULAR,
  SHADOW_MAP_SIZE,
  SHADOW_BIAS,
  SHADOW_NORMAL_BIAS,
  RIM_LIGHT_DIRECTION,
  RIM_LIGHT_INTENSITY,
  RIM_LIGHT_DIFFUSE,
  RIM_LIGHT_SPECULAR,
  AMBIENT_DIRECTION,
  AMBIENT_INTENSITY,
  AMBIENT_DIFFUSE,
  AMBIENT_GROUND_COLOR,
  MAX_ENV_LIGHTS,
  MAX_DEVICE_PIXEL_RATIO,
  SSAO_TOTAL_STRENGTH,
  SSAO_RADIUS,
  SSAO_SAMPLES,
  SSAO_RATIO,
  SSAO_BLUR_RATIO,
  BLOOM_THRESHOLD,
  BLOOM_WEIGHT,
  BLOOM_KERNEL,
  BLOOM_SCALE,
  COLOR_GRADE_EXPOSURE,
  COLOR_GRADE_CONTRAST,
  COLOR_CURVES_GLOBAL_SATURATION,
  COLOR_CURVES_SHADOWS_HUE,
  COLOR_CURVES_SHADOWS_SATURATION,
  COLOR_CURVES_SHADOWS_DENSITY,
  COLOR_CURVES_HIGHLIGHTS_HUE,
  COLOR_CURVES_HIGHLIGHTS_SATURATION,
  COLOR_CURVES_HIGHLIGHTS_DENSITY,
  VIGNETTE_WEIGHT,
  VIGNETTE_STRETCH,
  GRAIN_INTENSITY,
} from "@shared/constants";

interface RuntimeProfile {
  isProduction: boolean;
  isSafari: boolean;
  isIOS: boolean;
  isMobile: boolean;
  isSafariMobile: boolean;
  isConstrained: boolean;
  maxDevicePixelRatio: number;
}

function getRuntimeProfile(): RuntimeProfile {
  const userAgent = navigator.userAgent;
  const vendor = navigator.vendor || "";
  const isProduction = import.meta.env.PROD;

  const isIOS =
    /iPad|iPhone|iPod/i.test(userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent) || isIOS;
  const isSafari =
    /Safari/i.test(userAgent) &&
    /Apple Computer/i.test(vendor) &&
    !/CriOS|Chrome|EdgiOS|FxiOS|OPiOS|DuckDuckGo/i.test(userAgent);
  const isSafariMobile = isSafari && isMobile;

  // iOS is always constrained; desktop Safari gets conservative settings for production builds.
  const isConstrained = isMobile || (isSafari && isProduction);

  // Keep desktop Chrome quality while reducing retina pressure on constrained runtimes.
  const maxDevicePixelRatio = isMobile ? 1.25 : isSafari ? 1.5 : MAX_DEVICE_PIXEL_RATIO;

  return {
    isProduction,
    isSafari,
    isIOS,
    isMobile,
    isSafariMobile,
    isConstrained,
    maxDevicePixelRatio,
  };
}

// ============================================================================
// Entry Point
// ============================================================================

async function main(): Promise<void> {
  const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
  if (!canvas) {
    throw new Error("Canvas element #renderCanvas not found");
  }

  const runtimeProfile = getRuntimeProfile();

  // --- Create Engine (WebGPU primary, WebGL2 fallback) ---
  let engine: Engine;
  const useAggressiveWebGPUOptions = !runtimeProfile.isConstrained;

  if (runtimeProfile.isSafariMobile) {
    console.warn("Strife: Mobile Safari detected, forcing WebGL2 renderer");
    engine = new Engine(canvas, true, {
      adaptToDeviceRatio: true,
    });
    console.log("Strife: WebGL2 engine initialized");
  } else {
    try {
      const webgpuSupported = await WebGPUEngine.IsSupportedAsync;
      if (webgpuSupported) {
        const webgpuEngine = new WebGPUEngine(canvas, {
          antialias: !runtimeProfile.isConstrained,
          adaptToDeviceRatio: true,
          powerPreference: runtimeProfile.isMobile ? "low-power" : "high-performance",
          setMaximumLimits: useAggressiveWebGPUOptions,
          enableAllFeatures: useAggressiveWebGPUOptions,
        });
        await webgpuEngine.initAsync();
        engine = webgpuEngine as unknown as Engine;
        console.log("Strife: WebGPU engine initialized");
      } else {
        throw new Error("WebGPU not supported, falling back to WebGL2");
      }
    } catch (err) {
      console.warn("WebGPU unavailable, using WebGL2:", err);
      engine = new Engine(canvas, true, {
        adaptToDeviceRatio: true,
      });
      console.log("Strife: WebGL2 engine initialized");
    }
  }

  console.log(
    `Strife runtime profile: prod=${runtimeProfile.isProduction}, safari=${runtimeProfile.isSafari}, ios=${runtimeProfile.isIOS}, mobile=${runtimeProfile.isMobile}, constrained=${runtimeProfile.isConstrained}`,
  );

  // Cap device pixel ratio for memory stability on constrained runtimes.
  if (window.devicePixelRatio > runtimeProfile.maxDevicePixelRatio) {
    engine.setHardwareScalingLevel(window.devicePixelRatio / runtimeProfile.maxDevicePixelRatio);
  }

  // --- Create Scene ---
  const scene = new Scene(engine);
  scene.clearColor = new Color4(
    SCENE_CLEAR_COLOR.r,
    SCENE_CLEAR_COLOR.g,
    SCENE_CLEAR_COLOR.b,
    SCENE_CLEAR_COLOR.a,
  );

  // --- Load Map ---
  const mapData = await loadMap(`${import.meta.env.BASE_URL}maps/test-map.json`);
  const gridCols = mapData.gridSize[0];
  const gridRows = mapData.gridSize[1];
  const tileSize = mapData.tileSize;
  const gridWidth = gridCols * tileSize;
  const gridHeight = gridRows * tileSize;

  // --- Lighting Rig (Section 13) ---
  const { shadowGenerator } = setupLighting(scene, mapData, gridWidth, gridHeight, runtimeProfile);

  // --- Camera ---
  const cameraSystem = setupCamera(scene, engine, gridCols, gridRows, tileSize);

  // --- Grid & Terrain ---
  const gridSystem = createGrid(scene, mapData, shadowGenerator, runtimeProfile.isSafariMobile);

  // --- Procedural Cover Objects ---
  const coverMeshes = generateMapObjects(
    scene,
    mapData,
    gridSystem.tiles,
    shadowGenerator,
    runtimeProfile.isSafariMobile,
  );

  // --- Load Units ---
  const units = await loadAllUnits(
    scene,
    mapData,
    gridSystem.tiles,
    shadowGenerator,
    runtimeProfile.isSafariMobile,
  );

  // --- Post-Processing ---
  setupPostProcessing(scene, engine, cameraSystem, runtimeProfile);

  // --- Atmospheric Particles ---
  if (!runtimeProfile.isConstrained) {
    setupAtmosphere(scene, gridWidth, gridHeight);
  }

  // --- Sound System ---
  const soundSystem = initSoundSystem(scene);

  // --- Initialize Game State ---
  const gameState = initGameState(units);

  // --- GUI ---
  const actionCallbacks = createActionHandlers(gameState, scene, gridSystem, cameraSystem);
  const guiSystem = setupGUI(scene, engine, gameState, {
    onShoot: actionCallbacks.onShoot,
    onMelee: actionCallbacks.onMelee,
    onOverwatch: actionCallbacks.onOverwatch,
    onHunkerDown: actionCallbacks.onHunkerDown,
    onEndActivation: actionCallbacks.onEndActivation,
    onUnitRosterClick: actionCallbacks.onUnitRosterClick,
    onPlayAgain: actionCallbacks.onPlayAgain,
  });

  // --- Input ---
  const inputSystem = setupInput(scene, gameState, gridSystem, cameraSystem);
  inputSystem.setGUICallbacks(guiSystem.getInputCallbacks());

  // --- Grid Overlay Toggle (G key) ---
  scene.onKeyboardObservable.add((kbInfo) => {
    if (kbInfo.type === KeyboardEventTypes.KEYDOWN && kbInfo.event.key.toLowerCase() === "g") {
      gridSystem.gridLines.isVisible = !gridSystem.gridLines.isVisible;
    }
  });

  // --- AI Turn Handler ---
  onTurnEvent(async (event) => {
    if (event.phase === "ai_turn" && gameState.phase === "ai_turn") {
      // Delay to let the banner show
      await new Promise<void>((r) => setTimeout(r, 800));
      await executeAITurn(gameState, gridSystem.tiles, scene, cameraSystem);
    }
  });

  // --- Render Loop ---
  engine.runRenderLoop(() => {
    scene.render();
    guiSystem.update(gameState);
  });

  // --- Resize Handler ---
  window.addEventListener("resize", () => {
    engine.resize();
  });

  // --- Faction Selection → Start Game ---
  guiSystem.showFactionSelect((chosenFaction) => {
    gameState.playerFaction = chosenFaction;
    gameState.currentFaction = chosenFaction;

    // Rebuild the roster so the correct faction pips are clickable
    guiSystem.rebuildRoster();

    startGame(gameState);

    // Start ambient battlefield sounds (handles missing files gracefully)
    soundSystem.startAmbience();

    console.log(`Strife: Game started — ${gridCols}x${gridRows} grid, ${units.size} units, playing as ${chosenFaction}`);
  });
}

// ============================================================================
// Lighting Setup
// ============================================================================

function setupLighting(
  scene: Scene,
  mapData: MapData,
  gridWidth: number,
  gridHeight: number,
  runtimeProfile: RuntimeProfile,
): { shadowGenerator: ShadowGenerator; keyLight: DirectionalLight } {
  // --- Key DirectionalLight ---
  const keyLight = new DirectionalLight(
    "keyLight",
    new Vector3(KEY_LIGHT_DIRECTION.x, KEY_LIGHT_DIRECTION.y, KEY_LIGHT_DIRECTION.z),
    scene,
  );
  keyLight.intensity = KEY_LIGHT_INTENSITY;
  keyLight.diffuse = new Color3(KEY_LIGHT_DIFFUSE.r, KEY_LIGHT_DIFFUSE.g, KEY_LIGHT_DIFFUSE.b);
  keyLight.specular = new Color3(KEY_LIGHT_SPECULAR.r, KEY_LIGHT_SPECULAR.g, KEY_LIGHT_SPECULAR.b);

  // Position the light above the map for proper shadow casting
  keyLight.position = new Vector3(gridWidth / 2, 20, gridHeight / 2);

  // Shadow Generator with PCF
  const shadowMapSize = runtimeProfile.isMobile
    ? SHADOW_MAP_SIZE / 4
    : runtimeProfile.isConstrained
      ? SHADOW_MAP_SIZE / 2
      : SHADOW_MAP_SIZE;
  const shadowGenerator = new ShadowGenerator(shadowMapSize, keyLight);
  shadowGenerator.usePercentageCloserFiltering = true;
  shadowGenerator.bias = SHADOW_BIAS;
  shadowGenerator.normalBias = SHADOW_NORMAL_BIAS;
  shadowGenerator.filteringQuality = runtimeProfile.isConstrained
    ? ShadowGenerator.QUALITY_LOW
    : ShadowGenerator.QUALITY_MEDIUM;

  // --- Rim/Back DirectionalLight ---
  const rimLight = new DirectionalLight(
    "rimLight",
    new Vector3(RIM_LIGHT_DIRECTION.x, RIM_LIGHT_DIRECTION.y, RIM_LIGHT_DIRECTION.z),
    scene,
  );
  rimLight.intensity = RIM_LIGHT_INTENSITY;
  rimLight.diffuse = new Color3(RIM_LIGHT_DIFFUSE.r, RIM_LIGHT_DIFFUSE.g, RIM_LIGHT_DIFFUSE.b);
  rimLight.specular = new Color3(RIM_LIGHT_SPECULAR.r, RIM_LIGHT_SPECULAR.g, RIM_LIGHT_SPECULAR.b);
  // No shadows for rim light

  // --- Ambient HemisphericLight ---
  const ambientLight = new HemisphericLight(
    "ambientLight",
    new Vector3(AMBIENT_DIRECTION.x, AMBIENT_DIRECTION.y, AMBIENT_DIRECTION.z),
    scene,
  );
  ambientLight.intensity = AMBIENT_INTENSITY;
  ambientLight.diffuse = new Color3(AMBIENT_DIFFUSE.r, AMBIENT_DIFFUSE.g, AMBIENT_DIFFUSE.b);
  ambientLight.groundColor = new Color3(AMBIENT_GROUND_COLOR.r, AMBIENT_GROUND_COLOR.g, AMBIENT_GROUND_COLOR.b);
  ambientLight.specular = new Color3(0, 0, 0); // no specular from ambient

  // --- Environmental Point Lights from Map ---
  const envLightCap = runtimeProfile.isMobile
    ? Math.min(MAX_ENV_LIGHTS, 2)
    : runtimeProfile.isConstrained
      ? Math.min(MAX_ENV_LIGHTS, 3)
      : MAX_ENV_LIGHTS;
  const envLightCount = Math.min(mapData.lights.length, envLightCap);
  for (let i = 0; i < envLightCount; i++) {
    const lightData = mapData.lights[i];
    const worldX = lightData.tile[0] * mapData.tileSize + mapData.tileSize / 2;
    const worldZ = lightData.tile[1] * mapData.tileSize + mapData.tileSize / 2;

    const envLight = new PointLight(
      `envLight_${i}`,
      new Vector3(worldX, lightData.height, worldZ),
      scene,
    );

    const color = hexToRgb(lightData.color);
    envLight.diffuse = new Color3(color.r, color.g, color.b);
    envLight.intensity = lightData.intensity;
    envLight.range = lightData.radius;
  }

  return { shadowGenerator, keyLight };
}

// ============================================================================
// Post-Processing Pipeline
// ============================================================================

function setupPostProcessing(
  scene: Scene,
  engine: Engine,
  cameraSystem: CameraSystem,
  runtimeProfile: RuntimeProfile,
): void {
  if (runtimeProfile.isSafariMobile) {
    console.log("Post-processing disabled for mobile Safari stability");
    return;
  }

  const camera = cameraSystem.camera;

  // --- SSAO2 ---
  if (!runtimeProfile.isConstrained) {
    try {
      const ssao = new SSAO2RenderingPipeline("ssao", scene, {
        ssaoRatio: SSAO_RATIO,
        blurRatio: SSAO_BLUR_RATIO,
      });
      ssao.totalStrength = SSAO_TOTAL_STRENGTH;
      ssao.radius = SSAO_RADIUS;
      ssao.samples = SSAO_SAMPLES;
      scene.postProcessRenderPipelineManager.attachCamerasToRenderPipeline("ssao", camera);
    } catch (err) {
      console.warn("SSAO2 not available:", err);
    }
  } else {
    console.log("SSAO2 disabled for constrained runtime");
  }

  // --- Default Rendering Pipeline (Bloom + Color Grading + Vignette + Film Grain) ---
  try {
    const pipeline = new DefaultRenderingPipeline("defaultPipeline", true, scene, [camera]);

    // Bloom
    pipeline.bloomEnabled = true;
    pipeline.bloomThreshold = BLOOM_THRESHOLD;
    pipeline.bloomWeight = BLOOM_WEIGHT;
    pipeline.bloomKernel = runtimeProfile.isConstrained ? Math.min(BLOOM_KERNEL, 32) : BLOOM_KERNEL;
    pipeline.bloomScale = runtimeProfile.isConstrained ? 0.35 : BLOOM_SCALE;

    // Image processing (color grading)
    pipeline.imageProcessingEnabled = true;
    if (pipeline.imageProcessing) {
      pipeline.imageProcessing.exposure = COLOR_GRADE_EXPOSURE;
      pipeline.imageProcessing.contrast = COLOR_GRADE_CONTRAST;

      // Color curves
      pipeline.imageProcessing.colorCurvesEnabled = true;
      const curves = new ColorCurves();
      curves.globalSaturation = COLOR_CURVES_GLOBAL_SATURATION;
      curves.shadowsHue = COLOR_CURVES_SHADOWS_HUE;
      curves.shadowsSaturation = COLOR_CURVES_SHADOWS_SATURATION;
      curves.shadowsDensity = COLOR_CURVES_SHADOWS_DENSITY;
      curves.highlightsHue = COLOR_CURVES_HIGHLIGHTS_HUE;
      curves.highlightsSaturation = COLOR_CURVES_HIGHLIGHTS_SATURATION;
      curves.highlightsDensity = COLOR_CURVES_HIGHLIGHTS_DENSITY;
      pipeline.imageProcessing.colorCurves = curves;

      // Vignette
      pipeline.imageProcessing.vignetteEnabled = true;
      pipeline.imageProcessing.vignetteWeight = VIGNETTE_WEIGHT;
      pipeline.imageProcessing.vignetteStretch = VIGNETTE_STRETCH;
      pipeline.imageProcessing.vignetteColor = new Color4(0, 0, 0, 1);
    }

    // Film grain
    pipeline.grainEnabled = !runtimeProfile.isConstrained;
    if (pipeline.grainEnabled) {
      pipeline.grain.intensity = GRAIN_INTENSITY;
      pipeline.grain.animated = true;
    }
  } catch (err) {
    console.warn("Default rendering pipeline not available:", err);
  }
}

// ============================================================================
// Start Application
// ============================================================================

main().catch((err) => {
  console.error("Strife: Fatal error during initialization:", err);
  // Show error on page
  const canvas = document.getElementById("renderCanvas");
  if (canvas) {
    const div = document.createElement("div");
    div.style.cssText =
      "position:fixed;top:0;left:0;width:100%;height:100%;background:#1a1a1a;color:#ff4444;" +
      "display:flex;align-items:center;justify-content:center;font-family:monospace;font-size:16px;" +
      "text-align:center;padding:20px;z-index:9999;";
    div.textContent = `Strife failed to initialize: ${err instanceof Error ? err.message : String(err)}`;
    document.body.appendChild(div);
  }
});
