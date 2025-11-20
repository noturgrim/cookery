import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
import { CharacterManager } from "../characterManager.js";
import { AnimationController } from "../animationController.js";

/**
 * Player Manager
 * Handles player creation, updates, and management
 */
export class PlayerManager {
  constructor(sceneManager, uiManager) {
    this.sceneManager = sceneManager;
    this.uiManager = uiManager;
    this.players = new Map();
    this.characterManager = new CharacterManager();
    this.animationController = new AnimationController();
    this.playerId = null;
  }

  /**
   * Set the current player ID
   */
  setPlayerId(id) {
    this.playerId = id;
  }

  /**
   * Load character models
   */
  async loadCharacterModels() {
    return await this.characterManager.loadCharacterModels();
  }

  /**
   * Get character manager
   */
  getCharacterManager() {
    return this.characterManager;
  }

  /**
   * Create a player
   */
  createPlayer(playerData) {
    // Check if player already exists
    if (this.players.has(playerData.id)) {
      console.log("⚠️ Player already exists, removing old one:", playerData.id);
      this.removePlayer(playerData.id);
    }

    // Create character model
    const group = this.characterManager.createCharacterModel(playerData);

    // Setup animation if character model exists
    const characterModel = group.userData.characterModel;
    if (characterModel) {
      const mixer = new THREE.AnimationMixer(characterModel);
      const animations = group.userData.animations || [];
      this.animationController.initializeAnimation(
        playerData.id,
        characterModel,
        mixer,
        animations
      );
    }

    // Position the player
    group.position.set(playerData.x, playerData.y, playerData.z);
    group.rotation.y = playerData.rotation || 0;

    // Start with spawn animation state (invisible and small)
    group.scale.set(0.1, 0.1, 0.1);
    group.traverse((child) => {
      if (child.isMesh && child.material) {
        child.material.transparent = true;
        child.material.opacity = 0;
      }
    });

    this.sceneManager.add(group);

    // Create collision box if enabled (after mesh is added to scene)
    let collisionBox = null;
    if (this.sceneManager.showCollisionBoxes) {
      collisionBox = this.sceneManager.createPlayerCollisionBox(group);
      this.sceneManager.scene.add(collisionBox);
      this.sceneManager.collisionBoxes.push(collisionBox);
    }

    this.players.set(playerData.id, {
      mesh: group,
      targetPosition: new THREE.Vector3(
        playerData.x,
        playerData.y,
        playerData.z
      ),
      targetRotation: playerData.rotation || 0,
      color: playerData.color,
      isMoving: false,
      spawnProgress: 0, // 0 to 1 for spawn animation
      isSpawning: true,
      collisionBox: collisionBox, // Store reference to collision box
    });

    // Add name tag
    const isCurrentPlayer = playerData.id === this.playerId;
    const nameColor = isCurrentPlayer ? 0x00ff00 : 0xffffff;
    const displayName = playerData.name || (isCurrentPlayer ? "You" : "Player");
    this.uiManager.createNameTag(group, displayName, nameColor);

    // Start spawn animation
    this.playSpawnAnimation(playerData.id);

    // Send player dimensions to server if this is the current player
    if (isCurrentPlayer && this.networkManager) {
      const boundingBox = this.sceneManager.calculateBoundingBox(group);
      this.networkManager.updatePlayerDimensions(boundingBox);
    }
  }

  /**
   * Play spawn animation for a player
   */
  playSpawnAnimation(playerId) {
    const player = this.players.get(playerId);
    if (!player) return;

    console.log(`✨ Spawning player: ${playerId}`);
  }

  /**
   * Update spawn animation
   */
  updateSpawnAnimation(playerId, delta) {
    const player = this.players.get(playerId);
    if (!player || !player.isSpawning) return;

    // Increase spawn progress (takes 0.8 seconds to fully spawn)
    player.spawnProgress += delta * 1.25;

    if (player.spawnProgress >= 1) {
      // Animation complete
      player.spawnProgress = 1;
      player.isSpawning = false;

      // Ensure final state
      player.mesh.scale.set(1, 1, 1);
      player.mesh.traverse((child) => {
        if (child.isMesh && child.material) {
          child.material.opacity = 1;
        }
      });
    } else {
      // Ease-out animation for smooth spawn
      const easeOut = 1 - Math.pow(1 - player.spawnProgress, 3);

      // Scale up from 0.1 to 1
      const scale = 0.1 + easeOut * 0.9;
      player.mesh.scale.set(scale, scale, scale);

      // Fade in
      player.mesh.traverse((child) => {
        if (child.isMesh && child.material) {
          child.material.opacity = easeOut;
        }
      });

      // Add a slight bounce at the end
      if (player.spawnProgress > 0.7) {
        const bounceProgress = (player.spawnProgress - 0.7) / 0.3;
        const bounce = Math.sin(bounceProgress * Math.PI) * 0.1;
        const baseY = player.targetPosition.y;
        player.mesh.position.y = baseY + bounce;
      }

      // Update collision box position during spawn animation
      if (player.collisionBox) {
        this.sceneManager.updatePlayerCollisionBox(
          player.collisionBox,
          player.mesh
        );
      }
    }
  }

