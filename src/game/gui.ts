// ============================================================================
// Strife — GUI System
// Complete HUD via Babylon.js AdvancedDynamicTexture:
// Top bar, unit card, action bar, unit roster, damage numbers,
// AI turn banner, game over screen, debug overlay, in-world HP bars.
// Supports desktop (idealWidth=1920) and mobile (idealWidth=720) layouts.
// ============================================================================

import { AdvancedDynamicTexture } from "@babylonjs/gui/2D/advancedDynamicTexture";
import { TextBlock } from "@babylonjs/gui/2D/controls/textBlock";
import { Rectangle } from "@babylonjs/gui/2D/controls/rectangle";
import { StackPanel } from "@babylonjs/gui/2D/controls/stackPanel";
import { Button } from "@babylonjs/gui/2D/controls/button";
import { Ellipse } from "@babylonjs/gui/2D/controls/ellipse";
import { Control } from "@babylonjs/gui/2D/controls/control";
import { Animation } from "@babylonjs/core/Animations/animation";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import type { Engine } from "@babylonjs/core/Engines/engine";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";

import type {
  GameState,
  UnitState,
  Faction,
  ValidTarget,
  GamePhase,
  TurnEvent,
  GUICallbacks,
} from "@shared/types";

import { onTurnEvent } from "./turns";
import { getSoundSystem } from "./sound";
import type { InputGUICallbacks } from "./input";

import {
  GUI_IDEAL_WIDTH,
  GUI_IDEAL_HEIGHT,
  GUI_TOP_BAR_HEIGHT,
  GUI_BOTTOM_BAR_HEIGHT,
  GUI_UNIT_CARD_WIDTH,
  GUI_ACTION_BUTTON_SIZE,
  GUI_MIN_TOUCH_SIZE,
  GUI_MOBILE_IDEAL_WIDTH,
  GUI_MOBILE_TOP_BAR_HEIGHT,
  GUI_MOBILE_BOTTOM_BAR_HEIGHT,
  GUI_MOBILE_UNIT_CARD_WIDTH,
  GUI_MOBILE_ACTION_BUTTON_SIZE,
  GUI_MOBILE_ROSTER_PIP_SIZE,
  HP_BAR_HIGH_COLOR,
  HP_BAR_MED_COLOR,
  HP_BAR_LOW_COLOR,
  HP_BAR_BG_COLOR,
  ORDER_FACTION_COLOR,
  GERMANI_FACTION_COLOR,
  DAMAGE_NUMBER_RISE,
  DAMAGE_NUMBER_DURATION,
  AI_BANNER_FADE_IN,
  AI_BANNER_FADE_OUT,
  AI_BANNER_HOLD,
} from "@shared/constants";

export interface GUISystem {
  ui: AdvancedDynamicTexture;
  update: (gameState: GameState) => void;
  showUnitCard: (unit: UnitState) => void;
  hideUnitCard: () => void;
  showActionBar: (rangedTargets: ValidTarget[], meleeTargets: ValidTarget[]) => void;
  hideActionBar: () => void;
  showDamageNumber: (worldPos: Vector3, damage: number, hit: boolean) => void;
  showAIBanner: () => void;
  hideAIBanner: () => void;
  showGameOver: (winner: Faction, turnCount: number) => void;
  showFactionSelect: (onSelect: (faction: Faction) => void) => void;
  rebuildRoster: () => void;
  getInputCallbacks: () => InputGUICallbacks;
  dispose: () => void;
}

/**
 * Set up the complete GUI system.
 * When isMobile is true, uses a smaller idealWidth (720 vs 1920) so all
 * elements render at a usable size on phone-sized screens, and layouts
 * are adapted for touch (larger buttons, vertical stacking, etc.).
 */
export function setupGUI(
  scene: Scene,
  engine: Engine,
  gameState: GameState,
  actionCallbacks: GUICallbacks,
  isMobile = false,
): GUISystem {
  // Create fullscreen UI
  const ui = AdvancedDynamicTexture.CreateFullscreenUI("gameUI", true, scene);

  if (isMobile) {
    ui.idealWidth = GUI_MOBILE_IDEAL_WIDTH;
    // Do NOT set idealHeight — scale uniformly by width so vertical
    // elements keep the same proportions regardless of aspect ratio.

    // Compensate for hardware scaling that reduces scene resolution on mobile.
    // The scene renders at reduced resolution for performance, but the GUI
    // texture should stay crisp. renderScale multiplies the GUI texture
    // resolution without affecting layout or scene rendering cost.
    const hardwareScale = engine.getHardwareScalingLevel();
    if (hardwareScale > 1) {
      ui.renderScale = hardwareScale;
    }
  } else {
    ui.idealWidth = GUI_IDEAL_WIDTH;
    ui.idealHeight = GUI_IDEAL_HEIGHT;
  }

  // --- Top Bar ---
  const topBar = createTopBar(ui, gameState, isMobile);

  // --- Unit Card (bottom-left) ---
  const unitCard = createUnitCard(ui, isMobile);

  // --- Action Bar (bottom-right, or full-width bottom on mobile) ---
  const actionBar = createActionBar(ui, actionCallbacks, isMobile);

  // --- Unit Roster (bottom-center) ---
  let roster = createUnitRoster(ui, gameState, actionCallbacks, isMobile);

  // --- AI Turn Banner ---
  const aiBanner = createAIBanner(ui, isMobile);

  // --- Game Over Screen ---
  const gameOverScreen = createGameOverScreen(ui, actionCallbacks, isMobile);

  // --- Faction Selection Screen ---
  const factionSelectScreen = createFactionSelectScreen(ui, isMobile);

  // --- Debug Overlay ---
  const debugOverlay = createDebugOverlay(ui, engine, isMobile);

  // --- Turn Event Listener ---
  onTurnEvent((event) => {
    handleTurnEvent(event, topBar, aiBanner, gameOverScreen, gameState);

    // Handle action bar and unit card visibility on phase changes.
    // Buttons have isPointerBlocker=true by default in Babylon.js GUI,
    // so the action bar MUST be hidden when not in player_action phase,
    // otherwise it blocks scene.onPointerObservable from firing.
    if (event.type === "phase_change") {
      if (event.phase !== "player_action") {
        hideActionBarImpl(actionBar);
      }
      if (event.phase === "player_select_unit") {
        hideUnitCardImpl(unitCard);
        updateRoster(roster, gameState);
      }
    }
  });

  // --- Input GUI Callbacks ---
  const inputCallbacks: InputGUICallbacks = {
    onUnitSelected: (unit, movementRange) => {
      showUnitCardImpl(unit, unitCard);
      updateRoster(roster, gameState);
    },
    onUnitDeselected: () => {
      hideUnitCardImpl(unitCard);
      hideActionBarImpl(actionBar);
    },
    onMovePhase: (unit, movementRange) => {
      // Unit card is already shown
    },
    onActionPhase: (unit, rangedTargets, meleeTargets) => {
      showActionBarImpl(actionBar, rangedTargets, meleeTargets);
    },
    onAttackResult: (result) => {
      // Update unit card if still shown
    },
    onPhaseChange: (phase) => {
      updateTopBar(topBar, gameState);
      if (phase === "ai_turn") {
        showAIBannerImpl(aiBanner);
      } else {
        hideAIBannerImpl(aiBanner);
      }
      if (phase !== "player_action") {
        hideActionBarImpl(actionBar);
      }
      if (phase === "player_select_unit") {
        hideUnitCardImpl(unitCard);
        updateRoster(roster, gameState);
      }
    },
    showDamageNumber: (position, damage, hit) => {
      spawnDamageNumber(ui, scene, position, damage, hit);
    },
  };

  // --- Public API ---
  return {
    ui,
    update: (gs) => {
      updateTopBar(topBar, gs);
      updateDebugOverlay(debugOverlay, engine);
    },
    showUnitCard: (unit) => showUnitCardImpl(unit, unitCard),
    hideUnitCard: () => hideUnitCardImpl(unitCard),
    showActionBar: (rangedTargets, meleeTargets) => showActionBarImpl(actionBar, rangedTargets, meleeTargets),
    hideActionBar: () => hideActionBarImpl(actionBar),
    showDamageNumber: (worldPos, damage, hit) => spawnDamageNumber(ui, scene, worldPos, damage, hit),
    showAIBanner: () => showAIBannerImpl(aiBanner),
    hideAIBanner: () => hideAIBannerImpl(aiBanner),
    showGameOver: (winner, turnCount) => showGameOverImpl(gameOverScreen, winner, turnCount, gameState.playerFaction),
    showFactionSelect: (onSelect) => showFactionSelectImpl(factionSelectScreen, onSelect),
    rebuildRoster: () => {
      // Remove old roster container from UI
      ui.removeControl(roster.container);
      roster.container.dispose();
      // Create new roster with updated playerFaction
      roster = createUnitRoster(ui, gameState, actionCallbacks, isMobile);
      updateRoster(roster, gameState);
    },
    getInputCallbacks: () => inputCallbacks,
    dispose: () => {
      ui.dispose();
    },
  };
}

