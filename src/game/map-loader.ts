// ============================================================================
// Strife — Map Loader
// JSON loading and validation for map data.
// ============================================================================

import type { MapData } from "@shared/types";

/**
 * Load and parse a map JSON file from the given path.
 * Validates the basic structure before returning.
 */
export async function loadMap(path: string): Promise<MapData> {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Failed to load map from "${path}": ${response.status} ${response.statusText}`);
  }

  const json = await response.json();
  return validateMapData(json);
}

/**
 * Validate the map data structure and provide defaults for optional fields.
 * Throws on invalid data.
 */
function validateMapData(data: unknown): MapData {
  if (!data || typeof data !== "object") {
    throw new Error("Map data is not an object");
  }

  const d = data as Record<string, unknown>;

  // Required fields
  if (typeof d.name !== "string") {
    throw new Error("Map data missing 'name' string field");
  }

  if (!Array.isArray(d.gridSize) || d.gridSize.length !== 2) {
    throw new Error("Map data missing 'gridSize' [cols, rows] array");
  }

  const [cols, rows] = d.gridSize as [unknown, unknown];
  if (typeof cols !== "number" || typeof rows !== "number" || cols < 1 || rows < 1) {
    throw new Error("Map data 'gridSize' must contain positive integers");
  }

  if (typeof d.tileSize !== "number" || d.tileSize <= 0) {
    throw new Error("Map data missing valid 'tileSize' number");
  }

  if (typeof d.groundTexture !== "string") {
    throw new Error("Map data missing 'groundTexture' string");
  }

  // Validate spawn zones
  if (!d.spawnZones || typeof d.spawnZones !== "object") {
    throw new Error("Map data missing 'spawnZones' object");
  }

  const spawns = d.spawnZones as Record<string, unknown>;
  if (!Array.isArray(spawns.orderOfTheAbyss)) {
    throw new Error("Map data missing 'spawnZones.orderOfTheAbyss' array");
  }
  if (!Array.isArray(spawns.germani)) {
    throw new Error("Map data missing 'spawnZones.germani' array");
  }

  // Validate each spawn coordinate
  for (const zone of [spawns.orderOfTheAbyss, spawns.germani]) {
    for (const coord of zone as unknown[]) {
      if (!Array.isArray(coord) || coord.length !== 2 ||
          typeof coord[0] !== "number" || typeof coord[1] !== "number") {
        throw new Error("Spawn zone coordinates must be [col, row] number arrays");
      }
    }
  }

  // Validate objects array
  if (!Array.isArray(d.objects)) {
    throw new Error("Map data missing 'objects' array");
  }

  const validObjectTypes = ["boulder", "column", "ruined_wall", "rock_cluster", "barricade", "crater"];
  const validCoverTypes = ["none", "half", "full"];

  for (let i = 0; i < d.objects.length; i++) {
    const obj = d.objects[i] as Record<string, unknown>;
    if (!obj || typeof obj !== "object") {
      throw new Error(`Map object at index ${i} is not an object`);
    }
    if (!validObjectTypes.includes(obj.type as string)) {
      throw new Error(`Map object at index ${i} has invalid type "${obj.type}"`);
    }
    if (!Array.isArray(obj.tile) || obj.tile.length !== 2) {
      throw new Error(`Map object at index ${i} has invalid tile coordinates`);
    }
    if (typeof obj.seed !== "number") {
      throw new Error(`Map object at index ${i} missing seed number`);
    }
    if (!validCoverTypes.includes(obj.cover as string)) {
      throw new Error(`Map object at index ${i} has invalid cover type "${obj.cover}"`);
    }
  }

  // Validate lights array
  if (!Array.isArray(d.lights)) {
    throw new Error("Map data missing 'lights' array");
  }

  for (let i = 0; i < d.lights.length; i++) {
    const light = d.lights[i] as Record<string, unknown>;
    if (!light || typeof light !== "object") {
      throw new Error(`Map light at index ${i} is not an object`);
    }
    if (light.type !== "point") {
      throw new Error(`Map light at index ${i} has invalid type "${light.type}" (only "point" supported)`);
    }
    if (!Array.isArray(light.tile) || light.tile.length !== 2) {
      throw new Error(`Map light at index ${i} has invalid tile coordinates`);
    }
    if (typeof light.color !== "string") {
      throw new Error(`Map light at index ${i} missing color string`);
    }
    if (typeof light.intensity !== "number") {
      throw new Error(`Map light at index ${i} missing intensity number`);
    }
    if (typeof light.radius !== "number") {
      throw new Error(`Map light at index ${i} missing radius number`);
    }
    if (typeof light.height !== "number") {
      throw new Error(`Map light at index ${i} missing height number`);
    }
  }

  return data as MapData;
}
