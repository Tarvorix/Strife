// ============================================================================
// Strife — Unit System
// GLB loading, animation management (all 7 per unit), movement animation,
// unit visual state management.
// ============================================================================

import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import type { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import type { Nullable } from "@babylonjs/core/types";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";

// Register GLB/glTF loader
import "@babylonjs/loaders/glTF";

import type { MapData, TileData, UnitState, UnitVisual, Faction, AnimationName } from "@shared/types";
import { gridToWorld, generateUnitId, angleBetweenTiles, normalizeAngle, lerp } from "@shared/utils";
import {
  MODEL_PATHS,
  ACOLYTE_ANIMATIONS,
  SHOCK_TROOP_ANIMATIONS,
  BASE_UNIT_STATS,
  SQUAD_SIZE,
  SELECTION_RING_DIAMETER,
  SELECTION_RING_THICKNESS,
  SELECTION_RING_COLOR,
  ACTIVATED_DIM_FACTOR,
  UNIT_MOVE_SPEED,
  UNIT_RUN_SPEED,
  UNIT_RUN_THRESHOLD,
  UNIT_ROTATION_SPEED,
  TILE_SIZE,
} from "@shared/constants";

// ============================================================================
// Public API
// ============================================================================

/**
 * Load all units (both factions) and return their state records.
 * Each unit gets all 7 animations loaded from separate GLBs.
 */
export async function loadAllUnits(
  scene: Scene,
  mapData: MapData,
  tiles: TileData[][],
  shadowGenerator: Nullable<ShadowGenerator>,
): Promise<Map<string, UnitState>> {
  const units = new Map<string, UnitState>();

  // Load Order of the Abyss units (Acolytes)
  const orderSpawns = mapData.spawnZones.orderOfTheAbyss;
  for (let i = 0; i < SQUAD_SIZE; i++) {
    if (i >= orderSpawns.length) break;

    const unitId = generateUnitId("orderOfTheAbyss", i);
    const spawnTile = orderSpawns[i];
    const unit = await loadUnit(
      scene,
      unitId,
      "orderOfTheAbyss",
      "acolyte",
      spawnTile,
      tiles,
      shadowGenerator,
    );
    units.set(unitId, unit);
  }

  // Load Germani units (Shock Troops)
  const germaniSpawns = mapData.spawnZones.germani;
  for (let i = 0; i < SQUAD_SIZE; i++) {
    if (i >= germaniSpawns.length) break;

    const unitId = generateUnitId("germani", i);
    const spawnTile = germaniSpawns[i];
    const unit = await loadUnit(
      scene,
      unitId,
      "germani",
      "shock_troops",
      spawnTile,
      tiles,
      shadowGenerator,
    );
    units.set(unitId, unit);
  }

  return units;
}

/**
 * Play an animation on a unit. Stops any currently playing animation.
 * If loop is true, animation loops indefinitely.
 */
export function playAnimation(
  unit: UnitState,
  animName: AnimationName,
  loop: boolean = true,
): void {
  if (!unit.visual) return;

  const animGroup = unit.visual.animations.get(animName);
  if (!animGroup) {
    console.warn(`Animation "${animName}" not found for unit ${unit.id}`);
    return;
  }

  // Stop all other animations on this unit
  for (const [name, anim] of unit.visual.animations) {
    if (name !== animName && anim.isPlaying) {
      anim.stop();
    }
  }

  // Start the requested animation
  // start(loop, speedRatio, from, to, isAdditive)
  animGroup.loopAnimation = loop;
  animGroup.start(loop, 1.0, animGroup.from, animGroup.to, false);
}

/**
 * Play an attack animation (once) and return a Promise that resolves when it finishes.
 */
export function playAttackAnimation(
  unit: UnitState,
  animName: AnimationName,
): Promise<void> {
  return new Promise<void>((resolve) => {
    if (!unit.visual) {
      resolve();
      return;
    }

    const animGroup = unit.visual.animations.get(animName);
    if (!animGroup) {
      console.warn(`Animation "${animName}" not found for unit ${unit.id}`);
      resolve();
      return;
    }

    // Stop current animations
    for (const [, anim] of unit.visual.animations) {
      if (anim.isPlaying) {
        anim.stop();
      }
    }

    // Play once (not looping, not additive)
    animGroup.loopAnimation = false;
    animGroup.start(false, 1.0, animGroup.from, animGroup.to, false);

    // Resolve when animation ends
    const obs = animGroup.onAnimationGroupEndObservable.addOnce(() => {
      resolve();
    });
  });
}

/**
 * Play death animation, then dim the unit model.
 */
export async function playDeathAnimation(unit: UnitState): Promise<void> {
  await playAttackAnimation(unit, "death");

  // Dim the model to show it's dead
  if (unit.visual) {
    for (const mesh of unit.visual.meshes) {
      if (mesh.material && "albedoColor" in mesh.material) {
        const mat = mesh.material as { albedoColor: Color3 };
        mat.albedoColor = mat.albedoColor.scale(0.4);
      }
    }

    // Dim attached light
    if (unit.visual.attachedLight) {
      unit.visual.attachedLight.intensity = 0;
    }
  }
}

/**
 * Animate unit walking/running along a path (array of [col, row] tiles).
 * Updates tile occupancy at each step.
 * Returns a Promise that resolves when movement is complete.
 */
export function moveUnitAlongPath(
  scene: Scene,
  unit: UnitState,
  path: [number, number][],
  tiles: TileData[][],
): Promise<void> {
  return new Promise<void>((resolve) => {
    if (!unit.visual || path.length < 2) {
      resolve();
      return;
    }

    // Determine walk or run based on path length
    const isRunning = path.length - 1 > UNIT_RUN_THRESHOLD;
    const moveSpeed = isRunning ? UNIT_RUN_SPEED : UNIT_MOVE_SPEED;
    const animName: AnimationName = isRunning ? "run" : "walk";

    // Start movement animation
    playAnimation(unit, animName, true);

    // Clear occupant from starting tile
    const [startCol, startRow] = path[0];
    if (tiles[startCol] && tiles[startCol][startRow]) {
      tiles[startCol][startRow].occupant = null;
    }

    let currentPathIndex = 0;
    let currentPos = getWorldPosForTile(path[0]);
    let targetPos = getWorldPosForTile(path[1]);
    let segmentDistance = Vector3.Distance(currentPos, targetPos);
    let segmentTraveled = 0;

    const rootNode = unit.visual.rootMesh;

    const observer = scene.onBeforeRenderObservable.add(() => {
      const deltaTime = scene.getEngine().getDeltaTime() / 1000; // seconds
      const moveAmount = moveSpeed * deltaTime;
      segmentTraveled += moveAmount;

      // Interpolate position along current segment
      const t = Math.min(segmentTraveled / segmentDistance, 1);
      const newPos = Vector3.Lerp(currentPos, targetPos, t);
      rootNode.position.x = newPos.x;
      rootNode.position.z = newPos.z;

      // Smoothly rotate unit to face movement direction
      const dx = targetPos.x - currentPos.x;
      const dz = targetPos.z - currentPos.z;
      const targetAngle = Math.atan2(dx, dz); // atan2(x,z) for Y rotation
      const currentAngle = rootNode.rotation.y;
      const angleDiff = normalizeAngle(targetAngle - currentAngle);
      rootNode.rotation.y += angleDiff * Math.min(1, UNIT_ROTATION_SPEED * deltaTime);
      unit.facing = rootNode.rotation.y;

      // Check if we've reached the current target tile
      if (t >= 1) {
        currentPathIndex++;

        // Mark tile as occupied
        const [arriveCol, arriveRow] = path[currentPathIndex];
        // Update unit tile
        unit.tile = [arriveCol, arriveRow];

        if (currentPathIndex >= path.length - 1) {
          // Reached destination
          scene.onBeforeRenderObservable.remove(observer);

          // Set final occupancy
          if (tiles[arriveCol] && tiles[arriveCol][arriveRow]) {
            tiles[arriveCol][arriveRow].occupant = unit.id;
          }

          // Snap to exact tile center
          const finalPos = getWorldPosForTile(path[path.length - 1]);
          rootNode.position.x = finalPos.x;
          rootNode.position.z = finalPos.z;

          // Return to idle
          playAnimation(unit, "idle", true);

          // Update attached light position
          if (unit.visual!.attachedLight) {
            unit.visual!.attachedLight.position.x = finalPos.x;
            unit.visual!.attachedLight.position.z = finalPos.z;
          }

          resolve();
          return;
        }

        // Move to next segment
        currentPos = targetPos;
        targetPos = getWorldPosForTile(path[currentPathIndex + 1]);
        segmentDistance = Vector3.Distance(currentPos, targetPos);
        segmentTraveled = 0;
      }
    });
  });
}

/**
 * Set unit visual state to show activation status (dim when activated).
 */
export function setUnitActivated(unit: UnitState, activated: boolean): void {
  if (!unit.visual) return;

  for (const mesh of unit.visual.meshes) {
    if (mesh.material && "albedoColor" in mesh.material) {
      const mat = mesh.material as { albedoColor: Color3 };
      if (activated) {
        // Dim the unit
        mat.albedoColor = mat.albedoColor.scale(ACTIVATED_DIM_FACTOR);
      } else {
        // Restore brightness (scale back up)
        mat.albedoColor = mat.albedoColor.scale(1 / ACTIVATED_DIM_FACTOR);
      }
    }
  }

}

/**
 * Show or hide the selection indicator ring around a unit.
 */
export function setUnitSelected(unit: UnitState, selected: boolean): void {
  if (!unit.visual || !unit.visual.selectionIndicator) return;
  unit.visual.selectionIndicator.isVisible = selected;
}

/**
 * Rotate a unit to face a target tile.
 */
export function faceUnit(unit: UnitState, targetTile: [number, number]): void {
  if (!unit.visual) return;

  const angle = angleBetweenTiles(unit.tile, targetTile);
  // Convert from math angle (0=+X) to Babylon Y rotation (0=+Z)
  const yRotation = Math.atan2(
    targetTile[0] - unit.tile[0],
    targetTile[1] - unit.tile[1],
  );

  unit.visual.rootMesh.rotation.y = yRotation;
  unit.facing = angle;
}

/**
 * Get the world position Vector3 for a unit (at ground level).
 */
export function getUnitWorldPosition(unit: UnitState): Vector3 {
  const worldPos = gridToWorld(unit.tile[0], unit.tile[1], TILE_SIZE);
  return new Vector3(worldPos.x, 0, worldPos.z);
}

// ============================================================================
// Internal Implementation
// ============================================================================

/**
 * Load a single unit with all 7 animations.
 */
async function loadUnit(
  scene: Scene,
  unitId: string,
  faction: Faction,
  unitType: string,
  spawnTile: [number, number],
  tiles: TileData[][],
  shadowGenerator: Nullable<ShadowGenerator>,
): Promise<UnitState> {
  const modelPath = faction === "orderOfTheAbyss" ? MODEL_PATHS.orderOfTheAbyss : MODEL_PATHS.germani;
  const animMap = faction === "orderOfTheAbyss" ? ACOLYTE_ANIMATIONS : SHOCK_TROOP_ANIMATIONS;

  // Load the idle GLB as the base (gets mesh + skeleton)
  const idleFileName = `${animMap.idle}.glb`;
  const baseResult = await SceneLoader.ImportMeshAsync(
    "",
    modelPath,
    idleFileName,
    scene,
  );

  // The GLB loader creates a __root__ node (meshes[0]) whose rotationQuaternion
  // handles glTF right-handed → Babylon left-handed coordinate conversion.
  // We must NOT modify this rotation — doing so breaks model orientation.
  const glbRoot = baseResult.meshes[0];
  glbRoot.name = `${unitId}_glbRoot`;

  // Create a wrapper TransformNode for all positioning and facing.
  // The glbRoot (with its intact coordinate conversion) is a child of this wrapper.
  // All position/rotation operations go through the wrapper — never the glbRoot.
  const rootMesh = new TransformNode(unitId, scene);

  // Parent the GLB root under the wrapper
  glbRoot.parent = rootMesh;
  glbRoot.position.x = 0;
  glbRoot.position.y = 0;
  glbRoot.position.z = 0;

  // Position wrapper on spawn tile
  const worldPos = gridToWorld(spawnTile[0], spawnTile[1], TILE_SIZE);
  rootMesh.position.x = worldPos.x;
  rootMesh.position.y = 0;
  rootMesh.position.z = worldPos.z;

  // Face toward center of map (Y rotation on the wrapper only)
  const cols = tiles.length;
  const rows = tiles[0].length;
  const centerCol = cols / 2;
  const centerRow = rows / 2;
  rootMesh.rotation.y = Math.atan2(
    centerCol - spawnTile[0],
    centerRow - spawnTile[1],
  );

  // Store the idle animation group
  const animations = new Map<AnimationName, AnimationGroup>();
  if (baseResult.animationGroups.length > 0) {
    const idleAnim = baseResult.animationGroups[0];
    idleAnim.name = `${unitId}_idle`;
    animations.set("idle", idleAnim);
  }

  // Get all visible meshes (excluding the GLB root node)
  const meshes = baseResult.meshes.filter(m => m !== glbRoot) as AbstractMesh[];

  // Add meshes to shadow generator
  if (shadowGenerator) {
    for (const mesh of meshes) {
      shadowGenerator.addShadowCaster(mesh as Mesh, false);
      mesh.receiveShadows = true;
    }
  }

  // Build a name→TransformNode map from the GLB root's hierarchy (not the wrapper).
  // glTF animations target TransformNodes (not Bone objects directly).
  // Scoped to this unit's GLB hierarchy to avoid name collisions between units.
  const nodeMap = new Map<string, TransformNode>();
  const allDescendants = glbRoot.getChildTransformNodes(false);
  for (const node of allDescendants) {
    nodeMap.set(node.name, node as TransformNode);
  }

  // Load remaining 6 animations from separate GLBs
  const animNames: AnimationName[] = ["walk", "run", "attack_range", "attack_melee", "hit_reaction", "death"];

  for (const animName of animNames) {
    const fileName = `${animMap[animName]}.glb`;
    try {
      const container = await SceneLoader.LoadAssetContainerAsync(
        modelPath,
        fileName,
        scene,
      );

      if (container.animationGroups.length > 0) {
        const sourceGroup = container.animationGroups[0];

        // Create a new AnimationGroup in the scene with retargeted TransformNodes.
        // We map each container animation target to the matching node in this unit's hierarchy.
        const retargetedGroup = new AnimationGroup(`${unitId}_${animName}`, scene);

        for (const ta of sourceGroup.targetedAnimations) {
          if (ta.target && ta.target.name) {
            const matchingNode = nodeMap.get(ta.target.name);
            if (matchingNode) {
              retargetedGroup.addTargetedAnimation(ta.animation, matchingNode);
            }
          }
        }

        animations.set(animName, retargetedGroup);
      }

      // Dispose the entire container (meshes, skeletons, container animation groups).
      // Our retargeted AnimationGroup is scene-owned and independent.
      container.dispose();
    } catch (err) {
      console.warn(`Failed to load animation "${animName}" for ${unitId}:`, err);
    }
  }

  // Start idle animation
  const idleAnim = animations.get("idle");
  if (idleAnim) {
    idleAnim.loopAnimation = true;
    idleAnim.start(true);
  }

  // Unit glow handled via emissive materials (Mechanicus style), not point lights.
  // Point lights per unit exceed WebGPU's 12 uniform-buffer-per-stage limit.

  // Create selection indicator ring
  const selectionRing = createSelectionRing(scene, unitId);
  selectionRing.parent = rootMesh;
  selectionRing.position.y = 0.05;
  selectionRing.isVisible = false;

  // Mark spawn tile as occupied
  if (tiles[spawnTile[0]] && tiles[spawnTile[0]][spawnTile[1]]) {
    tiles[spawnTile[0]][spawnTile[1]].occupant = unitId;
  }

  // Build visual info
  const visual: UnitVisual = {
    rootMesh,
    meshes,
    animations,
    attachedLight: null,
    selectionIndicator: selectionRing,
  };

  // Build unit state
  const unitState: UnitState = {
    id: unitId,
    faction,
    unitType,
    stats: { ...BASE_UNIT_STATS },
    tile: spawnTile,
    facing: rootMesh.rotation.y,
    activated: false,
    alive: true,
    overwatching: false,
    overwatchCone: null,
    hunkered: false,
    visual,
  };

  return unitState;
}


/**
 * Create a selection ring (torus) mesh for indicating the selected unit.
 */
function createSelectionRing(scene: Scene, unitId: string): Mesh {
  const ring = MeshBuilder.CreateTorus(
    `${unitId}_selectionRing`,
    {
      diameter: SELECTION_RING_DIAMETER,
      thickness: SELECTION_RING_THICKNESS,
      tessellation: 32,
    },
    scene,
  );

  const mat = new StandardMaterial(`${unitId}_selectionRingMat`, scene);
  mat.emissiveColor = new Color3(
    SELECTION_RING_COLOR.r,
    SELECTION_RING_COLOR.g,
    SELECTION_RING_COLOR.b,
  );
  mat.diffuseColor = new Color3(0, 0, 0);
  mat.specularColor = new Color3(0, 0, 0);
  mat.disableLighting = true;
  mat.alpha = 0.8;
  ring.material = mat;

  ring.isPickable = false;

  return ring;
}

/**
 * Get world position Vector3 for a tile coordinate.
 */
function getWorldPosForTile(tile: [number, number]): Vector3 {
  const pos = gridToWorld(tile[0], tile[1], TILE_SIZE);
  return new Vector3(pos.x, 0, pos.z);
}
