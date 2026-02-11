// ============================================================================
// Strife — Editor GUI
// Complete editor interface via AdvancedDynamicTexture:
// Object palette sidebar, grid size controls, ground texture selector,
// object controls, mode toggles, light controls, preview/export/import.
// ============================================================================

import { AdvancedDynamicTexture } from "@babylonjs/gui/2D/advancedDynamicTexture";
import { TextBlock } from "@babylonjs/gui/2D/controls/textBlock";
import { Rectangle } from "@babylonjs/gui/2D/controls/rectangle";
import { StackPanel } from "@babylonjs/gui/2D/controls/stackPanel";
import { Button } from "@babylonjs/gui/2D/controls/button";
import { InputText } from "@babylonjs/gui/2D/controls/inputText";
import { Slider } from "@babylonjs/gui/2D/controls/sliders/slider";
import { Control } from "@babylonjs/gui/2D/controls/control";
import { ScrollViewer } from "@babylonjs/gui/2D/controls/scrollViewers/scrollViewer";
import type { Scene } from "@babylonjs/core/scene";
import type { Engine } from "@babylonjs/core/Engines/engine";

import type { EditorState, EditorTool, Faction, CoverType } from "@shared/types";
import { AVAILABLE_GROUND_TEXTURES, GUI_IDEAL_WIDTH, GUI_IDEAL_HEIGHT } from "@shared/constants";
import { PALETTE_ITEMS, selectPaletteItem, rotateSelection, rerollSeed } from "./palette";
import type { PaletteState, PaletteItem } from "./palette";
import { downloadMapJSON, importMapJSON, populateEditorFromMapData } from "./export";

export interface EditorGUI {
  ui: AdvancedDynamicTexture;
  update: () => void;
  dispose: () => void;
}

/**
 * Set up the complete editor GUI.
 */
export function setupEditorGUI(
  scene: Scene,
  engine: Engine,
  editorState: EditorState,
  paletteState: PaletteState,
  callbacks: {
    onGridResize: (cols: number, rows: number) => void;
    onTextureChange: (texture: string) => void;
    onRegenerate: () => void;
    onTogglePreview: (preview: boolean) => void;
  },
): EditorGUI {
  const ui = AdvancedDynamicTexture.CreateFullscreenUI("editorUI", true, scene);
  ui.idealWidth = GUI_IDEAL_WIDTH;
  ui.idealHeight = GUI_IDEAL_HEIGHT;

  // --- Left Sidebar (Object Palette) ---
  const sidebar = createSidebar(ui, paletteState, callbacks.onRegenerate);

  // --- Right Panel (Controls) ---
  const controlPanel = createControlPanel(
    ui,
    editorState,
    paletteState,
    callbacks,
  );

  // --- Top Bar ---
  const topBar = createEditorTopBar(ui, editorState, paletteState, callbacks);

  return {
    ui,
    update: () => {
      updateSidebar(sidebar, paletteState);
    },
    dispose: () => ui.dispose(),
  };
}

// ============================================================================
// Left Sidebar — Object Palette
// ============================================================================

interface SidebarUI {
  container: Rectangle;
  buttons: Map<string, Button>;
  selectedHighlight: Rectangle | null;
}

