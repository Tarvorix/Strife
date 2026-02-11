// ============================================================================
// Strife — Combat System
// Ranged/melee attack resolution, LOS checking, cover calculation,
// valid target enumeration.
// ============================================================================

import type {
  UnitState,
  TileData,
  AttackResult,
  AttackModifier,
  LOSResult,
  LOSStatus,
  CoverInfo,
  CoverType,
  ValidTarget,
} from "@shared/types";

import {
  bresenhamLine,
  chebyshevDistance,
  isInBounds,
  angleBetweenTiles,
  isFlanking,
  clamp,
} from "@shared/utils";

import {
  COVER_HALF_PENALTY,
  COVER_FULL_PENALTY,
  HIGH_GROUND_BONUS,
  FLANKING_BONUS,
  MIN_HIT_CHANCE,
  MAX_HIT_CHANCE,
  FLANKING_ANGLE_THRESHOLD,
  HUNKER_COVER_MULTIPLIER,
} from "@shared/constants";

// ============================================================================
// Ranged Attack
// ============================================================================

/**
 * Resolve a ranged attack from attacker to target.
 * Checks range, LOS, cover, flanking, high ground.
 * Returns the attack result with hit/miss, damage, and modifiers.
 */
export function resolveRangedAttack(
  attacker: UnitState,
  target: UnitState,
  tiles: TileData[][],
): AttackResult {
  const modifiers: AttackModifier[] = [];
  let accuracy = attacker.stats.rangedAccuracy;

  // Check LOS
  const losResult = checkLOS(attacker.tile, target.tile, tiles);
  if (losResult.status === "blocked") {
    return {
      hit: false,
      damage: 0,
      finalAccuracy: 0,
      modifiers: [{ name: "Blocked LOS", value: 0 }],
    };
  }

  // Cover penalty
  const coverInfo = getCoverInfo(target.tile, attacker.tile, tiles);
  if (coverInfo.type !== "none") {
    let coverPenalty = coverInfo.penalty;

    // Hunker down doubles cover bonus
    if (target.hunkered) {
      coverPenalty *= HUNKER_COVER_MULTIPLIER;
      modifiers.push({ name: "Hunkered Down", value: -coverPenalty + coverInfo.penalty });
    }

    accuracy -= coverPenalty;
    modifiers.push({ name: `${coverInfo.type} Cover`, value: -coverInfo.penalty });
  }

  // LOS partial cover penalty (from tiles along the ray)
  if (losResult.status === "partial") {
    accuracy -= losResult.coverPenalty;
    modifiers.push({ name: "Partial Cover (LOS)", value: -losResult.coverPenalty });
  }

  // Flanking bonus
  const attackAngle = angleBetweenTiles(target.tile, attacker.tile);
  if (isFlanking(target.facing, attackAngle, FLANKING_ANGLE_THRESHOLD)) {
    accuracy += FLANKING_BONUS;
    modifiers.push({ name: "Flanking", value: FLANKING_BONUS });
  }

  // High ground bonus
  const attackerTile = tiles[attacker.tile[0]]?.[attacker.tile[1]];
  const targetTile = tiles[target.tile[0]]?.[target.tile[1]];
  if (attackerTile && targetTile && attackerTile.elevation > targetTile.elevation) {
    accuracy += HIGH_GROUND_BONUS;
    modifiers.push({ name: "High Ground", value: HIGH_GROUND_BONUS });
  }

  // Clamp accuracy
  accuracy = clamp(accuracy, MIN_HIT_CHANCE, MAX_HIT_CHANCE);

  // Roll
  const roll = Math.random() * 100;
  const hit = roll < accuracy;

  return {
    hit,
    damage: hit ? attacker.stats.rangedDamage : 0,
    finalAccuracy: accuracy,
    modifiers,
  };
}

// ============================================================================
// Melee Attack
// ============================================================================

/**
 * Resolve a melee attack from attacker to target.
 * Requires adjacency (Chebyshev distance <= 1).
 * No cover penalty for melee.
 */
export function resolveMeleeAttack(
  attacker: UnitState,
  target: UnitState,
): AttackResult {
  const modifiers: AttackModifier[] = [];
  let accuracy = attacker.stats.meleeAccuracy;

  // Check adjacency
  const distance = chebyshevDistance(attacker.tile, target.tile);
  if (distance > 1) {
    return {
      hit: false,
      damage: 0,
      finalAccuracy: 0,
      modifiers: [{ name: "Out of Melee Range", value: 0 }],
    };
  }

  // Flanking bonus (still applies to melee)
  const attackAngle = angleBetweenTiles(target.tile, attacker.tile);
  if (isFlanking(target.facing, attackAngle, FLANKING_ANGLE_THRESHOLD)) {
    accuracy += FLANKING_BONUS;
    modifiers.push({ name: "Flanking", value: FLANKING_BONUS });
  }

  // Clamp
  accuracy = clamp(accuracy, MIN_HIT_CHANCE, MAX_HIT_CHANCE);

  // Roll
  const roll = Math.random() * 100;
  const hit = roll < accuracy;

  return {
    hit,
    damage: hit ? attacker.stats.meleeDamage : 0,
    finalAccuracy: accuracy,
    modifiers,
  };
}

