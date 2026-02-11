// ============================================================================
// Strife — Complete Type Definitions
// ============================================================================

import type { TransformNode, AnimationGroup, Mesh, PointLight, AbstractMesh } from "@babylonjs/core";

// --- Map Data Types ---

export type MapObjectType = "boulder" | "column" | "ruined_wall" | "rock_cluster" | "barricade" | "crater";

export interface MapObject {
  type: MapObjectType;
  tile: [number, number]; // [col, row]
  seed: number;
  scale?: number;
  rotation?: number;
  cover: CoverType;
}

export interface MapLight {
  type: "point";
  tile: [number, number];
  color: string; // hex color string
  intensity: number;
  radius: number;
  height: number;
}

export interface MapData {
  name: string;
  gridSize: [number, number]; // [columns, rows]
  tileSize: number;
  groundTexture: string;
  spawnZones: {
    orderOfTheAbyss: [number, number][];
    germani: [number, number][];
  };
  objects: MapObject[];
  lights: MapLight[];
}

// --- Grid Types ---

export type CoverType = "none" | "half" | "full";

export interface TileData {
  col: number;
  row: number;
  worldX: number;
  worldZ: number;
  walkable: boolean;
  cover: CoverType;
  coverDirection: number | null; // angle in degrees for directional cover, null if no cover
  occupant: string | null; // unit ID or null
  isSpawn: Faction | null;
  elevation: number; // Y height, 0 for flat prototype
  objectType: MapObjectType | null; // what cover object occupies this tile
}

// --- Unit Types ---

export type Faction = "orderOfTheAbyss" | "germani";

export type AnimationName =
  | "idle"
  | "walk"
  | "run"
  | "attack_range"
  | "attack_melee"
  | "hit_reaction"
  | "death";

export interface UnitStats {
  maxHP: number;
  currentHP: number;
  ap: number;
  maxAP: number;
  movement: number; // tiles per move action
  rangedDamage: number;
  meleeDamage: number;
  rangedAccuracy: number; // base percentage 0-100
  meleeAccuracy: number; // base percentage 0-100
  rangedRange: number; // max range in tiles
}

export interface UnitVisual {
  rootMesh: TransformNode;
  meshes: AbstractMesh[];
  animations: Map<AnimationName, AnimationGroup>;
  attachedLight: PointLight | null;
  selectionIndicator: Mesh | null;
}

export interface UnitState {
  id: string;
  faction: Faction;
  unitType: string; // "acolyte" | "shock_troops"
  stats: UnitStats;
  tile: [number, number]; // [col, row]
  facing: number; // angle in radians, 0 = positive X
  activated: boolean;
  alive: boolean;
  overwatching: boolean;
  overwatchCone: [number, number][] | null; // tiles being watched, null if not overwatching
  hunkered: boolean;
  visual: UnitVisual | null;
}

// --- Combat Types ---

export interface AttackResult {
  hit: boolean;
  damage: number;
  finalAccuracy: number;
  modifiers: AttackModifier[];
}

export interface AttackModifier {
  name: string;
  value: number; // positive = bonus, negative = penalty
}

export type LOSStatus = "clear" | "blocked" | "partial";

export interface LOSResult {
  status: LOSStatus;
  coverPenalty: number; // accuracy penalty from cover (0, 25, or 50)
  blockedByTile: [number, number] | null; // which tile blocks LOS, null if not blocked
  tilesAlongRay: [number, number][]; // all tiles the LOS ray passes through
}

export interface CoverInfo {
  type: CoverType;
  penalty: number;
  direction: number; // angle from which cover protects
}

export interface ValidTarget {
  unitId: string;
  tile: [number, number];
  distance: number;
  hitChance: number;
  coverInfo: CoverInfo;
  losResult: LOSResult;
}

// --- Game State Types ---

export type GamePhase =
  | "loading"
  | "player_select_unit"
  | "player_move"
  | "player_action"
  | "ai_turn"
  | "animating"
  | "combat_cam"
  | "game_over";

export interface GameState {
  phase: GamePhase;
  turnNumber: number;
  currentFaction: Faction;
  playerFaction: Faction; // which faction the player controls
  selectedUnitId: string | null;
  units: Map<string, UnitState>;
  activationOrder: string[]; // unit IDs in activation order for current turn
  currentActivationIndex: number;
  playerActivationsThisTurn: number;
  aiActivationsThisTurn: number;
  winner: Faction | null;
}

// --- AI Types ---

export type AIActionType = "move" | "shoot" | "melee" | "move_and_shoot" | "end_activation";

export interface AIAction {
  type: AIActionType;
  unitId: string;
  targetTile?: [number, number]; // for move actions
  targetUnitId?: string; // for attack actions
}

export interface AIDecision {
  unitId: string;
  actions: AIAction[];
  score: number; // evaluation score of this decision
}

// --- Editor Types ---

export type EditorTool = "select" | "place_object" | "paint_spawn" | "place_light" | "erase";

export interface PlacedObject {
  id: string;
  type: MapObjectType;
  tile: [number, number];
  seed: number;
  scale: number;
  rotation: number;
  cover: CoverType;
  previewMesh: Mesh | null;
}

export interface PlacedLight {
  id: string;
  tile: [number, number];
  color: string;
  intensity: number;
  radius: number;
  height: number;
  pointLight: PointLight | null;
  indicatorMesh: Mesh | null;
}

export interface EditorState {
  gridCols: number;
  gridRows: number;
  tileSize: number;
  groundTexture: string;
  currentTool: EditorTool;
  selectedObjectType: MapObjectType | null;
  selectedCoverType: CoverType;
  spawnMode: Faction | null;
  objects: Map<string, PlacedObject>; // key = "col,row"
  lights: Map<string, PlacedLight>; // key = "col,row"
  spawnZones: {
    orderOfTheAbyss: Set<string>; // "col,row" keys
    germani: Set<string>;
  };
  previewMode: boolean;
}

// --- Engine Types ---

export interface EngineConfig {
  canvas: HTMLCanvasElement;
  antialias: boolean;
  maxDevicePixelRatio: number;
}

// --- Grid System Return Types ---

export interface GridSystem {
  ground: Mesh;
  gridLines: Mesh;
  tiles: TileData[][];
  highlightTile: (col: number, row: number, color: { r: number; g: number; b: number }, alpha: number) => void;
  highlightTiles: (tiles: [number, number][], color: { r: number; g: number; b: number }, alpha: number) => void;
  clearHighlights: () => void;
  showMovementRange: (tiles: [number, number][]) => void;
  showAttackRange: (tiles: [number, number][]) => void;
  showOverwatchCone: (tiles: [number, number][]) => void;
  getTile: (col: number, row: number) => TileData | null;
}

// --- Map Scene Return Types ---

export interface MapSceneData {
  gridSystem: GridSystem;
  coverMeshes: Mesh[];
  environmentLights: PointLight[];
}

// --- GUI Callback Types ---

export interface GUICallbacks {
  onShoot: () => void;
  onMelee: () => void;
  onOverwatch: () => void;
  onHunkerDown: () => void;
  onEndActivation: () => void;
  onUnitRosterClick: (unitId: string) => void;
  onPlayAgain: () => void;
}

// --- Turn System Event Types ---

export type TurnEventType =
  | "turn_start"
  | "activation_start"
  | "activation_end"
  | "phase_change"
  | "turn_end"
  | "game_over";

export interface TurnEvent {
  type: TurnEventType;
  turnNumber: number;
  faction: Faction;
  unitId?: string;
  phase?: GamePhase;
  winner?: Faction;
}

export type TurnEventCallback = (event: TurnEvent) => void;
