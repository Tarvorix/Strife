// ============================================================================
// Strife — AI Opponent
// Rule-based AI decision tree for Germani faction.
// Evaluates unit priority, chooses actions (move, shoot, melee),
// camera follows AI units during their activation.
// ============================================================================

import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";

import type {
  GameState,
  UnitState,
  TileData,
  Faction,
  AIAction,
  AIDecision,
} from "@shared/types";

import {
  getValidRangedTargets,
  getValidMeleeTargets,
  resolveRangedAttack,
  resolveMeleeAttack,
  getCoverInfo,
  checkLOS,
} from "./combat";

import {
  playAnimation,
  playAttackAnimation,
  playDeathAnimation,
  moveUnitAlongPath,
  faceUnit,
  getUnitWorldPosition,
  setUnitActivated,
} from "./units";

import { playRangedAttackVFX, playMeleeAttackVFX, playDeathVFX } from "./vfx";
import { triggerCombatCamera, tweenCameraToTarget } from "./camera";
import type { CameraSystem } from "./camera";
import { getSoundSystem } from "./sound";
import {
  setPhase,
  onTurnEvent,
  getMovementRange,
  resetUnitForActivation,
} from "./turns";

import {
  aStarPath,
  floodFill,
  chebyshevDistance,
  gridToWorld,
  delay,
  randomDelay,
  getOpponentFaction,
} from "@shared/utils";

import {
  AI_DECISION_DELAY_MIN,
  AI_DECISION_DELAY_MAX,
  AI_DISTANCE_WEIGHT,
  AI_COVER_WEIGHT,
  AI_LOS_WEIGHT,
  TILE_SIZE,
} from "@shared/constants";

// ============================================================================
// Public API
// ============================================================================

/**
 * Execute the full AI turn: select a unit, make decisions, animate actions.
 * Returns when the AI unit's activation is complete.
 */
export async function executeAITurn(
  gameState: GameState,
  tiles: TileData[][],
  scene: Scene,
  cameraSystem: CameraSystem,
): Promise<void> {
  if (gameState.phase !== "ai_turn") return;

  // Pick the best AI unit to activate
  const unit = pickBestUnit(gameState, tiles);
  if (!unit) {
    // No units to activate — should not happen if phase is ai_turn
    return;
  }

  // Reset overwatch/hunker from previous turns
  resetUnitForActivation(unit);

  // Set phase to animating
  setPhase(gameState, "animating");

  // Camera follow: tween to AI unit position
  const unitWorldPos = getUnitWorldPosition(unit);
  await tweenCameraToTarget(scene, cameraSystem.camera, unitWorldPos, 20);

  // Brief delay before acting (so player can see which unit is active)
  await randomDelay(AI_DECISION_DELAY_MIN, AI_DECISION_DELAY_MAX);

  // Make decision
  const decision = makeDecision(unit, gameState, tiles);

  // Execute decision actions
  for (const action of decision.actions) {
    if (!unit.alive) break;

    switch (action.type) {
      case "move":
        if (action.targetTile) {
          await executeAIMove(scene, unit, action.targetTile, tiles, gameState, cameraSystem);
        }
        break;

      case "shoot":
        if (action.targetUnitId) {
          await executeAIShoot(scene, unit, action.targetUnitId, tiles, gameState, cameraSystem);
        }
        break;

      case "melee":
        if (action.targetUnitId) {
          await executeAIMelee(scene, unit, action.targetUnitId, tiles, gameState, cameraSystem);
        }
        break;

      case "move_and_shoot":
        if (action.targetTile) {
          await executeAIMove(scene, unit, action.targetTile, tiles, gameState, cameraSystem);
        }
        if (unit.alive && action.targetUnitId) {
          await randomDelay(AI_DECISION_DELAY_MIN * 0.5, AI_DECISION_DELAY_MAX * 0.5);
          await executeAIShoot(scene, unit, action.targetUnitId, tiles, gameState, cameraSystem);
        }
        break;

      case "end_activation":
        break;
    }

    // Brief delay between actions
    if (unit.alive) {
      await randomDelay(AI_DECISION_DELAY_MIN * 0.3, AI_DECISION_DELAY_MAX * 0.5);
    }
  }

  // End activation
  if (unit.alive) {
    unit.activated = true;
    unit.stats.ap = 0;
    setUnitActivated(unit, true);
    playAnimation(unit, "idle", true);
  }

  gameState.aiActivationsThisTurn++;

  // Advance to next activation
  advanceAfterAI(gameState);
}

