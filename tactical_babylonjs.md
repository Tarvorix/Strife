# Strife — Design Document (Babylon.js)

> **Project:** Turn-Based Squad Tactics Prototype  
> **Engine:** Babylon.js (TypeScript)  
> **Renderer:** WebGPU (primary) / WebGL2 (fallback)  
> **Platforms:** Desktop browsers (Chrome, Firefox, Edge, Safari) + Mobile browsers (iOS Safari, Android Chrome)  
> **Style:** Grimdark Military / 40K-adjacent  
> **Perspective:** Top-down 3D (Mechanicus / XCOM style)  
> **Mode:** Player vs AI (single player)  
> **Status:** Prototype / Strife

---

## 1. Game Concept

A turn-based squad tactics game in the style of Warhammer 40K: Mechanicus and XCOM. Two grimdark military factions — the Order of the Abyss and the Germani — deploy 5-unit squads on an outdoor battlefield. Players control one faction as commander, issuing orders to individual units on a square grid. An AI opponent controls the opposing faction.

The prototype validates the core tactical loop: positioning, cover usage, action point management, and ranged/melee combat on a 3D battlefield viewed from above.

---

## 2. Tech Stack

| Component | Choice | Notes |
|-----------|--------|-------|
| Engine | Babylon.js 8.x | Full 3D engine with native WebGPU support, built-in GUI, particles, post-processing, new audio engine |
| Language | TypeScript | Type safety, Babylon.js is built for TypeScript |
| Renderer | WebGPUEngine (primary) | Falls back to WebGL2 Engine automatically for unsupported browsers |
| Build Tool | Vite | Fast dev server, TypeScript out of the box, hot reload |
| Models | GLB format | Loaded via `SceneLoader.ImportMeshAsync`, rigged + animated from Mixamo pipeline |
| Terrain | Procedural geometry | `MeshBuilder.CreateGround` + generated rocks/columns via `MeshBuilder` primitives |
| Textures | Polyhaven PBR | CC0 ground materials, rock textures (user-provided), loaded as `PBRMaterial` |
| Tiles | Quaternius Sci-Fi Kit | GLB exports already complete (future indoor maps) |
| GUI | Babylon.js GUI (`@babylonjs/gui`) | `AdvancedDynamicTexture` for in-world and fullscreen UI — health bars, AP, turn controls |
| Map Editor | Separate Babylon.js app | Browser-based, exports JSON map files |
| Platforms | Desktop + Mobile | Touch input support via Babylon.js `PointerEvent` abstraction, responsive canvas sizing |

### WebGPU / WebGL2 Fallback Strategy

```typescript
import { Engine, WebGPUEngine } from "@babylonjs/core";

async function createEngine(canvas: HTMLCanvasElement): Promise<Engine> {
  const webGPUSupported = await WebGPUEngine.IsSupportedAsync;
  if (webGPUSupported) {
    const engine = new WebGPUEngine(canvas, { antialias: true });
    await engine.initAsync();
    return engine;
  }
  // Fallback to WebGL2 — same API surface, runs everywhere
  return new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
}
```

The game is authored once — Babylon.js abstracts the rendering backend. WebGPU provides better performance for post-processing and particle systems. WebGL2 ensures compatibility on older devices and iOS Safari versions that don't yet support WebGPU.

### Platform Support Matrix

| Platform | Browser | Renderer | Priority |
|----------|---------|----------|----------|
| Desktop | Chrome 113+ | WebGPU | P0 |
| Desktop | Firefox | WebGL2 (WebGPU in nightly) | P0 |
| Desktop | Edge | WebGPU | P1 |
| Desktop | Safari 18+ | WebGPU | P1 |
| iPad | Safari 18+ | WebGPU | P0 |
| iPhone | Safari 18+ | WebGPU | P0 |
| Android | Chrome | WebGPU / WebGL2 | P1 |

### Mobile Considerations
- Canvas sized to `window.innerWidth / window.innerHeight` with `engine.resize()` on orientation change
- Touch input handled natively by Babylon.js pointer events — no separate touch layer needed
- `devicePixelRatio` capped at 2.0 on mobile to prevent GPU overload on high-DPI screens
- Post-processing quality scaled down on mobile (half-res SSAO, reduced particle count)
- UI elements sized for touch targets (minimum 44×44px tap areas per Apple HIG)

---

## 3. Camera System

### Setup
- **Camera type:** `ArcRotateCamera` locked to a top-down tactical angle
- **Projection:** Orthographic mode via `camera.mode = Camera.ORTHOGRAPHIC_CAMERA` (matches Mechanicus/XCOM top-down feel, no perspective distortion)
- **Angle:** Beta (elevation) locked at approximately 0.35–0.5 radians (~20-30° from vertical). Alpha (rotation) locked. This gives depth to the 3D models while maintaining tactical readability
- **Default zoom:** Orthographic bounds set to show roughly 12×8 grid tiles on screen
- **Rotation:** Fixed (alpha locked — no rotation for prototype, simplifies unit facing and readability)

### Controls
- **Pan:** `camera.panningSensibility` enabled. Click-drag right mouse / two-finger drag on touch / WASD keys via custom `scene.onKeyboardObservable`
- **Zoom:** Scroll wheel / pinch-to-zoom adjusts orthographic bounds, clamped between "see whole map" and "close-up on 3×3 tiles"
- **Combat zoom:** When an attack resolves, `BABYLON.Animation.CreateAndStartAnimation` smoothly tweens the camera target and orthographic bounds to frame the attacker and target at a closer zoom. Holds for the animation duration, then eases back to the player's previous view. This is the Mechanicus "combat cam" feel — a brief cinematic moment within the tactical flow