// ============================================================================
// Top Bar
// ============================================================================

interface TopBarUI {
  container: Rectangle;
  turnText: TextBlock;
  factionText: TextBlock;
  phaseText: TextBlock;
}

function createTopBar(ui: AdvancedDynamicTexture, gameState: GameState, mobile: boolean): TopBarUI {
  const barHeight = mobile ? GUI_MOBILE_TOP_BAR_HEIGHT : GUI_TOP_BAR_HEIGHT;

  const container = new Rectangle("topBar");
  container.width = 1;
  container.height = `${barHeight}px`;
  container.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
  container.background = "rgba(0, 0, 0, 0.7)";
  container.thickness = 0;
  container.zIndex = 10;
  container.isHitTestVisible = false; // don't block scene pointer events
  ui.addControl(container);

  const panel = new StackPanel("topBarPanel");
  panel.isVertical = false;
  panel.width = 1;
  panel.height = 1;
  container.addControl(panel);

  const turnText = new TextBlock("turnCounter", "TURN 1");
  turnText.color = "white";
  turnText.fontSize = mobile ? 16 : 20;
  turnText.fontFamily = "monospace";
  turnText.width = mobile ? "100px" : "150px";
  turnText.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
  panel.addControl(turnText);

  const factionText = new TextBlock("factionIndicator", "ORDER OF THE ABYSS");
  factionText.color = ORDER_FACTION_COLOR;
  factionText.fontSize = mobile ? 14 : 18;
  factionText.fontFamily = "monospace";
  factionText.fontWeight = "bold";
  factionText.width = mobile ? "220px" : "350px";
  factionText.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
  panel.addControl(factionText);

  const phaseText = new TextBlock("phaseText", "SELECT UNIT");
  phaseText.color = "#aaaaaa";
  phaseText.fontSize = mobile ? 13 : 16;
  phaseText.fontFamily = "monospace";
  phaseText.width = mobile ? "140px" : "200px";
  phaseText.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
  panel.addControl(phaseText);

  return { container, turnText, factionText, phaseText };
}

function updateTopBar(topBar: TopBarUI, gameState: GameState): void {
  topBar.turnText.text = `TURN ${gameState.turnNumber}`;

  if (gameState.currentFaction === "orderOfTheAbyss") {
    topBar.factionText.text = "ORDER OF THE ABYSS";
    topBar.factionText.color = ORDER_FACTION_COLOR;
  } else {
    topBar.factionText.text = "GERMANI";
    topBar.factionText.color = GERMANI_FACTION_COLOR;
  }

  const phaseLabels: Record<string, string> = {
    loading: "LOADING...",
    player_select_unit: "SELECT UNIT",
    player_move: "MOVE",
    player_action: "CHOOSE ACTION",
    ai_turn: "ENEMY TURN",
    animating: "...",
    combat_cam: "COMBAT",
    game_over: "GAME OVER",
  };
  topBar.phaseText.text = phaseLabels[gameState.phase] || gameState.phase.toUpperCase();
}

// ============================================================================
// Unit Card (Bottom-Left)
// ============================================================================

interface UnitCardUI {
  container: Rectangle;
  unitTypeText: TextBlock;
  factionText: TextBlock;
  hpBarOuter: Rectangle;
  hpBarInner: Rectangle;
  hpText: TextBlock;
  apContainer: StackPanel;
  statusText: TextBlock;
}

