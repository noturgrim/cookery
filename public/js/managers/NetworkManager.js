import { io } from "https://cdn.socket.io/4.6.1/socket.io.esm.min.js";

/**
 * Network Manager
 * Handles all Socket.io connections and server communication
 */
export class NetworkManager {
  constructor(playerManager, sceneManager, uiManager, soundManager) {
    this.playerManager = playerManager;
    this.sceneManager = sceneManager;
    this.uiManager = uiManager;
    this.soundManager = soundManager;
    this.socket = null;
    this.playerId = null;
    this.playerName = "";
    this.playerSkin = 0;
  }

  /**
   * Set player customization data
   */
  setPlayerData(name, skinIndex) {
    this.playerName = name;
    this.playerSkin = skinIndex;
  }

  /**
   * Set input manager reference (called after InputManager is created)
   */
  setInputManager(inputManager) {
    this.inputManager = inputManager;
  }

  /**
   * Setup Socket.io connection
   */
  setupSocket() {
    this.socket = io();

    // Send player customization on connection
    this.socket.on("connect", () => {
      this.socket.emit("playerCustomization", {
        name: this.playerName,
        skinIndex: this.playerSkin,
      });
    });

    // Initialize game state
    this.socket.on("init", (data) => {
      console.log("🎮 Connected to game server");
      this.playerId = data.playerId;
      this.playerManager.setPlayerId(this.playerId);

      // Clear existing players
      this.playerManager.clear();

      // Create all existing players
      data.players.forEach((player) => {
        this.playerManager.createPlayer(player);
      });

      // Create all obstacles
      data.obstacles.forEach((obstacle) => {
        this.sceneManager.createObstacle(obstacle);
      });

      // Create all food items
      if (data.foodItems && data.foodItems.length > 0) {
        data.foodItems.forEach((foodItem) => {
          this.sceneManager.spawnFoodItem(
            foodItem.name,
            foodItem.x,
            foodItem.y,
            foodItem.z,
            foodItem.scale,
            foodItem.id // Pass existing ID for persistence
          );
        });
        console.log(
          `🍔 Loaded ${data.foodItems.length} food items from server`
        );
      }
    });

    // Handle new player joining
    this.socket.on("playerJoined", (playerData) => {
      console.log("👋 Player joined:", playerData.id);

      if (!this.playerManager.getAllPlayers().has(playerData.id)) {
        this.playerManager.createPlayer(playerData);
      } else {
        console.log(
          "⚠️ Player already exists, skipping duplicate:",
          playerData.id
        );
      }
    });

    // Handle player leaving
    this.socket.on("playerLeft", (playerId) => {
      console.log("👋 Player left:", playerId);
      this.playerManager.removePlayer(playerId, true); // true = with animation
    });

    // Handle game state updates
    this.socket.on("gameState", (state) => {
      state.players.forEach((serverPlayer) => {
        this.playerManager.updatePlayerTarget(
          serverPlayer.id,
          serverPlayer.x,
          serverPlayer.y,
          serverPlayer.z,
          serverPlayer.rotation
        );
      });
    });

    // Handle path updates
    this.socket.on("pathUpdate", (data) => {
      if (data.playerId === this.playerId && data.path) {
        this.uiManager.drawPathTrace(data.path);
      }
    });

    // Handle obstacle updates
    this.socket.on("obstacleUpdated", (data) => {
      const { id, x, y, z, rotation } = data;
      const obstacle = this.sceneManager.obstacles.find(
        (obs) => obs.userData.id === id
      );
      if (obstacle) {
        obstacle.position.set(x, y, z);
        if (rotation !== undefined) {
          obstacle.rotation.y = rotation;
        }
        console.log(`📦 Obstacle ${id} updated by another player`);
      }
    });

    // Handle new obstacle spawned by other players
    this.socket.on("obstacleSpawned", async (obstacleData) => {
      const obstacle = await this.sceneManager.createObstacle(obstacleData);
      // Apply highlight if edit mode is active
      if (this.inputManager && this.inputManager.editMode && obstacle) {
        this.inputManager.highlightObject(obstacle);
      }
      console.log(`✨ Obstacle ${obstacleData.id} spawned by another player`);
    });

    // Handle obstacle deleted by other players
    this.socket.on("obstacleDeleted", (data) => {
      const { id } = data;
      const obstacle = this.sceneManager.obstacles.find(
        (obs) => obs.userData.id === id
      );
      if (obstacle) {
        this.sceneManager.scene.remove(obstacle);
        const index = this.sceneManager.obstacles.indexOf(obstacle);
        if (index > -1) {
          this.sceneManager.obstacles.splice(index, 1);
        }
        console.log(`🗑️ Obstacle ${id} deleted by another player`);
      }
    });

    // Handle food spawned by other players
    this.socket.on("foodSpawned", async (foodData) => {
      const foodModel = await this.sceneManager.spawnFoodItem(
        foodData.name,
        foodData.x,
        foodData.y,
        foodData.z,
        foodData.scale,
        foodData.id // Pass existing ID for persistence
      );
      // Apply highlight if edit mode is active
      if (this.inputManager && this.inputManager.editMode && foodModel) {
        this.inputManager.highlightObject(foodModel);
      }
      console.log(`✨ Food ${foodData.id} spawned by another player`);
    });

    // Handle food updates
    this.socket.on("foodUpdated", (data) => {
      const { id, x, y, z } = data;
      const foodItem = this.sceneManager.foodItems.get(id);
      if (foodItem && foodItem.model) {
        foodItem.model.position.set(x, y, z);
        foodItem.position = { x, y, z };
        console.log(`🍔 Food ${id} updated by another player`);
      }
    });

    // Handle food deleted by other players
    this.socket.on("foodDeleted", (data) => {
      const { id } = data;
      const foodItem = this.sceneManager.foodItems.get(id);
      if (foodItem) {
        this.sceneManager.scene.remove(foodItem.model);
        this.sceneManager.foodItems.delete(id);
        console.log(`🗑️ Food ${id} deleted by another player`);
      }
    });

    // Handle emote/voice from other players
    this.socket.on("playerEmote", (data) => {
      const { playerId, emote } = data;

      // Don't play for own player
      if (playerId === this.playerId) return;

      // Calculate distance for spatial audio
      const currentPlayer = this.playerManager.getPlayer(this.playerId);
      const otherPlayer = this.playerManager.getPlayer(playerId);

      if (currentPlayer && otherPlayer) {
        const dx = currentPlayer.mesh.position.x - otherPlayer.mesh.position.x;
        const dz = currentPlayer.mesh.position.z - otherPlayer.mesh.position.z;
        const distance = Math.sqrt(dx * dx + dz * dz);

        // Play voice with spatial audio
        this.soundManager.playVoice(emote, distance, false);

        // Show visual indicator
        this.uiManager.showVoiceIndicator(
          otherPlayer.mesh,
          emote,
          this.sceneManager.camera
        );
      }
    });
  }