  /**
   * Remove a player with despawn animation
   */
  removePlayer(playerId, withAnimation = false) {
    const player = this.players.get(playerId);
    if (!player) return;

    // Remove collision box if it exists
    if (player.collisionBox) {
      this.sceneManager.scene.remove(player.collisionBox);
      const index = this.sceneManager.collisionBoxes.indexOf(
        player.collisionBox
      );
      if (index > -1) {
        this.sceneManager.collisionBoxes.splice(index, 1);
      }
    }

    if (withAnimation && player.mesh) {
      // Play despawn animation before removing
      this.playDespawnAnimation(playerId);
    } else {
      // Remove immediately
      if (player.mesh) {
        this.sceneManager.remove(player.mesh);
      }
      this.players.delete(playerId);
      this.animationController.removePlayer(playerId);
    }
  }

  /**
   * Play despawn animation (fade out and shrink)
   */
  playDespawnAnimation(playerId) {
    const player = this.players.get(playerId);
    if (!player || !player.mesh) return;

    console.log(`💨 Despawning player: ${playerId}`);

    let progress = 0;
    const duration = 0.5; // 0.5 seconds

    const animate = (timestamp) => {
      if (!player.mesh) return;

      progress += 0.016; // ~60fps
      const t = Math.min(progress / duration, 1);
      const easeIn = Math.pow(t, 2);

      // Scale down
      const scale = 1 - easeIn;
      player.mesh.scale.set(scale, scale, scale);

      // Fade out
      player.mesh.traverse((child) => {
        if (child.isMesh && child.material) {
          child.material.opacity = 1 - easeIn;
        }
      });

      if (t < 1) {
        requestAnimationFrame(animate);
      } else {
        // Animation complete, remove player
        this.sceneManager.remove(player.mesh);
        this.players.delete(playerId);
        this.animationController.removePlayer(playerId);
      }
    };

    requestAnimationFrame(animate);
  }

  /**
   * Update player target position
   */
  updatePlayerTarget(playerId, x, y, z, rotation) {
    const player = this.players.get(playerId);
    if (player) {
      const posChanged =
        Math.abs(x - player.targetPosition.x) > 0.01 ||
        Math.abs(z - player.targetPosition.z) > 0.01;

      player.targetPosition.set(x, y, z);
      player.targetRotation = rotation;
      player.isMoving = posChanged;
    }
  }

  /**
   * Update all players (interpolation and animation)
   */
  updatePlayers(delta, soundManager) {
    const lerpFactor = 0.3;

    this.players.forEach((player, playerId) => {
      // Update spawn animation if player is spawning
      if (player.isSpawning) {
        this.updateSpawnAnimation(playerId, delta);
        return; // Skip other updates during spawn
      }

      // Skip position updates if player is sitting or lying
      if (!player.isSitting && !player.isLying) {
        // Smooth position interpolation
        player.mesh.position.lerp(player.targetPosition, lerpFactor);

        // Smooth rotation interpolation
        const currentRotation = player.mesh.rotation.y;
        let targetRotation = player.targetRotation;

        // Handle rotation wrap-around
        const diff = targetRotation - currentRotation;
        if (Math.abs(diff) > Math.PI) {
          if (diff > 0) {
            targetRotation -= Math.PI * 2;
          } else {
            targetRotation += Math.PI * 2;
          }
        }

        player.mesh.rotation.y +=
          (targetRotation - currentRotation) * lerpFactor;

        // Update walking animation (only if not sitting)
        this.updateWalkingAnimation(
          playerId,
          player.isMoving || false,
          soundManager
        );
      }

      // Update collision box position if it exists
      if (player.collisionBox) {
        this.sceneManager.updatePlayerCollisionBox(
          player.collisionBox,
          player.mesh
        );
      }
    });

    // Update animation mixers
    const allMixers = this.animationController.getAllMixers();
    allMixers.forEach((animData) => {
      if (animData.mixer) {
        animData.mixer.update(delta);
      }
    });
  }

  /**
   * Update walking animation for a player
   */
  updateWalkingAnimation(playerId, isMoving, soundManager) {
    const footstepEvent = this.animationController.updateAnimation(
      playerId,
      isMoving
    );

    // Handle footstep sound if a step occurred
    if (footstepEvent && soundManager) {
      const isOwnPlayer = playerId === this.playerId;
      let distance = 0;

      if (!isOwnPlayer) {
        const currentPlayer = this.players.get(this.playerId);
        const otherPlayer = this.players.get(playerId);

        if (currentPlayer && otherPlayer) {
          const dx =
            currentPlayer.mesh.position.x - otherPlayer.mesh.position.x;
          const dz =
            currentPlayer.mesh.position.z - otherPlayer.mesh.position.z;
          distance = Math.sqrt(dx * dx + dz * dz);
        }
      }

      soundManager.playFootstep(footstepEvent.footIndex, distance, isOwnPlayer);
    }
  }

  /**
   * Get player by ID
   */
  getPlayer(playerId) {
    return this.players.get(playerId);
  }

  /**
   * Clear all players
   */
  clear() {
    this.players.forEach((player) => {
      if (player.mesh) {
        this.sceneManager.remove(player.mesh);
      }
    });
    this.players.clear();
  }

  /**
   * Get all players
   */
  getAllPlayers() {
    return this.players;
  }
}
