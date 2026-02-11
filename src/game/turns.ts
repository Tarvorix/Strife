// ============================================================================
// Strife — Turn System
// Game phase state machine, alternating activation, AP tracking,
// overwatch, hunker down, win conditions.
// ============================================================================

import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";

import type {
  GameState,
  GamePhase,
  UnitState,
  TileData,
  Faction,
  AttackResult,
  TurnEvent,
  TurnEventCallback,
  GridSystem,
} from "@shared/types";

import {
  resolveRangedAttack,
  resolveMeleeAttack,
  getValidRangedTargets,
  checkLOS,
} from "./combat";

import {
  playAnimation,
  playAttackAnimation,
  playDeathAnimation,
  moveUnitAlongPath,
  setUnitActivated,
  setUnitSelected,
  faceUnit,
  getUnitWorldPosition,
} from "./units";

import { playRangedAttackVFX, playMeleeAttackVFX, playDeathVFX, playOverwatchVFX } from "./vfx";
import { triggerCombatCamera } from "./camera";
import type { CameraSystem } from "./camera";
import { getSoundSystem } from "./sound";
import { aStarPath, floodFill, chebyshevDistance, getOpponentFaction } from "@shared/utils";

import {
  OVERWATCH_CONE_ANGLE,
  OVERWATCH_RANGE,
} from "@shared/constants";

// ============================================================================
// Turn System State & Event Management
// ============================================================================

const eventListeners: TurnEventCallback[] = [];

/**
 * Register a callback for turn events.
 */
export function onTurnEvent(callback: TurnEventCallback): void {
  eventListeners.push(callback);
}

/**
 * Remove a turn event listener.
 */
export function offTurnEvent(callback: TurnEventCallback): void {
  const idx = eventListeners.indexOf(callback);
  if (idx !== -1) eventListeners.splice(idx, 1);
}

function emitEvent(event: TurnEvent): void {
  for (const listener of eventListeners) {
    listener(event);
  }
}

// ============================================================================
// Game State Initialization
// ============================================================================

/**
 * Create the initial game state.
 */
export function initGameState(units: Map<string, UnitState>, playerFaction: Faction = "orderOfTheAbyss"): GameState {
  return {
    phase: "loading",
    turnNumber: 1,
    currentFaction: playerFaction,
    playerFaction,
    selectedUnitId: null,
    units,
    activationOrder: [],
    currentActivationIndex: 0,
    playerActivationsThisTurn: 0,
    aiActivationsThisTurn: 0,
    winner: null,
  };
}

/**
 * Start the game — transition from loading to player's first turn.
 */
export function startGame(gameState: GameState): void {
  gameState.phase = "player_select_unit";
  gameState.turnNumber = 1;
  gameState.currentFaction = gameState.playerFaction;

  emitEvent({
    type: "turn_start",
    turnNumber: 1,
    faction: gameState.playerFaction,
  });

  emitEvent({
    type: "phase_change",
    turnNumber: 1,
    faction: gameState.playerFaction,
    phase: "player_select_unit",
  });
}

// ============================================================================
// Phase Transitions
// ============================================================================

/**
 * Change the game phase and emit events.
 */
export function setPhase(gameState: GameState, phase: GamePhase): void {
  gameState.phase = phase;
  emitEvent({
    type: "phase_change",
    turnNumber: gameState.turnNumber,
    faction: gameState.currentFaction,
    phase,
  });
}

/**
 * Select a unit for activation.
 */
export function selectUnit(gameState: GameState, unitId: string): boolean {
  if (gameState.phase !== "player_select_unit") return false;

  const unit = gameState.units.get(unitId);
  if (!unit) return false;
  if (unit.faction !== gameState.playerFaction) return false;
  if (unit.activated || !unit.alive) return false;

  // Deselect previous
  if (gameState.selectedUnitId) {
    const prevUnit = gameState.units.get(gameState.selectedUnitId);
    if (prevUnit) setUnitSelected(prevUnit, false);
  }

  gameState.selectedUnitId = unitId;
  setUnitSelected(unit, true);
  setPhase(gameState, "player_move");

  emitEvent({
    type: "activation_start",
    turnNumber: gameState.turnNumber,
    faction: gameState.playerFaction,
    unitId,
  });

  return true;
}

// ============================================================================
// Player Actions
// ============================================================================