### Bounds
- Camera target panning is clamped via `camera.lowerAlphaLimit / upperAlphaLimit` and custom bounds checking so the viewport never leaves the map boundaries (Fill & Crop — no dead space visible)

### Mobile Camera
- Two-finger drag for panning, pinch for zoom — handled natively by `ArcRotateCamera`
- `camera.pinchPrecision` and `camera.panningSensibility` tuned for touch responsiveness
- No rotate gesture (alpha locked)

---

## 4. Factions & Units

### Prototype Scope
Two factions, one infantry unit type each. Stats are mirrored (identical gameplay values) but models, animations, and color schemes are distinct.

### Order of the Abyss
- Dark, occult grimdark aesthetic
- Distinct silhouette and color palette
- **Acolytes** — 1 infantry unit type, squad of 5

### Germani
- Militant, disciplined grimdark aesthetic
- Contrasting color palette for readability
- **Shock Troops** — 1 infantry unit type, squad of 5

### Unit Stats (Mirrored)

| Stat | Value | Notes |
|------|-------|-------|
| HP | 10 | Lethal in 2-3 hits |
| AP | 2 | Per activation |
| Movement | 4 tiles | Per move action (1 AP) |
| Ranged Attack | 4 damage | 1 AP, range 8 tiles |
| Melee Attack | 5 damage | 1 AP, must be adjacent |
| Accuracy (ranged) | 70% | Base hit chance |
| Accuracy (melee) | 85% | Base hit chance |
| Cover Bonus | -25% | Applied to attacker's accuracy |
| High Ground Bonus | +10% | Attacker on elevated terrain |

*Stats are placeholder — tuning happens during playtesting.*

---

## 5. Animations

Each faction has its own model with individually exported animations (separate GLB files per animation due to export constraints). Weapon position/rotation is baked per animation.

### Per Faction (7 animations each, 14 total)

| Animation | Use | Priority |
|-----------|-----|----------|
| **Idle** | Default standing state, weapon ready | Must-have |
| **Walk** | Moving between grid tiles (standard movement) | Must-have |
| **Run** | Faster movement, sprinting between positions | Must-have |
| **Attack Ranged** | Shooting at a target | Must-have |
| **Attack Melee** | Close combat strike | Must-have |
| **Hit Reaction** | Taking damage, flinch/stagger | Should-have |
| **Death** | Unit eliminated | Must-have |

### Animation Pipeline
1. Source character from Mixamo (or Meshy AI → Mixamo rigging)
2. Download each animation as separate FBX (with skin)
3. Process in Blender — weapon positioning per animation, material setup
4. Export each animation as individual GLB
5. Load in Babylon.js via `SceneLoader.ImportMeshAsync`, store `AnimationGroup` references per unit

### Runtime Animation Logic (Babylon.js)
- Each GLB import yields `AnimationGroup` objects — stored by name in a map per unit instance
- Idle plays on loop: `idleAnimGroup.start(true)` (looping = true)
- Walk/Run plays during movement, crossfade to idle on arrival via `animGroup.weight` blending
- Attack animations play once: `attackAnimGroup.start(false)` with `onAnimationGroupEndObservable` callback to trigger next action
- Hit reaction plays on the target when damage is dealt
- Death plays once, model remains on ground (or fades out via `mesh.visibility` tween after delay)
- Animation blending via `AnimationGroup.weight` property for smooth transitions

---

## 6. Game Flow

### Match Setup
1. Load map from JSON
2. Spawn Order of the Abyss Acolytes on designated spawn tiles
3. Spawn Germani Shock Troops (AI) on opposing spawn tiles
4. Player goes first (or coin flip — configurable)

### Turn Structure (Alternating Activation)
Unlike XCOM's "move all your units then enemy moves all," this uses **alternating activation** — player activates one unit, then AI activates one unit, back and forth. This keeps both sides engaged and creates tactical interplay.

```
Turn Start
  → Player activates Unit 1 (move + action)
  → AI activates Unit 1 (move + action)
  → Player activates Unit 2
  → AI activates Unit 2
  → ... until all units activated
  → Turn ends
  → New turn begins
```

### Unit Activation Flow
1. **Select unit** — Click/tap on a friendly unit that hasn't activated this turn
2. **Movement phase** — Grid highlights reachable tiles (blue). Click/tap a tile to move (costs 1 AP). Can skip movement
3. **Action phase** — Choose action:
   - **Shoot** — Select enemy in range and LOS. Resolve hit/miss, play animations (1 AP)
   - **Melee** — Must be adjacent to enemy. Resolve hit/miss, play animations (1 AP)
   - **Overwatch** — Unit watches a cone/area, will auto-shoot first enemy that enters (1 AP, resolves during enemy turn)
   - **Hunker Down** — Double cover bonus until next activation (1 AP)
   - **End activation** — Save remaining AP (unused AP is lost)
4. Unit is marked as activated (dimmed/grayed)

### Win Conditions
- **Elimination:** Destroy all enemy units
- **Future expansion:** Objective-based (hold points, retrieve items, reach extraction)

---

## 7. Combat System

