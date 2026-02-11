// ============================================================================
// Strife — Map Editor
// Separate Babylon.js app for creating and editing map JSON files.
// Simpler lighting (no post-processing), grid overlay, click-to-place objects,
// paint spawn zones, place lights, export/import JSON.
// ============================================================================

import { Engine } from "@babylonjs/core/Engines/engine";
import { WebGPUEngine } from "@babylonjs/core/Engines/webgpuEngine";
import { Scene } from "@babylonjs/core/scene";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Camera } from "@babylonjs/core/Cameras/camera";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { GridMaterial } from "@babylonjs/materials/grid/gridMaterial";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";

import type { EditorState } from "@shared/types";
import {
  DEFAULT_GRID_COLS,
  DEFAULT_GRID_ROWS,
  TILE_SIZE,
  CAMERA_ALPHA,
  CAMERA_BETA,
  CAMERA_ORTHO_SIZE,
  CAMERA_ZOOM_MIN,
  CAMERA_ZOOM_MAX,
  CAMERA_ZOOM_SPEED,
  MAX_DEVICE_PIXEL_RATIO,
} from "@shared/constants";

import { clamp } from "@shared/utils";
import { createPaletteState } from "./palette";
import { setupPlacement } from "./placement";
import { setupEditorGUI } from "./gui";

// ============================================================================
// Entry Point
// ============================================================================

