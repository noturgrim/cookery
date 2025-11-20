/**
 * Sound Manager for Supercooked
 * Handles all game audio with spatial sound support
 */

export class SoundManager {
  constructor() {
    this.sounds = new Map();
    this.enabled = true;
    this.masterVolume = 0.3; // 30% volume by default
    this.audioUnlocked = false; // Browser requires user interaction to play audio

    // Audio pool for frequently played sounds (reduces HTTP requests)
    this.audioPools = new Map();
    this.poolSize = 3; // Number of pre-loaded instances per pooled sound

    // Check if user has sound preference saved
    const savedSoundPref = localStorage.getItem("supercooked_soundEnabled");
    if (savedSoundPref !== null) {
      this.enabled = savedSoundPref === "true";
    }

    // Unlock audio on first user interaction
    this.unlockAudio();
  }

  /**
   * Unlock audio context on first user interaction (browser requirement)
   */
  unlockAudio() {
    const unlockHandler = () => {
      if (this.audioUnlocked) return;

      // Create and play a silent sound to unlock audio
      const silentAudio = new Audio();
      silentAudio.src =
        "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA";
      silentAudio.volume = 0;

      silentAudio
        .play()
        .then(() => {
          this.audioUnlocked = true;
          console.log("🔊 Audio unlocked!");

          // Remove listeners after unlock
          document.removeEventListener("click", unlockHandler);
          document.removeEventListener("keydown", unlockHandler);
          document.removeEventListener("touchstart", unlockHandler);
        })
        .catch(() => {
          // Audio unlock failed, will try again on next interaction
        });
    };

    // Listen for any user interaction
    document.addEventListener("click", unlockHandler);
    document.addEventListener("keydown", unlockHandler);
    document.addEventListener("touchstart", unlockHandler);
  }

  /**
   * Load a sound file
   * @param {boolean} usePool - If true, creates a pool of audio instances to reduce HTTP requests
   */
  async loadSound(name, url, usePool = false) {
    try {
      const audio = new Audio(url);
      audio.volume = this.masterVolume;
      audio.preload = "auto";

      // Wait for the sound to be loaded
      await new Promise((resolve, reject) => {
        audio.addEventListener("canplaythrough", resolve, { once: true });
        audio.addEventListener("error", reject, { once: true });
      });

      this.sounds.set(name, audio);

      // Create audio pool for frequently played sounds
      if (usePool) {
        const pool = [];
        for (let i = 0; i < this.poolSize; i++) {
          const poolAudio = audio.cloneNode();
          poolAudio.volume = this.masterVolume;
          poolAudio.preload = "auto";
          pool.push({ audio: poolAudio, playing: false });
        }
        this.audioPools.set(name, pool);
        console.log(
          `🔊 Loaded sound with pool: ${name} (${this.poolSize} instances)`
        );
      } else {
        console.log(`🔊 Loaded sound: ${name}`);
      }

      return true;
    } catch (error) {
      console.warn(`⚠️ Failed to load sound ${name}:`, error);
      return false;
    }
  }