### Ranged Attack Resolution
```
1. Check LOS (raycast from attacker to target on grid)
2. Check range (tile distance ≤ weapon range)
3. Calculate hit chance:
   Base accuracy (70%)
   - Cover penalty (if target in cover: -25%)
   + High ground bonus (if attacker elevated: +10%)
   + Flanking bonus (if attacking from side/rear: +15%)
4. Roll random [0-100]
5. If hit: deal damage, play attack animation → hit reaction on target
6. If miss: play attack animation, miss VFX (shot goes wide)
7. If target HP ≤ 0: play death animation, remove from active units
```

### Melee Attack Resolution
```
1. Must be on adjacent tile (including diagonals)
2. Calculate hit chance:
   Base accuracy (85%)
   - No cover penalty in melee
3. Roll, resolve damage
4. Play melee animation on attacker, hit reaction on target
```

### Cover System
- **Half cover:** Rocks, low walls, debris. -25% to incoming ranged accuracy
- **Full cover:** Large rocks, thick columns. -50% to incoming ranged accuracy, blocks LOS from certain angles
- Cover is directional — only applies if the cover object is between attacker and target
- Melee ignores cover

### Line of Sight
- Grid-based raycast from attacker tile to target tile (logical grid check, not Babylon.js physics ray)
- If the ray crosses a wall tile or full-cover tile, LOS is blocked
- Half-cover tiles don't block LOS, they just apply a penalty
- Units do not block LOS for prototype (simplification)
- Babylon.js `Ray` class available for visual LOS indicator line rendering

---

## 8. Battlefield — Outdoor Map

### Terrain Composition
The prototype uses outdoor maps only. The ground is a flat textured plane with procedurally generated 3D cover objects placed on the grid.

### Ground Plane
- `MeshBuilder.CreateGround("ground", { width: 40, height: 32, subdivisions: 1 }, scene)` sized to the grid (e.g., 20×16 tiles at 2m per tile)
- `PBRMaterial` with Polyhaven textures: albedo, normal, roughness/metallic, AO maps loaded as `Texture` objects
- Suggested textures: cracked earth, muddy ground, scorched dirt, gravel — grimdark aesthetic
- Texture tiled via `texture.uScale` and `texture.vScale`

### Procedural Cover Objects
Generated at runtime from Babylon.js `MeshBuilder` geometry + Polyhaven rock/stone PBR textures:

| Object | Geometry | Cover Type | Generation |
|--------|----------|------------|------------|
| **Boulders** | `MeshBuilder.CreateIcoSphere` with vertex displacement | Half or full cover (size-dependent) | Random seed → vertex position noise → non-uniform scaling |
| **Rock clusters** | Multiple small displaced icospheres merged via `Mesh.MergeMeshes` | Half cover | 3-5 small rocks grouped |
| **Columns/pillars** | `MeshBuilder.CreateCylinder`, optional vertex noise | Full cover | Height variation, optional "broken top" via vertex displacement |
| **Ruined walls** | `MeshBuilder.CreateBox`, stretched, jagged top edge | Full cover (directional) | Width/height variation, top vertices displaced |
| **Barricades** | Stacked deformed boxes | Half cover | Low and wide, tactical height |
| **Craters** | `MeshBuilder.CreateDisc` with inverted vertex displacement | No cover (open ground marker) | Circular depression, charred texture |

### Map Data
Each procedural object is deterministic from a seed, so the map JSON stores minimal data:

```json
{
  "name": "Scorched Outpost",
  "gridSize": [20, 16],
  "tileSize": 2.0,
  "groundTexture": "cracked_earth",
  "spawnZones": {
    "orderOfTheAbyss": [[0,6], [0,7], [0,8], [0,9], [1,6], [1,7], [1,8], [1,9]],
    "germani": [[19,6], [19,7], [19,8], [19,9], [18,6], [18,7], [18,8], [18,9]]
  },
  "objects": [
    { "type": "boulder", "tile": [5, 4], "seed": 12345, "scale": 1.2, "cover": "half" },
    { "type": "column", "tile": [10, 8], "seed": 67890, "scale": 1.0, "cover": "full" },
    { "type": "ruined_wall", "tile": [7, 10], "seed": 11111, "rotation": 90, "cover": "full" },
    { "type": "rock_cluster", "tile": [14, 3], "seed": 22222, "scale": 0.8, "cover": "half" }
  ],
  "lights": [
    { "type": "point", "tile": [8, 5], "color": "#44ff44", "intensity": 2.0, "radius": 6.0, "height": 0.5 },
    { "type": "point", "tile": [12, 10], "color": "#ff4422", "intensity": 1.5, "radius": 4.0, "height": 1.0 },
    { "type": "point", "tile": [3, 14], "color": "#ffaa33", "intensity": 2.5, "radius": 5.0, "height": 0.3 }
  ]
}
```

### Elevation (Future)
The prototype uses a flat plane. Future versions can add heightmap elevation via `MeshBuilder.CreateGroundFromHeightMap` for high ground / low ground gameplay. The grid system and LOS calculations are designed to accommodate a Y-component later.

---

## 9. Map Editor

A separate browser-based Babylon.js application for authoring maps. Exports JSON files consumed by the game.

### Editor Features
- **Grid overlay** on a ground plane, showing tile boundaries via `GridMaterial` or custom line meshes
- **Object palette** — sidebar listing available object types (boulder, column, wall, barricade, crater, spawn zone, point light)
- **Click/tap to place** — Select object type, click a tile to place it
- **Right-click / long-press to remove** — Delete object from tile
- **Rotation** — R key or button to rotate selected object in 90° increments
- **Cover type toggle** — Cycle between half/full/none for placed objects
- **Seed randomization** — Each placed object gets a random seed; button to re-roll for a different look
- **Spawn zone painting** — Toggle mode to paint Order of the Abyss / Germani spawn tiles
- **Light placement** — Place environmental point lights, pick color and intensity
- **Grid size controls** — Set map width and height
- **Ground texture selector** — Choose from available Polyhaven textures
- **Preview mode** — Hide grid overlay and UI to see the map as it would appear in-game
- **Export** — Save map as JSON file
- **Import** — Load existing JSON map for editing