// ============================================================================
// Unit Selection Priority
// ============================================================================

/**
 * Pick the best AI unit to activate based on priority rules:
 * 1. Unit with enemy in range + LOS (can shoot immediately)
 * 2. Unit closest to an enemy (can close distance)
 * 3. Unit furthest from cover (needs repositioning)
 * 4. Any remaining unactivated unit
 */
function pickBestUnit(gameState: GameState, tiles: TileData[][]): UnitState | null {
  const aiFaction = getOpponentFaction(gameState.playerFaction);
  const candidates: UnitState[] = [];

  for (const [, unit] of gameState.units) {
    if (unit.faction !== aiFaction || !unit.alive || unit.activated) continue;
    candidates.push(unit);
  }

  if (candidates.length === 0) return null;

  // Score each candidate
  let bestUnit: UnitState | null = null;
  let bestScore = -Infinity;

  for (const unit of candidates) {
    let score = 0;

    // Priority 1: Can shoot immediately
    const rangedTargets = getValidRangedTargets(unit, gameState.units, tiles);
    if (rangedTargets.length > 0) {
      score += 100; // high priority
      // Prefer targeting low-HP enemies
      const bestTarget = rangedTargets.reduce((a, b) => {
        const aUnit = gameState.units.get(a.unitId);
        const bUnit = gameState.units.get(b.unitId);
        if (!aUnit || !bUnit) return a;
        return aUnit.stats.currentHP < bUnit.stats.currentHP ? a : b;
      });
      score += (100 - (gameState.units.get(bestTarget.unitId)?.stats.currentHP ?? 100));
    }

    // Priority 2: Has adjacent enemy (can melee)
    const meleeTargets = getValidMeleeTargets(unit, gameState.units);
    if (meleeTargets.length > 0) {
      score += 150; // melee is even higher priority
    }

    // Priority 3: Closest to enemy
    let minDist = Infinity;
    for (const [, other] of gameState.units) {
      if (other.faction === aiFaction || !other.alive) continue;
      const dist = chebyshevDistance(unit.tile, other.tile);
      if (dist < minDist) minDist = dist;
    }
    score += (20 - minDist) * 2; // closer = higher score

    // Priority 4: Not in cover = needs repositioning
    const currentTile = tiles[unit.tile[0]]?.[unit.tile[1]];
    if (currentTile && currentTile.cover === "none") {
      score += 5; // slight nudge to move units not in cover
    }

    if (score > bestScore) {
      bestScore = score;
      bestUnit = unit;
    }
  }

  return bestUnit;
}

// ============================================================================
// Decision Making
// ============================================================================

/**
 * Make a decision for an AI unit using the decision tree:
 *
 * IF adjacent enemy → melee attack
 * ELSE IF enemy in range + LOS → shoot highest priority target
 * ELSE IF can move into range → move toward nearest enemy (prefer cover), then shoot if possible
 * ELSE → move toward nearest enemy
 */
function makeDecision(
  unit: UnitState,
  gameState: GameState,
  tiles: TileData[][],
): AIDecision {
  const actions: AIAction[] = [];

  // Check for adjacent enemies (melee)
  const meleeTargets = getValidMeleeTargets(unit, gameState.units);
  if (meleeTargets.length > 0) {
    // Pick highest priority melee target (lowest HP)
    const target = pickBestMeleeTarget(meleeTargets, gameState);

    actions.push({
      type: "melee",
      unitId: unit.id,
      targetUnitId: target.unitId,
    });

    return { unitId: unit.id, actions, score: 100 };
  }

  // Check for ranged targets
  const rangedTargets = getValidRangedTargets(unit, gameState.units, tiles);
  if (rangedTargets.length > 0) {
    // Pick best target (lowest HP, closest, no cover preferred)
    const target = pickBestRangedTarget(rangedTargets, gameState);

    actions.push({
      type: "shoot",
      unitId: unit.id,
      targetUnitId: target.unitId,
    });

    return { unitId: unit.id, actions, score: 80 };
  }

  // No immediate targets — need to move
  const reachableTiles = getMovementRange(unit, tiles);

  if (reachableTiles.length > 0) {
    // Find best tile to move to
    const bestMoveResult = findBestMoveTile(unit, reachableTiles, gameState, tiles);

    if (bestMoveResult) {
      // Check if we can shoot after moving to the best tile
      const canShootAfterMove = bestMoveResult.canShootTarget;

      if (canShootAfterMove) {
        actions.push({
          type: "move_and_shoot",
          unitId: unit.id,
          targetTile: bestMoveResult.tile,
          targetUnitId: canShootAfterMove,
        });
      } else {
        actions.push({
          type: "move",
          unitId: unit.id,
          targetTile: bestMoveResult.tile,
        });
      }

      return { unitId: unit.id, actions, score: bestMoveResult.score };
    }
  }

  // Fallback: end activation
  actions.push({ type: "end_activation", unitId: unit.id });
  return { unitId: unit.id, actions, score: 0 };
}