function createSidebar(
  ui: AdvancedDynamicTexture,
  paletteState: PaletteState,
  onRegenerate: () => void,
): SidebarUI {
  const container = new Rectangle("sidebar");
  container.width = "220px";
  container.height = 0.85;
  container.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
  container.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
  container.left = "5px";
  container.background = "rgba(0, 0, 0, 0.8)";
  container.cornerRadius = 8;
  container.thickness = 1;
  container.color = "rgba(255, 255, 255, 0.2)";
  container.zIndex = 10;
  ui.addControl(container);

  const scrollViewer = new ScrollViewer("sidebarScroll");
  scrollViewer.width = 1;
  scrollViewer.height = 1;
  scrollViewer.barSize = 8;
  scrollViewer.barColor = "#555555";
  container.addControl(scrollViewer);

  const panel = new StackPanel("sidebarPanel");
  panel.isVertical = true;
  panel.width = 0.9;
  panel.paddingTop = "10px";
  scrollViewer.addControl(panel);

  // Title
  const title = new TextBlock("sidebarTitle", "OBJECTS");
  title.color = "white";
  title.fontSize = 16;
  title.fontFamily = "monospace";
  title.fontWeight = "bold";
  title.height = "30px";
  title.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
  panel.addControl(title);

  const buttons = new Map<string, Button>();

  // Object type buttons
  for (const item of PALETTE_ITEMS) {
    const btn = Button.CreateSimpleButton(`palette_${item.type}`, `${item.label}\n(${item.defaultCover} cover)`);
    btn.width = 1;
    btn.height = "55px";
    btn.color = "white";
    btn.fontSize = 12;
    btn.fontFamily = "monospace";
    btn.background = "rgba(60, 60, 80, 0.6)";
    btn.cornerRadius = 4;
    btn.thickness = 1;
    btn.paddingTop = "3px";
    btn.paddingBottom = "3px";

    btn.onPointerClickObservable.add(() => {
      selectPaletteItem(paletteState, item);
      onRegenerate();
    });

    panel.addControl(btn);
    buttons.set(item.type, btn);
  }

  // Separator
  const sep = new TextBlock("sep1", "───────────────");
  sep.color = "#444444";
  sep.fontSize = 10;
  sep.height = "20px";
  panel.addControl(sep);

  // Tool buttons
  const spawnTitle = new TextBlock("spawnTitle", "SPAWN ZONES");
  spawnTitle.color = "white";
  spawnTitle.fontSize = 14;
  spawnTitle.fontFamily = "monospace";
  spawnTitle.fontWeight = "bold";
  spawnTitle.height = "25px";
  spawnTitle.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
  panel.addControl(spawnTitle);

  const orderSpawnBtn = Button.CreateSimpleButton("orderSpawnBtn", "Order of the Abyss");
  orderSpawnBtn.width = 1;
  orderSpawnBtn.height = "40px";
  orderSpawnBtn.color = "white";
  orderSpawnBtn.fontSize = 12;
  orderSpawnBtn.fontFamily = "monospace";
  orderSpawnBtn.background = "rgba(50, 50, 150, 0.6)";
  orderSpawnBtn.cornerRadius = 4;
  orderSpawnBtn.thickness = 1;
  orderSpawnBtn.paddingTop = "3px";
  orderSpawnBtn.onPointerClickObservable.add(() => {
    paletteState.selectedTool = "paint_spawn";
    paletteState.spawnFaction = "orderOfTheAbyss";
    paletteState.selectedItem = null;
    onRegenerate();
  });
  panel.addControl(orderSpawnBtn);

  const germaniSpawnBtn = Button.CreateSimpleButton("germaniSpawnBtn", "Germani");
  germaniSpawnBtn.width = 1;
  germaniSpawnBtn.height = "40px";
  germaniSpawnBtn.color = "white";
  germaniSpawnBtn.fontSize = 12;
  germaniSpawnBtn.fontFamily = "monospace";
  germaniSpawnBtn.background = "rgba(150, 50, 50, 0.6)";
  germaniSpawnBtn.cornerRadius = 4;
  germaniSpawnBtn.thickness = 1;
  germaniSpawnBtn.paddingTop = "3px";
  germaniSpawnBtn.onPointerClickObservable.add(() => {
    paletteState.selectedTool = "paint_spawn";
    paletteState.spawnFaction = "germani";
    paletteState.selectedItem = null;
    onRegenerate();
  });
  panel.addControl(germaniSpawnBtn);

  // Light placement
  const sep2 = new TextBlock("sep2", "───────────────");
  sep2.color = "#444444";
  sep2.fontSize = 10;
  sep2.height = "20px";
  panel.addControl(sep2);

  const lightBtn = Button.CreateSimpleButton("lightBtn", "Place Light");
  lightBtn.width = 1;
  lightBtn.height = "40px";
  lightBtn.color = "white";
  lightBtn.fontSize = 12;
  lightBtn.fontFamily = "monospace";
  lightBtn.background = "rgba(150, 120, 40, 0.6)";
  lightBtn.cornerRadius = 4;
  lightBtn.thickness = 1;
  lightBtn.paddingTop = "3px";
  lightBtn.onPointerClickObservable.add(() => {
    paletteState.selectedTool = "place_light";
    paletteState.selectedItem = null;
    onRegenerate();
  });
  panel.addControl(lightBtn);

  // Erase tool
  const eraseBtn = Button.CreateSimpleButton("eraseBtn", "Erase (Right-Click)");
  eraseBtn.width = 1;
  eraseBtn.height = "40px";
  eraseBtn.color = "white";
  eraseBtn.fontSize = 12;
  eraseBtn.fontFamily = "monospace";
  eraseBtn.background = "rgba(120, 40, 40, 0.6)";
  eraseBtn.cornerRadius = 4;
  eraseBtn.thickness = 1;
  eraseBtn.paddingTop = "3px";
  eraseBtn.onPointerClickObservable.add(() => {
    paletteState.selectedTool = "erase";
    paletteState.selectedItem = null;
    onRegenerate();
  });
  panel.addControl(eraseBtn);

  return { container, buttons, selectedHighlight: null };
}

