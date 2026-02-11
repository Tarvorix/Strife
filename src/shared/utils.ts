// ============================================================================
// Strife — Utility Functions
// Grid math, pathfinding (A*), LOS (Bresenham), seeded RNG, helpers.
// ============================================================================

import { TILE_SIZE } from "./constants";
import type { TileData, Faction } from "./types";

// --- Faction Helpers ---

/**
 * Get the opposing faction.
 */
export function getOpponentFaction(faction: Faction): Faction {
  return faction === "orderOfTheAbyss" ? "germani" : "orderOfTheAbyss";
}

// --- Coordinate Conversion ---

/**
 * Convert grid coordinates (col, row) to world position (x, z).
 * Grid origin (0,0) maps to the corner of the ground plane.
 * World position is at the center of the tile.
 */
export function gridToWorld(
  col: number,
  row: number,
  tileSize: number = TILE_SIZE,
): { x: number; z: number } {
  return {
    x: col * tileSize + tileSize / 2,
    z: row * tileSize + tileSize / 2,
  };
}

/**
 * Convert world position to the nearest grid coordinates.
 */
export function worldToGrid(
  x: number,
  z: number,
  tileSize: number = TILE_SIZE,
): { col: number; row: number } {
  return {
    col: Math.floor(x / tileSize),
    row: Math.floor(z / tileSize),
  };
}

// --- Bounds & Distance ---

/**
 * Check if grid coordinates are within bounds.
 */
export function isInBounds(
  col: number,
  row: number,
  cols: number,
  rows: number,
): boolean {
  return col >= 0 && col < cols && row >= 0 && row < rows;
}

/**
 * Manhattan distance between two tiles.
 */
export function manhattanDistance(
  a: [number, number],
  b: [number, number],
): number {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
}

/**
 * Chebyshev distance (allows diagonal movement, diagonals cost 1).
 * This is the standard distance metric for 8-directional grid movement.
 */
export function chebyshevDistance(
  a: [number, number],
  b: [number, number],
): number {
  return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
}

/**
 * Euclidean distance between two tiles (for scoring, not movement).
 */
export function euclideanDistance(
  a: [number, number],
  b: [number, number],
): number {
  const dx = a[0] - b[0];
  const dz = a[1] - b[1];
  return Math.sqrt(dx * dx + dz * dz);
}

// --- Math Helpers ---

/**
 * Clamp a value between min and max.
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Linear interpolation between two values.
 */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Normalize an angle to the range [-PI, PI].
 */
export function normalizeAngle(angle: number): number {
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
}

// --- Color Parsing ---

/**
 * Parse hex color string to RGB [0..1] components.
 */
export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return { r: 1, g: 1, b: 1 };
  return {
    r: parseInt(result[1], 16) / 255,
    g: parseInt(result[2], 16) / 255,
    b: parseInt(result[3], 16) / 255,
  };
}

// --- ID Generation ---

/**
 * Generate a unique ID for units.
 */
export function generateUnitId(faction: string, index: number): string {
  return `${faction}_unit_${index}`;
}

/**
 * Generate a tile key string for use as Map/Set keys.
 */
export function tileKey(col: number, row: number): string {
  return `${col},${row}`;
}

/**
 * Parse a tile key back to coordinates.
 */
export function parseTileKey(key: string): [number, number] {
  const parts = key.split(",");
  return [parseInt(parts[0], 10), parseInt(parts[1], 10)];
}

// --- Seeded Random Number Generator ---

/**
 * Simple seeded PRNG using mulberry32 algorithm.
 * Returns a function that produces deterministic random numbers [0, 1).
 */
export function seededRandom(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Seeded random float in range [min, max).
 */
export function seededRandomRange(
  rng: () => number,
  min: number,
  max: number,
): number {
  return min + rng() * (max - min);
}

/**
 * Seeded random integer in range [min, max] (inclusive).
 */
export function seededRandomInt(
  rng: () => number,
  min: number,
  max: number,
): number {
  return Math.floor(min + rng() * (max - min + 1));
}

// --- Bresenham's Line Algorithm (for LOS) ---

/**
 * Compute all grid tiles along a line from (x0, y0) to (x1, y1).
 * Uses Bresenham's line algorithm for efficient grid traversal.
 * Returns array of [col, row] coordinates.
 */
export function bresenhamLine(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): [number, number][] {
  const tiles: [number, number][] = [];

  let dx = Math.abs(x1 - x0);
  let dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;

  let cx = x0;
  let cy = y0;

  while (true) {
    tiles.push([cx, cy]);

    if (cx === x1 && cy === y1) break;

    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      cx += sx;
    }
    if (e2 < dx) {
      err += dx;
      cy += sy;
    }
  }

  return tiles;
}

