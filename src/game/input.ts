// ============================================================================
// Strife — Input System
// Pointer events (tile picking, unit picking), phase-dependent input handling.
// Camera input (WASD, scroll, drag) is handled by camera.ts.
// ============================================================================

import { PointerEventTypes } from "@babylonjs/core/Events/pointerEvents";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";

import type { GameState, UnitState, TileData, GridSystem, ValidTarget } from "@shared/types";
import { worldToGrid, isInBounds, chebyshevDistance } from "@shared/utils";
import {
  selectUnit,
  executeMove,
  executeShoot,
  executeMelee,
  executeOverwatch,
  executeHunkerDown,
  playerEndActivation,
  skipMovement,
  getMovementRange,
  resetUnitForActivation,
  setPhase,
} from "./turns";
import { setUnitSelected, getUnitWorldPosition } from "./units";
import { getValidRangedTargets, getValidMeleeTargets } from "./combat";
import type { CameraSystem } from "./camera";
import { TILE_SIZE } from "@shared/constants";

export interface InputSystem {
  dispose: () => void;
  setGUICallbacks: (callbacks: InputGUICallbacks) => void;
}

export interface InputGUICallbacks {
  onUnitSelected: (unit: UnitState, movementRange: [number, number][]) => void;
  onUnitDeselected: () => void;
  onMovePhase: (unit: UnitState, movementRange: [number, number][]) => void;
  onActionPhase: (
    unit: UnitState,
    rangedTargets: ValidTarget[],
    meleeTargets: ValidTarget[],
  ) => void;
  onAttackResult: (result: { hit: boolean; damage: number; targetId: string }) => void;
  onPhaseChange: (phase: string) => void;
  showDamageNumber: (position: Vector3, damage: number, hit: boolean) => void;
}

/**
 * Set up the complete input handling system.
 * Processes pointer events and dispatches to the appropriate game action
 * based on the current game phase.
 *
 * Tap detection uses POINTERDOWN / POINTERUP on scene.onPointerObservable
 * with manual threshold + multi-touch tracking.  This avoids Babylon.js's
 * POINTERTAP which is unreliable on mobile because the camera's
 * ArcRotateCameraPointersInput processes single-touch events and the
 * engine's internal _isPointerSwiping / _skipPointerTap /
 * _isMultiTouchGesture conditions can silently suppress the event.
 */
