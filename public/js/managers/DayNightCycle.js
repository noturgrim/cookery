import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";

/**
 * Day Night Cycle Manager
 * Handles dynamic time of day transitions with realistic sky colors and lighting
 */
export class DayNightCycle {
  constructor(scene, ambientLight, directionalLight, networkManager = null) {
    this.scene = scene;
    this.ambientLight = ambientLight;
    this.directionalLight = directionalLight;
    this.networkManager = networkManager;

    // Time management (0-24 hours)
    this.currentTime = 12.0; // Start at noon
    this.timeSpeed = 0.1; // How fast time progresses (lower = slower)
    this.paused = false;

    // Store original light references for restoration
    this.originalAmbientIntensity = ambientLight.intensity;
    this.originalDirectionalIntensity = directionalLight.intensity;

    // Sync settings
    this.syncEnabled = false; // Disabled by default, enabled after authentication
    this.syncInterval = 5000; // Sync every 5 seconds
    this.lastSyncTime = 0;

    // Time periods with specific colors and settings
    this.timePresets = {
      dawn: { time: 6.0, name: "Dawn" },
      morning: { time: 8.0, name: "Morning" },
      noon: { time: 12.0, name: "Noon" },
      afternoon: { time: 15.0, name: "Afternoon" },
      evening: { time: 18.0, name: "Evening" },
      dusk: { time: 19.5, name: "Dusk" },
      night: { time: 22.0, name: "Night" },
      midnight: { time: 0.0, name: "Midnight" },
    };

    // Sky color configurations for different times (realistic colors)
    this.skyColors = [
      { time: 0.0, color: new THREE.Color(0x050510), name: "Midnight" }, // Very dark blue-black
      { time: 4.0, color: new THREE.Color(0x0a0a20), name: "Late Night" }, // Dark navy
      { time: 5.0, color: new THREE.Color(0x1a1a35), name: "Pre-Dawn" }, // Deep blue
      { time: 5.5, color: new THREE.Color(0x2b2a4c), name: "Early Dawn" }, // Blue-purple
      { time: 6.0, color: new THREE.Color(0xff6b4a), name: "Dawn" }, // Orange-red sunrise
      { time: 6.5, color: new THREE.Color(0xffaa77), name: "Sunrise" }, // Warm orange
      { time: 7.0, color: new THREE.Color(0xffd4a3), name: "Early Morning" }, // Peach/golden
      { time: 8.0, color: new THREE.Color(0x87ceeb), name: "Morning" }, // Light blue sky
      { time: 10.0, color: new THREE.Color(0x5b9bd5), name: "Late Morning" }, // Brighter blue
      { time: 12.0, color: new THREE.Color(0x4a90e2), name: "Noon" }, // Vivid sky blue
      { time: 14.0, color: new THREE.Color(0x5b9bd5), name: "Early Afternoon" }, // Bright blue
      { time: 16.0, color: new THREE.Color(0x87ceeb), name: "Afternoon" }, // Light blue
      { time: 17.0, color: new THREE.Color(0xb8d4f1), name: "Late Afternoon" }, // Pale blue
      { time: 17.5, color: new THREE.Color(0xffc966), name: "Golden Hour" }, // Golden yellow
      { time: 18.0, color: new THREE.Color(0xff9955), name: "Evening" }, // Warm orange
      { time: 18.5, color: new THREE.Color(0xff7744), name: "Sunset Start" }, // Deep orange
      { time: 19.0, color: new THREE.Color(0xff5533), name: "Sunset" }, // Red-orange
      { time: 19.5, color: new THREE.Color(0xcc4466), name: "Late Sunset" }, // Pink-red
      { time: 20.0, color: new THREE.Color(0x664488), name: "Dusk" }, // Purple twilight
      { time: 20.5, color: new THREE.Color(0x3d3d6b), name: "Late Dusk" }, // Deep purple
      { time: 21.0, color: new THREE.Color(0x1e1e3e), name: "Early Night" }, // Dark blue
      { time: 22.0, color: new THREE.Color(0x0f0f25), name: "Night" }, // Very dark
      { time: 24.0, color: new THREE.Color(0x050510), name: "Midnight" }, // Back to midnight
    ];

    // Light intensity configurations (realistic lighting)
    this.lightIntensities = [
      { time: 0.0, ambient: 0.15, directional: 0.25 }, // Midnight - very dark
      { time: 4.0, ambient: 0.12, directional: 0.2 }, // Late night - darkest
      { time: 5.0, ambient: 0.15, directional: 0.25 }, // Pre-dawn
      { time: 6.0, ambient: 0.35, directional: 0.45 }, // Dawn - light increasing
      { time: 7.0, ambient: 0.5, directional: 0.6 }, // Early morning
      { time: 8.0, ambient: 0.65, directional: 0.75 }, // Morning - bright
      { time: 10.0, ambient: 0.75, directional: 0.85 }, // Late morning
      { time: 12.0, ambient: 0.8, directional: 0.95 }, // Noon - brightest
      { time: 14.0, ambient: 0.75, directional: 0.9 }, // Early afternoon
      { time: 16.0, ambient: 0.7, directional: 0.8 }, // Afternoon
      { time: 17.5, ambient: 0.6, directional: 0.7 }, // Golden hour
      { time: 18.5, ambient: 0.45, directional: 0.55 }, // Sunset
      { time: 19.5, ambient: 0.3, directional: 0.4 }, // Late sunset
      { time: 20.5, ambient: 0.2, directional: 0.3 }, // Dusk - getting dark
      { time: 22.0, ambient: 0.15, directional: 0.25 }, // Night
      { time: 24.0, ambient: 0.15, directional: 0.25 }, // Midnight
    ];

    // Directional light color (sun/moon tint - realistic)
    this.lightColors = [
      { time: 0.0, color: new THREE.Color(0x7788bb) }, // Cool blue moonlight
      { time: 4.0, color: new THREE.Color(0x6677aa) }, // Deep blue moon
      { time: 5.5, color: new THREE.Color(0x8899cc) }, // Pre-dawn blue
      { time: 6.0, color: new THREE.Color(0xffaa77) }, // Warm orange dawn
      { time: 6.5, color: new THREE.Color(0xffbb88) }, // Sunrise orange
      { time: 7.5, color: new THREE.Color(0xffddaa) }, // Golden morning
      { time: 8.0, color: new THREE.Color(0xffffdd) }, // Warm daylight
      { time: 10.0, color: new THREE.Color(0xffffee) }, // Bright daylight
      { time: 12.0, color: new THREE.Color(0xffffff) }, // Pure white noon sun
      { time: 14.0, color: new THREE.Color(0xffffee) }, // Bright afternoon
      { time: 16.0, color: new THREE.Color(0xffffdd) }, // Warm afternoon
      { time: 17.5, color: new THREE.Color(0xffddaa) }, // Golden hour
      { time: 18.0, color: new THREE.Color(0xffbb77) }, // Warm sunset
      { time: 18.5, color: new THREE.Color(0xff9955) }, // Orange sunset
      { time: 19.0, color: new THREE.Color(0xff7744) }, // Red-orange sunset
      { time: 19.5, color: new THREE.Color(0xee6655) }, // Deep sunset
      { time: 20.0, color: new THREE.Color(0xbb7799) }, // Purple twilight
      { time: 21.0, color: new THREE.Color(0x8888bb) }, // Blue-purple dusk
      { time: 22.0, color: new THREE.Color(0x7788bb) }, // Moonlight blue
      { time: 24.0, color: new THREE.Color(0x7788bb) }, // Moonlight
    ];

    // Sun position for directional light
    this.updateSunPosition();
  }

