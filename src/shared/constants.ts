// ============================================================================
// Strife — Game Constants & Configuration
// All magic numbers and configuration values in one place.
// Values taken from tactical_babylonjs.md design document sections 3-13.
// ============================================================================

// --- Grid ---
export const DEFAULT_GRID_COLS = 20;
export const DEFAULT_GRID_ROWS = 16;
export const TILE_SIZE = 2.0; // world units per tile

// --- Camera (Section 3) ---
export const CAMERA_BETA = 0.4; // ~23 degrees from vertical
export const CAMERA_ALPHA = -Math.PI / 2; // fixed rotation (facing -Z)
export const CAMERA_ORTHO_SIZE = 14; // half-width of visible area in world units
export const CAMERA_ZOOM_MIN = 6; // closest zoom (ortho half-width)
export const CAMERA_ZOOM_MAX = 24; // furthest zoom (ortho half-width)
export const CAMERA_ZOOM_SPEED = 0.5; // zoom sensitivity
export const CAMERA_PAN_SPEED = 0.15; // WASD pan speed in world units per frame
export const CAMERA_PAN_SENSIBILITY = 50; // mouse/touch pan sensitivity
export const CAMERA_PINCH_PRECISION = 50; // mobile pinch zoom precision

// Combat camera (Section 3)
export const COMBAT_CAM_ZOOM_SIZE = 4; // ortho half-width during combat zoom
export const COMBAT_CAM_TWEEN_FRAMES = 20; // frames to tween to combat view
export const COMBAT_CAM_HOLD_MS = 1500; // hold duration at combat zoom
export const COMBAT_CAM_RETURN_FRAMES = 30; // frames to return to normal view

// --- Unit Stats (Section 4, mirrored for both factions) ---
export const BASE_UNIT_STATS = {
  maxHP: 10,
  currentHP: 10,
  ap: 2,
  maxAP: 2,
  movement: 4, // tiles per move action
  rangedDamage: 4,
  meleeDamage: 5,
  rangedAccuracy: 70, // base percentage
  meleeAccuracy: 85, // base percentage
  rangedRange: 8, // tiles
} as const;

export const SQUAD_SIZE = 5; // units per faction

// --- Combat Modifiers (Section 7) ---
export const COVER_HALF_PENALTY = 25; // accuracy penalty for half cover
export const COVER_FULL_PENALTY = 50; // accuracy penalty for full cover
export const HIGH_GROUND_BONUS = 10; // accuracy bonus for elevated attacker
export const FLANKING_BONUS = 15; // accuracy bonus for side/rear attack
export const MIN_HIT_CHANCE = 5; // minimum hit chance after modifiers
export const MAX_HIT_CHANCE = 95; // maximum hit chance after modifiers
export const FLANKING_ANGLE_THRESHOLD = 90; // degrees: attacks within this angle from rear count as flanking

// --- Animation File Mappings (Section 5) ---
export const ACOLYTE_ANIMATIONS: Record<string, string> = {
  idle: "acolyte_idle",
  walk: "acolyte_walk",
  run: "acolyte_run",
  attack_range: "acolyte_attack_range",
  attack_melee: "acolyte_attack_melee",
  hit_reaction: "acolyte_hit_reaction",
  death: "acolyte_death",
} as const;

export const SHOCK_TROOP_ANIMATIONS: Record<string, string> = {
  idle: "shock_idle",
  walk: "shock_walk",
  run: "shock_run",
  attack_range: "shock_attack_range",
  attack_melee: "shock_attack_melee",
  hit_reaction: "shock_hit_reaction",
  death: "shock_death",
} as const;

// --- Asset Paths ---
const BASE = import.meta.env.BASE_URL;

export const MODEL_PATHS = {
  orderOfTheAbyss: `${BASE}models/order-of-the-abyss/acolyte/`,
  germani: `${BASE}models/germani/shock_troops/`,
} as const;

export const TEXTURE_PATH = `${BASE}textures/polyhaven/`;
export const PARTICLE_PATH = `${BASE}particles/`;