function createUnitCard(ui: AdvancedDynamicTexture, mobile: boolean): UnitCardUI {
  const cardWidth = mobile ? GUI_MOBILE_UNIT_CARD_WIDTH : GUI_UNIT_CARD_WIDTH;
  const cardHeight = mobile ? 150 : 180;

  // On mobile, the unit card sits above the action bar + roster
  // Desktop: 10px from bottom
  // Mobile:  action bar (70px) + gap (4px) + roster (36px) + gap (4px) = 114px from bottom
  const bottomOffset = mobile ? -118 : -10;
  const leftOffset = mobile ? 6 : 10;

  const container = new Rectangle("unitCard");
  container.width = `${cardWidth}px`;
  container.height = `${cardHeight}px`;
  container.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
  container.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
  container.left = `${leftOffset}px`;
  container.top = `${bottomOffset}px`;
  container.background = "rgba(0, 0, 0, 0.8)";
  container.cornerRadius = 8;
  container.thickness = 1;
  container.color = "rgba(255, 255, 255, 0.3)";
  container.zIndex = 10;
  container.isVisible = false;
  container.isHitTestVisible = false; // don't block scene pointer events
  ui.addControl(container);

  const innerPanel = new StackPanel("unitCardPanel");
  innerPanel.isVertical = true;
  innerPanel.width = 0.9;
  innerPanel.paddingTop = mobile ? "6px" : "10px";
  container.addControl(innerPanel);

  // Unit type
  const unitTypeText = new TextBlock("unitType", "");
  unitTypeText.color = "white";
  unitTypeText.fontSize = mobile ? 16 : 18;
  unitTypeText.fontFamily = "monospace";
  unitTypeText.fontWeight = "bold";
  unitTypeText.height = mobile ? "22px" : "25px";
  unitTypeText.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
  innerPanel.addControl(unitTypeText);

  // Faction
  const factionText = new TextBlock("unitFaction", "");
  factionText.color = "#aaaaaa";
  factionText.fontSize = mobile ? 11 : 12;
  factionText.fontFamily = "monospace";
  factionText.height = mobile ? "16px" : "18px";
  factionText.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
  innerPanel.addControl(factionText);

  // HP bar
  const hpBarOuter = new Rectangle("hpBarOuter");
  hpBarOuter.width = 1;
  hpBarOuter.height = mobile ? "12px" : "14px";
  hpBarOuter.background = HP_BAR_BG_COLOR;
  hpBarOuter.thickness = 0;
  hpBarOuter.cornerRadius = 3;
  hpBarOuter.paddingTop = mobile ? "4px" : "5px";
  innerPanel.addControl(hpBarOuter);

  const hpBarInner = new Rectangle("hpBarInner");
  hpBarInner.width = 1;
  hpBarInner.height = 1;
  hpBarInner.background = HP_BAR_HIGH_COLOR;
  hpBarInner.thickness = 0;
  hpBarInner.cornerRadius = 3;
  hpBarInner.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
  hpBarOuter.addControl(hpBarInner);

  const hpText = new TextBlock("hpText", "10 / 10");
  hpText.color = "white";
  hpText.fontSize = mobile ? 9 : 10;
  hpText.fontFamily = "monospace";
  hpBarOuter.addControl(hpText);

  // AP pips
  const apContainer = new StackPanel("apPips");
  apContainer.isVertical = false;
  apContainer.height = mobile ? "26px" : "30px";
  apContainer.paddingTop = mobile ? "4px" : "5px";
  innerPanel.addControl(apContainer);

  // Status text
  const statusText = new TextBlock("unitStatus", "READY");
  statusText.color = "#88ff88";
  statusText.fontSize = mobile ? 12 : 14;
  statusText.fontFamily = "monospace";
  statusText.height = mobile ? "18px" : "22px";
  statusText.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
  statusText.paddingTop = mobile ? "3px" : "5px";
  innerPanel.addControl(statusText);

  return {
    container,
    unitTypeText,
    factionText,
    hpBarOuter,
    hpBarInner,
    hpText,
    apContainer,
    statusText,
  };
}

function showUnitCardImpl(unit: UnitState, card: UnitCardUI): void {
  card.container.isVisible = true;

  // Unit type
  const typeNames: Record<string, string> = {
    acolyte: "ACOLYTE",
    shock_troops: "SHOCK TROOPS",
  };
  card.unitTypeText.text = typeNames[unit.unitType] || unit.unitType.toUpperCase();

  // Faction
  const factionNames: Record<string, string> = {
    orderOfTheAbyss: "Order of the Abyss",
    germani: "Germani",
  };
  card.factionText.text = factionNames[unit.faction] || unit.faction;
  card.factionText.color = unit.faction === "orderOfTheAbyss" ? ORDER_FACTION_COLOR : GERMANI_FACTION_COLOR;

  // HP bar
  const hpPercent = unit.stats.currentHP / unit.stats.maxHP;
  card.hpBarInner.width = Math.max(0.01, hpPercent);

  if (hpPercent > 0.6) {
    card.hpBarInner.background = HP_BAR_HIGH_COLOR;
  } else if (hpPercent > 0.3) {
    card.hpBarInner.background = HP_BAR_MED_COLOR;
  } else {
    card.hpBarInner.background = HP_BAR_LOW_COLOR;
  }

  card.hpText.text = `${unit.stats.currentHP} / ${unit.stats.maxHP}`;

  // AP pips
  card.apContainer.clearControls();
  const apLabel = new TextBlock("apLabel", "AP: ");
  apLabel.color = "#aaaaaa";
  apLabel.fontSize = 12;
  apLabel.fontFamily = "monospace";
  apLabel.width = "35px";
  card.apContainer.addControl(apLabel);

  for (let i = 0; i < unit.stats.maxAP; i++) {
    const pip = new Ellipse(`apPip_${i}`);
    pip.width = "16px";
    pip.height = "16px";
    pip.thickness = 2;
    pip.color = i < unit.stats.ap ? "#ffcc00" : "#555555";
    pip.background = i < unit.stats.ap ? "#ffcc00" : "transparent";
    pip.paddingLeft = "3px";
    card.apContainer.addControl(pip);
  }

  // Status
  let statusText = "READY";
  let statusColor = "#88ff88";
  if (unit.activated) {
    statusText = "ACTIVATED";
    statusColor = "#888888";
  } else if (unit.overwatching) {
    statusText = "OVERWATCHING";
    statusColor = "#ffcc00";
  } else if (unit.hunkered) {
    statusText = "HUNKERED DOWN";
    statusColor = "#4488ff";
  }
  card.statusText.text = statusText;
  card.statusText.color = statusColor;
}

function hideUnitCardImpl(card: UnitCardUI): void {
  card.container.isVisible = false;
}

// ============================================================================
// Action Bar (Bottom-Right on desktop, full-width bottom on mobile)
// ============================================================================

interface ActionBarUI {
  container: Rectangle;
  shootBtn: Button;
  meleeBtn: Button;
  overwatchBtn: Button;
  hunkerBtn: Button;
  endBtn: Button;
}

