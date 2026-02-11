// ============================================================================
// Strife — VFX System
// Combat particles (muzzle flash, tracers, impacts, melee, death) and
// atmospheric particles (ash, dust, ground fog).
// ============================================================================

import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import type { Scene } from "@babylonjs/core/scene";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";

import {
  PARTICLE_PATH,
  MUZZLE_FLASH_INTENSITY,
  MUZZLE_FLASH_DECAY_FRAMES,
  MUZZLE_FLASH_PARTICLE_COUNT,
  MUZZLE_FLASH_PARTICLE_LIFETIME,
  TRACER_TRAVEL_TIME,
  TRACER_WIDTH,
  TRACER_LENGTH,
  IMPACT_PARTICLE_COUNT,
  IMPACT_PARTICLE_LIFETIME,
  IMPACT_EMIT_POWER,
  MELEE_IMPACT_PARTICLE_COUNT,
  MELEE_SPARK_LIFETIME,
  DEATH_DUST_PARTICLE_COUNT,
  DEATH_DUST_LIFETIME,
  ASH_EMIT_RATE,
  ASH_MAX_LIFETIME,
  ASH_MIN_SIZE,
  ASH_MAX_SIZE,
  DUST_EMIT_RATE,
  DUST_MAX_LIFETIME,
  DUST_MIN_SIZE,
  DUST_MAX_SIZE,
  FOG_EMIT_RATE,
  FOG_MAX_LIFETIME,
  FOG_MIN_SIZE,
  FOG_MAX_SIZE,
  FOG_MAX_Y,
  TILE_SIZE,
} from "@shared/constants";

// ============================================================================
// Ranged Attack VFX
// ============================================================================

/**
 * Play complete ranged attack VFX sequence:
 * 1. Muzzle flash (light spike + particles at attacker)
 * 2. Tracer/bullet trail (animated from attacker to target)
 * 3. Hit impact (particles at target) or miss impact (offset)
 *
 * Returns a Promise that resolves when all VFX are complete.
 */
export async function playRangedAttackVFX(
  scene: Scene,
  attackerPos: Vector3,
  targetPos: Vector3,
  hit: boolean,
): Promise<void> {
  // Calculate direction and impact position
  const direction = targetPos.subtract(attackerPos).normalize();
  const impactPos = hit
    ? targetPos.clone()
    : targetPos.add(direction.scale(0.5)).add(new Vector3(
        (Math.random() - 0.5) * 0.8,
        0,
        (Math.random() - 0.5) * 0.8,
      ));

  // Raise positions to weapon height
  const weaponOffset = new Vector3(0, 1.2, 0);
  const muzzlePos = attackerPos.add(weaponOffset).add(direction.scale(0.3));
  const hitPos = impactPos.add(new Vector3(0, 0.8, 0));

  // 1. Muzzle flash
  playMuzzleFlash(scene, muzzlePos);

  // 2. Tracer (wait for it to reach target)
  await playTracer(scene, muzzlePos, hitPos);

  // 3. Impact
  if (hit) {
    playHitImpact(scene, hitPos);
  } else {
    playMissImpact(scene, impactPos);
  }
}

/**
 * Muzzle flash: brief point light intensity spike + small particle burst.
 */
