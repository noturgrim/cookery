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
   * Play footstep sound (special handling for walking)
   */
  playFootstep(stepNumber = 0) {
    if (!this.enabled) return;

    // Play the single footstep sound with variation
    this.play("footstep", {
      volume: 0.2, // Quieter for footsteps
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