async function editorMain(): Promise<void> {
  const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
  if (!canvas) {
    throw new Error("Canvas element #renderCanvas not found");
  }

  // --- Engine ---
  let engine: Engine;

  try {
    const webgpuSupported = await WebGPUEngine.IsSupportedAsync;
    if (webgpuSupported) {
      const webgpuEngine = new WebGPUEngine(canvas, {
        antialias: true,
        adaptToDeviceRatio: true,
      });
      await webgpuEngine.initAsync();
      engine = webgpuEngine as unknown as Engine;
      console.log("Editor: WebGPU engine initialized");
    } else {
      throw new Error("WebGPU not supported");
    }
  } catch {
    engine = new Engine(canvas, true, { adaptToDeviceRatio: true });
    console.log("Editor: WebGL2 engine initialized");
  }

  if (window.devicePixelRatio > MAX_DEVICE_PIXEL_RATIO) {
    engine.setHardwareScalingLevel(window.devicePixelRatio / MAX_DEVICE_PIXEL_RATIO);
  }

  // --- Scene ---
  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.12, 0.12, 0.14, 1);

  // --- Editor State ---
  const editorState: EditorState = {
    gridCols: DEFAULT_GRID_COLS,
    gridRows: DEFAULT_GRID_ROWS,
    tileSize: TILE_SIZE,
    groundTexture: "dirt",
    currentTool: "select",
    selectedObjectType: null,
    selectedCoverType: "none",
    spawnMode: null,
    objects: new Map(),
    lights: new Map(),
    spawnZones: {
      orderOfTheAbyss: new Set(),
      germani: new Set(),
    },
    previewMode: false,
  };

  const paletteState = createPaletteState();

  // --- Simple Lighting ---
  const ambientLight = new HemisphericLight("editorAmbient", new Vector3(0, 1, 0), scene);
  ambientLight.intensity = 0.6;
  ambientLight.diffuse = new Color3(0.9, 0.9, 1.0);
  ambientLight.groundColor = new Color3(0.3, 0.3, 0.35);

  const dirLight = new DirectionalLight("editorDir", new Vector3(-1, -2, 1), scene);
  dirLight.intensity = 0.8;
  dirLight.diffuse = new Color3(1.0, 0.95, 0.85);

  // --- Ground & Grid ---
  let groundMesh: Mesh | undefined;
  let gridOverlayMesh: Mesh | undefined;

  function createGround(): void {
    if (groundMesh) groundMesh.dispose();
    if (gridOverlayMesh) gridOverlayMesh.dispose();

    const gridWidth = editorState.gridCols * editorState.tileSize;
    const gridHeight = editorState.gridRows * editorState.tileSize;

    // Ground plane
    groundMesh = MeshBuilder.CreateGround(
      "editorGround",
      { width: gridWidth, height: gridHeight, subdivisions: 1 },
      scene,
    );
    groundMesh.position.x = gridWidth / 2;
    groundMesh.position.z = gridHeight / 2;

    // Grid material
    const gridMat = new GridMaterial("editorGridMat", scene);
    gridMat.mainColor = new Color3(0.15, 0.15, 0.18);
    gridMat.lineColor = new Color3(0.4, 0.45, 0.5);
    gridMat.gridRatio = editorState.tileSize;
    gridMat.majorUnitFrequency = 5;
    gridMat.minorUnitVisibility = 0.6;
    gridMat.opacity = 0.95;
    groundMesh.material = gridMat;

    // Update camera target
    camera.target = new Vector3(gridWidth / 2, 0, gridHeight / 2);
  }

  // --- Camera ---
  const camera = new ArcRotateCamera(
    "editorCamera",
    CAMERA_ALPHA,
    CAMERA_BETA,
    50,
    new Vector3(
      DEFAULT_GRID_COLS * TILE_SIZE / 2,
      0,
      DEFAULT_GRID_ROWS * TILE_SIZE / 2,
    ),
    scene,
  );

  camera.lowerAlphaLimit = CAMERA_ALPHA;
  camera.upperAlphaLimit = CAMERA_ALPHA;
  camera.lowerBetaLimit = CAMERA_BETA;
  camera.upperBetaLimit = CAMERA_BETA;
  camera.mode = Camera.ORTHOGRAPHIC_CAMERA;

  let orthoSize = CAMERA_ORTHO_SIZE;

  function updateOrthoBounds(): void {
    const aspect = canvas.width / canvas.height;
    camera.orthoLeft = -orthoSize * aspect;
    camera.orthoRight = orthoSize * aspect;
    camera.orthoTop = orthoSize;
    camera.orthoBottom = -orthoSize;
  }

  updateOrthoBounds();
  camera.attachControl(canvas, true);
  camera.inputs.removeByType("ArcRotateCameraMouseWheelInput");
  camera.panningSensibility = 50;
  camera._useCtrlForPanning = false;
  camera.panningAxis = new Vector3(1, 0, 1);

  // Scroll zoom
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const delta = Math.sign(e.deltaY) * CAMERA_ZOOM_SPEED;
    orthoSize = clamp(orthoSize + delta, CAMERA_ZOOM_MIN, CAMERA_ZOOM_MAX);
    updateOrthoBounds();
  }, { passive: false });

  // Initial ground
  createGround();

  // --- Placement System ---
  const placementSystem = setupPlacement(scene, editorState, paletteState, () => {
    // State changed callback
    editorGUI.update();
  });

  // --- Editor GUI ---
  const editorGUI = setupEditorGUI(scene, engine, editorState, paletteState, {
    onGridResize: (cols, rows) => {
      editorState.gridCols = cols;
      editorState.gridRows = rows;
      createGround();
      placementSystem.regenerateAllPreviews();
    },
    onTextureChange: (texture) => {
      editorState.groundTexture = texture;
      // In editor, we just show the grid material, not the PBR texture
    },
    onRegenerate: () => {
      placementSystem.regenerateAllPreviews();
      editorGUI.update();
    },
    onTogglePreview: (preview) => {
      // In preview mode, hide grid and UI
      // In edit mode, show them
      if (groundMesh && groundMesh.material) {
        if (preview) {
          const plainMat = new StandardMaterial("previewGroundMat", scene);
          plainMat.diffuseColor = new Color3(0.3, 0.25, 0.2);
          groundMesh.material = plainMat;
        } else {
          const gridMat = new GridMaterial("editorGridMat", scene);
          gridMat.mainColor = new Color3(0.15, 0.15, 0.18);
          gridMat.lineColor = new Color3(0.4, 0.45, 0.5);
          gridMat.gridRatio = editorState.tileSize;
          gridMat.majorUnitFrequency = 5;
          gridMat.minorUnitVisibility = 0.6;
          gridMat.opacity = 0.95;
          groundMesh.material = gridMat;
        }
      }
    },
  });

  // --- Render Loop ---
  engine.runRenderLoop(() => {
    scene.render();
  });

  window.addEventListener("resize", () => {
    engine.resize();
    updateOrthoBounds();
  });

  console.log("Strife Map Editor: Ready");
}

// ============================================================================
// Start
// ============================================================================

editorMain().catch((err) => {
  console.error("Editor failed to initialize:", err);
  const div = document.createElement("div");
  div.style.cssText =
    "position:fixed;top:0;left:0;width:100%;height:100%;background:#1a1a1a;color:#ff4444;" +
    "display:flex;align-items:center;justify-content:center;font-family:monospace;font-size:16px;" +
    "text-align:center;padding:20px;z-index:9999;";
  div.textContent = `Editor failed: ${err instanceof Error ? err.message : String(err)}`;
  document.body.appendChild(div);
});
