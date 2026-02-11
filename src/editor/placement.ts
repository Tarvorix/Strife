// ============================================================================
// Strife — Editor Placement System
// Click-to-place logic for objects, spawn zones, and lights.
// ============================================================================

import { PointerEventTypes } from "@babylonjs/core/Events/pointerEvents";
import { KeyboardEventTypes } from "@babylonjs/core/Events/keyboardEvents";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";

import type {
  EditorState,
  PlacedObject,
  PlacedLight,
  MapObjectType,
  CoverType,
  Faction,
} from "@shared/types";

import { worldToGrid, gridToWorld, isInBounds } from "@shared/utils";
import type { PaletteState } from "./palette";
import { rotateSelection, rerollSeed } from "./palette";
import { TILE_SIZE, AVAILABLE_GROUND_TEXTURES } from "@shared/constants";

export interface PlacementSystem {
  dispose: () => void;
  regenerateAllPreviews: () => void;
}

/**
 * Set up the click-to-place system for the editor.
 */
export function setupPlacement(
  scene: Scene,
  editorState: EditorState,
  paletteState: PaletteState,
  onStateChanged: () => void,
): PlacementSystem {
  // --- Pointer Event: Place/Remove objects ---
  const pointerObserver = scene.onPointerObservable.add((pointerInfo) => {
    if (pointerInfo.type !== PointerEventTypes.POINTERTAP) return;

    const pickResult = scene.pick(scene.pointerX, scene.pointerY);
    if (!pickResult || !pickResult.hit || !pickResult.pickedPoint) return;

    const point = pickResult.pickedPoint;
    const gridCoords = worldToGrid(point.x, point.z, editorState.tileSize);
    const { col, row } = gridCoords;

    if (!isInBounds(col, row, editorState.gridCols, editorState.gridRows)) return;

    const key = `${col},${row}`;
    const isRightClick = pointerInfo.event instanceof PointerEvent && pointerInfo.event.button === 2;

    // Right-click or erase tool: remove
    if (isRightClick || paletteState.selectedTool === "erase") {
      removeObject(editorState, key, scene);
      removeLight(editorState, key, scene);
      editorState.spawnZones.orderOfTheAbyss.delete(key);
      editorState.spawnZones.germani.delete(key);
      onStateChanged();
      return;
    }

    switch (paletteState.selectedTool) {
      case "place_object":
        if (paletteState.selectedItem) {
          placeObject(
            scene,
            editorState,
            col,
            row,
            paletteState.selectedItem.type,
            paletteState.currentSeed,
            paletteState.currentScale,
            paletteState.currentRotation,
            paletteState.currentCover,
          );
          // Generate new seed for next placement
          rerollSeed(paletteState);
          onStateChanged();
        }
        break;

      case "paint_spawn":
        if (paletteState.spawnFaction) {
          toggleSpawnZone(editorState, col, row, paletteState.spawnFaction, scene);
          onStateChanged();
        }
        break;

      case "place_light":
        placeLight(scene, editorState, col, row);
        onStateChanged();
        break;

      case "select":
        // In select mode, clicking does nothing special
        break;
    }
  });

  // --- Keyboard: R to rotate, N for new seed ---
  const keyboardObserver = scene.onKeyboardObservable.add((kbInfo) => {
    if (kbInfo.type !== KeyboardEventTypes.KEYDOWN) return;

    const key = kbInfo.event.key.toLowerCase();

    if (key === "r") {
      rotateSelection(paletteState);
      onStateChanged();
    } else if (key === "n") {
      rerollSeed(paletteState);
      onStateChanged();
    }
  });

  // --- Prevent context menu on right-click ---
  const canvas = scene.getEngine().getRenderingCanvas();
  const contextMenuHandler = (e: MouseEvent) => e.preventDefault();
  if (canvas) {
    canvas.addEventListener("contextmenu", contextMenuHandler);
  }

  function dispose(): void {
    scene.onPointerObservable.remove(pointerObserver);
    scene.onKeyboardObservable.remove(keyboardObserver);
    if (canvas) {
      canvas.removeEventListener("contextmenu", contextMenuHandler);
    }
  }

  function regenerateAllPreviews(): void {
    // Dispose and recreate all preview meshes
    for (const [key, obj] of editorState.objects) {
      if (obj.previewMesh) {
        obj.previewMesh.dispose();
        obj.previewMesh = null;
      }
      obj.previewMesh = createPreviewMesh(scene, obj);
    }

    // Recreate light indicators
    for (const [key, light] of editorState.lights) {
      if (light.indicatorMesh) {
        light.indicatorMesh.dispose();
        light.indicatorMesh = null;
      }
      if (light.pointLight) {
        light.pointLight.dispose();
        light.pointLight = null;
      }
      createLightVisuals(scene, light);
    }

    // Show spawn zone highlights
    updateSpawnHighlights(scene, editorState);
  }

  return { dispose, regenerateAllPreviews };
}

