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
      this.animationController.initializeAnimation(
        playerData.id,
        characterModel,
        mixer
      );
    }

    // Position the player
    group.position.set(playerData.x, playerData.y, playerData.z);
    group.rotation.y = playerData.rotation || 0;

    this.sceneManager.add(group);
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
    });

    // Add name tag
    const isCurrentPlayer = playerData.id === this.playerId;
    const nameColor = isCurrentPlayer ? 0x00ff00 : 0xffffff;
    const displayName = playerData.name || (isCurrentPlayer ? "You" : "Player");
    this.uiManager.createNameTag(group, displayName, nameColor);
  }

  /**
   * Remove a player
   */
  removePlayer(playerId) {
    const player = this.players.get(playerId);
    if (player && player.mesh) {
      this.sceneManager.remove(player.mesh);
    }
    this.players.delete(playerId);
    this.animationController.removePlayer(playerId);
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

      player.mesh.rotation.y += (targetRotation - currentRotation) * lerpFactor;

      // Update walking animation
      this.updateWalkingAnimation(
        playerId,
        player.isMoving || false,
        soundManager
      );
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