// Available ground textures (must match directories in public/textures/polyhaven/)
export const AVAILABLE_GROUND_TEXTURES = ["dirt", "rock_2", "rock_face", "sparse_grass"] as const;

// Texture file suffixes
export const TEXTURE_SUFFIXES = {
  diffuse: "_diff_4k.jpg",
  normal: "_nor_gl_4k.png",
  roughness: "_rough_4k", // extension varies: .png or .jpg
  displacement: "_disp_4k.png",
  mask: "_mask_4k.png", // only sparse_grass has this
} as const;

// Special cases for roughness file extensions (most are .png, rock_2 is .jpg)
export const ROUGHNESS_EXTENSIONS: Record<string, string> = {
  dirt: ".png",
  rock_2: ".jpg",
  rock_face: ".png",
  sparse_grass: ".png",
} as const;

// --- Mobile ---
export const MAX_DEVICE_PIXEL_RATIO = 2.0;

// --- Grid Visuals ---
export const GRID_LINE_COLOR = { r: 0.3, g: 0.35, b: 0.4 };
export const GRID_LINE_ALPHA = 0.4;
export const GRID_LINE_Y_OFFSET = 0.01; // slight elevation above ground to prevent z-fighting

export const TILE_HIGHLIGHT_MOVE_COLOR = { r: 0.2, g: 0.5, b: 1.0 }; // blue for movement range
export const TILE_HIGHLIGHT_MOVE_ALPHA = 0.35;
export const TILE_HIGHLIGHT_ATTACK_COLOR = { r: 1.0, g: 0.2, b: 0.2 }; // red for attack targets
export const TILE_HIGHLIGHT_ATTACK_ALPHA = 0.35;
export const TILE_HIGHLIGHT_OVERWATCH_COLOR = { r: 1.0, g: 0.85, b: 0.1 }; // yellow for overwatch
export const TILE_HIGHLIGHT_OVERWATCH_ALPHA = 0.25;
export const TILE_HIGHLIGHT_SELECTED_COLOR = { r: 0.1, g: 1.0, b: 0.3 }; // green for selected tile
export const TILE_HIGHLIGHT_SELECTED_ALPHA = 0.4;
export const TILE_HIGHLIGHT_SPAWN_ORDER_COLOR = { r: 0.3, g: 0.3, b: 0.8 }; // blue-ish for Order spawn
export const TILE_HIGHLIGHT_SPAWN_GERMANI_COLOR = { r: 0.8, g: 0.3, b: 0.3 }; // red-ish for Germani spawn
export const TILE_HIGHLIGHT_POOL_SIZE = 100; // pre-allocated highlight meshes

// --- Lighting (Section 13 — exact values) ---

// Key DirectionalLight
export const KEY_LIGHT_DIRECTION = { x: -1, y: -2, z: 1 };
export const KEY_LIGHT_INTENSITY = 1.5;
export const KEY_LIGHT_DIFFUSE = { r: 0.95, g: 0.85, b: 0.75 }; // warm desaturated
export const KEY_LIGHT_SPECULAR = { r: 0.9, g: 0.85, b: 0.8 };

// Shadow Generator
export const SHADOW_MAP_SIZE = 2048;
export const SHADOW_BIAS = 0.005;
export const SHADOW_NORMAL_BIAS = 0.02;

// Rim/Back DirectionalLight
export const RIM_LIGHT_DIRECTION = { x: 1, y: -1, z: -1 };
export const RIM_LIGHT_INTENSITY = 1.0;
export const RIM_LIGHT_DIFFUSE = { r: 0.6, g: 0.65, b: 0.85 }; // cool blue-white
export const RIM_LIGHT_SPECULAR = { r: 0.5, g: 0.55, b: 0.75 };

// Ambient HemisphericLight
export const AMBIENT_DIRECTION = { x: 0, y: 1, z: 0 };
export const AMBIENT_INTENSITY = 0.4;
export const AMBIENT_DIFFUSE = { r: 0.4, g: 0.42, b: 0.5 }; // cool blue-grey
export const AMBIENT_GROUND_COLOR = { r: 0.15, g: 0.12, b: 0.1 }; // warm dark brown