// ============================================================================
// Object Placement
// ============================================================================

function placeObject(
  scene: Scene,
  state: EditorState,
  col: number,
  row: number,
  type: MapObjectType,
  seed: number,
  scale: number,
  rotation: number,
  cover: CoverType,
): void {
  const key = `${col},${row}`;

  // Remove existing object at this tile
  removeObject(state, key, scene);

  const obj: PlacedObject = {
    id: key,
    type,
    tile: [col, row],
    seed,
    scale,
    rotation,
    cover,
    previewMesh: null,
  };

  // Create preview mesh
  obj.previewMesh = createPreviewMesh(scene, obj);

  state.objects.set(key, obj);
}

function removeObject(state: EditorState, key: string, scene: Scene): void {
  const existing = state.objects.get(key);
  if (existing) {
    if (existing.previewMesh) {
      existing.previewMesh.dispose();
    }
    state.objects.delete(key);
  }
}

/**
 * Create a simple preview mesh for an editor object.
 * Uses basic shapes colored by cover type (not full procedural generation for editor performance).
 */
function createPreviewMesh(scene: Scene, obj: PlacedObject): Mesh {
  const worldPos = gridToWorld(obj.tile[0], obj.tile[1], TILE_SIZE);
  let mesh: Mesh;

  switch (obj.type) {
    case "boulder":
      mesh = MeshBuilder.CreateSphere(
        `preview_${obj.id}`,
        { diameter: 0.8 * obj.scale, segments: 8 },
        scene,
      );
      mesh.position.y = 0.4 * obj.scale;
      break;

    case "rock_cluster":
      mesh = MeshBuilder.CreateSphere(
        `preview_${obj.id}`,
        { diameter: 0.6 * obj.scale, segments: 6 },
        scene,
      );
      mesh.position.y = 0.3 * obj.scale;
      break;

    case "column":
      mesh = MeshBuilder.CreateCylinder(
        `preview_${obj.id}`,
        { diameter: 0.5 * obj.scale, height: 2.0 * obj.scale, tessellation: 8 },
        scene,
      );
      mesh.position.y = 1.0 * obj.scale;
      break;

    case "ruined_wall":
      mesh = MeshBuilder.CreateBox(
        `preview_${obj.id}`,
        { width: 1.6 * obj.scale, height: 1.8 * obj.scale, depth: 0.3 * obj.scale },
        scene,
      );
      mesh.position.y = 0.9 * obj.scale;
      mesh.rotation.y = (obj.rotation * Math.PI) / 180;
      break;

    case "barricade":
      mesh = MeshBuilder.CreateBox(
        `preview_${obj.id}`,
        { width: 1.4 * obj.scale, height: 0.8 * obj.scale, depth: 0.4 * obj.scale },
        scene,
      );
      mesh.position.y = 0.4 * obj.scale;
      break;

    case "crater":
      mesh = MeshBuilder.CreateDisc(
        `preview_${obj.id}`,
        { radius: 0.8 * obj.scale, tessellation: 16 },
        scene,
      );
      mesh.rotation.x = Math.PI / 2;
      mesh.position.y = 0.01;
      break;

    default:
      mesh = MeshBuilder.CreateBox(`preview_${obj.id}`, { size: 0.5 }, scene);
      mesh.position.y = 0.25;
  }

  mesh.position.x = worldPos.x;
  mesh.position.z = worldPos.z;

  // Color by cover type
  const mat = new StandardMaterial(`previewMat_${obj.id}`, scene);
  switch (obj.cover) {
    case "full":
      mat.diffuseColor = new Color3(0.8, 0.2, 0.2); // red for full cover
      break;
    case "half":
      mat.diffuseColor = new Color3(0.8, 0.6, 0.2); // orange for half cover
      break;
    case "none":
      mat.diffuseColor = new Color3(0.5, 0.5, 0.5); // grey for no cover
      break;
  }
  mat.alpha = 0.7;
  mesh.material = mat;
  mesh.isPickable = false;

  return mesh;
}

// ============================================================================
// Light Placement
// ============================================================================

function placeLight(
  scene: Scene,
  state: EditorState,
  col: number,
  row: number,
): void {
  const key = `${col},${row}`;

  // Remove existing light at this tile
  removeLight(state, key, scene);

  const light: PlacedLight = {
    id: key,
    tile: [col, row],
    color: "#ffaa33", // default warm orange
    intensity: 2.0,
    radius: 5.0,
    height: 1.0,
    pointLight: null,
    indicatorMesh: null,
  };

  createLightVisuals(scene, light);
  state.lights.set(key, light);
}

function removeLight(state: EditorState, key: string, scene: Scene): void {
  const existing = state.lights.get(key);
  if (existing) {
    if (existing.pointLight) existing.pointLight.dispose();
    if (existing.indicatorMesh) existing.indicatorMesh.dispose();
    state.lights.delete(key);
  }
}