export function setupInput(
  scene: Scene,
  gameState: GameState,
  gridSystem: GridSystem,
  cameraSystem: CameraSystem,
): InputSystem {
  let guiCallbacks: InputGUICallbacks | null = null;

  // Track movement range for current selection
  let currentMovementRange: [number, number][] = [];
  let currentRangedTargets: ValidTarget[] = [];
  let currentMeleeTargets: ValidTarget[] = [];

  // ---- Tap handler (called when POINTERUP is detected as a tap) ----
  function handleTap(): void {
    const px = scene.pointerX;
    const py = scene.pointerY;

    // Ignore input during non-interactive phases
    if (
      gameState.phase === "loading" ||
      gameState.phase === "animating" ||
      gameState.phase === "combat_cam" ||
      gameState.phase === "ai_turn" ||
      gameState.phase === "game_over"
    ) {
      return;
    }

    // --- Phase-dependent picking ---
    // During player_move: pick ONLY the ground mesh for accurate tile coordinates.
    // This prevents unit meshes from intercepting the raycast in isometric view,
    // which would give incorrect coordinates and trigger accidental skip-movement.
    // During other phases: pick all meshes (need to identify clicked units).
    let gridCoords: { col: number; row: number };
    let clickedUnit: UnitState | null = null;

    if (gameState.phase === "player_move") {
      // Ground-only pick: bypass unit meshes entirely
      const groundPick = scene.pick(
        px,
        py,
        (mesh) => mesh.name === "ground",
      );

      if (!groundPick || !groundPick.hit || !groundPick.pickedPoint) return;

      gridCoords = worldToGrid(groundPick.pickedPoint.x, groundPick.pickedPoint.z, TILE_SIZE);
      // clickedUnit stays null — we only care about tile coordinates during move phase
    } else {
      // Standard pick: find units or ground
      const pickResult = scene.pick(
        px,
        py,
        (mesh) => mesh.isPickable && mesh.isVisible,
      );

      if (!pickResult || !pickResult.hit || !pickResult.pickedPoint) return;

      gridCoords = worldToGrid(pickResult.pickedPoint.x, pickResult.pickedPoint.z, TILE_SIZE);
      clickedUnit = findUnitAtMesh(pickResult.pickedMesh, gameState);
    }

    // Dispatch based on game phase
    switch (gameState.phase) {
      case "player_select_unit":
        handleSelectUnitPhase(clickedUnit, gridCoords, gameState, gridSystem);
        break;

      case "player_move":
        handleMovePhase(null, gridCoords, gameState, scene, gridSystem, cameraSystem);
        break;

      case "player_action":
        handleActionPhase(clickedUnit, gridCoords, gameState, scene, gridSystem, cameraSystem);
        break;
    }
  }

  // ---- Manual tap detection via POINTERDOWN / POINTERUP ----
  // We track the first finger's down-position and pointerId ourselves
  // so that multi-touch gestures (pan / pinch) are correctly ignored,
  // and small finger jitter on high-DPR screens is tolerated.
  const TAP_THRESHOLD = 20; // CSS pixels of allowable movement
  let tapDownX = 0;
  let tapDownY = 0;
  let tapDownPointerId = -1;
  let wasMultiTouch = false;

  const pointerObserver = scene.onPointerObservable.add((pointerInfo) => {
    const evt = pointerInfo.event as PointerEvent;

    if (pointerInfo.type === PointerEventTypes.POINTERDOWN) {
      if (tapDownPointerId === -1) {
        // First finger: record position
        tapDownX = scene.pointerX;
        tapDownY = scene.pointerY;
        tapDownPointerId = evt.pointerId;
        wasMultiTouch = false;
      } else {
        // Second+ finger: cancel any pending tap
        wasMultiTouch = true;
      }
    } else if (pointerInfo.type === PointerEventTypes.POINTERUP) {
      if (evt.pointerId === tapDownPointerId && !wasMultiTouch) {
        const dx = Math.abs(scene.pointerX - tapDownX);
        const dy = Math.abs(scene.pointerY - tapDownY);
        if (dx < TAP_THRESHOLD && dy < TAP_THRESHOLD) {
          handleTap();
        }
      }
      if (evt.pointerId === tapDownPointerId) {
        tapDownPointerId = -1;
      }
    }
  });

  // --- Public API ---
  function dispose(): void {
    scene.onPointerObservable.remove(pointerObserver);
  }

  function setGUICallbacks(callbacks: InputGUICallbacks): void {
    guiCallbacks = callbacks;
  }

  // --- Phase Handlers ---

  function handleSelectUnitPhase(
    clickedUnit: UnitState | null,
    gridCoords: { col: number; row: number },
    gameState: GameState,
    gridSystem: GridSystem,
  ): void {
    if (clickedUnit && clickedUnit.faction === gameState.playerFaction && clickedUnit.alive && !clickedUnit.activated) {
      // Clear previous highlights
      gridSystem.clearHighlights();

      // Reset overwatch/hunker from previous activation
      resetUnitForActivation(clickedUnit);

      // Select the unit
      if (selectUnit(gameState, clickedUnit.id)) {
        // Calculate and show movement range
        currentMovementRange = getMovementRange(clickedUnit, gridSystem.tiles);
        gridSystem.showMovementRange(currentMovementRange);

        if (guiCallbacks) {
          guiCallbacks.onUnitSelected(clickedUnit, currentMovementRange);
          guiCallbacks.onMovePhase(clickedUnit, currentMovementRange);
        }
      }
    }
  }

  function handleMovePhase(
    clickedUnit: UnitState | null,
    gridCoords: { col: number; row: number },
    gameState: GameState,
    scene: Scene,
    gridSystem: GridSystem,
    cameraSystem: CameraSystem,
  ): void {
    const selectedUnit = gameState.selectedUnitId ? gameState.units.get(gameState.selectedUnitId) : null;
    if (!selectedUnit) return;

    // During player_move, we use ground-only picking (clickedUnit is always null).
    // This means we rely entirely on grid coordinates from the ground hit point,
    // which avoids unit meshes intercepting the raycast in isometric camera view.

    // Check if the clicked tile is reachable — move there
    const isReachable = currentMovementRange.some(
      ([c, r]) => c === gridCoords.col && r === gridCoords.row,
    );

    if (isReachable) {
      gridSystem.clearHighlights();

      executeMove(gameState, scene, [gridCoords.col, gridCoords.row], gridSystem.tiles).then((success) => {
        if (success && selectedUnit.alive) {
          // After movement, prepare action phase
          currentRangedTargets = getValidRangedTargets(selectedUnit, gameState.units, gridSystem.tiles);
          currentMeleeTargets = getValidMeleeTargets(selectedUnit, gameState.units);

          if (gameState.phase === "player_action" && guiCallbacks) {
            guiCallbacks.onActionPhase(selectedUnit, currentRangedTargets, currentMeleeTargets);
          }
        }
      });
      return;
    }

    // Click on the unit's own tile = skip movement (go straight to action phase).
    const isOwnTile = gridCoords.col === selectedUnit.tile[0] && gridCoords.row === selectedUnit.tile[1];
    if (isOwnTile) {
      gridSystem.clearHighlights();
      skipMovement(gameState);

      // Calculate targets for action phase
      currentRangedTargets = getValidRangedTargets(selectedUnit, gameState.units, gridSystem.tiles);
      currentMeleeTargets = getValidMeleeTargets(selectedUnit, gameState.units);

      if (guiCallbacks) {
        guiCallbacks.onActionPhase(selectedUnit, currentRangedTargets, currentMeleeTargets);
      }
      return;
    }

    // Click on a tile with a different friendly unactivated unit = switch selection.
    // No AP has been spent during player_move, so switching is free.
    const clickedTile = gridSystem.tiles[gridCoords.col]?.[gridCoords.row];
    if (clickedTile && clickedTile.occupant) {
      const otherUnit = gameState.units.get(clickedTile.occupant);
      if (
        otherUnit &&
        otherUnit.id !== selectedUnit.id &&
        otherUnit.faction === gameState.playerFaction &&
        otherUnit.alive &&
        !otherUnit.activated
      ) {
        // Deselect current unit
        setUnitSelected(selectedUnit, false);
        gameState.selectedUnitId = null;
        gridSystem.clearHighlights();

        // Go back to select phase, then immediately select the new unit
        gameState.phase = "player_select_unit";
        resetUnitForActivation(otherUnit);

        if (selectUnit(gameState, otherUnit.id)) {
          currentMovementRange = getMovementRange(otherUnit, gridSystem.tiles);
          gridSystem.showMovementRange(currentMovementRange);

          if (guiCallbacks) {
            guiCallbacks.onUnitSelected(otherUnit, currentMovementRange);
            guiCallbacks.onMovePhase(otherUnit, currentMovementRange);
          }
        }
        return;
      }
    }
  }

  function handleActionPhase(
    clickedUnit: UnitState | null,
    gridCoords: { col: number; row: number },
    gameState: GameState,
    scene: Scene,
    gridSystem: GridSystem,
    cameraSystem: CameraSystem,
  ): void {
    const selectedUnit = gameState.selectedUnitId ? gameState.units.get(gameState.selectedUnitId) : null;
    if (!selectedUnit) return;

    // Click on an enemy unit = target for attack
    if (clickedUnit && clickedUnit.faction !== gameState.playerFaction && clickedUnit.alive) {
      // Check if it's a valid ranged target
      const isRangedTarget = currentRangedTargets.some(t => t.unitId === clickedUnit.id);
      if (isRangedTarget) {
        gridSystem.clearHighlights();
        executeShoot(gameState, scene, clickedUnit.id, gridSystem.tiles, cameraSystem).then((result) => {
          if (result && guiCallbacks) {
            guiCallbacks.onAttackResult({
              hit: result.hit,
              damage: result.damage,
              targetId: clickedUnit.id,
            });

            const targetPos = getUnitWorldPosition(clickedUnit);
            guiCallbacks.showDamageNumber(targetPos, result.damage, result.hit);
          }
        });
        return;
      }

      // Check if it's a valid melee target
      const isMeleeTarget = currentMeleeTargets.some(t => t.unitId === clickedUnit.id);
      if (isMeleeTarget) {
        gridSystem.clearHighlights();
        executeMelee(gameState, scene, clickedUnit.id, gridSystem.tiles, cameraSystem).then((result) => {
          if (result && guiCallbacks) {
            guiCallbacks.onAttackResult({
              hit: result.hit,
              damage: result.damage,
              targetId: clickedUnit.id,
            });

            const targetPos = getUnitWorldPosition(clickedUnit);
            guiCallbacks.showDamageNumber(targetPos, result.damage, result.hit);
          }
        });
        return;
      }
    }
  }

  return {
    dispose,
    setGUICallbacks,
  };
}