// Environmental point lights (map-defined)
export const MAX_ENV_LIGHTS = 6; // capped to stay under WebGPU 12-UBO-per-stage limit (3 scene + 6 env = 9)

// Scene clear color
export const SCENE_CLEAR_COLOR = { r: 0.05, g: 0.05, b: 0.07, a: 1 };

// --- Post-Processing (Section 13) ---

// SSAO2
export const SSAO_TOTAL_STRENGTH = 1.0;
export const SSAO_RADIUS = 2.0;
export const SSAO_SAMPLES = 16;
export const SSAO_RATIO = 0.5;
export const SSAO_BLUR_RATIO = 0.5;
export const SSAO_MOBILE_RATIO = 0.25;

// Bloom
export const BLOOM_THRESHOLD = 0.8;
export const BLOOM_WEIGHT = 0.3;
export const BLOOM_KERNEL = 64;
export const BLOOM_SCALE = 0.5;

// Color Grading
export const COLOR_GRADE_EXPOSURE = 0.9;
export const COLOR_GRADE_CONTRAST = 1.2;
export const COLOR_CURVES_GLOBAL_SATURATION = -25;
export const COLOR_CURVES_SHADOWS_HUE = 220;
export const COLOR_CURVES_SHADOWS_SATURATION = 30;
export const COLOR_CURVES_SHADOWS_DENSITY = 40;
export const COLOR_CURVES_HIGHLIGHTS_HUE = 40;
export const COLOR_CURVES_HIGHLIGHTS_SATURATION = 20;
export const COLOR_CURVES_HIGHLIGHTS_DENSITY = 40;

// Vignette
export const VIGNETTE_WEIGHT = 2.0;
export const VIGNETTE_STRETCH = 0.5;

// Film Grain
export const GRAIN_INTENSITY = 8;

// --- VFX (Section 11) ---

// Muzzle flash
export const MUZZLE_FLASH_INTENSITY = 5.0;
export const MUZZLE_FLASH_DECAY_FRAMES = 3;
export const MUZZLE_FLASH_PARTICLE_COUNT = 15;
export const MUZZLE_FLASH_PARTICLE_LIFETIME = 0.1; // seconds

// Tracer
export const TRACER_TRAVEL_TIME = 0.15; // seconds
export const TRACER_WIDTH = 0.05;
export const TRACER_LENGTH = 0.8;

// Impact particles
export const IMPACT_PARTICLE_COUNT = 20;
export const IMPACT_PARTICLE_LIFETIME = 0.3;
export const IMPACT_EMIT_POWER = 3.0;

// Melee VFX
export const MELEE_IMPACT_PARTICLE_COUNT = 15;
export const MELEE_SPARK_LIFETIME = 0.25;

// Death VFX
export const DEATH_DUST_PARTICLE_COUNT = 30;
export const DEATH_DUST_LIFETIME = 1.5;
export const DEATH_FADE_DELAY = 2000; // ms before body starts fading
export const DEATH_FADE_DURATION = 1000; // ms to fade out

// --- Atmospheric Particles (Section 13) ---
export const ASH_EMIT_RATE = 8; // particles per second
export const ASH_MAX_LIFETIME = 9; // seconds
export const ASH_MIN_SIZE = 0.02;
export const ASH_MAX_SIZE = 0.06;

export const DUST_EMIT_RATE = 5;
export const DUST_MAX_LIFETIME = 12;
export const DUST_MIN_SIZE = 0.01;
export const DUST_MAX_SIZE = 0.03;

export const FOG_EMIT_RATE = 3;
export const FOG_MAX_LIFETIME = 15;
export const FOG_MIN_SIZE = 1.0;
export const FOG_MAX_SIZE = 3.0;
export const FOG_MAX_Y = 0.3; // max height above ground

// --- AI (Section 12) ---
export const AI_DECISION_DELAY_MIN = 500; // ms between AI decisions
export const AI_DECISION_DELAY_MAX = 1000;
export const AI_CAMERA_TWEEN_SPEED = 30; // frames per second for camera follow

