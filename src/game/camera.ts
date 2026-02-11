// ============================================================================
// Strife — Camera System
// Orthographic ArcRotateCamera with pan, zoom, and combat camera.
// ============================================================================

import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { ArcRotateCameraPointersInput } from "@babylonjs/core/Cameras/Inputs/arcRotateCameraPointersInput";
import { Camera } from "@babylonjs/core/Cameras/camera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Animation } from "@babylonjs/core/Animations/animation";
import { CubicEase, EasingFunction } from "@babylonjs/core/Animations/easing";
import { KeyboardEventTypes } from "@babylonjs/core/Events/keyboardEvents";
import type { Scene } from "@babylonjs/core/scene";
import type { Engine } from "@babylonjs/core/Engines/engine";
import type { Observer } from "@babylonjs/core/Misc/observable";

import {
  CAMERA_ALPHA,
  CAMERA_BETA,
  CAMERA_ORTHO_SIZE,
  CAMERA_ZOOM_MIN,
  CAMERA_ZOOM_MAX,
  CAMERA_ZOOM_SPEED,
  CAMERA_PAN_SPEED,
  CAMERA_PAN_SENSIBILITY,
  CAMERA_PINCH_PRECISION,
  COMBAT_CAM_ZOOM_SIZE,
  COMBAT_CAM_TWEEN_FRAMES,
  COMBAT_CAM_HOLD_MS,
  COMBAT_CAM_RETURN_FRAMES,
  TILE_SIZE,
} from "@shared/constants";

import { clamp } from "@shared/utils";

export interface CameraSystem {
  camera: ArcRotateCamera;
  setOrthoSize: (size: number) => void;
  getOrthoSize: () => number;
  dispose: () => void;
}

interface KeyStates {
  w: boolean;
  a: boolean;
  s: boolean;
  d: boolean;
}

/**
 * Set up the main orthographic camera for tactical gameplay.
 * Includes WASD panning, scroll zoom, bounds clamping.
 * On mobile, single-touch is freed for unit picking (camera uses two-finger
 * gestures only) and ortho bounds update per-frame for orientation changes.
 */