function playMuzzleFlash(scene: Scene, position: Vector3): void {
  // Point light flash
  const flashLight = new PointLight("muzzleFlash", position, scene);
  flashLight.intensity = MUZZLE_FLASH_INTENSITY;
  flashLight.diffuse = new Color3(1.0, 0.8, 0.4); // warm orange
  flashLight.range = 4.0;

  let frameCount = 0;
  const observer = scene.onBeforeRenderObservable.add(() => {
    frameCount++;
    flashLight.intensity = MUZZLE_FLASH_INTENSITY * Math.max(0, 1 - frameCount / MUZZLE_FLASH_DECAY_FRAMES);
    if (frameCount >= MUZZLE_FLASH_DECAY_FRAMES) {
      scene.onBeforeRenderObservable.remove(observer);
      flashLight.dispose();
    }
  });

  // Particle burst
  const particles = new ParticleSystem("muzzleParticles", MUZZLE_FLASH_PARTICLE_COUNT, scene);
  particles.particleTexture = new Texture(`${PARTICLE_PATH}spark.png`, scene);
  particles.emitter = position;
  particles.minLifeTime = MUZZLE_FLASH_PARTICLE_LIFETIME * 0.5;
  particles.maxLifeTime = MUZZLE_FLASH_PARTICLE_LIFETIME;
  particles.minSize = 0.02;
  particles.maxSize = 0.08;
  particles.minEmitPower = 1;
  particles.maxEmitPower = 3;
  particles.emitRate = 500; // burst
  particles.direction1 = new Vector3(-0.5, 0.5, -0.5);
  particles.direction2 = new Vector3(0.5, 1, 0.5);
  particles.color1 = new Color4(1, 0.8, 0.3, 1);
  particles.color2 = new Color4(1, 0.5, 0.1, 1);
  particles.colorDead = new Color4(0.5, 0.2, 0, 0);
  particles.blendMode = ParticleSystem.BLENDMODE_ADD;
  particles.gravity = new Vector3(0, -2, 0);
  particles.disposeOnStop = true;
  particles.targetStopDuration = MUZZLE_FLASH_PARTICLE_LIFETIME;

  particles.start();
  setTimeout(() => {
    particles.stop();
  }, 50); // very brief burst
}

/**
 * Animated tracer/bullet trail from start to end position.
 * Returns a Promise that resolves when the tracer reaches the target.
 */
function playTracer(scene: Scene, start: Vector3, end: Vector3): Promise<void> {
  return new Promise((resolve) => {
    const direction = end.subtract(start).normalize();
    const distance = Vector3.Distance(start, end);

    // Create a thin stretched plane as the tracer
    const tracer = MeshBuilder.CreatePlane(
      "tracer",
      { width: TRACER_LENGTH, height: TRACER_WIDTH },
      scene,
    );

    const mat = new StandardMaterial("tracerMat", scene);
    mat.emissiveColor = new Color3(1.0, 0.9, 0.5); // bright yellow-white
    mat.diffuseColor = new Color3(0, 0, 0);
    mat.disableLighting = true;
    mat.alpha = 0.9;
    mat.backFaceCulling = false;
    tracer.material = mat;

    // Orient tracer along the direction of travel
    tracer.position = start.clone();
    tracer.lookAt(end);
    tracer.billboardMode = 7; // ALL axes billboard - always faces camera

    // Animate from start to end
    const travelTime = TRACER_TRAVEL_TIME * 1000; // ms
    const startTime = performance.now();

    const observer = scene.onBeforeRenderObservable.add(() => {
      const elapsed = performance.now() - startTime;
      const t = Math.min(elapsed / travelTime, 1);

      tracer.position = Vector3.Lerp(start, end, t);

      // Fade out as it travels
      mat.alpha = 0.9 * (1 - t * 0.3);

      if (t >= 1) {
        scene.onBeforeRenderObservable.remove(observer);
        tracer.dispose();
        mat.dispose();
        resolve();
      }
    });
  });
}

/**
 * Hit impact: spark particles at the point of impact.
 */
function playHitImpact(scene: Scene, position: Vector3): void {
  const particles = new ParticleSystem("hitImpact", IMPACT_PARTICLE_COUNT, scene);
  particles.particleTexture = new Texture(`${PARTICLE_PATH}spark.png`, scene);
  particles.emitter = position;
  particles.minLifeTime = IMPACT_PARTICLE_LIFETIME * 0.5;
  particles.maxLifeTime = IMPACT_PARTICLE_LIFETIME;
  particles.minSize = 0.02;
  particles.maxSize = 0.06;
  particles.minEmitPower = IMPACT_EMIT_POWER * 0.5;
  particles.maxEmitPower = IMPACT_EMIT_POWER;
  particles.emitRate = 500; // burst
  particles.direction1 = new Vector3(-1, 0.5, -1);
  particles.direction2 = new Vector3(1, 2, 1);
  particles.color1 = new Color4(1, 0.7, 0.2, 1);
  particles.color2 = new Color4(1, 0.3, 0.1, 1);
  particles.colorDead = new Color4(0.3, 0.1, 0, 0);
  particles.blendMode = ParticleSystem.BLENDMODE_ADD;
  particles.gravity = new Vector3(0, -5, 0);
  particles.disposeOnStop = true;
  particles.targetStopDuration = IMPACT_PARTICLE_LIFETIME;

  particles.start();
  setTimeout(() => {
    particles.stop();
  }, 80);
}