// ============================================================================
// Line of Sight
// ============================================================================

/**
 * Check line of sight from one tile to another.
 * Uses Bresenham's line to trace tiles along the ray.
 * Returns LOS status (clear, blocked, partial) and any cover penalty.
 */
export function checkLOS(
  from: [number, number],
  to: [number, number],
  tiles: TileData[][],
): LOSResult {
  const cols = tiles.length;
  const rows = cols > 0 ? tiles[0].length : 0;

  const rayTiles = bresenhamLine(from[0], from[1], to[0], to[1]);

  let maxCoverPenalty = 0;
  let status: LOSStatus = "clear";

  // Check each tile along the ray (skip start and end)
  for (let i = 1; i < rayTiles.length - 1; i++) {
    const [col, row] = rayTiles[i];

    if (!isInBounds(col, row, cols, rows)) {
      return {
        status: "blocked",
        coverPenalty: 0,
        blockedByTile: [col, row],
        tilesAlongRay: rayTiles,
      };
    }

    const tile = tiles[col][row];

    // Non-walkable tiles block LOS (walls, full cover objects occupying the tile)
    if (!tile.walkable && tile.cover === "full") {
      return {
        status: "blocked",
        coverPenalty: 0,
        blockedByTile: [col, row],
        tilesAlongRay: rayTiles,
      };
    }

    // Half cover along the ray provides partial penalty
    if (tile.cover === "half" && !tile.walkable) {
      status = "partial";
      maxCoverPenalty = Math.max(maxCoverPenalty, COVER_HALF_PENALTY / 2); // reduced penalty for passing through
    }
  }

  return {
    status,
    coverPenalty: maxCoverPenalty,
    blockedByTile: null,
    tilesAlongRay: rayTiles,
  };
}

// ============================================================================
// Cover Calculation
// ============================================================================

/**
 * Determine cover info for a target tile relative to an attacker's position.
 * Cover is directional: only counts if cover object is between attacker and target.
 */
export function getCoverInfo(
  targetTile: [number, number],
  attackerTile: [number, number],
  tiles: TileData[][],
): CoverInfo {
  const cols = tiles.length;
  const rows = cols > 0 ? tiles[0].length : 0;

  // Direction from attacker to target
  const dx = targetTile[0] - attackerTile[0];
  const dz = targetTile[1] - attackerTile[1];
  const attackAngle = Math.atan2(dz, dx);

  // Check tiles adjacent to the target that are in the direction toward the attacker
  const checkDirs: [number, number][] = [];

  // Determine which adjacent tiles to check based on attack direction
  // We check the tiles that are between the target and the attacker
  if (dx > 0) checkDirs.push([-1, 0]); // attacker is to the right, check left side
  if (dx < 0) checkDirs.push([1, 0]);  // attacker is to the left, check right side
  if (dz > 0) checkDirs.push([0, -1]); // attacker is below, check top side
  if (dz < 0) checkDirs.push([0, 1]);  // attacker is above, check bottom side
  // Diagonal directions
  if (dx > 0 && dz > 0) checkDirs.push([-1, -1]);
  if (dx > 0 && dz < 0) checkDirs.push([-1, 1]);
  if (dx < 0 && dz > 0) checkDirs.push([1, -1]);
  if (dx < 0 && dz < 0) checkDirs.push([1, 1]);

  let bestCover: CoverType = "none";
  let bestPenalty = 0;

  for (const [dc, dr] of checkDirs) {
    const adjCol = targetTile[0] + dc;
    const adjRow = targetTile[1] + dr;

    if (!isInBounds(adjCol, adjRow, cols, rows)) continue;

    const adjTile = tiles[adjCol][adjRow];

    if (adjTile.cover === "full" && !adjTile.walkable) {
      // Check if this cover is facing the right direction (for directional cover like walls)
      if (adjTile.coverDirection !== null) {
        // Directional cover: check if the wall is oriented to block this attack angle
        const wallAngle = (adjTile.coverDirection * Math.PI) / 180;
        const angleDiff = Math.abs(Math.atan2(Math.sin(attackAngle - wallAngle), Math.cos(attackAngle - wallAngle)));
        // Wall provides cover if attack comes roughly perpendicular to the wall face
        if (angleDiff < Math.PI * 0.75) {
          bestCover = "full";
          bestPenalty = COVER_FULL_PENALTY;
        }
      } else {
        // Non-directional full cover (boulder, column)
        bestCover = "full";
        bestPenalty = COVER_FULL_PENALTY;
      }
    } else if (adjTile.cover === "half" && bestCover !== "full") {
      bestCover = "half";
      bestPenalty = COVER_HALF_PENALTY;
    }
  }

  return {
    type: bestCover,
    penalty: bestPenalty,
    direction: attackAngle,
  };
}