// --- BFS Flood Fill (for Movement Range) ---

/**
 * BFS flood fill from a starting tile, returning all reachable tiles
 * within maxSteps movement. Respects walkability and occupancy.
 *
 * @param startCol Starting column
 * @param startRow Starting row
 * @param maxSteps Maximum movement distance
 * @param tiles 2D tile data array
 * @param ignoreOccupants If true, treat occupied tiles as passable (for pathfinding display)
 * @returns Array of reachable [col, row] tiles (excluding the start tile)
 */
export function floodFill(
  startCol: number,
  startRow: number,
  maxSteps: number,
  tiles: TileData[][],
  ignoreOccupants: boolean = false,
): [number, number][] {
  const cols = tiles.length;
  if (cols === 0) return [];
  const rows = tiles[0].length;

  const reachable: [number, number][] = [];
  const visited = new Set<string>();
  const queue: { col: number; row: number; steps: number }[] = [];

  visited.add(tileKey(startCol, startRow));
  queue.push({ col: startCol, row: startRow, steps: 0 });

  while (queue.length > 0) {
    const current = queue.shift()!;

    if (current.steps > 0) {
      reachable.push([current.col, current.row]);
    }

    if (current.steps >= maxSteps) continue;

    // Check all 8 neighbors (including diagonals)
    for (const [dc, dr] of EIGHT_DIRECTIONS) {
      const nc = current.col + dc;
      const nr = current.row + dr;
      const key = tileKey(nc, nr);

      if (visited.has(key)) continue;
      if (!isInBounds(nc, nr, cols, rows)) continue;

      const tile = tiles[nc][nr];
      if (!tile.walkable) continue;
      if (!ignoreOccupants && tile.occupant !== null) continue;

      visited.add(key);
      queue.push({ col: nc, row: nr, steps: current.steps + 1 });
    }
  }

  return reachable;
}

// --- A* Pathfinding ---

interface AStarNode {
  col: number;
  row: number;
  g: number; // cost from start
  h: number; // heuristic to goal
  f: number; // total cost (g + h)
  parent: AStarNode | null;
}

/**
 * A* pathfinding on the square grid.
 * Returns the shortest path as an array of [col, row] coordinates
 * (including start and end), or null if no path exists.
 *
 * Uses Chebyshev distance as heuristic (consistent with 8-directional movement).
 * Diagonal movement costs the same as cardinal movement (1 step).
 */
export function aStarPath(
  start: [number, number],
  end: [number, number],
  tiles: TileData[][],
): [number, number][] | null {
  const cols = tiles.length;
  if (cols === 0) return null;
  const rows = tiles[0].length;

  if (!isInBounds(start[0], start[1], cols, rows)) return null;
  if (!isInBounds(end[0], end[1], cols, rows)) return null;

  const endTile = tiles[end[0]][end[1]];
  if (!endTile.walkable) return null;

  const openSet: AStarNode[] = [];
  const closedSet = new Set<string>();
  const gScores = new Map<string, number>();

  const startH = chebyshevDistance(start, end); // no cross-product bias for start (it's 0)
  const startNode: AStarNode = {
    col: start[0],
    row: start[1],
    g: 0,
    h: startH,
    f: startH,
    parent: null,
  };

  openSet.push(startNode);
  gScores.set(tileKey(start[0], start[1]), 0);

  while (openSet.length > 0) {
    // Find node with lowest f cost
    let lowestIdx = 0;
    for (let i = 1; i < openSet.length; i++) {
      if (
        openSet[i].f < openSet[lowestIdx].f ||
        (openSet[i].f === openSet[lowestIdx].f &&
          openSet[i].h < openSet[lowestIdx].h)
      ) {
        lowestIdx = i;
      }
    }
    const current = openSet[lowestIdx];

    // Reached the goal
    if (current.col === end[0] && current.row === end[1]) {
      const path: [number, number][] = [];
      let node: AStarNode | null = current;
      while (node) {
        path.unshift([node.col, node.row]);
        node = node.parent;
      }
      return path;
    }

    // Move current from open to closed
    openSet.splice(lowestIdx, 1);
    closedSet.add(tileKey(current.col, current.row));

    // Check all 8 neighbors
    for (const [dc, dr] of EIGHT_DIRECTIONS) {
      const nc = current.col + dc;
      const nr = current.row + dr;
      const nKey = tileKey(nc, nr);

      if (closedSet.has(nKey)) continue;
      if (!isInBounds(nc, nr, cols, rows)) continue;

      const neighborTile = tiles[nc][nr];
      if (!neighborTile.walkable) continue;
      // Allow moving to the destination even if occupied (unit might be the target)
      if (
        neighborTile.occupant !== null &&
        !(nc === end[0] && nr === end[1])
      ) {
        continue;
      }

      // Diagonal movement check: prevent cutting through unwalkable corners
      if (dc !== 0 && dr !== 0) {
        const adjCol = tiles[current.col + dc]?.[current.row];
        const adjRow = tiles[current.col]?.[current.row + dr];
        if (
          (adjCol && !adjCol.walkable) ||
          (adjRow && !adjRow.walkable)
        ) {
          continue; // can't cut through diagonal wall corners
        }
      }

      const tentativeG = current.g + 1; // uniform cost for all directions
      const existingG = gScores.get(nKey);

      if (existingG !== undefined && tentativeG >= existingG) continue;

      // Cross-product tie-breaker: when multiple shortest paths exist,
      // prefer the one closest to the straight line from start to end.
      // This prevents zigzag paths (e.g., diagonal-then-diagonal-back)
      // when a straight cardinal path has the same Chebyshev cost.
      const dx1 = nc - end[0];
      const dy1 = nr - end[1];
      const dx2 = start[0] - end[0];
      const dy2 = start[1] - end[1];
      const cross = Math.abs(dx1 * dy2 - dx2 * dy1);
      const h = chebyshevDistance([nc, nr], end) + cross * 0.001;

      const neighborNode: AStarNode = {
        col: nc,
        row: nr,
        g: tentativeG,
        h: h,
        f: tentativeG + h,
        parent: current,
      };

      gScores.set(nKey, tentativeG);

      // Check if already in open set
      const existingIdx = openSet.findIndex(
        (n) => n.col === nc && n.row === nr,
      );
      if (existingIdx !== -1) {
        openSet[existingIdx] = neighborNode;
      } else {
        openSet.push(neighborNode);
      }
    }
  }

  return null; // no path found
}