/**
 * Miss impact: dirt/dust particles hitting the ground behind target.
 */
function playMissImpact(scene: Scene, position: Vector3): void {
  const groundPos = position.clone();
  groundPos.y = 0.05;

  const particles = new ParticleSystem("missImpact", IMPACT_PARTICLE_COUNT, scene);
  particles.particleTexture = new Texture(`${PARTICLE_PATH}dust.png`, scene);
  particles.emitter = groundPos;
  particles.minLifeTime = 0.3;
  particles.maxLifeTime = 0.6;
  particles.minSize = 0.03;
  particles.maxSize = 0.1;
  particles.minEmitPower = 1;
  particles.maxEmitPower = 2;
  particles.emitRate = 400;
  particles.direction1 = new Vector3(-0.5, 1, -0.5);
  particles.direction2 = new Vector3(0.5, 2, 0.5);
  particles.color1 = new Color4(0.6, 0.5, 0.3, 0.8);
  particles.color2 = new Color4(0.4, 0.35, 0.25, 0.6);
  particles.colorDead = new Color4(0.3, 0.25, 0.2, 0);
  particles.blendMode = ParticleSystem.BLENDMODE_STANDARD;
  particles.gravity = new Vector3(0, -3, 0);
  particles.disposeOnStop = true;
  particles.targetStopDuration = 0.6;

  particles.start();
  setTimeout(() => {
    particles.stop();
  }, 60);
}

// ============================================================================
// Melee Attack VFX
// ============================================================================

/**
 * Play melee attack VFX: weapon swing trail + impact flash + spark burst.
 */
export function playMeleeAttackVFX(
  scene: Scene,
  attackerPos: Vector3,
  targetPos: Vector3,
): void {
  const impactPoint = Vector3.Lerp(attackerPos, targetPos, 0.6);
  impactPoint.y = 1.0; // chest height

  // Impact flash: brief bright sprite
  const flashMesh = MeshBuilder.CreatePlane("meleeFlash", { size: 0.5 }, scene);
  flashMesh.position = impactPoint;
  flashMesh.billboardMode = 7;

  const flashMat = new StandardMaterial("meleeFlashMat", scene);
  flashMat.emissiveColor = new Color3(1, 0.9, 0.7);
  flashMat.diffuseColor = new Color3(0, 0, 0);
  flashMat.disableLighting = true;
  flashMat.alpha = 1.0;
  flashMat.backFaceCulling = false;
  flashMesh.material = flashMat;

  // Fade and dispose flash
  let flashFrame = 0;
  const flashObserver = scene.onBeforeRenderObservable.add(() => {
    flashFrame++;
    flashMat.alpha = Math.max(0, 1 - flashFrame / 6);
    const scale = 1 + flashFrame * 0.15;
    flashMesh.scaling = new Vector3(scale, scale, scale);
    if (flashFrame >= 6) {
      scene.onBeforeRenderObservable.remove(flashObserver);
      flashMesh.dispose();
      flashMat.dispose();
    }
  });

  // Spark burst particles
  const sparks = new ParticleSystem("meleeSparks", MELEE_IMPACT_PARTICLE_COUNT, scene);
  sparks.particleTexture = new Texture(`${PARTICLE_PATH}spark.png`, scene);
  sparks.emitter = impactPoint;
  sparks.minLifeTime = MELEE_SPARK_LIFETIME * 0.5;
  sparks.maxLifeTime = MELEE_SPARK_LIFETIME;
  sparks.minSize = 0.01;
  sparks.maxSize = 0.04;
  sparks.minEmitPower = 2;
  sparks.maxEmitPower = 5;
  sparks.emitRate = 400;
  sparks.direction1 = new Vector3(-1, 0.5, -1);
  sparks.direction2 = new Vector3(1, 2, 1);
  sparks.color1 = new Color4(1, 0.8, 0.3, 1);
  sparks.color2 = new Color4(1, 0.5, 0.1, 1);
  sparks.colorDead = new Color4(0.5, 0.2, 0, 0);
  sparks.blendMode = ParticleSystem.BLENDMODE_ADD;
  sparks.gravity = new Vector3(0, -8, 0);
  sparks.disposeOnStop = true;
  sparks.targetStopDuration = MELEE_SPARK_LIFETIME;

  sparks.start();
  setTimeout(() => {
    sparks.stop();
  }, 50);

  // Brief point light at impact
  const impactLight = new PointLight("meleeImpactLight", impactPoint, scene);
  impactLight.intensity = 3.0;
  impactLight.diffuse = new Color3(1, 0.7, 0.3);
  impactLight.range = 3.0;

  let lightFrame = 0;
  const lightObserver = scene.onBeforeRenderObservable.add(() => {
    lightFrame++;
    impactLight.intensity = 3.0 * Math.max(0, 1 - lightFrame / 5);
    if (lightFrame >= 5) {
      scene.onBeforeRenderObservable.remove(lightObserver);
      impactLight.dispose();
    }
  });
}