function createActionBar(
  ui: AdvancedDynamicTexture,
  callbacks: GUICallbacks,
  mobile: boolean,
): ActionBarUI {
  const barHeight = mobile ? GUI_MOBILE_BOTTOM_BAR_HEIGHT : GUI_BOTTOM_BAR_HEIGHT;
  const btnSize = mobile ? GUI_MOBILE_ACTION_BUTTON_SIZE : GUI_ACTION_BUTTON_SIZE;

  const container = new Rectangle("actionBar");
  if (mobile) {
    // Full-width bottom tray on mobile
    container.width = "95%";
    container.height = `${barHeight}px`;
    container.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
    container.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
    container.left = "0px";
    container.top = "-4px";
  } else {
    container.width = "450px";
    container.height = `${barHeight}px`;
    container.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
    container.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
    container.left = "-10px";
    container.top = "-10px";
  }
  container.background = "rgba(0, 0, 0, 0.7)";
  container.cornerRadius = 8;
  container.thickness = 0;
  container.zIndex = 10;
  container.isVisible = false;
  ui.addControl(container);

  const panel = new StackPanel("actionPanel");
  panel.isVertical = false;
  panel.width = 0.95;
  panel.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
  container.addControl(panel);

  function makeBtn(name: string, label: string, color: string, onClick: () => void): Button {
    const btn = Button.CreateSimpleButton(name, label);
    btn.width = `${btnSize}px`;
    btn.height = `${btnSize}px`;
    btn.color = "white";
    btn.fontSize = mobile ? 10 : 11;
    btn.fontFamily = "monospace";
    btn.background = color;
    btn.cornerRadius = 6;
    btn.thickness = 1;
    btn.paddingLeft = mobile ? "3px" : "4px";
    btn.paddingRight = mobile ? "3px" : "4px";
    btn.onPointerClickObservable.add(() => {
      const snd = getSoundSystem();
      if (snd) snd.playUIClick();
      onClick();
    });
    panel.addControl(btn);
    return btn;
  }

  const shootBtn = makeBtn("shootBtn", "SHOOT", "rgba(180, 60, 60, 0.8)", callbacks.onShoot);
  const meleeBtn = makeBtn("meleeBtn", "MELEE", "rgba(180, 120, 40, 0.8)", callbacks.onMelee);
  const overwatchBtn = makeBtn("overwatchBtn", "OVER\nWATCH", "rgba(160, 160, 40, 0.8)", callbacks.onOverwatch);
  const hunkerBtn = makeBtn("hunkerBtn", "HUNKER\nDOWN", "rgba(40, 100, 160, 0.8)", callbacks.onHunkerDown);
  const endBtn = makeBtn("endBtn", "END\nTURN", "rgba(100, 100, 100, 0.8)", callbacks.onEndActivation);

  return { container, shootBtn, meleeBtn, overwatchBtn, hunkerBtn, endBtn };
}

function showActionBarImpl(
  actionBar: ActionBarUI,
  rangedTargets: ValidTarget[],
  meleeTargets: ValidTarget[],
): void {
  actionBar.container.isVisible = true;

  // Enable/disable buttons based on available targets
  const hasRangedTargets = rangedTargets.length > 0;
  const hasMeleeTargets = meleeTargets.length > 0;

  actionBar.shootBtn.isEnabled = hasRangedTargets;
  actionBar.shootBtn.alpha = hasRangedTargets ? 1.0 : 0.4;

  actionBar.meleeBtn.isEnabled = hasMeleeTargets;
  actionBar.meleeBtn.alpha = hasMeleeTargets ? 1.0 : 0.4;

  actionBar.overwatchBtn.isEnabled = true;
  actionBar.overwatchBtn.alpha = 1.0;

  actionBar.hunkerBtn.isEnabled = true;
  actionBar.hunkerBtn.alpha = 1.0;

  actionBar.endBtn.isEnabled = true;
  actionBar.endBtn.alpha = 1.0;
}

function hideActionBarImpl(actionBar: ActionBarUI): void {
  actionBar.container.isVisible = false;
}

// ============================================================================
// Unit Roster (Bottom-Center)
// ============================================================================

interface UnitRosterUI {
  container: Rectangle;
  pips: Map<string, Ellipse>;
}

function createUnitRoster(
  ui: AdvancedDynamicTexture,
  gameState: GameState,
  callbacks: GUICallbacks,
  mobile: boolean,
): UnitRosterUI {
  const pipSize = mobile ? GUI_MOBILE_ROSTER_PIP_SIZE : 22;
  const rosterWidth = mobile ? 360 : 320;
  const rosterHeight = mobile ? 36 : 40;

  // On mobile, roster sits above the action bar
  // Desktop: 10px from bottom
  // Mobile:  action bar (80px) + gap (4px) = 84px from bottom
  const bottomOffset = mobile ? -88 : -10;

  const container = new Rectangle("unitRoster");
  container.width = `${rosterWidth}px`;
  container.height = `${rosterHeight}px`;
  container.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
  container.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
  container.top = `${bottomOffset}px`;
  container.background = "rgba(0, 0, 0, 0.6)";
  container.cornerRadius = 20;
  container.thickness = 0;
  container.zIndex = 10;
  container.isHitTestVisible = false; // don't block scene pointer events
  ui.addControl(container);

  const panel = new StackPanel("rosterPanel");
  panel.isVertical = false;
  panel.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
  container.addControl(panel);

  const pips = new Map<string, Ellipse>();

  const playerFaction = gameState.playerFaction;
  const playerColor = playerFaction === "orderOfTheAbyss" ? ORDER_FACTION_COLOR : GERMANI_FACTION_COLOR;
  const enemyColor = playerFaction === "orderOfTheAbyss" ? GERMANI_FACTION_COLOR : ORDER_FACTION_COLOR;

  // Create pips for player units (clickable)
  for (const [unitId, unit] of gameState.units) {
    if (unit.faction !== playerFaction) continue;

    const pip = new Ellipse(`rosterPip_${unitId}`);
    pip.width = `${pipSize}px`;
    pip.height = `${pipSize}px`;
    pip.thickness = 2;
    pip.color = playerColor;
    pip.background = playerColor;
    pip.paddingLeft = mobile ? "3px" : "4px";
    pip.paddingRight = mobile ? "3px" : "4px";

    pip.onPointerClickObservable.add(() => {
      const snd = getSoundSystem();
      if (snd) snd.playUISelect();
      callbacks.onUnitRosterClick(unitId);
    });

    panel.addControl(pip);
    pips.set(unitId, pip);
  }

  // Small separator
  const sep = new TextBlock("rosterSep", " | ");
  sep.color = "#666666";
  sep.fontSize = mobile ? 14 : 16;
  sep.width = mobile ? "16px" : "20px";
  panel.addControl(sep);

  // Enemy pips (info only, not clickable)
  for (const [unitId, unit] of gameState.units) {
    if (unit.faction === playerFaction) continue;

    const pip = new Ellipse(`rosterPip_${unitId}`);
    pip.width = `${pipSize}px`;
    pip.height = `${pipSize}px`;
    pip.thickness = 2;
    pip.color = enemyColor;
    pip.background = enemyColor;
    pip.paddingLeft = mobile ? "3px" : "4px";
    pip.paddingRight = mobile ? "3px" : "4px";

    panel.addControl(pip);
    pips.set(unitId, pip);
  }

  return { container, pips };
}