function updateSidebar(sidebar: SidebarUI, paletteState: PaletteState): void {
  // Highlight the selected palette item
  for (const [type, btn] of sidebar.buttons) {
    if (paletteState.selectedItem && paletteState.selectedItem.type === type) {
      btn.background = "rgba(80, 120, 180, 0.8)";
      btn.thickness = 2;
      btn.color = "#88bbff";
    } else {
      btn.background = "rgba(60, 60, 80, 0.6)";
      btn.thickness = 1;
      btn.color = "rgba(255, 255, 255, 0.2)";
    }
  }
}

// ============================================================================
// Right Panel — Controls
// ============================================================================

function createControlPanel(
  ui: AdvancedDynamicTexture,
  editorState: EditorState,
  paletteState: PaletteState,
  callbacks: {
    onGridResize: (cols: number, rows: number) => void;
    onTextureChange: (texture: string) => void;
    onRegenerate: () => void;
    onTogglePreview: (preview: boolean) => void;
  },
): Rectangle {
  const container = new Rectangle("controlPanel");
  container.width = "200px";
  container.height = "350px";
  container.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
  container.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
  container.left = "-5px";
  container.top = "60px";
  container.background = "rgba(0, 0, 0, 0.8)";
  container.cornerRadius = 8;
  container.thickness = 1;
  container.color = "rgba(255, 255, 255, 0.2)";
  container.zIndex = 10;
  ui.addControl(container);

  const panel = new StackPanel("controlStack");
  panel.isVertical = true;
  panel.width = 0.9;
  panel.paddingTop = "10px";
  container.addControl(panel);

  // Grid size
  const gridLabel = new TextBlock("gridLabel", "GRID SIZE");
  gridLabel.color = "white";
  gridLabel.fontSize = 12;
  gridLabel.fontFamily = "monospace";
  gridLabel.fontWeight = "bold";
  gridLabel.height = "22px";
  gridLabel.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
  panel.addControl(gridLabel);

  const gridSizePanel = new StackPanel("gridSizePanel");
  gridSizePanel.isVertical = false;
  gridSizePanel.height = "35px";
  panel.addControl(gridSizePanel);

  const colsInput = new InputText("colsInput", String(editorState.gridCols));
  colsInput.width = "60px";
  colsInput.height = "28px";
  colsInput.color = "white";
  colsInput.fontSize = 12;
  colsInput.fontFamily = "monospace";
  colsInput.background = "rgba(40, 40, 60, 0.8)";
  colsInput.focusedBackground = "rgba(60, 60, 100, 0.8)";
  colsInput.thickness = 1;
  colsInput.onTextChangedObservable.add((eventData) => {
    const val = parseInt(eventData.text, 10);
    if (!isNaN(val) && val >= 4 && val <= 50) {
      editorState.gridCols = val;
    }
  });
  gridSizePanel.addControl(colsInput);

  const xLabel = new TextBlock("xLabel", " x ");
  xLabel.color = "#aaaaaa";
  xLabel.fontSize = 12;
  xLabel.width = "25px";
  gridSizePanel.addControl(xLabel);

  const rowsInput = new InputText("rowsInput", String(editorState.gridRows));
  rowsInput.width = "60px";
  rowsInput.height = "28px";
  rowsInput.color = "white";
  rowsInput.fontSize = 12;
  rowsInput.fontFamily = "monospace";
  rowsInput.background = "rgba(40, 40, 60, 0.8)";
  rowsInput.focusedBackground = "rgba(60, 60, 100, 0.8)";
  rowsInput.thickness = 1;
  rowsInput.onTextChangedObservable.add((eventData) => {
    const val = parseInt(eventData.text, 10);
    if (!isNaN(val) && val >= 4 && val <= 50) {
      editorState.gridRows = val;
    }
  });
  gridSizePanel.addControl(rowsInput);

  // Ground texture selector
  const texLabel = new TextBlock("texLabel", "GROUND TEXTURE");
  texLabel.color = "white";
  texLabel.fontSize = 12;
  texLabel.fontFamily = "monospace";
  texLabel.fontWeight = "bold";
  texLabel.height = "25px";
  texLabel.paddingTop = "8px";
  texLabel.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
  panel.addControl(texLabel);

  let texIdx = AVAILABLE_GROUND_TEXTURES.indexOf(editorState.groundTexture as typeof AVAILABLE_GROUND_TEXTURES[number]);
  if (texIdx < 0) texIdx = 0;

  const texBtn = Button.CreateSimpleButton("texBtn", AVAILABLE_GROUND_TEXTURES[texIdx]);
  texBtn.width = 1;
  texBtn.height = "30px";
  texBtn.color = "white";
  texBtn.fontSize = 12;
  texBtn.fontFamily = "monospace";
  texBtn.background = "rgba(60, 60, 80, 0.6)";
  texBtn.cornerRadius = 4;
  texBtn.thickness = 1;
  texBtn.onPointerClickObservable.add(() => {
    texIdx = (texIdx + 1) % AVAILABLE_GROUND_TEXTURES.length;
    texBtn.textBlock!.text = AVAILABLE_GROUND_TEXTURES[texIdx];
    editorState.groundTexture = AVAILABLE_GROUND_TEXTURES[texIdx];
    callbacks.onTextureChange(AVAILABLE_GROUND_TEXTURES[texIdx]);
  });
  panel.addControl(texBtn);

  // Selected object controls
  const objLabel = new TextBlock("objLabel", "OBJECT CONTROLS");
  objLabel.color = "white";
  objLabel.fontSize = 12;
  objLabel.fontFamily = "monospace";
  objLabel.fontWeight = "bold";
  objLabel.height = "25px";
  objLabel.paddingTop = "10px";
  objLabel.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
  panel.addControl(objLabel);

  const rotateBtn = Button.CreateSimpleButton("rotateBtn", "Rotate (R)");
  rotateBtn.width = 1;
  rotateBtn.height = "30px";
  rotateBtn.color = "white";
  rotateBtn.fontSize = 11;
  rotateBtn.fontFamily = "monospace";
  rotateBtn.background = "rgba(60, 80, 60, 0.6)";
  rotateBtn.cornerRadius = 4;
  rotateBtn.thickness = 1;
  rotateBtn.paddingTop = "3px";
  rotateBtn.onPointerClickObservable.add(() => {
    rotateSelection(paletteState);
    callbacks.onRegenerate();
  });
  panel.addControl(rotateBtn);

  const rerollBtn = Button.CreateSimpleButton("rerollBtn", "New Seed (N)");
  rerollBtn.width = 1;
  rerollBtn.height = "30px";
  rerollBtn.color = "white";
  rerollBtn.fontSize = 11;
  rerollBtn.fontFamily = "monospace";
  rerollBtn.background = "rgba(60, 80, 60, 0.6)";
  rerollBtn.cornerRadius = 4;
  rerollBtn.thickness = 1;
  rerollBtn.paddingTop = "3px";
  rerollBtn.onPointerClickObservable.add(() => {
    rerollSeed(paletteState);
    callbacks.onRegenerate();
  });
  panel.addControl(rerollBtn);

  // Scale slider
  const scaleLabel = new TextBlock("scaleLabel", "Scale: 1.0");
  scaleLabel.color = "#aaaaaa";
  scaleLabel.fontSize = 11;
  scaleLabel.fontFamily = "monospace";
  scaleLabel.height = "22px";
  scaleLabel.paddingTop = "5px";
  scaleLabel.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
  panel.addControl(scaleLabel);

  const scaleSlider = new Slider("scaleSlider");
  scaleSlider.minimum = 0.5;
  scaleSlider.maximum = 2.0;
  scaleSlider.value = 1.0;
  scaleSlider.step = 0.1;
  scaleSlider.height = "20px";
  scaleSlider.width = 1;
  scaleSlider.color = "#88aacc";
  scaleSlider.background = "#333333";
  scaleSlider.thumbColor = "#aaccee";
  scaleSlider.onValueChangedObservable.add((value) => {
    paletteState.currentScale = value;
    scaleLabel.text = `Scale: ${value.toFixed(1)}`;
  });
  panel.addControl(scaleSlider);

  return container;
}