// --- Neighbor Lookup ---

/**
 * 8-directional neighbor offsets (including diagonals).
 * [deltaCol, deltaRow]
 */
export const EIGHT_DIRECTIONS: [number, number][] = [
  [0, -1], // N
  [1, -1], // NE
  [1, 0], // E
  [1, 1], // SE
  [0, 1], // S
  [-1, 1], // SW
  [-1, 0], // W
  [-1, -1], // NW
];

/**
 * 4-directional neighbor offsets (cardinal only).
 */
export const FOUR_DIRECTIONS: [number, number][] = [
  [0, -1], // N
  [1, 0], // E
  [0, 1], // S
  [-1, 0], // W
];

/**
 * Get all valid adjacent tiles (8 directions).
 */
export function getAdjacentTiles(
  col: number,
  row: number,
  cols: number,
  rows: number,
): [number, number][] {
  const neighbors: [number, number][] = [];
  for (const [dc, dr] of EIGHT_DIRECTIONS) {
    const nc = col + dc;
    const nr = row + dr;
    if (isInBounds(nc, nr, cols, rows)) {
      neighbors.push([nc, nr]);
    }
  }
  return neighbors;
}

// --- Angle Calculations ---

/**
 * Calculate the angle from one tile to another (in radians).
 * 0 = positive X direction, PI/2 = positive Z, etc.
 */
export function angleBetweenTiles(
  from: [number, number],
  to: [number, number],
): number {
  const dx = to[0] - from[0];
  const dz = to[1] - from[1];
  return Math.atan2(dz, dx);
}

/**
 * Check if an attack angle qualifies as flanking.
 * Flanking occurs when the attacker is attacking from the side or rear
 * of the defender (relative to the defender's facing direction).
 *
 * @param defenderFacing Defender's facing angle in radians
 * @param attackAngle Angle from defender to attacker in radians
 * @param threshold Flanking threshold in degrees (default 90 = attacks from behind ±90° of rear)
 * @returns true if the attack is flanking
 */
export function isFlanking(
  defenderFacing: number,
  attackAngle: number,
  threshold: number = 90,
): boolean {
  // Rear direction is opposite to facing
  const rearAngle = defenderFacing + Math.PI;
  const angleDiff = Math.abs(normalizeAngle(attackAngle - rearAngle));
  const thresholdRad = (threshold * Math.PI) / 180;
  return angleDiff <= thresholdRad;
}

// --- Promise Utility ---

/**
 * Create a promise that resolves after a given delay.
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Create a promise that resolves after a random delay in range [minMs, maxMs].
 */
export function randomDelay(minMs: number, maxMs: number): Promise<void> {
  const ms = minMs + Math.random() * (maxMs - minMs);
  return new Promise((resolve) => setTimeout(resolve, ms));
}