function updateRoster(roster: UnitRosterUI, gameState: GameState): void {
  for (const [unitId, pip] of roster.pips) {
    const unit = gameState.units.get(unitId);
    if (!unit) continue;

    const factionColor = unit.faction === "orderOfTheAbyss" ? ORDER_FACTION_COLOR : GERMANI_FACTION_COLOR;

    if (!unit.alive) {
      pip.color = "#444444";
      pip.background = "#222222";
      // Could add an X overlay for dead units
    } else if (unit.activated) {
      pip.color = "#666666";
      pip.background = "transparent";
    } else {
      pip.color = factionColor;
      pip.background = factionColor;
    }
  }
}

// ============================================================================
// AI Turn Banner
// ============================================================================

interface AIBannerUI {
  container: Rectangle;
  text: TextBlock;
}

function createAIBanner(ui: AdvancedDynamicTexture, mobile: boolean): AIBannerUI {
  const container = new Rectangle("aiBanner");
  container.width = mobile ? "300px" : "400px";
  container.height = mobile ? "50px" : "60px";
  container.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
  container.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
  container.top = mobile ? "55px" : "70px";
  container.background = "rgba(180, 40, 40, 0.85)";
  container.cornerRadius = 8;
  container.thickness = 0;
  container.alpha = 0;
  container.isVisible = false;
  container.zIndex = 20;
  container.isHitTestVisible = false; // don't block scene pointer events
  ui.addControl(container);

  const text = new TextBlock("aiBannerText", "ENEMY TURN");
  text.color = "white";
  text.fontSize = mobile ? 22 : 28;
  text.fontFamily = "monospace";
  text.fontWeight = "bold";
  container.addControl(text);

  return { container, text };
}

function showAIBannerImpl(banner: AIBannerUI): void {
  banner.container.isVisible = true;
  banner.container.alpha = 0;

  // Fade in
  let frame = 0;
  const totalFrames = Math.ceil(AI_BANNER_FADE_IN / 16);
  const fadeIn = setInterval(() => {
    frame++;
    banner.container.alpha = Math.min(1, frame / totalFrames);
    if (frame >= totalFrames) clearInterval(fadeIn);
  }, 16);
}

function hideAIBannerImpl(banner: AIBannerUI): void {
  // Fade out
  let frame = 0;
  const totalFrames = Math.ceil(AI_BANNER_FADE_OUT / 16);
  const fadeOut = setInterval(() => {
    frame++;
    banner.container.alpha = Math.max(0, 1 - frame / totalFrames);
    if (frame >= totalFrames) {
      clearInterval(fadeOut);
      banner.container.isVisible = false;
    }
  }, 16);
}

// ============================================================================
// Game Over Screen
// ============================================================================

interface GameOverUI {
  container: Rectangle;
  titleText: TextBlock;
  resultText: TextBlock;
  turnText: TextBlock;
  playAgainBtn: Button;
}

function createGameOverScreen(
  ui: AdvancedDynamicTexture,
  callbacks: GUICallbacks,
  mobile: boolean,
): GameOverUI {
  const container = new Rectangle("gameOverScreen");
  container.width = 1;
  container.height = 1;
  container.background = "rgba(0, 0, 0, 0.85)";
  container.thickness = 0;
  container.isVisible = false;
  container.zIndex = 100;
  ui.addControl(container);

  const panel = new StackPanel("gameOverPanel");
  panel.isVertical = true;
  panel.width = mobile ? "90%" : "500px";
  container.addControl(panel);

  const titleText = new TextBlock("gameOverTitle", "GAME OVER");
  titleText.color = "white";
  titleText.fontSize = mobile ? 36 : 48;
  titleText.fontFamily = "monospace";
  titleText.fontWeight = "bold";
  titleText.height = mobile ? "60px" : "80px";
  panel.addControl(titleText);

  const resultText = new TextBlock("gameOverResult", "");
  resultText.color = "#ffcc00";
  resultText.fontSize = mobile ? 22 : 28;
  resultText.fontFamily = "monospace";
  resultText.height = mobile ? "40px" : "50px";
  panel.addControl(resultText);

  const turnText = new TextBlock("gameOverTurns", "");
  turnText.color = "#aaaaaa";
  turnText.fontSize = mobile ? 15 : 18;
  turnText.fontFamily = "monospace";
  turnText.height = mobile ? "30px" : "40px";
  panel.addControl(turnText);

  const playAgainBtn = Button.CreateSimpleButton("playAgainBtn", "PLAY AGAIN");
  playAgainBtn.width = mobile ? "180px" : "200px";
  playAgainBtn.height = mobile ? "48px" : "50px";
  playAgainBtn.color = "white";
  playAgainBtn.fontSize = mobile ? 18 : 20;
  playAgainBtn.fontFamily = "monospace";
  playAgainBtn.background = "rgba(60, 120, 60, 0.8)";
  playAgainBtn.cornerRadius = 8;
  playAgainBtn.thickness = 0;
  playAgainBtn.paddingTop = mobile ? "15px" : "20px";
  playAgainBtn.onPointerClickObservable.add(callbacks.onPlayAgain);
  panel.addControl(playAgainBtn);

  return { container, titleText, resultText, turnText, playAgainBtn };
}

function showGameOverImpl(gameOver: GameOverUI, winner: Faction, turnCount: number, playerFaction: Faction): void {
  gameOver.container.isVisible = true;

  const factionNames: Record<string, string> = {
    orderOfTheAbyss: "ORDER OF THE ABYSS",
    germani: "GERMANI",
  };

  const winnerColor = winner === "orderOfTheAbyss" ? ORDER_FACTION_COLOR : GERMANI_FACTION_COLOR;

  if (winner === playerFaction) {
    gameOver.resultText.text = "VICTORY!";
    gameOver.resultText.color = winnerColor;
  } else {
    gameOver.resultText.text = "DEFEAT";
    gameOver.resultText.color = winnerColor;
  }

  gameOver.turnText.text = `${factionNames[winner]} wins in ${turnCount} turns`;
}

