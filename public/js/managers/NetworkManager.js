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
      const { id, x, y, z } = data;
      const obstacle = this.sceneManager.obstacles.find(
        (obs) => obs.userData.id === id
      );
      if (obstacle) {
        obstacle.position.set(x, y, z);
        console.log(`📦 Obstacle ${id} updated by another player`);
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
   * Update obstacle position on server
   */
  updateObstacle(id, x, y, z) {
    if (this.socket) {
      this.socket.emit("updateObstacle", { id, x, y, z });
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