// AI tile scoring weights
export const AI_DISTANCE_WEIGHT = -1.0; // prefer closer to enemies (negative = lower distance is better)
export const AI_COVER_WEIGHT = 2.0; // prefer tiles near cover
export const AI_LOS_WEIGHT = 1.5; // prefer tiles with LOS to enemies

// --- Overwatch ---
export const OVERWATCH_CONE_ANGLE = 90; // degrees, forward-facing arc
export const OVERWATCH_RANGE = 8; // tiles, same as ranged range

// --- Hunker Down ---
export const HUNKER_COVER_MULTIPLIER = 2; // doubles cover bonus

// --- Procedural Generation (Section 8) ---

// Boulder
export const BOULDER_BASE_RADIUS = 0.6;
export const BOULDER_DISPLACEMENT_STRENGTH = 0.3;
export const BOULDER_SUBDIVISIONS = 2;

// Rock cluster
export const ROCK_CLUSTER_COUNT_MIN = 3;
export const ROCK_CLUSTER_COUNT_MAX = 5;
export const ROCK_CLUSTER_SPREAD = 0.6; // world units

// Column
export const COLUMN_BASE_RADIUS = 0.3;
export const COLUMN_MIN_HEIGHT = 1.5;
export const COLUMN_MAX_HEIGHT = 2.5;
export const COLUMN_NOISE_STRENGTH = 0.1;

// Ruined wall
export const WALL_WIDTH = 1.6;
export const WALL_HEIGHT = 1.8;
export const WALL_DEPTH = 0.3;
export const WALL_JAGGED_STRENGTH = 0.4;

// Barricade
export const BARRICADE_WIDTH = 1.4;
export const BARRICADE_HEIGHT = 0.8;
export const BARRICADE_BOX_COUNT = 3;

// Crater
export const CRATER_RADIUS = 0.8;
export const CRATER_DEPTH = 0.2;
export const CRATER_SEGMENTS = 24;

// --- GUI (Section 10) ---
export const GUI_IDEAL_WIDTH = 1920;
export const GUI_IDEAL_HEIGHT = 1080;
export const GUI_MIN_TOUCH_SIZE = 44; // minimum tap target in pixels
export const GUI_TOP_BAR_HEIGHT = 50;
export const GUI_BOTTOM_BAR_HEIGHT = 120;
export const GUI_UNIT_CARD_WIDTH = 250;
export const GUI_ACTION_BUTTON_SIZE = 80;

// HP bar colors
export const HP_BAR_HIGH_COLOR = "#22cc44"; // green, > 60%
export const HP_BAR_MED_COLOR = "#cccc22"; // yellow, 30-60%
export const HP_BAR_LOW_COLOR = "#cc2222"; // red, < 30%
export const HP_BAR_BG_COLOR = "#333333";

// Faction colors for UI
export const ORDER_FACTION_COLOR = "#4488ff"; // blue
export const GERMANI_FACTION_COLOR = "#ff4444"; // red

// Damage number animation
export const DAMAGE_NUMBER_RISE = 60; // pixels to float up
export const DAMAGE_NUMBER_DURATION = 1200; // ms

// AI turn banner
export const AI_BANNER_FADE_IN = 300; // ms
export const AI_BANNER_FADE_OUT = 300; // ms
export const AI_BANNER_HOLD = 500; // ms between fade in and first AI action

// --- Movement Animation ---
export const UNIT_MOVE_SPEED = 4.0; // world units per second (walk)
export const UNIT_RUN_SPEED = 6.0; // world units per second (run, for > 2 tiles)
export const UNIT_RUN_THRESHOLD = 2; // distance in tiles to switch from walk to run
export const UNIT_ROTATION_SPEED = 8.0; // radians per second for facing updates

// --- Selection Indicator ---
export const SELECTION_RING_DIAMETER = 1.8;
export const SELECTION_RING_THICKNESS = 0.08;
export const SELECTION_RING_COLOR = { r: 0, g: 1, b: 0.3 };
export const ACTIVATED_DIM_FACTOR = 0.5; // multiply albedo brightness for activated units