/**
 * Execute a move action: pathfind and animate the selected unit.
 * Costs 1 AP.
 */
export async function executeMove(
  gameState: GameState,
  scene: Scene,
  targetTile: [number, number],
  tiles: TileData[][],
): Promise<boolean> {
  if (gameState.phase !== "player_move") return false;
  if (!gameState.selectedUnitId) return false;

  const unit = gameState.units.get(gameState.selectedUnitId);
  if (!unit || unit.stats.ap < 1) return false;

  // Find path
  const path = aStarPath(unit.tile, targetTile, tiles);
  if (!path || path.length < 2) return false;

  // Check if path length is within movement range
  if (path.length - 1 > unit.stats.movement) return false;

  // Spend 1 AP
  unit.stats.ap -= 1;

  // Set phase to animating during movement
  setPhase(gameState, "animating");

  // Check for overwatch triggers along the path
  await moveWithOverwatchCheck(scene, unit, path, tiles, gameState);

  // After movement, transition to action phase (if unit is still alive)
  if (unit.alive) {
    if (unit.stats.ap > 0) {
      setPhase(gameState, "player_action");
    } else {
      // No AP left, end activation
      await endActivation(gameState, unit);
    }
  }

  return true;
}

/**
 * Skip movement — go directly to action phase.
 */
export function skipMovement(gameState: GameState): boolean {
  if (gameState.phase !== "player_move") return false;

  setPhase(gameState, "player_action");
  return true;
}

/**
 * Execute a ranged attack (shoot).
 * Costs 1 AP.
 */
export async function executeShoot(
  gameState: GameState,
  scene: Scene,
  targetUnitId: string,
  tiles: TileData[][],
  cameraSystem: CameraSystem,
): Promise<AttackResult | null> {
  if (gameState.phase !== "player_action") return null;
  if (!gameState.selectedUnitId) return null;

  const attacker = gameState.units.get(gameState.selectedUnitId);
  const target = gameState.units.get(targetUnitId);
  if (!attacker || !target) return null;
  if (attacker.stats.ap < 1) return null;

  // Spend AP
  attacker.stats.ap -= 1;

  // Face attacker toward target
  faceUnit(attacker, target.tile);

  // Set phase
  setPhase(gameState, "combat_cam");

  // Combat camera
  const attackerPos = getUnitWorldPosition(attacker);
  const targetPos = getUnitWorldPosition(target);

  const combatCamPromise = triggerCombatCamera(scene, cameraSystem, attackerPos, targetPos);

  // Resolve attack
  const result = resolveRangedAttack(attacker, target, tiles);

  // Play attack animation
  await playAttackAnimation(attacker, "attack_range");

  // Sound: ranged fire
  const sound = getSoundSystem();
  if (sound) sound.playRangedFire(attackerPos);

  // Play VFX
  await playRangedAttackVFX(scene, attackerPos, targetPos, result.hit);

  // Apply damage
  if (result.hit) {
    target.stats.currentHP -= result.damage;

    // Play hit reaction
    if (target.stats.currentHP > 0) {
      if (sound) sound.playHitReaction(targetPos);
      await playAttackAnimation(target, "hit_reaction");
    }
  }

  // Check for death
  if (target.stats.currentHP <= 0) {
    target.alive = false;
    target.stats.currentHP = 0;

    // Sound + animation: death
    if (sound) sound.playDeath(targetPos);
    await playDeathAnimation(target);
    playDeathVFX(scene, targetPos);

    // Clear occupant from tile
    const tTile = tiles[target.tile[0]]?.[target.tile[1]];
    if (tTile) tTile.occupant = null;

    // Check win condition
    checkWinCondition(gameState);
  }

  // Wait for combat camera to finish
  await combatCamPromise;

  // Return attacker to idle
  playAnimation(attacker, "idle", true);

  // End activation (shoot ends the activation)
  if ((gameState.phase as string) !== "game_over") {
    await endActivation(gameState, attacker);
  }

  return result;
}

/**
 * Execute a melee attack.
 * Costs 1 AP.
 */