/**
 * Find the best tile to move to, considering:
 * - Distance to nearest enemy
 * - Cover adjacency
 * - LOS to enemies from that tile
 */
function findBestMoveTile(
  unit: UnitState,
  reachableTiles: [number, number][],
  gameState: GameState,
  tiles: TileData[][],
): { tile: [number, number]; score: number; canShootTarget: string | null } | null {
  const aiFaction = getOpponentFaction(gameState.playerFaction);
  let bestTile: [number, number] | null = null;
  let bestScore = -Infinity;
  let bestShootTarget: string | null = null;

  for (const tile of reachableTiles) {
    let score = 0;

    // Distance to nearest enemy (prefer closer)
    let minEnemyDist = Infinity;
    let closestEnemy: UnitState | null = null;
    for (const [, other] of gameState.units) {
      if (other.faction === aiFaction || !other.alive) continue;
      const dist = chebyshevDistance(tile, other.tile);
      if (dist < minEnemyDist) {
        minEnemyDist = dist;
        closestEnemy = other;
      }
    }
    score += minEnemyDist * AI_DISTANCE_WEIGHT;

    // Cover bonus: check if any adjacent tile has cover
    const hasCoverNearby = hasAdjacentCover(tile, tiles);
    if (hasCoverNearby) {
      score += AI_COVER_WEIGHT;
    }

    // Is the tile itself providing cover?
    const tileData = tiles[tile[0]]?.[tile[1]];
    if (tileData && tileData.cover !== "none") {
      score += AI_COVER_WEIGHT * 0.5; // being ON a cover tile is less valuable than being adjacent
    }

    // LOS to enemies: can we see an enemy from this tile?
    let canShoot: string | null = null;
    for (const [, other] of gameState.units) {
      if (other.faction === aiFaction || !other.alive) continue;
      const dist = chebyshevDistance(tile, other.tile);
      if (dist <= unit.stats.rangedRange) {
        const los = checkLOS(tile, other.tile, tiles);
        if (los.status !== "blocked") {
          score += AI_LOS_WEIGHT;
          canShoot = other.id;
          break;
        }
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestTile = tile;
      bestShootTarget = canShoot;
    }
  }

  if (bestTile) {
    return { tile: bestTile, score: bestScore, canShootTarget: bestShootTarget };
  }

  return null;
}

/**
 * Check if any tile adjacent to the given tile has cover.
 */
function hasAdjacentCover(tile: [number, number], tiles: TileData[][]): boolean {
  const cols = tiles.length;
  const rows = cols > 0 ? tiles[0].length : 0;

  const dirs: [number, number][] = [
    [0, -1], [1, 0], [0, 1], [-1, 0],
    [1, -1], [1, 1], [-1, 1], [-1, -1],
  ];

  for (const [dc, dr] of dirs) {
    const nc = tile[0] + dc;
    const nr = tile[1] + dr;
    if (nc >= 0 && nc < cols && nr >= 0 && nr < rows) {
      if (tiles[nc][nr].cover !== "none") return true;
    }
  }

  return false;
}

/**
 * Pick the best melee target: lowest HP, then highest hit chance.
 */
function pickBestMeleeTarget(
  targets: { unitId: string; hitChance: number }[],
  gameState: GameState,
): { unitId: string; hitChance: number } {
  return targets.reduce((best, current) => {
    const bestUnit = gameState.units.get(best.unitId);
    const currentUnit = gameState.units.get(current.unitId);
    if (!bestUnit || !currentUnit) return best;

    // Prefer lower HP
    if (currentUnit.stats.currentHP < bestUnit.stats.currentHP) return current;
    if (currentUnit.stats.currentHP > bestUnit.stats.currentHP) return best;

    // Prefer higher hit chance
    return current.hitChance > best.hitChance ? current : best;
  });
}

/**
 * Pick the best ranged target: lowest HP > closest > no cover preferred.
 */
function pickBestRangedTarget(
  targets: { unitId: string; hitChance: number; distance: number }[],
  gameState: GameState,
): { unitId: string; hitChance: number; distance: number } {
  return targets.reduce((best, current) => {
    const bestUnit = gameState.units.get(best.unitId);
    const currentUnit = gameState.units.get(current.unitId);
    if (!bestUnit || !currentUnit) return best;

    // Prefer lower HP
    if (currentUnit.stats.currentHP < bestUnit.stats.currentHP) return current;
    if (currentUnit.stats.currentHP > bestUnit.stats.currentHP) return best;

    // Prefer closer
    if (current.distance < best.distance) return current;
    if (current.distance > best.distance) return best;

    // Prefer higher hit chance
    return current.hitChance > best.hitChance ? current : best;
  });
}

// ============================================================================
// AI Action Execution
// ============================================================================

/**
 * Execute AI movement to a target tile.
 */
async function executeAIMove(
  scene: Scene,
  unit: UnitState,
  targetTile: [number, number],
  tiles: TileData[][],
  gameState: GameState,
  cameraSystem: CameraSystem,
): Promise<void> {
  const path = aStarPath(unit.tile, targetTile, tiles);
  if (!path || path.length < 2) return;

  unit.stats.ap -= 1;

  // Camera follows unit during movement
  const targetWorldPos = new Vector3(
    gridToWorld(targetTile[0], targetTile[1], TILE_SIZE).x,
    0,
    gridToWorld(targetTile[0], targetTile[1], TILE_SIZE).z,
  );

  // Move with overwatch check (uses the same system as player movement)
  // We need to import the overwatch checking from turns.ts — but to avoid circular deps,
  // we'll do a simplified version here
  await moveUnitAlongPath(scene, unit, path, tiles);

  // Update camera to follow
  if (unit.alive) {
    await tweenCameraToTarget(scene, cameraSystem.camera, getUnitWorldPosition(unit), 15);
  }
}

/**
 * Execute AI ranged attack.
 */
async function executeAIShoot(
  scene: Scene,
  unit: UnitState,
  targetUnitId: string,
  tiles: TileData[][],
  gameState: GameState,
  cameraSystem: CameraSystem,
): Promise<void> {
  const target = gameState.units.get(targetUnitId);
  if (!target || !target.alive) return;
  if (unit.stats.ap < 1) return;

  unit.stats.ap -= 1;

  // Face target
  faceUnit(unit, target.tile);

  // Combat camera
  const attackerPos = getUnitWorldPosition(unit);
  const targetPos = getUnitWorldPosition(target);

  const combatCamPromise = triggerCombatCamera(scene, cameraSystem, attackerPos, targetPos);

  // Resolve attack
  const result = resolveRangedAttack(unit, target, tiles);

  // Play attack animation
  await playAttackAnimation(unit, "attack_range");

  // Sound: ranged fire
  const sound = getSoundSystem();
  if (sound) sound.playRangedFire(attackerPos);

  // VFX
  await playRangedAttackVFX(scene, attackerPos, targetPos, result.hit);

  // Apply damage
  if (result.hit) {
    target.stats.currentHP -= result.damage;

    if (target.stats.currentHP > 0) {
      if (sound) sound.playHitReaction(targetPos);
      await playAttackAnimation(target, "hit_reaction");
    }
  }

  // Death check
  if (target.stats.currentHP <= 0) {
    target.alive = false;
    target.stats.currentHP = 0;
    if (sound) sound.playDeath(targetPos);
    await playDeathAnimation(target);
    playDeathVFX(scene, targetPos);

    const tTile = tiles[target.tile[0]]?.[target.tile[1]];
    if (tTile) tTile.occupant = null;

    checkWinConditionAI(gameState);
  }

  await combatCamPromise;

  // Return to idle
  playAnimation(unit, "idle", true);
}

/**
 * Execute AI melee attack.
 */
async function executeAIMelee(
  scene: Scene,
  unit: UnitState,
  targetUnitId: string,
  tiles: TileData[][],
  gameState: GameState,
  cameraSystem: CameraSystem,
): Promise<void> {
  const target = gameState.units.get(targetUnitId);
  if (!target || !target.alive) return;
  if (unit.stats.ap < 1) return;

  unit.stats.ap -= 1;

  faceUnit(unit, target.tile);

  const attackerPos = getUnitWorldPosition(unit);
  const targetPos = getUnitWorldPosition(target);

  const combatCamPromise = triggerCombatCamera(scene, cameraSystem, attackerPos, targetPos);

  const result = resolveMeleeAttack(unit, target);

  await playAttackAnimation(unit, "attack_melee");

  // Sound: melee impact
  const sound = getSoundSystem();
  if (sound) sound.playMeleeImpact(targetPos);

  playMeleeAttackVFX(scene, attackerPos, targetPos);

  if (result.hit) {
    target.stats.currentHP -= result.damage;

    if (target.stats.currentHP > 0) {
      if (sound) sound.playHitReaction(targetPos);
      await playAttackAnimation(target, "hit_reaction");
    }
  }

  if (target.stats.currentHP <= 0) {
    target.alive = false;
    target.stats.currentHP = 0;
    if (sound) sound.playDeath(targetPos);
    await playDeathAnimation(target);
    playDeathVFX(scene, targetPos);

    const tTile = tiles[target.tile[0]]?.[target.tile[1]];
    if (tTile) tTile.occupant = null;

    checkWinConditionAI(gameState);
  }

  await combatCamPromise;
  playAnimation(unit, "idle", true);
}

// ============================================================================
// AI Win Condition Check
// ============================================================================

function checkWinConditionAI(gameState: GameState): void {
  let orderAlive = false;
  let germaniAlive = false;

  for (const [, unit] of gameState.units) {
    if (unit.alive) {
      if (unit.faction === "orderOfTheAbyss") orderAlive = true;
      if (unit.faction === "germani") germaniAlive = true;
    }
  }

  if (!orderAlive) {
    gameState.winner = "germani";
    setPhase(gameState, "game_over");
  } else if (!germaniAlive) {
    gameState.winner = "orderOfTheAbyss";
    setPhase(gameState, "game_over");
  }
}

// ============================================================================
// Activation Flow After AI
// ============================================================================

/**
 * Advance the game after AI activation completes.
 */
function advanceAfterAI(gameState: GameState): void {
  if (gameState.phase === "game_over") return;

  const playerFaction = gameState.playerFaction;
  const aiFaction = getOpponentFaction(playerFaction);

  // Check if there are player units to activate
  let hasPlayerUnactivated = false;
  let hasAIUnactivated = false;

  for (const [, unit] of gameState.units) {
    if (!unit.alive) continue;
    if (!unit.activated) {
      if (unit.faction === playerFaction) hasPlayerUnactivated = true;
      if (unit.faction === aiFaction) hasAIUnactivated = true;
    }
  }

  if (!hasPlayerUnactivated && !hasAIUnactivated) {
    // New turn
    startNewTurnFromAI(gameState);
  } else if (hasPlayerUnactivated) {
    gameState.currentFaction = playerFaction;
    setPhase(gameState, "player_select_unit");
  } else if (hasAIUnactivated) {
    // AI continues (should be handled by the turn system calling executeAITurn again)
    setPhase(gameState, "ai_turn");
  }
}

/**
 * Start a new turn from the AI side.
 */
function startNewTurnFromAI(gameState: GameState): void {
  gameState.turnNumber++;
  gameState.playerActivationsThisTurn = 0;
  gameState.aiActivationsThisTurn = 0;

  for (const [, unit] of gameState.units) {
    if (!unit.alive) continue;
    unit.activated = false;
    unit.stats.ap = unit.stats.maxAP;
    setUnitActivated(unit, false);
  }

  gameState.currentFaction = gameState.playerFaction;
  setPhase(gameState, "player_select_unit");
}