  /**
   * Send move command to server
   */
  moveTo(x, z) {
    if (this.socket) {
      this.socket.emit("moveTo", { x, z });
    }
  }

  /**
   * Update obstacle position and rotation on server
   */
  updateObstacle(id, x, y, z, rotation = 0) {
    if (this.socket) {
      this.socket.emit("updateObstacle", { id, x, y, z, rotation });
    }
  }

  /**
   * Spawn obstacle on server
   */
  spawnObstacle(obstacleData) {
    if (this.socket) {
      this.socket.emit("spawnObstacle", obstacleData);
    }
  }

  /**
   * Delete obstacle on server
   */
  deleteObstacle(id) {
    if (this.socket) {
      this.socket.emit("deleteObstacle", { id });
    }
  }

  /**
   * Spawn food item on server
   */
  spawnFood(foodData) {
    if (this.socket) {
      this.socket.emit("spawnFood", foodData);
    }
  }

  /**
   * Update food position on server
   */
  updateFood(id, x, y, z) {
    if (this.socket) {
      this.socket.emit("updateFood", { id, x, y, z });
    }
  }

  /**
   * Delete food item on server
   */
  deleteFood(id) {
    if (this.socket) {
      this.socket.emit("deleteFood", { id });
    }
  }

  /**
   * Play an emote
   */
  playEmote(emoteName) {
    console.log(`🎵 Playing emote: ${emoteName}`);

    // Play sound locally
    this.soundManager.playVoice(emoteName, 0, true);

    // Send to server
    if (this.socket) {
      this.socket.emit("playEmote", {
        playerId: this.playerId,
        emote: emoteName,
      });
    }

    // Show visual indicator
    const player = this.playerManager.getPlayer(this.playerId);
    if (player) {
      this.uiManager.showVoiceIndicator(
        player.mesh,
        emoteName,
        this.sceneManager.camera
      );
    }
  }

  /**
   * Update player customization
   */
  updatePlayerCustomization(name, skinIndex) {
    if (this.socket) {
      this.socket.emit("playerCustomization", {
        name: name,
        skinIndex: skinIndex,
      });
    }
  }

  /**
   * Check if socket is connected
   */
  isConnected() {
    return this.socket && this.socket.connected;
  }
}