// ============================================================================
// Valid Targets
// ============================================================================

/**
 * Get all valid ranged targets for an attacker.
 * Filters by: alive, enemy faction, in range, LOS clear or partial.
 */
export function getValidRangedTargets(
  attacker: UnitState,
  allUnits: Map<string, UnitState>,
  tiles: TileData[][],
): ValidTarget[] {
  const targets: ValidTarget[] = [];

  for (const [unitId, unit] of allUnits) {
    // Skip self, allies, dead units
    if (unit.id === attacker.id) continue;
    if (unit.faction === attacker.faction) continue;
    if (!unit.alive) continue;

    // Check range
    const distance = chebyshevDistance(attacker.tile, unit.tile);
    if (distance > attacker.stats.rangedRange) continue;

    // Check LOS
    const losResult = checkLOS(attacker.tile, unit.tile, tiles);
    if (losResult.status === "blocked") continue;

    // Calculate cover info
    const coverInfo = getCoverInfo(unit.tile, attacker.tile, tiles);

    // Calculate hit chance
    let hitChance = attacker.stats.rangedAccuracy;
    if (coverInfo.type !== "none") {
      let penalty = coverInfo.penalty;
      if (unit.hunkered) penalty *= HUNKER_COVER_MULTIPLIER;
      hitChance -= penalty;
    }
    if (losResult.status === "partial") {
      hitChance -= losResult.coverPenalty;
    }

    // Flanking
    const attackAngle = angleBetweenTiles(unit.tile, attacker.tile);
    if (isFlanking(unit.facing, attackAngle, FLANKING_ANGLE_THRESHOLD)) {
      hitChance += FLANKING_BONUS;
    }

    // High ground
    const attackerTile = tiles[attacker.tile[0]]?.[attacker.tile[1]];
    const targetTile = tiles[unit.tile[0]]?.[unit.tile[1]];
    if (attackerTile && targetTile && attackerTile.elevation > targetTile.elevation) {
      hitChance += HIGH_GROUND_BONUS;
    }

    hitChance = clamp(hitChance, MIN_HIT_CHANCE, MAX_HIT_CHANCE);

    targets.push({
      unitId: unit.id,
      tile: unit.tile,
      distance,
      hitChance,
      coverInfo,
      losResult,
    });
  }

  // Sort by hit chance (highest first), then by distance (closest first)
  targets.sort((a, b) => {
    if (b.hitChance !== a.hitChance) return b.hitChance - a.hitChance;
    return a.distance - b.distance;
  });

  return targets;
}

/**
 * Get all valid melee targets for an attacker (adjacent enemies).
 */
export function getValidMeleeTargets(
  attacker: UnitState,
  allUnits: Map<string, UnitState>,
): ValidTarget[] {
  const targets: ValidTarget[] = [];

  for (const [unitId, unit] of allUnits) {
    if (unit.id === attacker.id) continue;
    if (unit.faction === attacker.faction) continue;
    if (!unit.alive) continue;

    const distance = chebyshevDistance(attacker.tile, unit.tile);
    if (distance > 1) continue;

    let hitChance = attacker.stats.meleeAccuracy;

    // Flanking
    const attackAngle = angleBetweenTiles(unit.tile, attacker.tile);
    if (isFlanking(unit.facing, attackAngle, FLANKING_ANGLE_THRESHOLD)) {
      hitChance += FLANKING_BONUS;
    }

    hitChance = clamp(hitChance, MIN_HIT_CHANCE, MAX_HIT_CHANCE);

    targets.push({
      unitId: unit.id,
      tile: unit.tile,
      distance,
      hitChance,
      coverInfo: { type: "none", penalty: 0, direction: 0 },
      losResult: {
        status: "clear",
        coverPenalty: 0,
        blockedByTile: null,
        tilesAlongRay: [],
      },
    });
  }

  return targets;
}

/**
 * Check if any unit is adjacent (for melee) to a given tile.
 */
export function hasAdjacentEnemy(
  tile: [number, number],
  faction: string,
  allUnits: Map<string, UnitState>,
): boolean {
  for (const [, unit] of allUnits) {
    if (unit.faction === faction || !unit.alive) continue;
    if (chebyshevDistance(tile, unit.tile) <= 1) return true;
  }
  return false;
}
