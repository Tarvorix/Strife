// ============================================================================
// Strife — Editor Export/Import
// Serialize editor state to MapData JSON. File download and upload.
// ============================================================================

import type { MapData, MapObject, MapLight, EditorState, CoverType } from "@shared/types";

/**
 * Export the editor state to a MapData JSON object.
 */
export function exportMapData(state: EditorState): MapData {
  // Collect objects
  const objects: MapObject[] = [];
  for (const [, placed] of state.objects) {
    objects.push({
      type: placed.type,
      tile: [...placed.tile] as [number, number],
      seed: placed.seed,
      scale: placed.scale,
      rotation: placed.rotation,
      cover: placed.cover,
    });
  }

  // Collect lights
  const lights: MapLight[] = [];
  for (const [, placed] of state.lights) {
    lights.push({
      type: "point",
      tile: [...placed.tile] as [number, number],
      color: placed.color,
      intensity: placed.intensity,
      radius: placed.radius,
      height: placed.height,
    });
  }

  // Collect spawn zones
  const orderSpawns: [number, number][] = [];
  for (const key of state.spawnZones.orderOfTheAbyss) {
    const parts = key.split(",");
    orderSpawns.push([parseInt(parts[0], 10), parseInt(parts[1], 10)]);
  }

  const germaniSpawns: [number, number][] = [];
  for (const key of state.spawnZones.germani) {
    const parts = key.split(",");
    germaniSpawns.push([parseInt(parts[0], 10), parseInt(parts[1], 10)]);
  }

  return {
    name: "Custom Map",
    gridSize: [state.gridCols, state.gridRows],
    tileSize: state.tileSize,
    groundTexture: state.groundTexture,
    spawnZones: {
      orderOfTheAbyss: orderSpawns,
      germani: germaniSpawns,
    },
    objects,
    lights,
  };
}

/**
 * Trigger a browser file download with the map JSON.
 */
export function downloadMapJSON(state: EditorState, filename: string = "map.json"): void {
  const mapData = exportMapData(state);
  const json = JSON.stringify(mapData, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  URL.revokeObjectURL(url);
}

/**
 * Open a file picker and import a map JSON file.
 * Returns the parsed MapData, or null if cancelled/failed.
 */
export function importMapJSON(): Promise<MapData | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.style.display = "none";

    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }

      try {
        const text = await file.text();
        const data = JSON.parse(text) as MapData;

        // Basic validation
        if (!data.name || !data.gridSize || !data.objects) {
          console.error("Invalid map JSON structure");
          resolve(null);
          return;
        }

        resolve(data);
      } catch (err) {
        console.error("Failed to parse map JSON:", err);
        resolve(null);
      } finally {
        document.body.removeChild(input);
      }
    });

    input.addEventListener("cancel", () => {
      document.body.removeChild(input);
      resolve(null);
    });

    document.body.appendChild(input);
    input.click();
  });
}

/**
 * Populate editor state from imported MapData.
 */
export function populateEditorFromMapData(state: EditorState, mapData: MapData): void {
  state.gridCols = mapData.gridSize[0];
  state.gridRows = mapData.gridSize[1];
  state.tileSize = mapData.tileSize;
  state.groundTexture = mapData.groundTexture;

  // Clear existing
  state.objects.clear();
  state.lights.clear();
  state.spawnZones.orderOfTheAbyss.clear();
  state.spawnZones.germani.clear();

  // Import objects
  for (const obj of mapData.objects) {
    const key = `${obj.tile[0]},${obj.tile[1]}`;
    state.objects.set(key, {
      id: key,
      type: obj.type,
      tile: [...obj.tile] as [number, number],
      seed: obj.seed,
      scale: obj.scale ?? 1.0,
      rotation: obj.rotation ?? 0,
      cover: obj.cover,
      previewMesh: null, // will be regenerated
    });
  }

  // Import lights
  for (const light of mapData.lights) {
    const key = `${light.tile[0]},${light.tile[1]}`;
    state.lights.set(key, {
      id: key,
      tile: [...light.tile] as [number, number],
      color: light.color,
      intensity: light.intensity,
      radius: light.radius,
      height: light.height,
      pointLight: null,
      indicatorMesh: null,
    });
  }

  // Import spawn zones
  for (const [col, row] of mapData.spawnZones.orderOfTheAbyss) {
    state.spawnZones.orderOfTheAbyss.add(`${col},${row}`);
  }
  for (const [col, row] of mapData.spawnZones.germani) {
    state.spawnZones.germani.add(`${col},${row}`);
  }
}