  /**
   * Update time and apply changes to scene
   */
  update(deltaTime) {
    if (this.paused) return;

    // Advance time
    this.currentTime += deltaTime * this.timeSpeed;

    // Wrap around 24 hours
    if (this.currentTime >= 24.0) {
      this.currentTime -= 24.0;
    }

    // Apply visual changes
    this.updateSkyColor();
    this.updateLighting();
    this.updateSunPosition();

    // Periodic sync with server
    if (this.syncEnabled && this.networkManager) {
      const now = Date.now();
      if (now - this.lastSyncTime > this.syncInterval) {
        this.syncToServer();
        this.lastSyncTime = now;
      }
    }
  }

  /**
   * Interpolate between color/intensity points
   */
  interpolate(array, time, property = "color") {
    // Find the two points to interpolate between
    let before = array[0];
    let after = array[array.length - 1];

    for (let i = 0; i < array.length - 1; i++) {
      if (time >= array[i].time && time <= array[i + 1].time) {
        before = array[i];
        after = array[i + 1];
        break;
      }
    }

    // Calculate interpolation factor (0 to 1)
    const range = after.time - before.time;
    const factor = range > 0 ? (time - before.time) / range : 0;

    if (property === "color") {
      // Interpolate colors
      const color = new THREE.Color();
      color.lerpColors(before.color, after.color, factor);
      return color;
    } else {
      // Interpolate numbers (ambient/directional intensity)
      return THREE.MathUtils.lerp(before[property], after[property], factor);
    }
  }

  /**
   * Update sky background color
   */
  updateSkyColor() {
    const skyColor = this.interpolate(this.skyColors, this.currentTime);
    this.scene.background = skyColor;
  }