export async function executeMelee(
  gameState: GameState,
  scene: Scene,
  targetUnitId: string,
  tiles: TileData[][],
  cameraSystem: CameraSystem,
): Promise<AttackResult | null> {
  if (gameState.phase !== "player_action") return null;
  if (!gameState.selectedUnitId) return null;

  const attacker = gameState.units.get(gameState.selectedUnitId);
  const target = gameState.units.get(targetUnitId);
  if (!attacker || !target) return null;
  if (attacker.stats.ap < 1) return null;

  // Spend AP
  attacker.stats.ap -= 1;

  // Face attacker toward target
  faceUnit(attacker, target.tile);

  setPhase(gameState, "combat_cam");

  const attackerPos = getUnitWorldPosition(attacker);
  const targetPos = getUnitWorldPosition(target);

  const combatCamPromise = triggerCombatCamera(scene, cameraSystem, attackerPos, targetPos);

  // Resolve
  const result = resolveMeleeAttack(attacker, target);

  // Play attack animation
  await playAttackAnimation(attacker, "attack_melee");

  // Sound: melee impact
  const sound = getSoundSystem();
  if (sound) sound.playMeleeImpact(targetPos);

  // VFX
  playMeleeAttackVFX(scene, attackerPos, targetPos);

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

    checkWinCondition(gameState);
  }

  await combatCamPromise;

  playAnimation(attacker, "idle", true);

  if ((gameState.phase as string) !== "game_over") {
    await endActivation(gameState, attacker);
  }

  return result;
}

/**
 * Set unit to overwatch mode.
 * Costs 1 AP. Defines a watch cone based on unit's facing direction.
 */
export function executeOverwatch(
  gameState: GameState,
  tiles: TileData[][],
): boolean {
  if (gameState.phase !== "player_action") return false;
  if (!gameState.selectedUnitId) return false;

  const unit = gameState.units.get(gameState.selectedUnitId);
  if (!unit || unit.stats.ap < 1) return false;

  // Spend AP
  unit.stats.ap -= 1;

  // Set overwatch state
  unit.overwatching = true;

  // Calculate overwatch cone tiles
  unit.overwatchCone = calculateOverwatchCone(
    unit.tile,
    unit.facing,
    OVERWATCH_RANGE,
    OVERWATCH_CONE_ANGLE,
    tiles,
  );

  // End activation after overwatch
  endActivationSync(gameState, unit);
  return true;
}

/**
 * Set unit to hunker down.
 * Costs 1 AP. Doubles cover bonus until next activation.
 */
export function executeHunkerDown(gameState: GameState): boolean {
  if (gameState.phase !== "player_action") return false;
  if (!gameState.selectedUnitId) return false;

  const unit = gameState.units.get(gameState.selectedUnitId);
  if (!unit || unit.stats.ap < 1) return false;

  unit.stats.ap -= 1;
  unit.hunkered = true;

  endActivationSync(gameState, unit);
  return true;
}

/**
 * End a unit's activation and advance to the next.
 */
export async function endActivation(gameState: GameState, unit: UnitState): Promise<void> {
  endActivationSync(gameState, unit);
}

/**
 * Synchronous version of end activation for use in non-async contexts.
 */
function endActivationSync(gameState: GameState, unit: UnitState): void {
  unit.activated = true;
  unit.stats.ap = 0;

  setUnitActivated(unit, true);
  setUnitSelected(unit, false);

  gameState.selectedUnitId = null;

  emitEvent({
    type: "activation_end",
    turnNumber: gameState.turnNumber,
    faction: unit.faction,
    unitId: unit.id,
  });

  if (unit.faction === gameState.playerFaction) {
    gameState.playerActivationsThisTurn++;
  } else {
    gameState.aiActivationsThisTurn++;
  }

  // Determine next phase
  advanceActivation(gameState);
}

/**
 * Player explicitly ends their unit's activation.
 */
export function playerEndActivation(gameState: GameState): boolean {
  if (gameState.phase !== "player_action" && gameState.phase !== "player_move") return false;
  if (!gameState.selectedUnitId) return false;

  const unit = gameState.units.get(gameState.selectedUnitId);
  if (!unit) return false;

  endActivationSync(gameState, unit);
  return true;
}

// ============================================================================
// Activation Flow
// ============================================================================

/**
 * Advance to the next activation (alternating player/AI).
 */
