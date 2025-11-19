import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
import { GLTFLoader } from "https://unpkg.com/three@0.160.0/examples/jsm/loaders/GLTFLoader.js";

/**
 * Character Manager
 * Handles loading and creating character models
 */
export class CharacterManager {
  constructor() {
    this.gltfLoader = new GLTFLoader();
    this.characterModels = [];
    this.isModelsLoaded = false;
  }

  /**
   * Load all character models from GLB files
   * @returns {Promise<Array>} Array of loaded character models
   */
  async loadCharacterModels() {
    // Generate array of character names from 'a' to 'r' (18 characters)
    const characters = Array.from({ length: 18 }, (_, i) =>
      String.fromCharCode(97 + i)
    ); // 97 = 'a' in ASCII

    const loadPromises = characters.map((letter, index) => {
      return new Promise((resolve) => {
        this.gltfLoader.load(
          `/models/glb/character-${letter}.glb`,
          (gltf) => {
            // Enable shadows for all meshes
            gltf.scene.traverse((child) => {
              if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
              }
            });
            console.log(`✅ Loaded character-${letter}.glb (index ${index})`);

            // Store both scene and animations
            resolve({
              scene: gltf.scene,
              animations: gltf.animations,
              letter: letter,
            });
          },
          undefined,
          (error) => {
            console.error(`❌ Failed to load character-${letter}.glb:`, error);
            resolve(null); // Don't reject, just skip this model
          }
        );
      });
    });

    const loadedModels = await Promise.all(loadPromises);
    this.characterModels = loadedModels.filter((model) => model !== null);

    console.log(
      `📦 Total loaded: ${this.characterModels.length} out of 18 character models`
    );

    // Log which models failed to load
    const failedModels = characters.filter(
      (letter, index) => !loadedModels[index]
    );
    if (failedModels.length > 0) {
      console.warn(
        `⚠️ Missing models: character-${failedModels.join(
          ".glb, character-"
        )}.glb`
      );
    }

    this.isModelsLoaded = this.characterModels.length > 0;

    if (!this.isModelsLoaded) {
      console.warn("⚠️ No GLB models loaded, will use primitive shapes");
    }

    return this.characterModels;
  }

  /**
   * Create a character model for a player
   * @param {Object} playerData - Player data including skinIndex
   * @returns {THREE.Group} Character group with model
   */
  createCharacterModel(playerData) {
    const group = new THREE.Group();

    if (this.characterModels.length > 0) {
      // Use player's selected skin or default to 0
      let modelIndex = playerData.skinIndex || 0;
      if (modelIndex >= this.characterModels.length) {
        modelIndex = modelIndex % this.characterModels.length;
      }

      const modelData = this.characterModels[modelIndex];
      const characterModel = modelData.scene.clone();

      // Fix material issues
      this.fixMaterials(characterModel);

      // Scale and position the model
      characterModel.scale.set(1.2, 1.2, 1.2);
      group.add(characterModel);

      // Store character model reference
      group.userData.characterModel = characterModel;
    } else {
      // Fallback: Use primitive shapes
      this.createPrimitiveCharacter(group, playerData.color);
    }

    return group;
  }

  /**
   * Fix material transparency and rendering issues
   * @param {THREE.Object3D} model - The character model
   */
  fixMaterials(model) {
    model.traverse((child) => {
      if (child.isMesh && child.material) {
        // Clone material to avoid modifying the original
        child.material = child.material.clone();

        // Fix transparency issues
        child.material.transparent = false;
        child.material.opacity = 1.0;
        child.material.alphaTest = 0;
        child.material.depthWrite = true;
        child.material.side = THREE.FrontSide;

        // Force material update
        child.material.needsUpdate = true;
      }
    });
  }

  /**
   * Create primitive character (fallback when no GLB models available)
   * @param {THREE.Group} group - Group to add primitives to
   * @param {number} color - Character color
   */
  createPrimitiveCharacter(group, color) {
    // Body
    const bodyGeometry = new THREE.CylinderGeometry(0.4, 0.4, 1.5, 8);
    const bodyMaterial = new THREE.MeshStandardMaterial({
      color: color,
      roughness: 0.7,
      metalness: 0.3,
    });
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    body.castShadow = true;
    body.position.y = 1;
    group.add(body);

    // Head
    const headGeometry = new THREE.SphereGeometry(0.35, 8, 6);
    const headMaterial = new THREE.MeshStandardMaterial({
      color: color,
      roughness: 0.6,
      metalness: 0.2,
    });
    const head = new THREE.Mesh(headGeometry, headMaterial);
    head.castShadow = true;
    head.position.y = 2;
    group.add(head);

    // Nose
    const noseGeometry = new THREE.ConeGeometry(0.15, 0.3, 6);
    const noseMaterial = new THREE.MeshStandardMaterial({ color: 0x333333 });
    const nose = new THREE.Mesh(noseGeometry, noseMaterial);
    nose.rotation.x = Math.PI / 2;
    nose.position.set(0, 2, 0.4);
    nose.castShadow = true;
    group.add(nose);
  }

  /**
   * Get character model by index
   * @param {number} index - Model index
   * @returns {Object|null} Model data or null if not found
   */
  getModel(index) {
    if (index >= 0 && index < this.characterModels.length) {
      return this.characterModels[index];
    }
    return null;
  }

  /**
   * Get total number of loaded models
   * @returns {number} Number of models
   */
  getModelCount() {
    return this.characterModels.length;
  }

  /**
   * Check if models are loaded
   * @returns {boolean} Whether models are loaded
   */
  areModelsLoaded() {
    return this.isModelsLoaded;
  }
}