export function setupCamera(
  scene: Scene,
  engine: Engine,
  gridCols: number,
  gridRows: number,
  tileSize: number = TILE_SIZE,
  isMobile = false,
): CameraSystem {
  const gridWidth = gridCols * tileSize;
  const gridHeight = gridRows * tileSize;

  // Camera targets center of grid
  const targetX = gridWidth / 2;
  const targetZ = gridHeight / 2;
  const target = new Vector3(targetX, 0, targetZ);

  const camera = new ArcRotateCamera(
    "tacticalCamera",
    CAMERA_ALPHA,
    CAMERA_BETA,
    50, // radius doesn't matter for ortho, but needed for ArcRotateCamera
    target,
    scene,
  );

  // Lock alpha and beta so camera angle is fixed
  camera.lowerAlphaLimit = CAMERA_ALPHA;
  camera.upperAlphaLimit = CAMERA_ALPHA;
  camera.lowerBetaLimit = CAMERA_BETA;
  camera.upperBetaLimit = CAMERA_BETA;

  // Switch to orthographic mode
  camera.mode = Camera.ORTHOGRAPHIC_CAMERA;

  // Current ortho size (half-width of visible area)
  let currentOrthoSize = CAMERA_ORTHO_SIZE;

  function updateOrthoBounds(): void {
    const canvas = engine.getRenderingCanvas();
    if (!canvas) return;
    const aspect = canvas.width / canvas.height;

    camera.orthoLeft = -currentOrthoSize * aspect;
    camera.orthoRight = currentOrthoSize * aspect;
    camera.orthoTop = currentOrthoSize;
    camera.orthoBottom = -currentOrthoSize;
  }

  updateOrthoBounds();

  // Attach controls for right-click drag panning
  camera.attachControl(engine.getRenderingCanvas()!, true);

  // Disable default scroll zoom (we handle it manually)
  camera.inputs.removeByType("ArcRotateCameraMouseWheelInput");

  // Configure panning
  camera.panningSensibility = CAMERA_PAN_SENSIBILITY;
  camera.pinchPrecision = CAMERA_PINCH_PRECISION;

  // Disable rotation (locked angles)
  camera._useCtrlForPanning = false;
  camera.panningAxis = new Vector3(1, 0, 1); // pan in XZ plane

  // --- Mobile: free single-touch for unit picking ---
  // By default, ArcRotateCamera uses single-touch (button 0) for rotation.
  // Even though alpha/beta are locked, the camera still processes the event,
  // which can prevent POINTERTAP from firing on touch devices.
  // Fix: exclude button 0 so single-tap passes through to scene picking.
  // Two-finger pinch/drag still works for zoom and pan via multiTouch handlers.
  if (isMobile) {
    const pointerInput = camera.inputs.attached["pointers"] as ArcRotateCameraPointersInput;
    if (pointerInput) {
      pointerInput.buttons = [1, 2]; // middle-click, right-click only
      pointerInput.multiTouchPanning = true;
      pointerInput.multiTouchPanAndZoom = true;
      pointerInput.pinchZoom = true;
    }
  }

  // --- WASD Pan ---
  const keys: KeyStates = { w: false, a: false, s: false, d: false };

  const keyboardObserver = scene.onKeyboardObservable.add((kbInfo) => {
    const key = kbInfo.event.key.toLowerCase();
    const isDown = kbInfo.type === KeyboardEventTypes.KEYDOWN;

    switch (key) {
      case "w":
        keys.w = isDown;
        break;
      case "a":
        keys.a = isDown;
        break;
      case "s":
        keys.s = isDown;
        break;
      case "d":
        keys.d = isDown;
        break;
    }
  });

  // --- Scroll Zoom ---
  const wheelHandler = (event: WheelEvent): void => {
    event.preventDefault();
    const delta = Math.sign(event.deltaY) * CAMERA_ZOOM_SPEED;
    currentOrthoSize = clamp(currentOrthoSize + delta, CAMERA_ZOOM_MIN, CAMERA_ZOOM_MAX);
    updateOrthoBounds();
  };

  const canvas = engine.getRenderingCanvas();
  if (canvas) {
    canvas.addEventListener("wheel", wheelHandler, { passive: false });
  }

  // --- Per-frame update: WASD pan + bounds clamping + ortho bounds ---
  // Ortho bounds are recalculated every frame (trivial cost: one division,
  // four assignments). This guarantees correctness after orientation changes
  // on mobile where the resize event fires before the browser finishes layout.
  const renderObserver = scene.onBeforeRenderObservable.add(() => {
    // Keep ortho projection in sync with canvas aspect ratio
    updateOrthoBounds();

    // Apply WASD movement
    let panX = 0;
    let panZ = 0;

    if (keys.w) panZ -= CAMERA_PAN_SPEED;
    if (keys.s) panZ += CAMERA_PAN_SPEED;
    if (keys.a) panX -= CAMERA_PAN_SPEED;
    if (keys.d) panX += CAMERA_PAN_SPEED;

    if (panX !== 0 || panZ !== 0) {
      camera.target.x += panX;
      camera.target.z += panZ;
    }

    // Clamp camera target to keep viewport within map bounds
    const canvasEl = engine.getRenderingCanvas();
    if (!canvasEl) return;
    const aspect = canvasEl.width / canvasEl.height;
    const halfViewWidth = currentOrthoSize * aspect;
    const halfViewHeight = currentOrthoSize;

    // Allow some margin so edges of map are visible
    const margin = tileSize;
    camera.target.x = clamp(
      camera.target.x,
      halfViewWidth - margin,
      gridWidth - halfViewWidth + margin,
    );
    camera.target.z = clamp(
      camera.target.z,
      halfViewHeight - margin,
      gridHeight - halfViewHeight + margin,
    );
  });

  // --- Resize + orientation change handlers ---
  const resizeHandler = (): void => {
    updateOrthoBounds();
  };

  window.addEventListener("resize", resizeHandler);

  // Mobile browsers sometimes report stale canvas dimensions on the first
  // resize event after an orientation change. A delayed second resize
  // ensures the engine and ortho bounds use the final layout dimensions.
  let orientationTimeout: ReturnType<typeof setTimeout> | null = null;
  const orientationHandler = (): void => {
    if (orientationTimeout) clearTimeout(orientationTimeout);
    orientationTimeout = setTimeout(() => {
      engine.resize();
      updateOrthoBounds();
    }, 200);
  };
  window.addEventListener("orientationchange", orientationHandler);

  // Public API
  function setOrthoSize(size: number): void {
    currentOrthoSize = clamp(size, CAMERA_ZOOM_MIN, CAMERA_ZOOM_MAX);
    updateOrthoBounds();
  }

  function getOrthoSize(): number {
    return currentOrthoSize;
  }

  function dispose(): void {
    scene.onKeyboardObservable.remove(keyboardObserver as Observer<unknown>);
    scene.onBeforeRenderObservable.remove(renderObserver as Observer<unknown>);
    window.removeEventListener("resize", resizeHandler);
    window.removeEventListener("orientationchange", orientationHandler);
    if (orientationTimeout) clearTimeout(orientationTimeout);
    if (canvas) {
      canvas.removeEventListener("wheel", wheelHandler);
    }
  }

  return {
    camera,
    setOrthoSize,
    getOrthoSize,
    dispose,
  };
}