function advanceActivation(gameState: GameState): void {
  if (gameState.phase === "game_over") return;

  const playerFaction = gameState.playerFaction;
  const aiFaction = getOpponentFaction(playerFaction);

  const hasPlayerUnactivated = hasUnactivatedUnits(gameState, playerFaction);
  const hasAIUnactivated = hasUnactivatedUnits(gameState, aiFaction);

  if (!hasPlayerUnactivated && !hasAIUnactivated) {
    // Both sides fully activated — start new turn
    startNewTurn(gameState);
    return;
  }

  // Alternating activation
  if (gameState.currentFaction === playerFaction) {
    // Player just went, now AI's turn
    if (hasAIUnactivated) {
      gameState.currentFaction = aiFaction;
      setPhase(gameState, "ai_turn");
    } else if (hasPlayerUnactivated) {
      // AI has no units left to activate, player continues
      setPhase(gameState, "player_select_unit");
    } else {
      startNewTurn(gameState);
    }
  } else {
    // AI just went, now player's turn
    if (hasPlayerUnactivated) {
      gameState.currentFaction = playerFaction;
      setPhase(gameState, "player_select_unit");
    } else if (hasAIUnactivated) {
      // Player has no units left, AI continues
      setPhase(gameState, "ai_turn");
    } else {
      startNewTurn(gameState);
    }
  }
}

/**
 * Start a new turn — reset all activations.
 */
function startNewTurn(gameState: GameState): void {
  gameState.turnNumber++;
  gameState.playerActivationsThisTurn = 0;
  gameState.aiActivationsThisTurn = 0;

  // Reset all units
  for (const [, unit] of gameState.units) {
    if (!unit.alive) continue;

    unit.activated = false;
    unit.stats.ap = unit.stats.maxAP;

    // Clear overwatch (it persists until the unit activates again)
    // Actually overwatch persists until the unit's next activation
    // So we DON'T clear it here — it gets cleared when the unit activates

    // Clear hunker down on new activation
    // Same — hunker persists until next activation

    // Restore visual brightness
    setUnitActivated(unit, false);
  }

  emitEvent({
    type: "turn_end",
    turnNumber: gameState.turnNumber - 1,
    faction: gameState.currentFaction,
  });

  // Player always goes first
  gameState.currentFaction = gameState.playerFaction;

  emitEvent({
    type: "turn_start",
    turnNumber: gameState.turnNumber,
    faction: gameState.playerFaction,
  });

  setPhase(gameState, "player_select_unit");
}

/**
 * Check if a faction has unactivated living units.
 */
function hasUnactivatedUnits(gameState: GameState, faction: Faction): boolean {
  for (const [, unit] of gameState.units) {
    if (unit.faction === faction && unit.alive && !unit.activated) return true;
  }
  return false;
}

// ============================================================================
// Overwatch
// ============================================================================

/**
 * Calculate the overwatch cone tiles based on facing direction, range, and angle.
 */
function calculateOverwatchCone(
  fromTile: [number, number],
  facingAngle: number,
  range: number,
  coneAngleDegrees: number,
  tiles: TileData[][],
): [number, number][] {
  const cols = tiles.length;
  const rows = cols > 0 ? tiles[0].length : 0;
  const halfConeRad = (coneAngleDegrees / 2) * (Math.PI / 180);
  const coneTiles: [number, number][] = [];

  // Check all tiles within range
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      if (c === fromTile[0] && r === fromTile[1]) continue;

      const dist = chebyshevDistance(fromTile, [c, r]);
      if (dist > range) continue;

      // Check if tile is within the cone angle
      const angleTo = Math.atan2(r - fromTile[1], c - fromTile[0]);
      const angleDiff = Math.abs(Math.atan2(
        Math.sin(angleTo - facingAngle),
        Math.cos(angleTo - facingAngle),
      ));

      if (angleDiff <= halfConeRad) {
        // Also check LOS
        const los = checkLOS(fromTile, [c, r], tiles);
        if (los.status !== "blocked") {
          coneTiles.push([c, r]);
        }
      }
    }
  }

  return coneTiles;
}

/**
 * Check if moving through a path triggers any overwatch reactions.
 * If triggered, resolves the overwatch shot and may interrupt movement.
 */