### Editor Does NOT Need
- Undo/redo (for prototype)
- Multi-select or copy/paste
- Custom object scaling (use preset sizes)
- Terrain elevation editing (flat maps only for now)

---

## 10. GUI — Player Interface

Babylon.js provides a native GUI system via `@babylonjs/gui` with `AdvancedDynamicTexture`. This renders UI on a 2D texture overlay on top of the 3D scene — no HTML/CSS layer needed. This keeps everything in one render pipeline and simplifies mobile touch handling since Babylon.js manages both 3D and 2D input.

### HUD Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  [TURN 1]        ORDER OF THE ABYSS's TURN          [⚙ Settings] │  ← Top bar
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│                                                                 │
│                                                                 │
│                     3D BATTLEFIELD                              │
│                     (Babylon.js canvas)                         │
│                                                                 │
│                                                                 │
│                                                                 │
├────────────────────┬────────────────────────────────────────────┤
│  [UNIT CARD]       │  [ACTION BAR]                              │
│  Portrait/Icon     │  [🔫 Shoot] [⚔ Melee] [👁 Overwatch]     │
│  HP: ████████░░    │  [🛡 Hunker] [⏭ End Turn]                │
│  AP: ●●            │                                            │
│  Status: Ready     │  [Unit 1 ● ] [Unit 2 ● ] [Unit 3 ○ ]    │
│                    │  [Unit 4 ○ ] [Unit 5 ○ ]                  │
│                    │  ● = activated  ○ = available              │
└────────────────────┴────────────────────────────────────────────┘
```

### GUI Implementation

**Fullscreen UI layer** — `AdvancedDynamicTexture.CreateFullscreenUI("ui")` for HUD elements:
- Top bar: `StackPanel` (horizontal) with `TextBlock` for turn info and `Button` for settings
- Unit card: `Rectangle` container with `TextBlock` for stats, `Rectangle` with width animation for HP bar, `Ellipse` elements for AP pips
- Action bar: `StackPanel` (horizontal) with `Button` elements. Disabled buttons use reduced `alpha` and `isEnabled = false`
- Unit roster: Row of `Ellipse` markers, color-coded by activation status

**In-world UI** — `AdvancedDynamicTexture.CreateForMesh` or billboard-linked controls for:
- **Health bars** — `Rectangle` with inner `Rectangle` scaled to HP%, linked to unit mesh position via `linkWithMesh()`
- **AP pips** — Small `Ellipse` elements linked below health bar
- **Damage numbers** — `TextBlock` that animates `top` offset and `alpha` fade via `Animation`

### Mobile GUI Scaling
- All GUI elements use Babylon.js `idealWidth` / `idealHeight` on `AdvancedDynamicTexture` for automatic DPI scaling
- Touch targets minimum 44px equivalent via `widthInPixels` / `heightInPixels` constraints
- Bottom bar collapses to icon-only mode on small screens (phone portrait)
- Unit card slides in from left edge as a drawer on mobile

### AI Turn Presentation
During the AI's activations, the camera follows the active AI unit. Actions play out with a brief delay between each (0.5-1s) so the player can follow what's happening. A subtle "ENEMY TURN" banner displays at the top via `TextBlock` with fade-in animation.

---

## 11. VFX — Weapon Effects

Babylon.js has a built-in `ParticleSystem` and `GPUParticleSystem` (WebGPU-accelerated). All VFX use these native systems.

### Ranged Attack (Shooting)
- **Muzzle flash** — `PointLight` flash (intensity spike + decay) + `ParticleSystem` burst at weapon barrel, emitting for 2-3 frames with additive blend mode
- **Tracer/bullet trail** — `MeshBuilder.CreateLines` or stretched `MeshBuilder.CreatePlane` with emissive `StandardMaterial`, animated along a path via `Animation` (~0.15s travel time gives visual feedback)
- **Impact hit** — `ParticleSystem` burst at target position (spark texture for metal/armor, dust texture for ground miss), short `maxLifeTime`, high initial `emitPower`
- **Miss trail** — Same tracer but offset to pass near the target and hit the ground behind them, small dirt particle burst

### Melee Attack
- **Weapon swing trail** — `TrailMesh` attached to weapon bone, or `ParticleSystem` emitting along an arc path, fades quickly
- **Impact flash** — Bright emissive `Sprite` at contact point
- **Blood/spark burst** — `ParticleSystem` with velocity, gravity via `particleSystem.gravity`, fade-out

### Overwatch Trigger
- Same as ranged attack VFX but preceded by a brief "reaction" indicator — overwatch cone flashes via emissive material pulse, short delay, then fires

### Death
- Unit plays death animation
- Optional: `ParticleSystem` dust cloud at base as they fall
- Unit model stays on the ground (dimmed via `mesh.material.albedoColor` desaturation) or fades out via `mesh.visibility` tween

### WebGPU Particle Advantage
`GPUParticleSystem` runs particle simulation on the GPU, supporting significantly higher particle counts without CPU overhead. Used for larger VFX (artillery strikes, environmental effects) in future. For the prototype, standard `ParticleSystem` is sufficient.

### Implementation Notes
- All VFX are short-lived (< 1 second) and auto-dispose: `particleSystem.disposeOnStop = true`
- Particle textures: simple 8×8 or 16×16 PNGs (spark, smoke puff, dust), packed into sprite sheet or individual files
- `ParticleSystem.blendMode = BABYLON.ParticleSystem.BLENDMODE_ADD` for glowing effects

---

## 12. AI Opponent

### Prototype AI (Rule-Based)
No machine learning for the prototype. Simple priority-based decision making.

### Activation Priority (Which Unit to Activate)
1. Unit with an enemy in range and LOS (can shoot immediately)
2. Unit closest to an enemy (can close distance)
3. Unit furthest from cover (needs to reposition)
4. Any remaining unit

### Action Decision Tree
```
IF adjacent enemy exists:
  → Melee attack (higher damage, higher accuracy)