  /**
   * Update lighting intensities and colors
   */
  updateLighting() {
    // Update light intensities
    const ambientIntensity = this.interpolate(
      this.lightIntensities,
      this.currentTime,
      "ambient"
    );
    const directionalIntensity = this.interpolate(
      this.lightIntensities,
      this.currentTime,
      "directional"
    );

    this.ambientLight.intensity = ambientIntensity;
    this.directionalLight.intensity = directionalIntensity;

    // Update light color
    const lightColor = this.interpolate(this.lightColors, this.currentTime);
    this.directionalLight.color = lightColor;
  }

  /**
   * Update sun/moon position based on time
   */
  updateSunPosition() {
    // Calculate angle based on time (0-24 hours = 0-360 degrees)
    const angle = ((this.currentTime - 6) / 24) * Math.PI * 2; // 6 AM is sunrise (angle 0)

    // Sun arc across the sky
    const distance = 20;
    const x = Math.cos(angle) * distance * 0.5;
    const y = Math.sin(angle) * distance;
    const z = 10;

    // During night, move light to simulate moon position
    const isNight = this.currentTime < 6 || this.currentTime > 20;
    if (isNight) {
      // Moon position (opposite side)
      this.directionalLight.position.set(-x, Math.abs(y) * 0.6, z);
    } else {
      // Sun position
      this.directionalLight.position.set(x, Math.abs(y), z);
    }
  }

  /**
   * Set specific time of day
   */
  setTime(hours) {
    this.currentTime = Math.max(0, Math.min(24, hours));
    this.updateSkyColor();
    this.updateLighting();
    this.updateSunPosition();
  }

  /**
   * Jump to a preset time
   */
  setTimePreset(presetName) {
    if (this.timePresets[presetName]) {
      this.setTime(this.timePresets[presetName].time);
      console.log(
        `⏰ Time set to: ${this.timePresets[presetName].name} (${this.timePresets[presetName].time}:00)`
      );
    }
  }

  /**
   * Change time progression speed
   */
  setTimeSpeed(speed) {
    this.timeSpeed = Math.max(0, speed);
    console.log(`⏱️ Time speed: ${this.timeSpeed.toFixed(2)}x`);
  }

  /**
   * Toggle pause
   */
  togglePause() {
    this.paused = !this.paused;
    console.log(`⏸️ Time ${this.paused ? "paused" : "resumed"}`);
    return this.paused;
  }

  /**
   * Get current time as formatted string
   */
  getTimeString() {
    const hours = Math.floor(this.currentTime);
    const minutes = Math.floor((this.currentTime % 1) * 60);
    const ampm = hours >= 12 ? "PM" : "AM";
    const displayHours = hours % 12 || 12;
    return `${displayHours}:${minutes.toString().padStart(2, "0")} ${ampm}`;
  }

  /**
   * Get current period name (Dawn, Morning, Noon, etc.)
   */
  getCurrentPeriod() {
    const time = this.currentTime;

    if (time >= 22 || time < 4) return "Night";
    if (time >= 4 && time < 6) return "Pre-Dawn";
    if (time >= 6 && time < 7) return "Dawn";
    if (time >= 7 && time < 12) return "Morning";
    if (time >= 12 && time < 15) return "Noon";
    if (time >= 15 && time < 18) return "Afternoon";
    if (time >= 18 && time < 20) return "Evening";
    if (time >= 20 && time < 22) return "Dusk";

    return "Unknown";
  }

  /**
   * Get debug info
   */
  getDebugInfo() {
    return {
      time: this.currentTime.toFixed(2),
      timeString: this.getTimeString(),
      period: this.getCurrentPeriod(),
      speed: this.timeSpeed,
      paused: this.paused,
      ambientIntensity: this.ambientLight.intensity.toFixed(2),
      directionalIntensity: this.directionalLight.intensity.toFixed(2),
    };
  }

  /**
   * Set network manager for syncing
   */
  setNetworkManager(networkManager) {
    this.networkManager = networkManager;
  }

  /**
   * Enable syncing (call after authentication)
   */
  enableSync() {
    this.syncEnabled = true;
    console.log("🔄 Day-night cycle sync enabled");
  }

  /**
   * Disable syncing
   */
  disableSync() {
    this.syncEnabled = false;
  }

  /**
   * Sync current time to server
   */
  syncToServer() {
    if (!this.networkManager || !this.networkManager.socket) return;

    this.networkManager.socket.emit("updateWorldTime", {
      currentTime: this.currentTime,
      timeSpeed: this.timeSpeed,
      isPaused: this.paused,
    });
  }

  /**
   * Receive time update from server
   */
  syncFromServer(serverData) {
    if (serverData.currentTime !== undefined) {
      this.currentTime = serverData.currentTime;
    }
    if (serverData.timeSpeed !== undefined) {
      this.timeSpeed = serverData.timeSpeed;
    }
    if (serverData.isPaused !== undefined) {
      this.paused = serverData.isPaused;
    }

    // Immediately apply visual changes
    this.updateSkyColor();
    this.updateLighting();
    this.updateSunPosition();
  }
}