  /**
   * Play a sound effect
   */
  play(name, options = {}) {
    if (!this.enabled) return;

    // Don't play if audio isn't unlocked yet
    if (!this.audioUnlocked) {
      console.warn("⚠️ Audio not unlocked yet. Click or press a key first.");
      return;
    }

    // Check if this sound uses an audio pool
    const pool = this.audioPools.get(name);
    if (pool) {
      // Find an available audio instance in the pool
      const available = pool.find((item) => !item.playing);

      if (available) {
        available.audio.volume = (options.volume || 1.0) * this.masterVolume;
        available.audio.playbackRate = options.playbackRate || 1.0;
        available.audio.currentTime = 0; // Reset to start
        available.playing = true;

        available.audio.play().catch((err) => {
          console.warn(`⚠️ Error playing pooled sound ${name}:`, err);
        });

        // Mark as available when done
        available.audio.addEventListener(
          "ended",
          () => {
            available.playing = false;
          },
          { once: true }
        );

        return available.audio;
      }
      // If no available instance, skip this play (acceptable for footsteps)
      return;
    }

    // Non-pooled sounds: use cloning (for less frequent sounds)
    const sound = this.sounds.get(name);
    if (!sound) {
      console.warn(`⚠️ Sound not found: ${name}`);
      return;
    }

    const audioClone = sound.cloneNode();
    audioClone.volume = (options.volume || 1.0) * this.masterVolume;
    audioClone.playbackRate = options.playbackRate || 1.0;

    audioClone.play().catch((err) => {
      console.warn(`⚠️ Error playing sound ${name}:`, err);
    });

    // Remove clone after playing to free memory
    audioClone.addEventListener("ended", () => {
      audioClone.remove();
    });

    return audioClone;
  }

  /**
   * Play voice/emote sound with spatial audio
   * @param {string} emoteName - Name of the emote/voice sound
   * @param {number} distance - Distance from listener
   * @param {boolean} isOwnPlayer - Whether this is the current player
   */
  playVoice(emoteName, distance = 0, isOwnPlayer = true) {
    if (!this.enabled) return;

    // Calculate volume based on distance (spatial audio)
    let volume = 0.5; // Base volume for own voice (50%)

    if (!isOwnPlayer) {
      // Other players' voices get quieter with distance
      const maxHearingDistance = 40; // Max distance to hear voices

      if (distance > maxHearingDistance) {
        return; // Too far away, don't play sound
      }

      // Volume falls off with distance: 40% at close range, fading to 0%
      const distanceFactor = 1 - distance / maxHearingDistance;
      volume = 0.4 * distanceFactor; // Max 40% for other players
    }

    // Play the voice sound
    this.play(emoteName, {
      volume: volume,
      playbackRate: 1.0, // No pitch variation for voices
    });
  }

  /**
   * Play footstep sound (special handling for walking)
   * @param {number} stepNumber - Which foot (0 = right, 1 = left)
   * @param {number} distance - Distance from listener (optional, for spatial audio)
   * @param {boolean} isOwnPlayer - Whether this is the current player's footstep
   */
  playFootstep(stepNumber = 0, distance = 0, isOwnPlayer = true) {
    if (!this.enabled) return;

    // Calculate volume based on distance (spatial audio)
    let volume = 0.2; // Base volume for own footsteps

    if (!isOwnPlayer) {
      // Other players' footsteps get quieter with distance
      const maxHearingDistance = 30; // Max distance to hear footsteps

      if (distance > maxHearingDistance) {
        return; // Too far away, don't play sound
      }

      // Volume falls off with distance: 15% at close range, fading to 0%
      const distanceFactor = 1 - distance / maxHearingDistance;
      volume = 0.15 * distanceFactor; // Max 15% for other players
    }

    // Play the single footstep sound with variation
    this.play("footstep", {
      volume: volume,
      playbackRate: 0.9 + Math.random() * 0.2, // Slight pitch variation for variety
    });
  }

  /**
   * Toggle sound on/off
   */
  toggleSound() {
    this.enabled = !this.enabled;
    localStorage.setItem("supercooked_soundEnabled", this.enabled);
    console.log(`🔊 Sound ${this.enabled ? "enabled" : "disabled"}`);
    return this.enabled;
  }

  /**
   * Set master volume (0.0 to 1.0)
   */
  setVolume(volume) {
    this.masterVolume = Math.max(0, Math.min(1, volume));

    // Update all loaded sounds
    this.sounds.forEach((sound) => {
      sound.volume = this.masterVolume;
    });
  }

  /**
   * Stop all sounds
   */
  stopAll() {
    this.sounds.forEach((sound) => {
      sound.pause();
      sound.currentTime = 0;
    });
  }
}
