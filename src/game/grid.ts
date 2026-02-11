// ============================================================================
// Strife — Grid & Terrain System
// Ground plane with PBR textures, grid overlay, tile data, tile highlighting.
// ============================================================================

import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import type { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import type { Nullable } from "@babylonjs/core/types";

import type { MapData, TileData, GridSystem, Faction, CoverType } from "@shared/types";
import { gridToWorld, isInBounds } from "@shared/utils";
import {
  TILE_SIZE,
  TEXTURE_PATH,
  TEXTURE_SUFFIXES,
  ROUGHNESS_EXTENSIONS,
  GRID_LINE_COLOR,
  GRID_LINE_ALPHA,
  GRID_LINE_Y_OFFSET,
  TILE_HIGHLIGHT_MOVE_COLOR,
  TILE_HIGHLIGHT_MOVE_ALPHA,
  TILE_HIGHLIGHT_ATTACK_COLOR,
  TILE_HIGHLIGHT_ATTACK_ALPHA,
  TILE_HIGHLIGHT_OVERWATCH_COLOR,
  TILE_HIGHLIGHT_OVERWATCH_ALPHA,
  TILE_HIGHLIGHT_POOL_SIZE,
} from "@shared/constants";

/**
 * Create the complete grid system: ground plane, grid overlay, tile data, and highlighting.
 */
export function createGrid(
  scene: Scene,
  mapData: MapData,
  shadowGenerator: Nullable<ShadowGenerator>,
): GridSystem {
  const cols = mapData.gridSize[0];
  const rows = mapData.gridSize[1];
  const tileSize = mapData.tileSize;
  const gridWidth = cols * tileSize;
  const gridHeight = rows * tileSize;

  // --- Ground Plane ---
  const ground = createGroundPlane(scene, gridWidth, gridHeight, mapData.groundTexture, shadowGenerator);

  // --- Grid Overlay Lines ---
  const gridLines = createGridOverlay(scene, cols, rows, tileSize);

  // --- Tile Data ---
  const tiles = createTileData(cols, rows, tileSize, mapData);

  // --- Tile Highlight Pool ---
  const highlightPool = createHighlightPool(scene, tileSize);

  // --- Public API ---
  function highlightTile(col: number, row: number, color: { r: number; g: number; b: number }, alpha: number): void {
    if (!isInBounds(col, row, cols, rows)) return;

    const mesh = getHighlightMesh();
    if (!mesh) return;

    const worldPos = gridToWorld(col, row, tileSize);
    mesh.position.x = worldPos.x;
    mesh.position.z = worldPos.z;
    mesh.position.y = GRID_LINE_Y_OFFSET + 0.005;
    mesh.isVisible = true;

    const mat = mesh.material as StandardMaterial;
    mat.diffuseColor = new Color3(color.r, color.g, color.b);
    mat.alpha = alpha;
  }

  function highlightTiles(tilesToHighlight: [number, number][], color: { r: number; g: number; b: number }, alpha: number): void {
    for (const [col, row] of tilesToHighlight) {
      highlightTile(col, row, color, alpha);
    }
  }

  function clearHighlights(): void {
    for (const mesh of highlightPool) {
      mesh.isVisible = false;
    }
    nextHighlightIndex = 0;
  }

  function showMovementRange(moveTiles: [number, number][]): void {
    highlightTiles(moveTiles, TILE_HIGHLIGHT_MOVE_COLOR, TILE_HIGHLIGHT_MOVE_ALPHA);
  }

  function showAttackRange(attackTiles: [number, number][]): void {
    highlightTiles(attackTiles, TILE_HIGHLIGHT_ATTACK_COLOR, TILE_HIGHLIGHT_ATTACK_ALPHA);
  }

  function showOverwatchCone(coneTiles: [number, number][]): void {
    highlightTiles(coneTiles, TILE_HIGHLIGHT_OVERWATCH_COLOR, TILE_HIGHLIGHT_OVERWATCH_ALPHA);
  }

  function getTile(col: number, row: number): TileData | null {
    if (!isInBounds(col, row, cols, rows)) return null;
    return tiles[col][row];
  }

  // --- Highlight Pool Management ---
  let nextHighlightIndex = 0;

  function getHighlightMesh(): Mesh | null {
    if (nextHighlightIndex >= highlightPool.length) return null;
    return highlightPool[nextHighlightIndex++];
  }

  return {
    ground,
    gridLines,
    tiles,
    highlightTile,
    highlightTiles,
    clearHighlights,
    showMovementRange,
    showAttackRange,
    showOverwatchCone,
    getTile,
  };
}

// ============================================================================
// Internal Implementation
// ============================================================================

/**
 * Create the ground plane mesh with PBR material using Polyhaven textures.
 */
function createGroundPlane(
  scene: Scene,
  width: number,
  height: number,
  textureName: string,
  shadowGenerator: Nullable<ShadowGenerator>,
): Mesh {
  const ground = MeshBuilder.CreateGround(
    "ground",
    {
      width: width,
      height: height,
      subdivisions: 64, // enough for displacement detail
    },
    scene,
  );

  // Position ground so tile (0,0) starts at world origin
  ground.position.x = width / 2;
  ground.position.z = height / 2;

  // PBR Material
  const mat = new PBRMaterial("groundMaterial", scene);

  const basePath = `${TEXTURE_PATH}${textureName}/`;
  const tileScale = Math.max(width, height) / 8; // tile the texture across the ground

  // Albedo/diffuse texture
  const diffuseTex = new Texture(
    `${basePath}${textureName}${TEXTURE_SUFFIXES.diffuse}`,
    scene,
  );
  diffuseTex.uScale = tileScale;
  diffuseTex.vScale = tileScale;
  mat.albedoTexture = diffuseTex;

  // Normal map
  const normalTex = new Texture(
    `${basePath}${textureName}${TEXTURE_SUFFIXES.normal}`,
    scene,
  );
  normalTex.uScale = tileScale;
  normalTex.vScale = tileScale;
  mat.bumpTexture = normalTex;
  mat.invertNormalMapX = false;
  mat.invertNormalMapY = false;

  // Roughness/metallic — roughness stored in green channel of metallic texture
  const roughExt = ROUGHNESS_EXTENSIONS[textureName] || ".png";
  const roughTex = new Texture(
    `${basePath}${textureName}${TEXTURE_SUFFIXES.roughness}${roughExt}`,
    scene,
  );
  roughTex.uScale = tileScale;
  roughTex.vScale = tileScale;
  mat.metallicTexture = roughTex;
  mat.useRoughnessFromMetallicTextureAlpha = false;
  mat.useRoughnessFromMetallicTextureGreen = true;
  mat.metallic = 0.0; // ground is not metallic
  mat.roughness = 1.0; // base roughness, modulated by texture
  mat.maxSimultaneousLights = 4; // cap for WebGPU uniform buffer limit

  // Ensure ground receives shadows
  ground.receiveShadows = true;

  ground.material = mat;

  // Add ground to shadow generator receive list (it already receives via flag)
  if (shadowGenerator) {
    // Ground doesn't cast shadows, only receives them
  }

  return ground;
}

/**
 * Create grid overlay lines on top of the ground.
 */
function createGridOverlay(
  scene: Scene,
  cols: number,
  rows: number,
  tileSize: number,
): Mesh {
  const gridWidth = cols * tileSize;
  const gridHeight = rows * tileSize;

  const lines: Vector3[][] = [];

  // Vertical lines (along Z axis)
  for (let c = 0; c <= cols; c++) {
    const x = c * tileSize;
    lines.push([
      new Vector3(x, GRID_LINE_Y_OFFSET, 0),
      new Vector3(x, GRID_LINE_Y_OFFSET, gridHeight),
    ]);
  }

  // Horizontal lines (along X axis)
  for (let r = 0; r <= rows; r++) {
    const z = r * tileSize;
    lines.push([
      new Vector3(0, GRID_LINE_Y_OFFSET, z),
      new Vector3(gridWidth, GRID_LINE_Y_OFFSET, z),
    ]);
  }

  const gridMesh = MeshBuilder.CreateLineSystem(
    "gridLines",
    { lines: lines },
    scene,
  );

  gridMesh.color = new Color3(GRID_LINE_COLOR.r, GRID_LINE_COLOR.g, GRID_LINE_COLOR.b);
  gridMesh.alpha = GRID_LINE_ALPHA;
  gridMesh.isPickable = false;
  gridMesh.isVisible = false; // hidden by default, toggled with G key

  return gridMesh;
}

/**
 * Create the 2D tile data array with all tile information.
 */
function createTileData(
  cols: number,
  rows: number,
  tileSize: number,
  mapData: MapData,
): TileData[][] {
  // Initialize all tiles
  const tiles: TileData[][] = [];

  for (let c = 0; c < cols; c++) {
    tiles[c] = [];
    for (let r = 0; r < rows; r++) {
      const worldPos = gridToWorld(c, r, tileSize);
      tiles[c][r] = {
        col: c,
        row: r,
        worldX: worldPos.x,
        worldZ: worldPos.z,
        walkable: true,
        cover: "none" as CoverType,
        coverDirection: null,
        occupant: null,
        isSpawn: null,
        elevation: 0,
        objectType: null,
      };
    }
  }

  // Mark spawn zones
  for (const [col, row] of mapData.spawnZones.orderOfTheAbyss) {
    if (isInBounds(col, row, cols, rows)) {
      tiles[col][row].isSpawn = "orderOfTheAbyss" as Faction;
    }
  }

  for (const [col, row] of mapData.spawnZones.germani) {
    if (isInBounds(col, row, cols, rows)) {
      tiles[col][row].isSpawn = "germani" as Faction;
    }
  }

  // Mark tiles occupied by cover objects
  for (const obj of mapData.objects) {
    const [col, row] = obj.tile;
    if (isInBounds(col, row, cols, rows)) {
      tiles[col][row].walkable = obj.type !== "crater"; // craters are walkable
      tiles[col][row].cover = obj.cover;
      tiles[col][row].objectType = obj.type;

      // For directional cover (ruined walls), store the rotation as cover direction
      if (obj.rotation !== undefined) {
        tiles[col][row].coverDirection = obj.rotation;
      }
    }
  }

  return tiles;
}

/**
 * Create a pool of pre-allocated tile highlight meshes.
 * These are reused via show/hide to avoid runtime allocation.
 */
function createHighlightPool(scene: Scene, tileSize: number): Mesh[] {
  const pool: Mesh[] = [];

  for (let i = 0; i < TILE_HIGHLIGHT_POOL_SIZE; i++) {
    const mesh = MeshBuilder.CreatePlane(
      `tileHighlight_${i}`,
      { size: tileSize * 0.95 }, // slightly smaller than tile to show grid lines
      scene,
    );

    // Rotate to lie flat on the XZ plane
    mesh.rotation.x = Math.PI / 2;
    mesh.isVisible = false;
    mesh.isPickable = false;

    // Create a unique material for each highlight (so colors can differ)
    const mat = new StandardMaterial(`highlightMat_${i}`, scene);
    mat.diffuseColor = new Color3(1, 1, 1);
    mat.emissiveColor = new Color3(0.2, 0.5, 1.0);
    mat.specularColor = new Color3(0, 0, 0);
    mat.alpha = 0.35;
    mat.backFaceCulling = false;
    mat.disableLighting = true;

    mesh.material = mat;

    pool.push(mesh);
  }

  return pool;
}