ELSE IF enemy in range + LOS:
  → Shoot highest-priority target
    Priority: lowest HP > closest > no cover
ELSE IF can move into range of an enemy:
  → Move toward nearest enemy, end in cover if possible
  → Shoot if now in range
ELSE:
  → Move toward nearest enemy
  → End activation
```

### AI Behavior Notes
- AI always tries to use cover when moving (prefers tiles adjacent to cover objects)
- AI doesn't use overwatch or hunker down in prototype (simplification)
- AI has a short delay (0.5-1s) between decisions via `setTimeout` or `scene.onBeforeRenderObservable` timer so the player can follow along
- AI uses the same rules as the player — no cheating, no information the player doesn't have

### Future AI Expansion
- Difficulty levels (easy skips optimal plays, hard uses flanking and focus fire)
- Overwatch and hunker usage
- AlphaZero / MCTS integration (the turn-based grid structure is ideal for this)

---

## 13. Lighting & Atmosphere

The visual target is Warhammer 40K: Mechanicus and Chaos Gate — Daemonhunters. These games share a signature look: **high contrast** scenes with strong directional lighting, glowing emissives, and colored environmental lights — NOT uniformly dark scenes. The grimdark feel comes from contrast and color grading, not from making everything hard to see.

### Core Lighting Philosophy
**Readability first, mood second.** The player must always be able to clearly see units, cover objects, and the grid at a glance. The grimdark atmosphere comes from: desaturated color grading, warm/cool light contrast, emissive glow, and atmospheric particles — NOT from low light levels. A common mistake is making the scene too dark — Mechanicus and Chaos Gate are actually well-lit scenes with heavy color grading applied on top.

**CRITICAL: Cumulative Darkening Warning.** Each of these systems reduces visible brightness: PBR materials (energy-conserving = darker than StandardMaterial), SSAO (darkens creases), vignette (darkens edges), desaturation (perceived darker), bloom threshold (dims non-emissive surfaces by comparison). Start with a scene that looks slightly TOO bright, then layer post-processing on. If the scene looks good before post-processing, it will be too dark after.

### Light Rig (Babylon.js) — Concrete Values

**1. Key Light (DirectionalLight)**
```typescript
const keyLight = new DirectionalLight("keyLight", new Vector3(-1, -2, 1), scene);
keyLight.intensity = 1.5;  // START HERE — not 0.5, not 0.8. 1.5.
keyLight.diffuse = new Color3(0.95, 0.85, 0.75);  // Warm desaturated — NOT pure white
keyLight.specular = new Color3(0.9, 0.85, 0.8);

