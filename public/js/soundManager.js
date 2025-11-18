/**
 * Sound Manager for Supercooked
 * Handles all game audio with spatial sound support
 */

export class SoundManager {
  constructor() {
    this.sounds = new Map();
    this.enabled = true;
    this.masterVolume = 0.3; // 30% volume by default

    // Check if user has sound preference saved
    const savedSoundPref = localStorage.getItem("supercooked_soundEnabled");
    if (savedSoundPref !== null) {
      this.enabled = savedSoundPref === "true";
    }
  }

  /**
   * Load a sound file
   */
  async loadSound(name, url) {
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
      console.log(`🔊 Loaded sound: ${name}`);
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

    const sound = this.sounds.get(name);
    if (!sound) {
      console.warn(`⚠️ Sound not found: ${name}`);
      return;
    }

    // Clone the audio to allow overlapping sounds
    const audioClone = sound.cloneNode();
    audioClone.volume = (options.volume || 1.0) * this.masterVolume;
    audioClone.playbackRate = options.playbackRate || 1.0;

    // Play and clean up after
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