// ============================================================================
// Top Bar — Preview, Export, Import
// ============================================================================

function createEditorTopBar(
  ui: AdvancedDynamicTexture,
  editorState: EditorState,
  paletteState: PaletteState,
  callbacks: {
    onGridResize: (cols: number, rows: number) => void;
    onTextureChange: (texture: string) => void;
    onRegenerate: () => void;
    onTogglePreview: (preview: boolean) => void;
  },
): Rectangle {
  const container = new Rectangle("editorTopBar");
  container.width = 1;
  container.height = "45px";
  container.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
  container.background = "rgba(0, 0, 0, 0.8)";
  container.thickness = 0;
  container.zIndex = 10;
  ui.addControl(container);

  const panel = new StackPanel("topBarPanel");
  panel.isVertical = false;
  panel.height = 1;
  container.addControl(panel);

  // Title
  const titleText = new TextBlock("editorTitle", "STRIFE MAP EDITOR");
  titleText.color = "white";
  titleText.fontSize = 18;
  titleText.fontFamily = "monospace";
  titleText.fontWeight = "bold";
  titleText.width = "250px";
  panel.addControl(titleText);

  // Spacer
  const spacer = new TextBlock("spacer", "");
  spacer.width = "200px";
  panel.addControl(spacer);

  // Preview button
  let previewOn = false;
  const previewBtn = Button.CreateSimpleButton("previewBtn", "Preview");
  previewBtn.width = "100px";
  previewBtn.height = "32px";
  previewBtn.color = "white";
  previewBtn.fontSize = 13;
  previewBtn.fontFamily = "monospace";
  previewBtn.background = "rgba(80, 80, 120, 0.6)";
  previewBtn.cornerRadius = 4;
  previewBtn.thickness = 1;
  previewBtn.paddingRight = "5px";
  previewBtn.onPointerClickObservable.add(() => {
    previewOn = !previewOn;
    editorState.previewMode = previewOn;
    previewBtn.textBlock!.text = previewOn ? "Edit" : "Preview";
    callbacks.onTogglePreview(previewOn);
  });
  panel.addControl(previewBtn);

  // Export button
  const exportBtn = Button.CreateSimpleButton("exportBtn", "Export");
  exportBtn.width = "100px";
  exportBtn.height = "32px";
  exportBtn.color = "white";
  exportBtn.fontSize = 13;
  exportBtn.fontFamily = "monospace";
  exportBtn.background = "rgba(40, 120, 40, 0.6)";
  exportBtn.cornerRadius = 4;
  exportBtn.thickness = 1;
  exportBtn.paddingRight = "5px";
  exportBtn.onPointerClickObservable.add(() => {
    downloadMapJSON(editorState, `${editorState.groundTexture}_map.json`);
  });
  panel.addControl(exportBtn);

  // Import button
  const importBtn = Button.CreateSimpleButton("importBtn", "Import");
  importBtn.width = "100px";
  importBtn.height = "32px";
  importBtn.color = "white";
  importBtn.fontSize = 13;
  importBtn.fontFamily = "monospace";
  importBtn.background = "rgba(120, 100, 40, 0.6)";
  importBtn.cornerRadius = 4;
  importBtn.thickness = 1;
  importBtn.onPointerClickObservable.add(async () => {
    const mapData = await importMapJSON();
    if (mapData) {
      populateEditorFromMapData(editorState, mapData);
      callbacks.onGridResize(editorState.gridCols, editorState.gridRows);
      callbacks.onTextureChange(editorState.groundTexture);
      callbacks.onRegenerate();
    }
  });
  panel.addControl(importBtn);

  return container;
}