// ============================================================================
// Overwatch VFX
// ============================================================================

/**
 * Play overwatch trigger VFX: brief cone flash, then ranged attack VFX.
 */
export async function playOverwatchVFX(
  scene: Scene,
  overwatcherPos: Vector3,
  targetPos: Vector3,
  hit: boolean,
): Promise<void> {
  // Brief flash around overwatcher
  const flashLight = new PointLight("overwatchFlash", overwatcherPos.add(new Vector3(0, 1.5, 0)), scene);
  flashLight.intensity = 4.0;
  flashLight.diffuse = new Color3(1, 1, 0.5);
  flashLight.range = 5.0;

  let flashFrame = 0;
  const observer = scene.onBeforeRenderObservable.add(() => {
    flashFrame++;
    flashLight.intensity = 4.0 * Math.max(0, 1 - flashFrame / 8);
    if (flashFrame >= 8) {
      scene.onBeforeRenderObservable.remove(observer);
      flashLight.dispose();
    }
  });

  // Short delay then ranged attack VFX
  await new Promise<void>(r => setTimeout(r, 150));
  await playRangedAttackVFX(scene, overwatcherPos, targetPos, hit);
}

// ============================================================================
// Death VFX
// ============================================================================

/**
 * Play death dust cloud at unit's base as they fall.
 */
export function playDeathVFX(scene: Scene, position: Vector3): void {
  const dustPos = position.clone();
  dustPos.y = 0.1;

  const dust = new ParticleSystem("deathDust", DEATH_DUST_PARTICLE_COUNT, scene);
  dust.particleTexture = new Texture(`${PARTICLE_PATH}smoke.png`, scene);
  dust.emitter = dustPos;
  dust.minLifeTime = DEATH_DUST_LIFETIME * 0.6;
  dust.maxLifeTime = DEATH_DUST_LIFETIME;
  dust.minSize = 0.1;
  dust.maxSize = 0.4;
  dust.minEmitPower = 0.5;
  dust.maxEmitPower = 1.5;
  dust.emitRate = 60;
  dust.direction1 = new Vector3(-0.5, 0.3, -0.5);
  dust.direction2 = new Vector3(0.5, 1.0, 0.5);
  dust.color1 = new Color4(0.5, 0.45, 0.35, 0.6);
  dust.color2 = new Color4(0.4, 0.35, 0.3, 0.4);
  dust.colorDead = new Color4(0.3, 0.25, 0.2, 0);
  dust.blendMode = ParticleSystem.BLENDMODE_STANDARD;
  dust.gravity = new Vector3(0, -0.5, 0);
  dust.disposeOnStop = true;
  dust.targetStopDuration = DEATH_DUST_LIFETIME;

  dust.start();
  setTimeout(() => {
    dust.stop();
  }, 500);
}

// ============================================================================
// Atmospheric Particles
// ============================================================================

/**
 * Set up atmospheric particle systems: floating ash/embers, dust motes, ground fog.
 * These persist for the duration of the game.
 */