async function moveWithOverwatchCheck(
  scene: Scene,
  unit: UnitState,
  path: [number, number][],
  tiles: TileData[][],
  gameState: GameState,
): Promise<void> {
  // Check for overwatch from enemy units
  const overwatchers = getOverwatchersForUnit(unit, gameState);

  if (overwatchers.length === 0) {
    // No overwatch threats, just move normally
    await moveUnitAlongPath(scene, unit, path, tiles);
    return;
  }

  // Move tile by tile, checking for overwatch triggers
  for (let i = 1; i < path.length; i++) {
    if (!unit.alive) break;

    const subPath = [path[i - 1], path[i]];

    // Move to next tile
    await moveUnitAlongPath(scene, unit, subPath, tiles);

    if (!unit.alive) break;

    // Check if any overwatcher can see this tile
    for (const overwatcher of overwatchers) {
      if (!overwatcher.overwatching || !overwatcher.overwatchCone) continue;

      // Check if the unit's new position is in the overwatch cone
      const currentTile = path[i];
      const inCone = overwatcher.overwatchCone.some(
        ([c, r]) => c === currentTile[0] && r === currentTile[1],
      );

      if (inCone) {
        // Overwatch triggered!
        const los = checkLOS(overwatcher.tile, currentTile, tiles);
        if (los.status !== "blocked") {
          // Resolve overwatch shot
          const attackResult = resolveRangedAttack(overwatcher, unit, tiles);

          // Face overwatcher toward target
          faceUnit(overwatcher, currentTile);

          // Play overwatch VFX + sound
          const overwatcherPos = getUnitWorldPosition(overwatcher);
          const unitPos = getUnitWorldPosition(unit);
          const owSound = getSoundSystem();
          if (owSound) owSound.playRangedFire(overwatcherPos);
          await playOverwatchVFX(scene, overwatcherPos, unitPos, attackResult.hit);

          // Apply damage
          if (attackResult.hit) {
            unit.stats.currentHP -= attackResult.damage;

            if (unit.stats.currentHP > 0) {
              if (owSound) owSound.playHitReaction(unitPos);
              await playAttackAnimation(unit, "hit_reaction");
            } else {
              unit.alive = false;
              unit.stats.currentHP = 0;
              if (owSound) owSound.playDeath(unitPos);
              await playDeathAnimation(unit);
              playDeathVFX(scene, unitPos);

              const tTile = tiles[unit.tile[0]]?.[unit.tile[1]];
              if (tTile) tTile.occupant = null;

              checkWinCondition(gameState);
            }
          }

          // Clear overwatch state (one shot per overwatch)
          overwatcher.overwatching = false;
          overwatcher.overwatchCone = null;

          // Return overwatcher to idle
          playAnimation(overwatcher, "idle", true);

          break; // Only one overwatch per tile step
        }
      }
    }
  }
}

/**
 * Get all enemy units that are currently on overwatch and could potentially see the given unit.
 */
function getOverwatchersForUnit(unit: UnitState, gameState: GameState): UnitState[] {
  const overwatchers: UnitState[] = [];
  for (const [, other] of gameState.units) {
    if (other.faction === unit.faction) continue;
    if (!other.alive || !other.overwatching) continue;
    overwatchers.push(other);
  }
  return overwatchers;
}

// ============================================================================
// Win Condition
// ============================================================================

/**
 * Check if one faction has been eliminated.
 */
function checkWinCondition(gameState: GameState): void {
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
    emitEvent({
      type: "game_over",
      turnNumber: gameState.turnNumber,
      faction: "germani",
      winner: "germani",
    });
  } else if (!germaniAlive) {
    gameState.winner = "orderOfTheAbyss";
    setPhase(gameState, "game_over");
    emitEvent({
      type: "game_over",
      turnNumber: gameState.turnNumber,
      faction: "orderOfTheAbyss",
      winner: "orderOfTheAbyss",
    });
  }
}

// ============================================================================
// Utility — Get Movement Range
// ============================================================================

/**
 * Get the movement range tiles for a unit.
 */
export function getMovementRange(unit: UnitState, tiles: TileData[][]): [number, number][] {
  return floodFill(unit.tile[0], unit.tile[1], unit.stats.movement, tiles, false);
}

/**
 * Reset a unit's activation state (for starting a new activation).
 * Clears overwatch and hunker from previous turn.
 */
export function resetUnitForActivation(unit: UnitState): void {
  unit.overwatching = false;
  unit.overwatchCone = null;
  unit.hunkered = false;
}
