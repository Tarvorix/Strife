// ============================================================================
// Strife — Editor Palette
// Object type definitions, selection state, and preview mesh generation.
// ============================================================================

import type { MapObjectType, CoverType, Faction, EditorTool } from "@shared/types";

export interface PaletteItem {
  type: MapObjectType;
  label: string;
  defaultCover: CoverType;
  description: string;
}

/**
 * All available object types for the editor palette.
 */
export const PALETTE_ITEMS: PaletteItem[] = [
  {
    type: "boulder",
    label: "Boulder",
    defaultCover: "half",
    description: "Half cover. Natural rock formation.",
  },
  {
    type: "rock_cluster",
    label: "Rock Cluster",
    defaultCover: "half",
    description: "Half cover. Scattered rocks.",
  },
  {
    type: "column",
    label: "Column",
    defaultCover: "full",
    description: "Full cover. Ruined pillar.",
  },
  {
    type: "ruined_wall",
    label: "Ruined Wall",
    defaultCover: "full",
    description: "Full directional cover. Rotatable.",
  },
  {
    type: "barricade",
    label: "Barricade",
    defaultCover: "half",
    description: "Half cover. Stacked debris.",
  },
  {
    type: "crater",
    label: "Crater",
    defaultCover: "none",
    description: "No cover. Ground depression.",
  },
];

/**
 * Editor palette state.
 */
export interface PaletteState {
  selectedItem: PaletteItem | null;
  selectedTool: EditorTool;
  spawnFaction: Faction | null;
  currentSeed: number;
  currentScale: number;
  currentRotation: number;
  currentCover: CoverType;
}

/**
 * Create the initial palette state.
 */
export function createPaletteState(): PaletteState {
  return {
    selectedItem: null,
    selectedTool: "select",
    spawnFaction: null,
    currentSeed: Math.floor(Math.random() * 100000),
    currentScale: 1.0,
    currentRotation: 0,
    currentCover: "none",
  };
}

/**
 * Select a palette item for placement.
 */
export function selectPaletteItem(state: PaletteState, item: PaletteItem): void {
  state.selectedItem = item;
  state.selectedTool = "place_object";
  state.currentCover = item.defaultCover;
  state.currentSeed = Math.floor(Math.random() * 100000);
  state.currentScale = 1.0;
  state.currentRotation = 0;
}

/**
 * Generate a new random seed for the current selection.
 */
export function rerollSeed(state: PaletteState): void {
  state.currentSeed = Math.floor(Math.random() * 100000);
}

/**
 * Rotate the current selection by 90 degrees.
 */
export function rotateSelection(state: PaletteState): void {
  state.currentRotation = (state.currentRotation + 90) % 360;
}