/**
 * Trigger a combat camera zoom-in to frame two units during an attack.
 * Tweens camera target to midpoint between attacker and target,
 * zooms to close-up view, holds, then returns to previous state.
 *
 * Returns a Promise that resolves when the camera has returned to normal.
 */
export function triggerCombatCamera(
  scene: Scene,
  cameraSystem: CameraSystem,
  attackerPos: Vector3,
  targetPos: Vector3,
): Promise<void> {
  return new Promise<void>((resolve) => {
    const { camera } = cameraSystem;
    const prevOrthoSize = cameraSystem.getOrthoSize();
    const prevTarget = camera.target.clone();

    // Calculate midpoint between attacker and target
    const midpoint = Vector3.Lerp(attackerPos, targetPos, 0.5);
    midpoint.y = 0; // keep target on ground plane

    const ease = new CubicEase();
    ease.setEasingMode(EasingFunction.EASINGMODE_EASEINOUT);

    // --- Phase 1: Zoom IN ---
    // Animate camera target to midpoint
    const targetXAnim = new Animation(
      "combatCamTargetX",
      "target.x",
      60,
      Animation.ANIMATIONTYPE_FLOAT,
      Animation.ANIMATIONLOOPMODE_CONSTANT,
    );
    targetXAnim.setKeys([
      { frame: 0, value: prevTarget.x },
      { frame: COMBAT_CAM_TWEEN_FRAMES, value: midpoint.x },
    ]);
    targetXAnim.setEasingFunction(ease);

    const targetZAnim = new Animation(
      "combatCamTargetZ",
      "target.z",
      60,
      Animation.ANIMATIONTYPE_FLOAT,
      Animation.ANIMATIONLOOPMODE_CONSTANT,
    );
    targetZAnim.setKeys([
      { frame: 0, value: prevTarget.z },
      { frame: COMBAT_CAM_TWEEN_FRAMES, value: midpoint.z },
    ]);
    targetZAnim.setEasingFunction(ease);

    camera.animations = [targetXAnim, targetZAnim];

    // Animate ortho size smoothly using before-render observer
    const startOrtho = prevOrthoSize;
    const endOrtho = COMBAT_CAM_ZOOM_SIZE;
    let zoomInFrame = 0;

    const zoomInObserver = scene.onBeforeRenderObservable.add(() => {
      zoomInFrame++;
      const t = Math.min(zoomInFrame / COMBAT_CAM_TWEEN_FRAMES, 1);
      // Apply easing manually for ortho
      const easedT = easeInOutCubic(t);
      cameraSystem.setOrthoSize(startOrtho + (endOrtho - startOrtho) * easedT);

      if (t >= 1) {
        scene.onBeforeRenderObservable.remove(zoomInObserver);
      }
    });

    scene.beginAnimation(camera, 0, COMBAT_CAM_TWEEN_FRAMES, false, 1.0, () => {
      // --- Phase 2: Hold ---
      setTimeout(() => {
        // --- Phase 3: Zoom OUT ---
        const returnTargetXAnim = new Animation(
          "combatCamReturnX",
          "target.x",
          60,
          Animation.ANIMATIONTYPE_FLOAT,
          Animation.ANIMATIONLOOPMODE_CONSTANT,
        );
        returnTargetXAnim.setKeys([
          { frame: 0, value: midpoint.x },
          { frame: COMBAT_CAM_RETURN_FRAMES, value: prevTarget.x },
        ]);
        returnTargetXAnim.setEasingFunction(ease);

        const returnTargetZAnim = new Animation(
          "combatCamReturnZ",
          "target.z",
          60,
          Animation.ANIMATIONTYPE_FLOAT,
          Animation.ANIMATIONLOOPMODE_CONSTANT,
        );
        returnTargetZAnim.setKeys([
          { frame: 0, value: midpoint.z },
          { frame: COMBAT_CAM_RETURN_FRAMES, value: prevTarget.z },
        ]);
        returnTargetZAnim.setEasingFunction(ease);

        camera.animations = [returnTargetXAnim, returnTargetZAnim];

        let zoomOutFrame = 0;
        const zoomOutObserver = scene.onBeforeRenderObservable.add(() => {
          zoomOutFrame++;
          const t = Math.min(zoomOutFrame / COMBAT_CAM_RETURN_FRAMES, 1);
          const easedT = easeInOutCubic(t);
          cameraSystem.setOrthoSize(endOrtho + (startOrtho - endOrtho) * easedT);

          if (t >= 1) {
            scene.onBeforeRenderObservable.remove(zoomOutObserver);
          }
        });

        scene.beginAnimation(camera, 0, COMBAT_CAM_RETURN_FRAMES, false, 1.0, () => {
          // Restore original ortho size exactly
          cameraSystem.setOrthoSize(prevOrthoSize);
          resolve();
        });
      }, COMBAT_CAM_HOLD_MS);
    });
  });
}

