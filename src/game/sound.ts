// ============================================================================
// Strife — Sound System
// Audio using Babylon.js Sound API.
// Weapon fire, melee impacts, hit reactions, death, UI clicks,
// ambient battlefield atmosphere. Spatial audio positioned at source.
// ============================================================================

import { Sound } from "@babylonjs/core/Audio/sound";
import "@babylonjs/core/Audio/audioSceneComponent";
import "@babylonjs/core/Audio/audioEngine";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";

// ============================================================================
// Sound File Paths — Place .wav/.mp3 files in public/sounds/
// ============================================================================

const BASE = import.meta.env.BASE_URL;

const SOUND_PATHS = {
  rangedFire: `${BASE}sounds/ranged_fire.wav`,
  meleeImpact: `${BASE}sounds/melee_impact.wav`,
  hitReaction: `${BASE}sounds/hit_reaction.wav`,
  death: `${BASE}sounds/death.wav`,
  uiClick: `${BASE}sounds/ui_click.wav`,
  uiSelect: `${BASE}sounds/ui_select.wav`,
  battlefieldAmbience: `${BASE}sounds/battlefield_ambience.mp3`,
} as const;

// ============================================================================
// Sound System Interface
// ============================================================================

export interface SoundSystem {
  initialized: boolean;
  playRangedFire: (position: Vector3) => void;
  playMeleeImpact: (position: Vector3) => void;
  playHitReaction: (position: Vector3) => void;
  playDeath: (position: Vector3) => void;
  playUIClick: () => void;
  playUISelect: () => void;
  startAmbience: () => void;
  stopAmbience: () => void;
  setMasterVolume: (volume: number) => void;
  dispose: () => void;
}

// ============================================================================
// Module-level singleton for access from other game systems
// ============================================================================

let _soundSystem: SoundSystem | null = null;

/**
 * Get the sound system singleton. Returns null if not yet initialized.
 * Used by turns.ts and ai.ts to play combat sounds without threading the instance.
 */
export function getSoundSystem(): SoundSystem | null {
  return _soundSystem;
}

// ============================================================================
// Initialization
// ============================================================================

/**
 * Initialize the sound system.
 * Gracefully handles missing sound files — game works without audio.
 * Sounds load asynchronously in the background via Babylon.js Sound callbacks.
 */
export function initSoundSystem(scene: Scene): SoundSystem {
  let masterVolume = 0.7;
  let initialized = false;

  // Sound references (null if file not found or loading failed)
  let rangedFireSound: Sound | null = null;
  let meleeImpactSound: Sound | null = null;
  let hitReactionSound: Sound | null = null;
  let deathSound: Sound | null = null;
  let uiClickSound: Sound | null = null;
  let uiSelectSound: Sound | null = null;
  let ambienceSound: Sound | null = null;

  /**
   * Load a sound file. Babylon.js Sound constructor handles async loading.
   * Returns the Sound instance, or null if the constructor throws.
   */
  function loadSound(
    name: string,
    path: string,
    options: {
      loop?: boolean;
      volume?: number;
      spatialSound?: boolean;
      maxDistance?: number;
      distanceModel?: string;
    } = {},
  ): Sound | null {
    try {
      const sound = new Sound(
        name,
        path,
        scene,
        () => {
          // Sound loaded successfully
          if (!initialized) {
            initialized = true;
            console.log("Strife: Sound system — audio loaded");
          }
        },
        {
          loop: options.loop ?? false,
          volume: (options.volume ?? 1.0) * masterVolume,
          spatialSound: options.spatialSound ?? false,
          maxDistance: options.maxDistance ?? 50,
          distanceModel: (options.distanceModel ?? "linear") as "linear" | "inverse" | "exponential",
          autoplay: false,
        },
      );
      return sound;
    } catch (err) {
      console.warn(`Sound "${name}" at "${path}" — load failed, skipping`);
      return null;
    }
  }

  // --- Load all sounds ---

  // Combat sounds (spatial: positioned at their source in 3D)
  rangedFireSound = loadSound("rangedFire", SOUND_PATHS.rangedFire, {
    spatialSound: true,
    maxDistance: 40,
    volume: 0.8,
  });

  meleeImpactSound = loadSound("meleeImpact", SOUND_PATHS.meleeImpact, {
    spatialSound: true,
    maxDistance: 30,
    volume: 0.7,
  });

  hitReactionSound = loadSound("hitReaction", SOUND_PATHS.hitReaction, {
    spatialSound: true,
    maxDistance: 30,
    volume: 0.6,
  });

  deathSound = loadSound("death", SOUND_PATHS.death, {
    spatialSound: true,
    maxDistance: 40,
    volume: 0.7,
  });

  // UI sounds (non-spatial: play at equal volume regardless of camera position)
  uiClickSound = loadSound("uiClick", SOUND_PATHS.uiClick, {
    spatialSound: false,
    volume: 0.4,
  });

  uiSelectSound = loadSound("uiSelect", SOUND_PATHS.uiSelect, {
    spatialSound: false,
    volume: 0.5,
  });

  // Ambient battlefield atmosphere (non-spatial, looping)
  ambienceSound = loadSound("ambience", SOUND_PATHS.battlefieldAmbience, {
    spatialSound: false,
    loop: true,
    volume: 0.25,
  });

  // --- Helper: Play spatial sound at a 3D position ---
  function playSpatialAt(sound: Sound | null, position: Vector3): void {
    if (!sound) return;
    try {
      sound.setVolume(masterVolume * 0.8);
      sound.setPosition(position);
      sound.play();
    } catch {
      // Silently fail — game continues without this sound
    }
  }

  function playNonSpatial(sound: Sound | null, volumeScale: number = 1.0): void {
    if (!sound) return;
    try {
      sound.setVolume(masterVolume * volumeScale);
      sound.play();
    } catch {
      // Silently fail
    }
  }

  // --- Public API ---
  const system: SoundSystem = {
    get initialized() {
      return initialized;
    },

    playRangedFire: (position: Vector3) => {
      playSpatialAt(rangedFireSound, position);
    },

    playMeleeImpact: (position: Vector3) => {
      playSpatialAt(meleeImpactSound, position);
    },

    playHitReaction: (position: Vector3) => {
      playSpatialAt(hitReactionSound, position);
    },

    playDeath: (position: Vector3) => {
      playSpatialAt(deathSound, position);
    },

    playUIClick: () => {
      playNonSpatial(uiClickSound, 0.4);
    },

    playUISelect: () => {
      playNonSpatial(uiSelectSound, 0.5);
    },

    startAmbience: () => {
      if (!ambienceSound) return;
      try {
        ambienceSound.setVolume(masterVolume * 0.25);
        ambienceSound.play();
      } catch {
        // Silently fail
      }
    },

    stopAmbience: () => {
      if (!ambienceSound) return;
      try {
        ambienceSound.stop();
      } catch {
        // Silently fail
      }
    },

    setMasterVolume: (volume: number) => {
      masterVolume = Math.max(0, Math.min(1, volume));
    },

    dispose: () => {
      const allSounds = [
        rangedFireSound,
        meleeImpactSound,
        hitReactionSound,
        deathSound,
        uiClickSound,
        uiSelectSound,
        ambienceSound,
      ];
      for (const sound of allSounds) {
        if (sound) {
          try {
            sound.dispose();
          } catch {
            // Silently fail
          }
        }
      }
      _soundSystem = null;
    },
  };

  _soundSystem = system;
  return system;
}