export function setupAtmosphere(
  scene: Scene,
  gridWidth: number,
  gridHeight: number,
): ParticleSystem[] {
  const systems: ParticleSystem[] = [];

  // --- Floating Ash / Embers ---
  const ash = new ParticleSystem("ashEmbers", 200, scene);
  ash.particleTexture = new Texture(`${PARTICLE_PATH}ember.png`, scene);
  ash.emitter = new Vector3(gridWidth / 2, 3, gridHeight / 2);
  ash.minEmitBox = new Vector3(-gridWidth / 2, -1, -gridHeight / 2);
  ash.maxEmitBox = new Vector3(gridWidth / 2, 4, gridHeight / 2);
  ash.emitRate = ASH_EMIT_RATE;
  ash.minLifeTime = ASH_MAX_LIFETIME * 0.5;
  ash.maxLifeTime = ASH_MAX_LIFETIME;
  ash.minSize = ASH_MIN_SIZE;
  ash.maxSize = ASH_MAX_SIZE;
  ash.minEmitPower = 0.01;
  ash.maxEmitPower = 0.05;
  ash.direction1 = new Vector3(-0.1, 0.05, -0.1);
  ash.direction2 = new Vector3(0.1, 0.15, 0.1);
  ash.color1 = new Color4(1.0, 0.7, 0.3, 0.8);
  ash.color2 = new Color4(1.0, 0.5, 0.2, 0.6);
  ash.colorDead = new Color4(0.5, 0.3, 0.1, 0);
  ash.blendMode = ParticleSystem.BLENDMODE_ADD;
  ash.gravity = new Vector3(0, 0.02, 0); // slow upward drift
  ash.noiseStrength = new Vector3(0.5, 0.3, 0.5); // gentle wandering
  ash.start();
  systems.push(ash);

  // --- Dust Motes ---
  const dust = new ParticleSystem("dustMotes", 150, scene);
  dust.particleTexture = new Texture(`${PARTICLE_PATH}dust.png`, scene);
  dust.emitter = new Vector3(gridWidth / 2, 2, gridHeight / 2);
  dust.minEmitBox = new Vector3(-gridWidth / 2, 0, -gridHeight / 2);
  dust.maxEmitBox = new Vector3(gridWidth / 2, 3, gridHeight / 2);
  dust.emitRate = DUST_EMIT_RATE;
  dust.minLifeTime = DUST_MAX_LIFETIME * 0.6;
  dust.maxLifeTime = DUST_MAX_LIFETIME;
  dust.minSize = DUST_MIN_SIZE;
  dust.maxSize = DUST_MAX_SIZE;
  dust.minEmitPower = 0.005;
  dust.maxEmitPower = 0.02;
  dust.direction1 = new Vector3(-0.05, -0.01, -0.05);
  dust.direction2 = new Vector3(0.05, 0.03, 0.05);
  dust.color1 = new Color4(0.8, 0.75, 0.65, 0.3);
  dust.color2 = new Color4(0.7, 0.65, 0.55, 0.2);
  dust.colorDead = new Color4(0.5, 0.45, 0.4, 0);
  dust.blendMode = ParticleSystem.BLENDMODE_STANDARD;
  dust.gravity = new Vector3(0, -0.005, 0); // very slow settling
  dust.noiseStrength = new Vector3(0.3, 0.2, 0.3); // lazy drift
  dust.start();
  systems.push(dust);

  // --- Ground Fog Wisps ---
  const fog = new ParticleSystem("groundFog", 100, scene);
  fog.particleTexture = new Texture(`${PARTICLE_PATH}smoke.png`, scene);
  fog.emitter = new Vector3(gridWidth / 2, 0, gridHeight / 2);
  fog.minEmitBox = new Vector3(-gridWidth / 2, 0, -gridHeight / 2);
  fog.maxEmitBox = new Vector3(gridWidth / 2, FOG_MAX_Y, gridHeight / 2);
  fog.emitRate = FOG_EMIT_RATE;
  fog.minLifeTime = FOG_MAX_LIFETIME * 0.7;
  fog.maxLifeTime = FOG_MAX_LIFETIME;
  fog.minSize = FOG_MIN_SIZE;
  fog.maxSize = FOG_MAX_SIZE;
  fog.minEmitPower = 0.005;
  fog.maxEmitPower = 0.015;
  fog.direction1 = new Vector3(-0.02, 0, -0.02);
  fog.direction2 = new Vector3(0.02, 0.005, 0.02);
  fog.color1 = new Color4(0.7, 0.7, 0.75, 0.15);
  fog.color2 = new Color4(0.6, 0.6, 0.65, 0.1);
  fog.colorDead = new Color4(0.5, 0.5, 0.55, 0);
  fog.blendMode = ParticleSystem.BLENDMODE_STANDARD;
  fog.gravity = new Vector3(0, -0.001, 0); // stays near ground
  fog.noiseStrength = new Vector3(0.1, 0.02, 0.1); // very slow creep
  fog.start();
  systems.push(fog);

  return systems;
}