/**
 * Smoothly tween the camera target to follow a position (for AI camera follow).
 * Returns a Promise that resolves when the tween completes.
 */
export function tweenCameraToTarget(
  scene: Scene,
  camera: ArcRotateCamera,
  targetPos: Vector3,
  frames: number = 20,
): Promise<void> {
  return new Promise<void>((resolve) => {
    const startPos = camera.target.clone();
    const ease = new CubicEase();
    ease.setEasingMode(EasingFunction.EASINGMODE_EASEINOUT);

    const xAnim = new Animation(
      "camFollowX",
      "target.x",
      60,
      Animation.ANIMATIONTYPE_FLOAT,
      Animation.ANIMATIONLOOPMODE_CONSTANT,
    );
    xAnim.setKeys([
      { frame: 0, value: startPos.x },
      { frame: frames, value: targetPos.x },
    ]);
    xAnim.setEasingFunction(ease);

    const zAnim = new Animation(
      "camFollowZ",
      "target.z",
      60,
      Animation.ANIMATIONTYPE_FLOAT,
      Animation.ANIMATIONLOOPMODE_CONSTANT,
    );
    zAnim.setKeys([
      { frame: 0, value: startPos.z },
      { frame: frames, value: targetPos.z },
    ]);
    zAnim.setEasingFunction(ease);

    camera.animations = [xAnim, zAnim];
    scene.beginAnimation(camera, 0, frames, false, 1.0, () => {
      resolve();
    });
  });
}

/**
 * Cubic ease-in-out function for manual interpolation.
 */
function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