// ============================================================================
// Faction Selection Screen
// ============================================================================

interface FactionSelectUI {
  container: Rectangle;
  orderBtn: Button;
  germaniBtn: Button;
}

function createFactionSelectScreen(ui: AdvancedDynamicTexture, mobile: boolean): FactionSelectUI {
  const container = new Rectangle("factionSelectScreen");
  container.width = 1;
  container.height = 1;
  container.background = "rgba(0, 0, 0, 0.9)";
  container.thickness = 0;
  container.isVisible = false;
  container.zIndex = 200;
  ui.addControl(container);

  const panel = new StackPanel("factionSelectPanel");
  panel.isVertical = true;
  panel.width = mobile ? "95%" : "600px";
  container.addControl(panel);

  // Title
  const titleText = new TextBlock("factionSelectTitle", "STRIFE");
  titleText.color = "#cccccc";
  titleText.fontSize = mobile ? 38 : 56;
  titleText.fontFamily = "monospace";
  titleText.fontWeight = "bold";
  titleText.height = mobile ? "55px" : "80px";
  panel.addControl(titleText);

  // Subtitle
  const subtitleText = new TextBlock("factionSelectSubtitle", "CHOOSE YOUR FACTION");
  subtitleText.color = "#888888";
  subtitleText.fontSize = mobile ? 16 : 22;
  subtitleText.fontFamily = "monospace";
  subtitleText.height = mobile ? "35px" : "50px";
  panel.addControl(subtitleText);

  // Spacer
  const spacer = new Rectangle("factionSpacer");
  spacer.width = 1;
  spacer.height = mobile ? "15px" : "30px";
  spacer.thickness = 0;
  spacer.background = "transparent";
  panel.addControl(spacer);

  if (mobile) {
    // ---- MOBILE: Vertical stacking, full-width buttons ----
    return createFactionSelectMobile(panel, container);
  }

  // ---- DESKTOP: Horizontal button row ----
  return createFactionSelectDesktop(panel, container);
}

function createFactionSelectDesktop(panel: StackPanel, container: Rectangle): FactionSelectUI {
  // Button row
  const btnRow = new StackPanel("factionBtnRow");
  btnRow.isVertical = false;
  btnRow.height = "200px";
  btnRow.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
  panel.addControl(btnRow);

  // Order of the Abyss button
  const orderContainer = new Rectangle("orderBtnContainer");
  orderContainer.width = "260px";
  orderContainer.height = "180px";
  orderContainer.background = "rgba(30, 50, 120, 0.6)";
  orderContainer.cornerRadius = 12;
  orderContainer.thickness = 3;
  orderContainer.color = ORDER_FACTION_COLOR;
  orderContainer.paddingLeft = "10px";
  orderContainer.paddingRight = "10px";
  btnRow.addControl(orderContainer);

  const orderPanel = new StackPanel("orderPanel");
  orderPanel.isVertical = true;
  orderPanel.width = 0.9;
  orderPanel.paddingTop = "15px";
  orderContainer.addControl(orderPanel);

  const orderIcon = new TextBlock("orderIcon", "\u2694"); // ⚔ Crossed swords
  orderIcon.color = ORDER_FACTION_COLOR;
  orderIcon.fontSize = 40;
  orderIcon.height = "55px";
  orderPanel.addControl(orderIcon);

  const orderName = new TextBlock("orderName", "ORDER OF\nTHE ABYSS");
  orderName.color = "white";
  orderName.fontSize = 18;
  orderName.fontFamily = "monospace";
  orderName.fontWeight = "bold";
  orderName.height = "50px";
  orderName.textWrapping = true;
  orderPanel.addControl(orderName);

  const orderDesc = new TextBlock("orderDesc", "Acolytes");
  orderDesc.color = "#8888cc";
  orderDesc.fontSize = 12;
  orderDesc.fontFamily = "monospace";
  orderDesc.height = "20px";
  orderPanel.addControl(orderDesc);

  const orderBtn = Button.CreateSimpleButton("orderSelectBtn", "");
  orderBtn.width = 1;
  orderBtn.height = 1;
  orderBtn.background = "transparent";
  orderBtn.thickness = 0;
  orderBtn.color = "transparent";
  orderContainer.addControl(orderBtn);

  // Germani button
  const germaniContainer = new Rectangle("germaniBtnContainer");
  germaniContainer.width = "260px";
  germaniContainer.height = "180px";
  germaniContainer.background = "rgba(120, 30, 30, 0.6)";
  germaniContainer.cornerRadius = 12;
  germaniContainer.thickness = 3;
  germaniContainer.color = GERMANI_FACTION_COLOR;
  germaniContainer.paddingLeft = "10px";
  germaniContainer.paddingRight = "10px";
  btnRow.addControl(germaniContainer);

  const germaniPanel = new StackPanel("germaniPanel");
  germaniPanel.isVertical = true;
  germaniPanel.width = 0.9;
  germaniPanel.paddingTop = "15px";
  germaniContainer.addControl(germaniPanel);

  const germaniIcon = new TextBlock("germaniIcon", "\u2720"); // ✠ Maltese cross
  germaniIcon.color = GERMANI_FACTION_COLOR;
  germaniIcon.fontSize = 40;
  germaniIcon.height = "55px";
  germaniPanel.addControl(germaniIcon);

  const germaniName = new TextBlock("germaniName", "GERMANI");
  germaniName.color = "white";
  germaniName.fontSize = 18;
  germaniName.fontFamily = "monospace";
  germaniName.fontWeight = "bold";
  germaniName.height = "50px";
  germaniPanel.addControl(germaniName);

  const germaniDesc = new TextBlock("germaniDesc", "Shock Troops");
  germaniDesc.color = "#cc8888";
  germaniDesc.fontSize = 12;
  germaniDesc.fontFamily = "monospace";
  germaniDesc.height = "20px";
  germaniPanel.addControl(germaniDesc);

  const germaniBtn = Button.CreateSimpleButton("germaniSelectBtn", "");
  germaniBtn.width = 1;
  germaniBtn.height = 1;
  germaniBtn.background = "transparent";
  germaniBtn.thickness = 0;
  germaniBtn.color = "transparent";
  germaniContainer.addControl(germaniBtn);

  // Hover effects
  orderBtn.onPointerEnterObservable.add(() => {
    orderContainer.background = "rgba(40, 70, 160, 0.8)";
    orderContainer.thickness = 4;
  });
  orderBtn.onPointerOutObservable.add(() => {
    orderContainer.background = "rgba(30, 50, 120, 0.6)";
    orderContainer.thickness = 3;
  });

  germaniBtn.onPointerEnterObservable.add(() => {
    germaniContainer.background = "rgba(160, 40, 40, 0.8)";
    germaniContainer.thickness = 4;
  });
  germaniBtn.onPointerOutObservable.add(() => {
    germaniContainer.background = "rgba(120, 30, 30, 0.6)";
    germaniContainer.thickness = 3;
  });

  return { container, orderBtn, germaniBtn };
}