// Shadows
const shadowGen = new ShadowGenerator(2048, keyLight);
shadowGen.usePercentageCloserFiltering = true;
shadowGen.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;
shadowGen.bias = 0.005;
shadowGen.normalBias = 0.02;
```
- This is the main scene illumination. It should clearly light the battlefield
- Angled to cast visible shadows across the grid (~30-40° elevation)
- Warm tone gives the grimdark "overcast through smoke" feel

**2. Rim/Back Light (DirectionalLight)**
```typescript
const rimLight = new DirectionalLight("rimLight", new Vector3(1, -1, -1), scene);
rimLight.intensity = 1.0;  // Strong enough to clearly outline unit silhouettes
rimLight.diffuse = new Color3(0.6, 0.65, 0.85);  // Cool blue-white
rimLight.specular = new Color3(0.5, 0.55, 0.75);
rimLight.shadowEnabled = false;  // No shadows — purely for rim highlight
```
- Positioned roughly opposite the key light
- The cool vs warm contrast between key and rim light is what creates the Mechanicus look
- Must be strong enough to actually see the rim on unit models — if you can't see it, increase intensity

**3. Ambient (HemisphericLight)**
```typescript
const ambient = new HemisphericLight("ambient", new Vector3(0, 1, 0), scene);
ambient.intensity = 0.4;  // NOT 0.1. That's how you get a black scene.
ambient.diffuse = new Color3(0.4, 0.42, 0.5);  // Cool blue-grey
ambient.groundColor = new Color3(0.15, 0.12, 0.1);  // Warm dark brown
ambient.specular = Color3.Black();  // No specular from ambient
```
- **0.4 intensity is the floor.** Do not go below this. The color grading handles the mood, not ambient darkness
- The cool top / warm ground color split gives subtle environmental shading
- If the scene looks too bright at 0.4, fix it with color grading, NOT by lowering ambient

**4. Environmental Point Lights (PointLight)**
```typescript
const envLight = new PointLight("fire1", new Vector3(x, 0.5, z), scene);
envLight.intensity = 3.0;  // Point lights need higher intensity due to falloff
envLight.diffuse = new Color3(1.0, 0.5, 0.15);  // Amber fire example
envLight.range = 8.0;  // ~4 tiles radius
envLight.shadowEnabled = false;  // Performance — no point light shadows
```
- These add color and visual interest, not primary illumination
- Defined in map JSON, placed via the editor
- Suggested colors: sickly green `(0.3, 0.8, 0.2)`, deep red `(0.9, 0.15, 0.1)`, amber fire `(1.0, 0.5, 0.15)`, cold blue `(0.2, 0.4, 0.9)`
- Limit to 10-15 per map for performance

**5. Unit-Attached Lights (Optional but High Impact)**
```typescript
const unitGlow = new PointLight("unitGlow", Vector3.Zero(), scene);
unitGlow.intensity = 0.8;
unitGlow.diffuse = new Color3(0.3, 0.5, 1.0);  // Order of the Abyss: cold blue
unitGlow.range = 3.0;  // Small pool at their feet
unitGlow.parent = unitTransformNode;
unitGlow.shadowEnabled = false;
```
- Order of the Abyss: cold blue weapon glow `(0.3, 0.5, 1.0)`
- Germani: warm red/amber `(1.0, 0.4, 0.15)`
- Subtle but visible pool of colored light at their feet

### Emissive Materials
Critical to the Mechanicus/Chaos Gate aesthetic. Babylon.js `PBRMaterial` supports `emissiveColor` and `emissiveTexture` natively.

```typescript
// Example: glowing weapon coil
const weaponMat = new PBRMaterial("weaponGlow", scene);
weaponMat.emissiveColor = new Color3(0.3, 0.5, 1.0);
weaponMat.emissiveIntensity = 2.0;  // > 1.0 to trigger bloom
// Base material can still have albedo, roughness etc — emissive adds on top
```

- **Unit eyes** — Glowing through helmet visors via `emissiveColor` on eye material
- **Weapon details** — Power cells, barrel tips, energy coils with `emissiveIntensity` 1.5-3.0 to trigger bloom
- **Armor accents** — Runes, insignia, power conduits
- **Environment objects** — Cracked ground with lava/warp energy, obelisk carvings, data terminals
- Emissive color and intensity tuned per faction for visual identity
- Emissives interact with bloom post-processing to create the signature glow bleed

### Atmospheric Particles
A subtle but constant particle layer using Babylon.js `ParticleSystem`:

- **Floating ash/embers** — `ParticleSystem` with small billboard textures drifting slowly upward. Warm orange-white. `emitRate` low (~5-10/sec), long `maxLifeTime` (~8-10s), large `emitter` box covering the visible scene
- **Dust motes** — Even smaller particles, neutral colored, caught in light. Lazy drift via low `direction1/direction2` velocity
- **Ground fog wisps** — `ParticleSystem` with `minEmitBox` / `maxEmitBox` constrained to ground level (Y near 0), semi-transparent white/grey, large particle size, very slow movement. Concentrated in low areas
- All particles use `BLENDMODE_ADD` or `BLENDMODE_STANDARD` depending on effect
- Performance cost is minimal — these are simple billboards with low emit rates

### Post-Processing Stack (Babylon.js DefaultRenderingPipeline)

**IMPORTANT: Apply post-processing AFTER the scene looks clearly readable with just the lights above. Post-processing should enhance mood, not create it. If you can't see things clearly before post-processing, your lights are too dim.**

```typescript
const pipeline = new DefaultRenderingPipeline("pipeline", true, scene, [camera]);
```

**1. SSAO (SSAO2RenderingPipeline)**
```typescript
const ssao = new SSAO2RenderingPipeline("ssao", scene, { ssaoRatio: 0.5, blurRatio: 0.5 });
ssao.totalStrength = 1.0;  // Default is fine — don't crank this up
ssao.radius = 2.0;  // Scaled for top-down camera distance
ssao.samples = 16;
// Mobile: ssaoRatio: 0.25 for performance
```
- Adds contact shadows in crevices, under units, at cover bases
- Grounds objects in the scene — prevents "floating on a plane" look
- **Do NOT increase totalStrength above 1.5** — it compounds with other darkening effects

**2. Bloom**
```typescript
pipeline.bloomEnabled = true;
pipeline.bloomThreshold = 0.8;  // Only bright emissives trigger bloom, not the whole scene
pipeline.bloomWeight = 0.3;  // Visible but not overwhelming
pipeline.bloomKernel = 64;  // Soft wide glow
pipeline.bloomScale = 0.5;
```
- This makes weapon glows, eyes, and energy effects pop
- Threshold of 0.8 means only emissive materials with intensity > 1.0 will bloom
- If the whole scene is blooming, your threshold is too low

**3. Volumetric God Rays (Optional — High Impact)**
- `VolumetricLightScatteringPostProcess` built into Babylon.js
- Light shafts from the key light direction cutting through the atmospheric haze
- If full volumetrics are too expensive on mobile, fake it with 2-3 static transparent mesh planes angled to look like light shafts, placed strategically on the map

**4. Color Grading — THIS IS WHERE THE MOOD LIVES**
```typescript
pipeline.imageProcessingEnabled = true;
pipeline.imageProcessing.exposure = 0.9;  // Slightly under 1.0 — subtle darkening only
pipeline.imageProcessing.contrast = 1.2;  // Boost contrast — darks darker, brights brighter

