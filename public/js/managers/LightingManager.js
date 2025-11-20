import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";

/**
 * Lighting Manager
 * Manages dynamic lights for lamps and other light sources
 */
export class LightingManager {
  constructor(scene, dayNightCycle) {
    this.scene = scene;
    this.dayNightCycle = dayNightCycle;
    this.lights = new Map(); // Map of object id to light data

    // Lamp configurations - adjust these for your models
    this.lampConfigs = {
      lamp: {
        type: "point",
        color: 0xffdd88, // Warm white
        intensity: 1.5,
        distance: 8,
        decay: 2,
        offset: { x: 0, y: 1.5, z: 0 }, // Height offset from lamp base
      },
      lampWall: {
        type: "point",
        color: 0xffdd88,
        intensity: 1.2,
        distance: 6,
        decay: 2,
        offset: { x: 0, y: 0.5, z: 0 },
      },
      // Add more lamp types as needed
    };
  }

  /**
   * Detect and add lights to lamp objects
   */
  detectAndAddLampsLights(objects) {
    let lampsFound = 0;

    objects.forEach((object) => {
      if (this.isLampObject(object)) {
        this.addLightToObject(object);
        lampsFound++;
      }
    });

    console.log(`💡 Added lights to ${lampsFound} lamps`);
  }

  /**
   * Check if an object is a lamp
   */
  isLampObject(object) {
    if (!object.userData) return false;

    // Check both name and model fields
    const name = (object.userData.name || "").toLowerCase();
    const model = (object.userData.model || "").toLowerCase();
    const id = (object.userData.id || "").toLowerCase();

    return (
      name.includes("lamp") ||
      name.includes("light") ||
      model.includes("lamp") ||
      model.includes("light") ||
      id.includes("lamp") ||
      id.includes("light")
    );
  }

  /**
   * Get lamp configuration based on object name
   */
  getLampConfig(object) {
    const name = (object.userData.name || "").toLowerCase();
    const model = (object.userData.model || "").toLowerCase();
    const id = (object.userData.id || "").toLowerCase();

    // Combine all identifiers
    const identifier = `${name} ${model} ${id}`;

    // Check for specific lamp types
    if (identifier.includes("wall")) return this.lampConfigs.lampWall;

    // Default lamp config
    return this.lampConfigs.lamp;
  }

  /**
   * Add light to a lamp object
   */
  addLightToObject(object) {
    const objectId = object.userData.id;

    // Don't add if already has light
    if (this.lights.has(objectId)) return;

    const config = this.getLampConfig(object);
    let light;

    // Create light based on type
    if (config.type === "point") {
      light = new THREE.PointLight(
        config.color,
        config.intensity,
        config.distance,
        config.decay
      );
    } else if (config.type === "spot") {
      light = new THREE.SpotLight(config.color, config.intensity);
      light.angle = config.angle || Math.PI / 6;
      light.penumbra = config.penumbra || 0.2;
      light.distance = config.distance || 10;
      light.decay = config.decay || 2;
    }

    // Position light relative to lamp
    const offset = config.offset;
    light.position.set(
      object.position.x + offset.x,
      object.position.y + offset.y,
      object.position.z + offset.z
    );

    // Optional: Add light helper for debugging (remove in production)
    // const helper = new THREE.PointLightHelper(light, 0.3);
    // this.scene.add(helper);

    // Add to scene
    this.scene.add(light);

    // Store reference
    this.lights.set(objectId, {
      light: light,
      object: object,
      config: config,
      isOn: true,
    });

    console.log(`💡 Added ${config.type} light to ${object.userData.id}`);
  }

  /**
   * Update light position when object moves
   */
  updateLightPosition(object) {
    const objectId = object.userData.id;
    const lightData = this.lights.get(objectId);

    if (lightData) {
      const offset = lightData.config.offset;
      lightData.light.position.set(
        object.position.x + offset.x,
        object.position.y + offset.y,
        object.position.z + offset.z
      );
    }
  }

  /**
   * Toggle light on/off
   */
  toggleLight(objectId) {
    const lightData = this.lights.get(objectId);

    if (lightData) {
      lightData.isOn = !lightData.isOn;
      lightData.light.intensity = lightData.isOn
        ? lightData.config.intensity
        : 0;
      return lightData.isOn;
    }

    return false;
  }

  /**
   * Turn all lights on/off
   */
  setAllLights(on) {
    this.lights.forEach((lightData) => {
      lightData.isOn = on;
      lightData.light.intensity = on ? lightData.config.intensity : 0;
    });
  }

  /**
   * Adjust light intensity based on time of day
   * Lights are brighter at night, dimmer during day
   */
  updateLightsForTimeOfDay() {
    if (!this.dayNightCycle) return;

    const time = this.dayNightCycle.currentTime;
    let intensityMultiplier = 1.0;

    // Calculate multiplier based on time
    if (time >= 6 && time < 18) {
      // Daytime (6 AM - 6 PM): Lights dimmer or off
      intensityMultiplier = 0.3;
    } else if (time >= 18 && time < 20) {
      // Evening (6 PM - 8 PM): Gradually brighten
      const t = (time - 18) / 2; // 0 to 1
      intensityMultiplier = 0.3 + t * 0.7; // 0.3 to 1.0
    } else if (time >= 20 || time < 5) {
      // Night (8 PM - 5 AM): Full brightness
      intensityMultiplier = 1.0;
    } else {
      // Dawn (5 AM - 6 AM): Gradually dim
      const t = (time - 5) / 1; // 0 to 1
      intensityMultiplier = 1.0 - t * 0.7; // 1.0 to 0.3
    }

    // Apply to all lights
    this.lights.forEach((lightData) => {
      if (lightData.isOn) {
        lightData.light.intensity =
          lightData.config.intensity * intensityMultiplier;
      }
    });
  }

  /**
   * Remove light from object
   */
  removeLight(objectId) {
    const lightData = this.lights.get(objectId);

    if (lightData) {
      this.scene.remove(lightData.light);
      this.lights.delete(objectId);
    }
  }

  /**
   * Remove all lights
   */
  removeAllLights() {
    this.lights.forEach((lightData) => {
      this.scene.remove(lightData.light);
    });
    this.lights.clear();
  }

  /**
   * Get light info for debugging
   */
  getLightInfo() {
    return {
      totalLights: this.lights.size,
      lightsOn: Array.from(this.lights.values()).filter((l) => l.isOn).length,
      lights: Array.from(this.lights.entries()).map(([id, data]) => ({
        id: id,
        type: data.config.type,
        on: data.isOn,
        position: data.light.position,
      })),
    };
  }
}