function createFactionSelectMobile(panel: StackPanel, container: Rectangle): FactionSelectUI {
  // ---- MOBILE: Vertical stacking with full-width buttons ----

  // Order of the Abyss button — full width, horizontal layout (icon left, text right)
  const orderContainer = new Rectangle("orderBtnContainer");
  orderContainer.width = "90%";
  orderContainer.height = "100px";
  orderContainer.background = "rgba(30, 50, 120, 0.6)";
  orderContainer.cornerRadius = 12;
  orderContainer.thickness = 3;
  orderContainer.color = ORDER_FACTION_COLOR;
  panel.addControl(orderContainer);

  const orderRow = new StackPanel("orderRow");
  orderRow.isVertical = false;
  orderRow.width = 0.95;
  orderRow.height = 1;
  orderContainer.addControl(orderRow);

  const orderIcon = new TextBlock("orderIcon", "\u2694"); // ⚔ Crossed swords
  orderIcon.color = ORDER_FACTION_COLOR;
  orderIcon.fontSize = 36;
  orderIcon.width = "60px";
  orderRow.addControl(orderIcon);

  const orderTextCol = new StackPanel("orderTextCol");
  orderTextCol.isVertical = true;
  orderTextCol.width = "300px";
  orderTextCol.paddingLeft = "10px";
  orderRow.addControl(orderTextCol);

  const orderName = new TextBlock("orderName", "ORDER OF THE ABYSS");
  orderName.color = "white";
  orderName.fontSize = 16;
  orderName.fontFamily = "monospace";
  orderName.fontWeight = "bold";
  orderName.height = "28px";
  orderName.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
  orderTextCol.addControl(orderName);

  const orderDesc = new TextBlock("orderDesc", "Acolytes");
  orderDesc.color = "#8888cc";
  orderDesc.fontSize = 13;
  orderDesc.fontFamily = "monospace";
  orderDesc.height = "22px";
  orderDesc.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
  orderTextCol.addControl(orderDesc);

  const orderBtn = Button.CreateSimpleButton("orderSelectBtn", "");
  orderBtn.width = 1;
  orderBtn.height = 1;
  orderBtn.background = "transparent";
  orderBtn.thickness = 0;
  orderBtn.color = "transparent";
  orderContainer.addControl(orderBtn);

  // Spacer between faction buttons
  const btnSpacer = new Rectangle("factionBtnSpacer");
  btnSpacer.width = 1;
  btnSpacer.height = "12px";
  btnSpacer.thickness = 0;
  btnSpacer.background = "transparent";
  panel.addControl(btnSpacer);

  // Germani button — full width, horizontal layout (icon left, text right)
  const germaniContainer = new Rectangle("germaniBtnContainer");
  germaniContainer.width = "90%";
  germaniContainer.height = "100px";
  germaniContainer.background = "rgba(120, 30, 30, 0.6)";
  germaniContainer.cornerRadius = 12;
  germaniContainer.thickness = 3;
  germaniContainer.color = GERMANI_FACTION_COLOR;
  panel.addControl(germaniContainer);

  const germaniRow = new StackPanel("germaniRow");
  germaniRow.isVertical = false;
  germaniRow.width = 0.95;
  germaniRow.height = 1;
  germaniContainer.addControl(germaniRow);

  const germaniIcon = new TextBlock("germaniIcon", "\u2720"); // ✠ Maltese cross
  germaniIcon.color = GERMANI_FACTION_COLOR;
  germaniIcon.fontSize = 36;
  germaniIcon.width = "60px";
  germaniRow.addControl(germaniIcon);

  const germaniTextCol = new StackPanel("germaniTextCol");
  germaniTextCol.isVertical = true;
  germaniTextCol.width = "300px";
  germaniTextCol.paddingLeft = "10px";
  germaniRow.addControl(germaniTextCol);

  const germaniName = new TextBlock("germaniName", "GERMANI");
  germaniName.color = "white";
  germaniName.fontSize = 16;
  germaniName.fontFamily = "monospace";
  germaniName.fontWeight = "bold";
  germaniName.height = "28px";
  germaniName.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
  germaniTextCol.addControl(germaniName);

  const germaniDesc = new TextBlock("germaniDesc", "Shock Troops");
  germaniDesc.color = "#cc8888";
  germaniDesc.fontSize = 13;
  germaniDesc.fontFamily = "monospace";
  germaniDesc.height = "22px";
  germaniDesc.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
  germaniTextCol.addControl(germaniDesc);

  const germaniBtn = Button.CreateSimpleButton("germaniSelectBtn", "");
  germaniBtn.width = 1;
  germaniBtn.height = 1;
  germaniBtn.background = "transparent";
  germaniBtn.thickness = 0;
  germaniBtn.color = "transparent";
  germaniContainer.addControl(germaniBtn);

  // Touch hover effects (brief feedback on press)
  orderBtn.onPointerEnterObservable.add(() => {
    orderContainer.background = "rgba(40, 70, 160, 0.8)";
    orderContainer.thickness = 4;
  });
  orderBtn.onPointerOutObservable.add(() => {
    orderContainer.background = "rgba(30, 50, 120, 0.6)";
    orderContainer.thickness = 3;
  });

  germaniBtn.onPointerEnterObservable.add(() => {
    germaniContainer.background = "rgba(160, 40, 40, 0.8)";
    germaniContainer.thickness = 4;
  });
  germaniBtn.onPointerOutObservable.add(() => {
    germaniContainer.background = "rgba(120, 30, 30, 0.6)";
    germaniContainer.thickness = 3;
  });

  return { container, orderBtn, germaniBtn };
}