pipeline.imageProcessing.colorCurvesEnabled = true;
const curves = new ColorCurves();
curves.globalSaturation = -25;  // Desaturate — THIS is what makes it grimdark, not low light
curves.shadowsHue = 220;  // Push shadows toward cool blue
curves.shadowsSaturation = 30;
curves.shadowsDensity = 40;
curves.highlightsHue = 40;  // Push highlights toward warm amber
curves.highlightsSaturation = 20;
curves.highlightsDensity = 40;
pipeline.imageProcessing.colorCurves = curves;
```
- **Desaturation is the single biggest contributor to the grimdark look.** Not darkness — desaturation
- The shadow→cool / highlight→warm split creates the Mechanicus color palette
- Exposure stays close to 1.0. If you drop it to 0.5, the scene dies
- For precise Mechanicus tone: optionally use `pipeline.imageProcessing.colorGradingTexture` with a custom 3D LUT

**5. Vignette**
```typescript
pipeline.imageProcessing.vignetteEnabled = true;
pipeline.imageProcessing.vignetteWeight = 2.0;  // Subtle — not a tunnel
pipeline.imageProcessing.vignetteStretch = 0.5;
pipeline.imageProcessing.vignetteColor = new Color4(0, 0, 0, 1);
pipeline.imageProcessing.vignetteCameraFov = camera.fov;
```
- Subtle edge darkening to focus attention center-screen
- **If vignetteWeight > 4.0 it starts eating into readable gameplay area** — keep it low

**6. Film Grain (Subtle)**
```typescript
pipeline.grainEnabled = true;
pipeline.grain.intensity = 8;  // Very subtle — barely perceptible
pipeline.grain.animated = true;
```
- Adds grit texture, breaks up clean digital rendering
- Keep it barely perceptible — it should feel like texture, not static

### Skybox / Background
```typescript
scene.clearColor = new Color4(0.05, 0.05, 0.07, 1);  // Dark blue-grey, NOT pure black
```
- Dark overcast, smoke-filled — not a bright sky, but not void-black either
- Polyhaven HDRI loaded via `CubeTexture.CreateFromPrefilteredData` with desaturation, or the solid color above
- `scene.environmentTexture` set to a dark HDRI for PBR material reflections — even if barely visible, it gives metallic surfaces subtle environmental reflections
- At top-down camera angle sky is barely visible, but pure black `(0,0,0)` looks like a broken scene

### Lighting Debug Checklist
Before applying post-processing, verify these with just the light rig active:
1. **Can you clearly see every unit on the field?** If no → increase key light or ambient
2. **Can you distinguish cover objects from the ground?** If no → increase key light intensity
3. **Can you see the grid lines/tile boundaries?** If no → ambient is too low
4. **Do units have visible rim highlights?** If no → increase rim light intensity
5. **Are environmental point lights creating visible colored pools on the ground?** If no → increase point light intensity or range

After applying post-processing:
6. **Can you still clearly see everything from steps 1-5?** If no → your exposure is too low or SSAO totalStrength is too high
7. **Do emissive materials glow with bloom?** If no → bloom threshold is too high or emissiveIntensity is too low
8. **Does the scene feel desaturated and contrasty?** If no → increase color curve saturation reduction

### Performance Considerations
- Point lights are the biggest cost. Limit to ~10-15 per map. Use `light.range` aggressively so they don't illuminate the whole scene
- SSAO is moderately expensive — reduced ratio on mobile, can be disabled on low-end devices
- Bloom is cheap. Always on
- Particles at these counts (< 200 total) are negligible
- Shadow maps only on the key directional light via `ShadowGenerator`. No point light shadows — expensive and not worth it at top-down angles
- `scene.performancePriority = ScenePerformancePriority.Intermediate` for balanced optimization
- WebGPU renderer handles the post-processing stack more efficiently than WebGL2

---

## 14. Project Structure

```
strife/
├── index.html              # Game entry point
├── editor.html             # Map editor entry point
├── package.json            # Dependencies (Babylon.js, Vite, TypeScript)
├── tsconfig.json           # TypeScript configuration
├── vite.config.ts          # Vite build config
├── src/
│   ├── game/
│   │   ├── main.ts         # Engine init (WebGPU/WebGL2), scene setup, game loop
│   │   ├── camera.ts       # ArcRotateCamera orthographic setup, pan/zoom, combat cam
│   │   ├── grid.ts         # Grid creation, tile management, highlighting
│   │   ├── units.ts        # Unit loading (SceneLoader), AnimationGroup management, state
│   │   ├── combat.ts       # Attack resolution, damage, LOS
│   │   ├── turns.ts        # Turn state machine, activation tracking
│   │   ├── ai.ts           # AI decision making
│   │   ├── vfx.ts          # ParticleSystem effects, muzzle flash, tracers
│   │   ├── input.ts        # Pointer events, scene picking, raycasting
│   │   ├── gui.ts          # AdvancedDynamicTexture UI — HUD, unit card, action bar
│   │   ├── map-loader.ts   # Load map JSON, generate terrain/objects, place lights
│   │   └── procedural.ts   # Rock, column, wall generation via MeshBuilder
│   ├── editor/
│   │   ├── main.ts         # Editor Babylon.js scene
│   │   ├── palette.ts      # Object type selection
│   │   ├── placement.ts    # Click/tap-to-place logic
│   │   ├── export.ts       # JSON export
│   │   └── gui.ts          # Editor interface (AdvancedDynamicTexture)
│   └── shared/
│       ├── constants.ts    # Grid size, unit stats, shared config
│       ├── types.ts        # TypeScript interfaces (MapData, UnitState, TileData, etc.)
│       └── utils.ts        # Math helpers, grid utilities
├── public/
│   ├── models/
│   │   ├── order-of-the-abyss/  # Acolyte GLB files (idle.glb, walk.glb, etc.)
│   │   └── germani/             # Shock Trooper GLB files
│   ├── textures/
│   │   └── polyhaven/      # Ground + rock PBR textures (user-provided)
│   ├── particles/           # Particle texture PNGs (spark, smoke, dust, ember)
│   └── tiles/              # Quaternius sci-fi GLB tiles (for future indoor maps)
├── maps/
│   └── test-map.json       # Default test map
└── dist/                   # Vite build output (production)
```

### Package Dependencies

```json
{
  "dependencies": {
    "@babylonjs/core": "^8.x",
    "@babylonjs/gui": "^8.x",
    "@babylonjs/loaders": "^8.x",
    "@babylonjs/materials": "^8.x",
    "@babylonjs/post-processes": "^8.x",
    "@babylonjs/recast": "^8.x"
  },
  "devDependencies": {
    "typescript": "^5.x",
    "vite": "^6.x"
  }
}
```

---

## 15. Development Phases

### Phase 1 — Foundation
- Vite + TypeScript + Babylon.js project setup
- WebGPU engine with WebGL2 fallback
- `ArcRotateCamera` in orthographic mode (pan + zoom, locked angle)
- Square grid rendering on a flat PBR-textured ground plane
- Load one GLB infantry model with idle `AnimationGroup` playing
- Click/tap a tile to highlight it (scene picking via `scene.pick()`)
- Verify desktop and mobile browser compatibility

### Phase 2 — Units & Movement
- Load 5 units per side, positioned on spawn tiles
- Unit selection (pick to select, show unit card via Babylon GUI)
- Movement range calculation and tile highlighting
- Click/tap-to-move with walk/run animation playing during movement
- Pathfinding via Babylon.js `RecastJSPlugin` (`@babylonjs/recast`) navigation mesh, with grid-snapped waypoint output
- Mobile touch input verification

### Phase 3 — Combat
- Ranged attack: target selection, LOS check, hit/miss roll, damage
- Attack `AnimationGroup` playing on attacker and target
- Death animation and unit removal
- Basic VFX via `ParticleSystem` (muzzle flash, tracer, impact)
- Melee attack (adjacent tiles)

### Phase 4 — Turn System
- Alternating activation flow
- AP tracking (2 AP per unit per turn)
- Unit activation status (available / activated) reflected in GUI roster
- Turn counter, turn transition UI
- Win condition check (all enemies eliminated)

### Phase 5 — AI Opponent
- Rule-based AI decision tree
- AI unit activation with camera follow (tween camera target)
- Delayed action execution for readability
- AI movement toward enemies, preference for cover

### Phase 6 — Map Editor
- Separate Babylon.js app (shared `types.ts` and `constants.ts`)
- Grid with click/tap-to-place objects
- Object palette (rocks, columns, walls, barricades, craters, point lights)
- Procedural object generation with seed control
- Spawn zone painting
- JSON export / import

### Phase 7 — Cover & Terrain
- Procedural rock/column generation with Polyhaven PBR textures
- Cover system (half/full, directional)
- Cover visual indicators in GUI
- LOS visualization (line mesh from attacker to target)

### Phase 8 — Polish
- Full post-processing pipeline (`DefaultRenderingPipeline` + `SSAO2RenderingPipeline`)
- Atmospheric particles (ash, dust, ground fog)
- Damage numbers floating up via animated GUI `TextBlock`
- Combat camera (tween zoom during attacks)
- Sound effects (Babylon.js 8 `AudioEngineV2` with spatial audio support, if desired)
- Overwatch and hunker down actions
- Second faction model integration with unique animations
- Mobile performance profiling and optimization pass

---

## 16. Future Expansion (Out of Scope for Prototype)

These are noted for architectural awareness — the prototype should not block these but does not implement them:

- **Base mechanics** — Resource gathering, unit production, base building between missions
- **Multiple unit types** — Specialists, heavy weapons, vehicles per faction
- **Campaign/mission structure** — Linked missions with persistent squad
- **Multiplayer** — Player vs player via WebSocket (Colyseus or similar)
- **Indoor maps** — Using existing Quaternius sci-fi tile kit
- **Elevation** — `CreateGroundFromHeightMap` terrain with high ground gameplay
- **Abilities** — Faction-specific special abilities (grenades, buffs, airstrikes)
- **Fog of war** — Hidden information, scouting
- **Destructible cover** — Cover objects that degrade and break from weapon fire
- **Godot migration** — Move from Babylon.js prototype to full Godot 4 implementation with AlphaZero AI
- **PWA / installable** — Service worker for offline play, add-to-homescreen on mobile

---

## 17. Reference Games

| Game | What to Reference |
|------|-------------------|
| **Warhammer 40K: Mechanicus** | Camera angle, combat cam zoom, grid movement, dark atmosphere, turn flow |
| **Warhammer 40K: Chaos Gate — Daemonhunters** | Lighting rig, grimdark atmosphere, emissive materials, combat presentation, unit weight |
| **XCOM / XCOM 2** | Cover system, action point economy, overwatch, squad management UI |
| **Jagged Alliance 3** | Squad-level tactics, individual unit personality, positioning depth, tactical flexibility |
| **Warhammer 40K: Battlesector** | Alternating activation, military unit feel, ranged combat at distance |
| **Into the Breach** | Clean grid readability, showing enemy intent, tight tactical decisions |

---

*Document Version: 1.0*  
*Last Updated: February 2026*