function createLightVisuals(scene: Scene, light: PlacedLight): void {
  const worldPos = gridToWorld(light.tile[0], light.tile[1], TILE_SIZE);

  // Create point light
  const pl = new PointLight(
    `editorLight_${light.id}`,
    new Vector3(worldPos.x, light.height, worldPos.z),
    scene,
  );

  const colorParts = hexToRGB(light.color);
  pl.diffuse = new Color3(colorParts.r, colorParts.g, colorParts.b);
  pl.intensity = light.intensity;
  pl.range = light.radius;
  light.pointLight = pl;

  // Create a small glowing sphere as indicator
  const indicator = MeshBuilder.CreateSphere(
    `lightIndicator_${light.id}`,
    { diameter: 0.3, segments: 8 },
    scene,
  );
  indicator.position = new Vector3(worldPos.x, light.height, worldPos.z);

  const mat = new StandardMaterial(`lightIndicatorMat_${light.id}`, scene);
  mat.emissiveColor = new Color3(colorParts.r, colorParts.g, colorParts.b);
  mat.diffuseColor = new Color3(0, 0, 0);
  mat.disableLighting = true;
  indicator.material = mat;
  indicator.isPickable = false;

  light.indicatorMesh = indicator;
}

// ============================================================================
// Spawn Zone Painting
// ============================================================================

function toggleSpawnZone(
  state: EditorState,
  col: number,
  row: number,
  faction: Faction,
  scene: Scene,
): void {
  const key = `${col},${row}`;

  const zoneSet = faction === "orderOfTheAbyss"
    ? state.spawnZones.orderOfTheAbyss
    : state.spawnZones.germani;

  // Toggle
  if (zoneSet.has(key)) {
    zoneSet.delete(key);
  } else {
    // Remove from other faction if present
    const otherSet = faction === "orderOfTheAbyss"
      ? state.spawnZones.germani
      : state.spawnZones.orderOfTheAbyss;
    otherSet.delete(key);
    zoneSet.add(key);
  }

  updateSpawnHighlights(scene, state);
}

// Spawn highlight meshes are created/managed here
const spawnHighlightMeshes: Mesh[] = [];

function updateSpawnHighlights(scene: Scene, state: EditorState): void {
  // Dispose existing
  for (const mesh of spawnHighlightMeshes) {
    mesh.dispose();
  }
  spawnHighlightMeshes.length = 0;

  // Create highlights for Order spawns
  for (const key of state.spawnZones.orderOfTheAbyss) {
    const parts = key.split(",");
    const col = parseInt(parts[0], 10);
    const row = parseInt(parts[1], 10);
    const worldPos = gridToWorld(col, row, state.tileSize);

    const mesh = MeshBuilder.CreatePlane(
      `spawnHighlight_order_${key}`,
      { size: state.tileSize * 0.9 },
      scene,
    );
    mesh.rotation.x = Math.PI / 2;
    mesh.position = new Vector3(worldPos.x, 0.02, worldPos.z);

    const mat = new StandardMaterial(`spawnMat_order_${key}`, scene);
    mat.diffuseColor = new Color3(0.3, 0.3, 0.9);
    mat.emissiveColor = new Color3(0.1, 0.1, 0.3);
    mat.alpha = 0.4;
    mat.backFaceCulling = false;
    mat.disableLighting = true;
    mesh.material = mat;
    mesh.isPickable = false;

    spawnHighlightMeshes.push(mesh);
  }

  // Create highlights for Germani spawns
  for (const key of state.spawnZones.germani) {
    const parts = key.split(",");
    const col = parseInt(parts[0], 10);
    const row = parseInt(parts[1], 10);
    const worldPos = gridToWorld(col, row, state.tileSize);

    const mesh = MeshBuilder.CreatePlane(
      `spawnHighlight_germani_${key}`,
      { size: state.tileSize * 0.9 },
      scene,
    );
    mesh.rotation.x = Math.PI / 2;
    mesh.position = new Vector3(worldPos.x, 0.02, worldPos.z);

    const mat = new StandardMaterial(`spawnMat_germani_${key}`, scene);
    mat.diffuseColor = new Color3(0.9, 0.3, 0.3);
    mat.emissiveColor = new Color3(0.3, 0.1, 0.1);
    mat.alpha = 0.4;
    mat.backFaceCulling = false;
    mat.disableLighting = true;
    mesh.material = mat;
    mesh.isPickable = false;

    spawnHighlightMeshes.push(mesh);
  }
}

// ============================================================================
// Utility
// ============================================================================

function hexToRGB(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return { r: 1, g: 1, b: 1 };
  return {
    r: parseInt(result[1], 16) / 255,
    g: parseInt(result[2], 16) / 255,
    b: parseInt(result[3], 16) / 255,
  };
}
