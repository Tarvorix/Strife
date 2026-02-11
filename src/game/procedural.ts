// ============================================================================
// Strife — Procedural Cover Object Generators
// All 6 cover object types: boulder, rock cluster, column, ruined wall,
// barricade, and crater. Deterministic from seed.
// ============================================================================

import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import type { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import type { Nullable } from "@babylonjs/core/types";
import type { FloatArray } from "@babylonjs/core/types";

import type { MapData, MapObject, TileData } from "@shared/types";
import { gridToWorld, seededRandom, seededRandomRange, seededRandomInt } from "@shared/utils";
import {
  TEXTURE_PATH,
  BOULDER_BASE_RADIUS,
  BOULDER_DISPLACEMENT_STRENGTH,
  BOULDER_SUBDIVISIONS,
  ROCK_CLUSTER_COUNT_MIN,
  ROCK_CLUSTER_COUNT_MAX,
  ROCK_CLUSTER_SPREAD,
  COLUMN_BASE_RADIUS,
  COLUMN_MIN_HEIGHT,
  COLUMN_MAX_HEIGHT,
  COLUMN_NOISE_STRENGTH,
  WALL_WIDTH,
  WALL_HEIGHT,
  WALL_DEPTH,
  WALL_JAGGED_STRENGTH,
  BARRICADE_WIDTH,
  BARRICADE_HEIGHT,
  BARRICADE_BOX_COUNT,
  CRATER_RADIUS,
  CRATER_DEPTH,
  CRATER_SEGMENTS,
} from "@shared/constants";

/**
 * Generate all procedural cover objects from map data.
 * Returns the created meshes.
 */
export function generateMapObjects(
  scene: Scene,
  mapData: MapData,
  tiles: TileData[][],
  shadowGenerator: Nullable<ShadowGenerator>,
  constrainedRendering: boolean = false,
): Mesh[] {
  const rockMaterial = createRockMaterial(scene, "rock_2", constrainedRendering);
  const rockFaceMaterial = createRockMaterial(scene, "rock_face", constrainedRendering);
  const allMeshes: Mesh[] = [];

  for (const obj of mapData.objects) {
    const worldPos = gridToWorld(obj.tile[0], obj.tile[1], mapData.tileSize);
    let mesh: Mesh;

    switch (obj.type) {
      case "boulder":
        mesh = createBoulder(scene, obj, worldPos, rockMaterial);
        break;
      case "rock_cluster":
        mesh = createRockCluster(scene, obj, worldPos, rockMaterial);
        break;
      case "column":
        mesh = createColumn(scene, obj, worldPos, rockFaceMaterial);
        break;
      case "ruined_wall":
        mesh = createRuinedWall(scene, obj, worldPos, rockFaceMaterial);
        break;
      case "barricade":
        mesh = createBarricade(scene, obj, worldPos, rockMaterial);
        break;
      case "crater":
        mesh = createCrater(scene, obj, worldPos, rockMaterial);
        break;
      default:
        continue;
    }

    // Add to shadow generator
    if (shadowGenerator && obj.type !== "crater") {
      shadowGenerator.addShadowCaster(mesh, true);
    }

    mesh.receiveShadows = true;
    allMeshes.push(mesh);
  }

  return allMeshes;
}

// ============================================================================
// PBR Material Creation
// ============================================================================

/**
 * Create a PBR rock material from Polyhaven textures.
 */
function createRockMaterial(scene: Scene, textureName: string, constrainedRendering: boolean): PBRMaterial {
  const mat = new PBRMaterial(`${textureName}Material`, scene);
  const basePath = `${TEXTURE_PATH}${textureName}/`;

  // Determine file extensions
  const roughExt = textureName === "rock_2" ? ".jpg" : ".png";

  // Albedo
  const diffTex = new Texture(`${basePath}${textureName}_diff_4k.jpg`, scene, constrainedRendering);
  diffTex.uScale = 1;
  diffTex.vScale = 1;
  mat.albedoTexture = diffTex;

  if (!constrainedRendering) {
    // Normal
    const norTex = new Texture(`${basePath}${textureName}_nor_gl_4k.png`, scene, constrainedRendering);
    norTex.uScale = 1;
    norTex.vScale = 1;
    mat.bumpTexture = norTex;

    // Roughness
    const roughTex = new Texture(`${basePath}${textureName}_rough_4k${roughExt}`, scene, constrainedRendering);
    roughTex.uScale = 1;
    roughTex.vScale = 1;
    mat.metallicTexture = roughTex;
    mat.useRoughnessFromMetallicTextureAlpha = false;
    mat.useRoughnessFromMetallicTextureGreen = true;
    mat.metallic = 0.0;
    mat.roughness = 1.0;
  } else {
    mat.metallic = 0.0;
    mat.roughness = 1.0;
  }
  mat.maxSimultaneousLights = 4; // cap for WebGPU uniform buffer limit

  return mat;
}

// ============================================================================
// Boulder
// ============================================================================

/**
 * Create a displaced icosphere boulder.
 * Half or full cover depending on scale.
 */
function createBoulder(
  scene: Scene,
  obj: MapObject,
  worldPos: { x: number; z: number },
  material: PBRMaterial,
): Mesh {
  const rng = seededRandom(obj.seed);
  const scale = obj.scale ?? 1.0;

  const sphere = MeshBuilder.CreateIcoSphere(
    `boulder_${obj.tile[0]}_${obj.tile[1]}`,
    {
      radius: BOULDER_BASE_RADIUS * scale,
      subdivisions: BOULDER_SUBDIVISIONS,
      flat: false,
    },
    scene,
  );

  // Displace vertices for organic look
  displaceVertices(sphere, rng, BOULDER_DISPLACEMENT_STRENGTH * scale);

  // Non-uniform scaling for natural look
  const scaleX = 0.8 + rng() * 0.4;
  const scaleY = 0.7 + rng() * 0.6;
  const scaleZ = 0.8 + rng() * 0.4;
  sphere.scaling = new Vector3(scaleX, scaleY, scaleZ);

  // Position at tile center, sitting on ground
  sphere.position.x = worldPos.x;
  sphere.position.y = BOULDER_BASE_RADIUS * scale * scaleY * 0.6; // sink slightly into ground
  sphere.position.z = worldPos.z;

  // Random rotation
  sphere.rotation.y = rng() * Math.PI * 2;

  sphere.material = material;

  return sphere;
}

// ============================================================================
// Rock Cluster
// ============================================================================

/**
 * Create a cluster of 3-5 small displaced icospheres merged together.
 * Half cover.
 */
function createRockCluster(
  scene: Scene,
  obj: MapObject,
  worldPos: { x: number; z: number },
  material: PBRMaterial,
): Mesh {
  const rng = seededRandom(obj.seed);
  const scale = obj.scale ?? 1.0;
  const count = seededRandomInt(rng, ROCK_CLUSTER_COUNT_MIN, ROCK_CLUSTER_COUNT_MAX);

  const meshes: Mesh[] = [];

  for (let i = 0; i < count; i++) {
    const radius = (0.15 + rng() * 0.25) * scale;
    const rock = MeshBuilder.CreateIcoSphere(
      `rockCluster_${obj.tile[0]}_${obj.tile[1]}_${i}`,
      {
        radius: radius,
        subdivisions: 1,
        flat: false,
      },
      scene,
    );

    // Displace vertices
    displaceVertices(rock, rng, radius * 0.5);

    // Random position within cluster spread
    const offsetX = seededRandomRange(rng, -ROCK_CLUSTER_SPREAD, ROCK_CLUSTER_SPREAD) * scale;
    const offsetZ = seededRandomRange(rng, -ROCK_CLUSTER_SPREAD, ROCK_CLUSTER_SPREAD) * scale;
    rock.position.x = worldPos.x + offsetX;
    rock.position.y = radius * 0.6; // sit on ground
    rock.position.z = worldPos.z + offsetZ;

    // Random non-uniform scale
    rock.scaling = new Vector3(
      0.7 + rng() * 0.6,
      0.5 + rng() * 0.5,
      0.7 + rng() * 0.6,
    );

    rock.rotation.y = rng() * Math.PI * 2;
    rock.material = material;

    meshes.push(rock);
  }

  // Merge all rocks into a single mesh
  const merged = Mesh.MergeMeshes(meshes, true, true, undefined, false, true);
  if (merged) {
    merged.name = `rockCluster_${obj.tile[0]}_${obj.tile[1]}`;
    return merged;
  }

  // Fallback: return the first rock if merge fails
  return meshes[0];
}

// ============================================================================
// Column / Pillar
// ============================================================================

/**
 * Create a cylindrical column with optional broken top.
 * Full cover.
 */
function createColumn(
  scene: Scene,
  obj: MapObject,
  worldPos: { x: number; z: number },
  material: PBRMaterial,
): Mesh {
  const rng = seededRandom(obj.seed);
  const scale = obj.scale ?? 1.0;
  const height = seededRandomRange(rng, COLUMN_MIN_HEIGHT, COLUMN_MAX_HEIGHT) * scale;

  const column = MeshBuilder.CreateCylinder(
    `column_${obj.tile[0]}_${obj.tile[1]}`,
    {
      diameter: COLUMN_BASE_RADIUS * 2 * scale,
      height: height,
      tessellation: 12,
      subdivisions: 6, // enough for top displacement
    },
    scene,
  );

  // Displace top vertices for broken column look
  const positions = column.getVerticesData("position");
  if (positions) {
    const newPositions = new Float32Array(positions.length);
    for (let i = 0; i < positions.length; i += 3) {
      const y = positions[i + 1];
      newPositions[i] = positions[i];
      newPositions[i + 1] = positions[i + 1];
      newPositions[i + 2] = positions[i + 2];

      // Only displace vertices near the top
      if (y > height * 0.3) {
        const factor = (y - height * 0.3) / (height * 0.7); // 0 at bottom, 1 at top
        newPositions[i] += (rng() - 0.5) * COLUMN_NOISE_STRENGTH * factor * scale;
        newPositions[i + 1] += (rng() - 0.5) * COLUMN_NOISE_STRENGTH * factor * scale * 2;
        newPositions[i + 2] += (rng() - 0.5) * COLUMN_NOISE_STRENGTH * factor * scale;
      }
    }
    column.setVerticesData("position", newPositions);
    // Recompute normals after displacement
    const normals: Float32Array = new Float32Array(newPositions.length);
    const indices = column.getIndices();
    if (indices) {
      VertexData.ComputeNormals(newPositions, indices, normals);
      column.setVerticesData("normal", normals);
    }
  }

  // Position
  column.position.x = worldPos.x;
  column.position.y = height / 2;
  column.position.z = worldPos.z;

  // Slight random tilt for weathered look
  column.rotation.x = (rng() - 0.5) * 0.05;
  column.rotation.z = (rng() - 0.5) * 0.05;

  column.material = material;

  return column;
}

// ============================================================================
// Ruined Wall
// ============================================================================

/**
 * Create a ruined wall with jagged top edge.
 * Full cover (directional).
 */
function createRuinedWall(
  scene: Scene,
  obj: MapObject,
  worldPos: { x: number; z: number },
  material: PBRMaterial,
): Mesh {
  const rng = seededRandom(obj.seed);
  const scale = obj.scale ?? 1.0;
  const rotation = (obj.rotation ?? 0) * (Math.PI / 180); // convert degrees to radians

  const wall = MeshBuilder.CreateBox(
    `wall_${obj.tile[0]}_${obj.tile[1]}`,
    {
      width: WALL_WIDTH * scale,
      height: WALL_HEIGHT * scale,
      depth: WALL_DEPTH * scale,
      updatable: true,
    },
    scene,
  );

  // Displace top vertices for jagged broken wall look
  const positions = wall.getVerticesData("position");
  if (positions) {
    const newPositions = new Float32Array(positions.length);
    const halfHeight = (WALL_HEIGHT * scale) / 2;

    for (let i = 0; i < positions.length; i += 3) {
      newPositions[i] = positions[i];
      newPositions[i + 1] = positions[i + 1];
      newPositions[i + 2] = positions[i + 2];

      // Displace top vertices downward/upward for jagged edge
      if (positions[i + 1] > halfHeight * 0.7) {
        newPositions[i + 1] += (rng() - 0.3) * WALL_JAGGED_STRENGTH * scale; // bias downward for broken look
        newPositions[i] += (rng() - 0.5) * WALL_JAGGED_STRENGTH * scale * 0.3; // slight horizontal jag
      }
    }
    wall.setVerticesData("position", newPositions);
    const normals: Float32Array = new Float32Array(newPositions.length);
    const indices = wall.getIndices();
    if (indices) {
      VertexData.ComputeNormals(newPositions, indices, normals);
      wall.setVerticesData("normal", normals);
    }
  }

  // Position
  wall.position.x = worldPos.x;
  wall.position.y = (WALL_HEIGHT * scale) / 2;
  wall.position.z = worldPos.z;

  // Rotation
  wall.rotation.y = rotation;

  wall.material = material;

  return wall;
}

// ============================================================================
// Barricade
// ============================================================================

/**
 * Create a barricade from multiple deformed boxes stacked low and wide.
 * Half cover.
 */
function createBarricade(
  scene: Scene,
  obj: MapObject,
  worldPos: { x: number; z: number },
  material: PBRMaterial,
): Mesh {
  const rng = seededRandom(obj.seed);
  const scale = obj.scale ?? 1.0;

  const meshes: Mesh[] = [];

  for (let i = 0; i < BARRICADE_BOX_COUNT; i++) {
    const boxWidth = (BARRICADE_WIDTH / BARRICADE_BOX_COUNT + (rng() - 0.5) * 0.3) * scale;
    const boxHeight = (BARRICADE_HEIGHT * (0.6 + rng() * 0.4)) * scale;
    const boxDepth = (0.3 + rng() * 0.3) * scale;

    const box = MeshBuilder.CreateBox(
      `barricade_${obj.tile[0]}_${obj.tile[1]}_${i}`,
      {
        width: boxWidth,
        height: boxHeight,
        depth: boxDepth,
      },
      scene,
    );

    // Spread boxes along the width
    const xOffset = (i - (BARRICADE_BOX_COUNT - 1) / 2) * (BARRICADE_WIDTH * scale / BARRICADE_BOX_COUNT);
    box.position.x = worldPos.x + xOffset + (rng() - 0.5) * 0.15 * scale;
    box.position.y = boxHeight / 2;
    box.position.z = worldPos.z + (rng() - 0.5) * 0.2 * scale;

    // Slight random rotation for haphazard look
    box.rotation.y = (rng() - 0.5) * 0.3;
    box.rotation.x = (rng() - 0.5) * 0.05;
    box.rotation.z = (rng() - 0.5) * 0.05;

    box.material = material;
    meshes.push(box);
  }

  // Merge into single mesh
  const merged = Mesh.MergeMeshes(meshes, true, true, undefined, false, true);
  if (merged) {
    merged.name = `barricade_${obj.tile[0]}_${obj.tile[1]}`;
    return merged;
  }

  return meshes[0];
}

// ============================================================================
// Crater
// ============================================================================

/**
 * Create a crater depression in the ground.
 * No cover. Walkable.
 */
function createCrater(
  scene: Scene,
  obj: MapObject,
  worldPos: { x: number; z: number },
  material: PBRMaterial,
): Mesh {
  const rng = seededRandom(obj.seed);
  const scale = obj.scale ?? 1.0;

  const crater = MeshBuilder.CreateDisc(
    `crater_${obj.tile[0]}_${obj.tile[1]}`,
    {
      radius: CRATER_RADIUS * scale,
      tessellation: CRATER_SEGMENTS,
    },
    scene,
  );

  // Rotate to lay flat
  crater.rotation.x = Math.PI / 2;

  // Displace vertices to create depression shape
  const positions = crater.getVerticesData("position");
  if (positions) {
    const newPositions = new Float32Array(positions.length);
    const radius = CRATER_RADIUS * scale;

    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i];
      const y = positions[i + 1];

      // Calculate distance from center
      const distFromCenter = Math.sqrt(x * x + y * y);
      const normalizedDist = distFromCenter / radius;

      // Depression: deeper at center, flat at edges
      // Using cosine curve for smooth bowl shape
      let depression = 0;
      if (normalizedDist < 1.0) {
        depression = -CRATER_DEPTH * scale * Math.cos(normalizedDist * Math.PI / 2);
        // Add noise
        depression += (rng() - 0.5) * 0.03 * scale;
      }

      newPositions[i] = positions[i] + (rng() - 0.5) * 0.05 * scale; // slight XZ noise
      newPositions[i + 1] = positions[i + 1] + (rng() - 0.5) * 0.05 * scale;
      newPositions[i + 2] = depression; // Z becomes Y after rotation
    }
    crater.setVerticesData("position", newPositions);
    const normals: Float32Array = new Float32Array(newPositions.length);
    const indices = crater.getIndices();
    if (indices) {
      VertexData.ComputeNormals(newPositions, indices, normals);
      crater.setVerticesData("normal", normals);
    }
  }

  // Position slightly above ground to avoid z-fighting
  crater.position.x = worldPos.x;
  crater.position.y = 0.005;
  crater.position.z = worldPos.z;

  // Create a darker charred material for the crater
  const craterMat = material.clone(`craterMat_${obj.tile[0]}_${obj.tile[1]}`);
  craterMat.albedoColor = new Color3(0.15, 0.12, 0.1); // darkened, charred
  crater.material = craterMat;

  return crater;
}

// ============================================================================
// Vertex Displacement Utility
// ============================================================================

/**
 * Displace mesh vertices along their normals using seeded random noise.
 * Used for organic-looking deformations on boulders and rocks.
 */
function displaceVertices(
  mesh: Mesh,
  rng: () => number,
  strength: number,
): void {
  const positions = mesh.getVerticesData("position");
  const normals = mesh.getVerticesData("normal");

  if (!positions || !normals) return;

  const newPositions = new Float32Array(positions.length);

  for (let i = 0; i < positions.length; i += 3) {
    const displacement = (rng() - 0.5) * 2 * strength;
    newPositions[i] = positions[i] + normals[i] * displacement;
    newPositions[i + 1] = positions[i + 1] + normals[i + 1] * displacement;
    newPositions[i + 2] = positions[i + 2] + normals[i + 2] * displacement;
  }

  mesh.setVerticesData("position", newPositions);

  // Recompute normals after displacement
  const newNormals: Float32Array = new Float32Array(newPositions.length);
  const indices = mesh.getIndices();
  if (indices) {
    VertexData.ComputeNormals(newPositions, indices, newNormals);
    mesh.setVerticesData("normal", newNormals);
  }
}