// ============================================================================
// GUI Action Handlers (called from GUI buttons)
// ============================================================================

/**
 * Create action handlers that the GUI buttons can call.
 */
export function createActionHandlers(
  gameState: GameState,
  scene: Scene,
  gridSystem: GridSystem,
  cameraSystem: CameraSystem,
) {
  return {
    onShoot: () => {
      // Show attack range highlights on valid targets
      const selectedUnit = gameState.selectedUnitId ? gameState.units.get(gameState.selectedUnitId) : null;
      if (!selectedUnit) return;

      const targets = getValidRangedTargets(selectedUnit, gameState.units, gridSystem.tiles);
      gridSystem.clearHighlights();
      gridSystem.showAttackRange(targets.map(t => t.tile));
    },

    onMelee: () => {
      const selectedUnit = gameState.selectedUnitId ? gameState.units.get(gameState.selectedUnitId) : null;
      if (!selectedUnit) return;

      const targets = getValidMeleeTargets(selectedUnit, gameState.units);
      gridSystem.clearHighlights();
      gridSystem.showAttackRange(targets.map(t => t.tile));
    },

    onOverwatch: () => {
      gridSystem.clearHighlights();
      const success = executeOverwatch(gameState, gridSystem.tiles);
      if (success) {
        const unit = gameState.units.get(gameState.selectedUnitId || "");
        if (unit && unit.overwatchCone) {
          // Briefly show the overwatch cone
          gridSystem.showOverwatchCone(unit.overwatchCone);
          setTimeout(() => gridSystem.clearHighlights(), 1500);
        }
      }
    },

    onHunkerDown: () => {
      gridSystem.clearHighlights();
      executeHunkerDown(gameState);
    },

    onEndActivation: () => {
      gridSystem.clearHighlights();
      playerEndActivation(gameState);
    },

    onUnitRosterClick: (unitId: string) => {
      if (gameState.phase !== "player_select_unit") return;

      const unit = gameState.units.get(unitId);
      if (!unit || unit.faction !== gameState.playerFaction || !unit.alive || unit.activated) return;

      // Trigger selection
      gridSystem.clearHighlights();
      resetUnitForActivation(unit);

      if (selectUnit(gameState, unitId)) {
        const movementRange = getMovementRange(unit, gridSystem.tiles);
        gridSystem.showMovementRange(movementRange);
      }
    },

    onPlayAgain: () => {
      // Reload the page for a fresh game
      window.location.reload();
    },
  };
}

// ============================================================================
// Utility
// ============================================================================

/**
 * Find which unit (if any) owns the picked mesh.
 * Traverses up the mesh parent hierarchy to find a unit root.
 */
function findUnitAtMesh(
  mesh: AbstractMesh | null,
  gameState: GameState,
): UnitState | null {
  if (!mesh) return null;

  // Walk up the parent hierarchy
  let current: AbstractMesh | null = mesh;
  while (current) {
    // Check if any unit's root mesh matches
    for (const [, unit] of gameState.units) {
      if (!unit.visual || !unit.alive) continue;
      if (unit.visual.rootMesh === current || unit.visual.rootMesh.name === current.name) {
        return unit;
      }
      // Also check if any child mesh matches
      for (const unitMesh of unit.visual.meshes) {
        if (unitMesh === current) return unit;
      }
    }
    current = current.parent as AbstractMesh | null;
  }

  return null;
}