function showFactionSelectImpl(
  factionSelect: FactionSelectUI,
  onSelect: (faction: Faction) => void,
): void {
  factionSelect.container.isVisible = true;

  // Clear any existing observers from previous shows
  factionSelect.orderBtn.onPointerClickObservable.clear();
  factionSelect.germaniBtn.onPointerClickObservable.clear();

  factionSelect.orderBtn.onPointerClickObservable.addOnce(() => {
    const snd = getSoundSystem();
    if (snd) snd.playUIClick();
    factionSelect.container.isVisible = false;
    onSelect("orderOfTheAbyss");
  });

  factionSelect.germaniBtn.onPointerClickObservable.addOnce(() => {
    const snd = getSoundSystem();
    if (snd) snd.playUIClick();
    factionSelect.container.isVisible = false;
    onSelect("germani");
  });
}

// ============================================================================
// Debug Overlay
// ============================================================================

interface DebugUI {
  container: Rectangle;
  fpsText: TextBlock;
  rendererText: TextBlock;
}

function createDebugOverlay(ui: AdvancedDynamicTexture, engine: Engine, mobile: boolean): DebugUI {
  const topOffset = mobile ? 50 : 60;

  const container = new Rectangle("debugOverlay");
  container.width = mobile ? "160px" : "200px";
  container.height = mobile ? "34px" : "40px";
  container.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
  container.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
  container.left = mobile ? "6px" : "10px";
  container.top = `${topOffset}px`;
  container.background = "rgba(0, 0, 0, 0.4)";
  container.cornerRadius = 4;
  container.thickness = 0;
  container.zIndex = 5;
  container.isHitTestVisible = false; // don't block scene pointer events
  ui.addControl(container);

  const panel = new StackPanel("debugPanel");
  panel.isVertical = true;
  panel.width = 0.9;
  container.addControl(panel);

  const rendererText = new TextBlock("rendererType", "");
  rendererText.color = "#888888";
  rendererText.fontSize = mobile ? 9 : 10;
  rendererText.fontFamily = "monospace";
  rendererText.height = mobile ? "12px" : "14px";
  rendererText.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
  panel.addControl(rendererText);

  // Detect renderer type
  const description = engine.description || "";
  rendererText.text = description.includes("WebGPU") ? "WebGPU" : "WebGL2";

  const fpsText = new TextBlock("fpsCounter", "FPS: --");
  fpsText.color = "#888888";
  fpsText.fontSize = mobile ? 9 : 10;
  fpsText.fontFamily = "monospace";
  fpsText.height = mobile ? "12px" : "14px";
  fpsText.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
  panel.addControl(fpsText);

  return { container, fpsText, rendererText };
}

function updateDebugOverlay(debug: DebugUI, engine: Engine): void {
  debug.fpsText.text = `FPS: ${engine.getFps().toFixed(0)}`;
}

// ============================================================================
// Damage Numbers
// ============================================================================

/**
 * Spawn a floating damage number that rises and fades out.
 * Uses the UI's actual idealWidth to compute positioning so it works
 * correctly for both desktop (idealWidth=1920) and mobile (idealWidth=720).
 */
function spawnDamageNumber(
  ui: AdvancedDynamicTexture,
  scene: Scene,
  worldPos: Vector3,
  damage: number,
  hit: boolean,
): void {
  const text = new TextBlock(
    `dmgNum_${Date.now()}`,
    hit ? `-${damage}` : "MISS",
  );
  text.color = hit ? "#ff4444" : "#aaaaaa";
  text.fontSize = hit ? 28 : 22;
  text.fontFamily = "monospace";
  text.fontWeight = "bold";
  text.outlineWidth = 2;
  text.outlineColor = "black";
  text.zIndex = 50;

  // Position at world location projected to screen
  // Use linkWithMesh concept but manual positioning
  ui.addControl(text);

  // Convert world position to screen coordinates
  const screenPos = Vector3.Project(
    worldPos.add(new Vector3(0, 2, 0)),
    scene.getTransformMatrix(),
    scene.getProjectionMatrix(),
    scene.activeCamera!.viewport.toGlobal(
      scene.getEngine().getRenderWidth(),
      scene.getEngine().getRenderHeight(),
    ),
  );

  const startX = (screenPos.x / scene.getEngine().getRenderWidth()) * 2 - 1;
  const startY = (screenPos.y / scene.getEngine().getRenderHeight()) * 2 - 1;

  // Compute the effective ideal dimensions used by the UI.
  // When only idealWidth is set (mobile), vertical scaling uses the same ratio
  // as horizontal, so the effective ideal height depends on the canvas aspect.
  const idealW = ui.idealWidth || GUI_IDEAL_WIDTH;
  const renderW = scene.getEngine().getRenderWidth();
  const renderH = scene.getEngine().getRenderHeight();
  const scale = renderW / idealW;
  const effectiveIdealH = renderH / scale;

  text.left = `${startX * idealW / 2}px`;
  text.top = `${startY * effectiveIdealH / 2}px`;

  // Animate: rise upward and fade out
  const startTime = performance.now();
  const duration = DAMAGE_NUMBER_DURATION;

  const observer = scene.onBeforeRenderObservable.add(() => {
    const elapsed = performance.now() - startTime;
    const t = Math.min(elapsed / duration, 1);

    // Move up
    const riseAmount = DAMAGE_NUMBER_RISE * t;
    text.top = `${startY * effectiveIdealH / 2 - riseAmount}px`;

    // Fade out in second half
    if (t > 0.5) {
      text.alpha = 1 - (t - 0.5) * 2;
    }

    if (t >= 1) {
      scene.onBeforeRenderObservable.remove(observer);
      ui.removeControl(text);
      text.dispose();
    }
  });
}

// ============================================================================
// Turn Event Handler
// ============================================================================

function handleTurnEvent(
  event: TurnEvent,
  topBar: TopBarUI,
  aiBanner: AIBannerUI,
  gameOverScreen: GameOverUI,
  gameState: GameState,
): void {
  switch (event.type) {
    case "turn_start":
      updateTopBar(topBar, gameState);
      break;

    case "phase_change":
      updateTopBar(topBar, gameState);
      if (event.phase === "ai_turn") {
        showAIBannerImpl(aiBanner);
      } else if (event.phase !== "animating" && event.phase !== "combat_cam") {
        hideAIBannerImpl(aiBanner);
      }
      break;

    case "game_over":
      if (event.winner) {
        showGameOverImpl(gameOverScreen, event.winner, event.turnNumber, gameState.playerFaction);
      }
      break;
  }
}
