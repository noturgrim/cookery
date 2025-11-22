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
   * Set interaction manager reference (called after InteractionManager is created)
   */
  setInteractionManager(interactionManager) {
    this.interactionManager = interactionManager;
  }

  /**
   * Update player dimensions on the server
   */
  updatePlayerDimensions(boundingBox) {
    if (!this.socket) return;

    const width = boundingBox.max.x - boundingBox.min.x;
    const height = boundingBox.max.y - boundingBox.min.y;
    const depth = boundingBox.max.z - boundingBox.min.z;

    this.socket.emit("updatePlayerDimensions", {
      width,
      height,
      depth,
    });
  }

  /**
   * Update platform size
   */
  updatePlatformSize(platformSize) {
    if (!this.socket) {
      console.error("❌ Cannot update platform size: socket not connected");
      return;
    }

    const size = parseInt(platformSize);
    console.log(`📤 Sending platform size update to server: ${size}x${size}`);

    this.socket.emit("updatePlatformSize", {
      platformSize: size,
    });
  }

  /**
   * Setup Socket.io connection
   */
  setupSocket() {
    this.socket = io();

    // Authenticate on connection
    this.socket.on("connect", () => {
      const sessionToken = localStorage.getItem("sessionToken");
      if (!sessionToken) {
        console.error("❌ No session token found");
        window.location.href = "/auth.html";
        return;
      }

      // Send authentication
      this.socket.emit("authenticate", { sessionToken });
    });

    // Handle authentication response
    this.socket.on("authenticated", (data) => {
      console.log("✅ Authenticated with game server");
      this.playerId = data.playerId;
      console.log(`🎮 Player ID: ${this.playerId}`);
    });

    // Handle authentication errors
    this.socket.on("authError", (data) => {
      console.error("❌ Authentication error:", data.error);
      alert(`Authentication failed: ${data.error}\nPlease log in again.`);
      localStorage.removeItem("sessionToken");
      localStorage.removeItem("user");
      window.location.href = "/auth.html";
    });

    // Initialize game state
    this.socket.on("init", (data) => {
      console.log("🎮 Connected to game server");
      this.playerId = data.playerId;
      this.playerManager.setPlayerId(this.playerId);

      // Clear existing players
      this.playerManager.clear();

      // Request connections sync FIRST, then music sync
      // This ensures we know which speakers are connected before starting music
      setTimeout(() => {
        console.log("🔌 Requesting connections sync from server...");
        this.socket.emit("requestConnectionsSync");
      }, 300);

      // Music sync is already requested at 300ms, no need to request again

      // Initialize world time from server
      if (
        data.worldTime &&
        this.sceneManager &&
        this.sceneManager.dayNightCycle
      ) {
        try {
          this.sceneManager.dayNightCycle.syncFromServer(data.worldTime);
          // Enable sync now that we're authenticated
          this.sceneManager.dayNightCycle.enableSync();
          console.log(
            `🕒 World time synced: ${data.worldTime.currentTime.toFixed(2)}h`
          );
        } catch (error) {
          console.warn("⚠️ Failed to sync world time:", error);
        }
      }

      // Initialize platform size from server
      if (data.worldSettings && data.worldSettings.platformSize) {
        try {
          this.sceneManager.updatePlatformSize(data.worldSettings.platformSize);
          console.log(
            `🟦 Platform size synced: ${data.worldSettings.platformSize}x${data.worldSettings.platformSize}`
          );
        } catch (error) {
          console.warn("⚠️ Failed to sync platform size:", error);
        }
      }

      // Sync all furniture collision boxes to server after a delay (wait for scene to load)
      setTimeout(() => {
        this.syncAllFurnitureCollisions();
      }, 1000);

      // Create all existing players
      data.players.forEach((player) => {
        this.playerManager.createPlayer(player);

        // If player is sitting, set up their sitting state after creation
        if (player.isSitting && this.interactionManager) {
          // Wait a bit for the player to be fully created
          setTimeout(() => {
            const createdPlayer = this.playerManager.players.get(player.id);
            if (createdPlayer && createdPlayer.mesh) {
              // Mark as sitting
              createdPlayer.isSitting = true;
              createdPlayer.sittingOn = player.sittingOn;
              createdPlayer.seatIndex = player.seatIndex;
              createdPlayer.isMoving = false;

              // Set position (already set from server data, but ensure it's locked)
              createdPlayer.targetPosition.set(player.x, player.y, player.z);
              createdPlayer.mesh.position.set(player.x, player.y, player.z);
              createdPlayer.mesh.rotation.y = player.rotation;
              createdPlayer.targetRotation = player.rotation;

              // Play sit animation
              this.playerManager.animationController.playAnimationClip(
                player.id,
                "sit",
                null,
                true // Loop
              );

              console.log(
                `👀 Loaded sitting player ${player.id} on ${
                  player.sittingOn
                } (seat ${player.seatIndex + 1})`
              );
            }
          }, 100); // Small delay to ensure player is fully initialized
        }

        // If player is lying, set up their lying state after creation
        if (player.isLying && this.interactionManager) {
          setTimeout(() => {
            const createdPlayer = this.playerManager.players.get(player.id);
            if (createdPlayer && createdPlayer.mesh) {
              // Mark as lying
              createdPlayer.isLying = true;
              createdPlayer.lyingOn = player.lyingOn;
              createdPlayer.lyingIndex = player.lyingIndex;
              createdPlayer.isMoving = false;

              // Set position
              createdPlayer.targetPosition.set(player.x, player.y, player.z);
              createdPlayer.mesh.position.set(player.x, player.y, player.z);
              createdPlayer.mesh.rotation.y = player.rotation;
              createdPlayer.targetRotation = player.rotation;

              // Play lie animation
              const hasAnimation =
                this.playerManager.animationController.playAnimationClip(
                  player.id,
                  "lie",
                  null,
                  true // Loop
                );

              if (!hasAnimation) {
                // Use procedural lying pose
                this.playerManager.animationController.applyLyingPose(
                  player.id
                );
              }

              // Add sleeping indicator (Z's)
              this.playerManager.addSleepingIndicator(player.id);

              console.log(
                `👀 Loaded lying player ${player.id} on ${
                  player.lyingOn
                } (position ${player.lyingIndex + 1})`
              );
            }
          }, 100);
        }
      });

      // Store cat positions for later (after model loads)
      if (data.cats && data.cats.length > 0) {
        console.log(
          `🐱 Received ${data.cats.length} cat positions from server`
        );
        if (window.game && window.game.petManager) {
          window.game.petManager.pendingCats = data.cats;
        }
      }

      // Trigger pet loading after network is ready
      if (window.game && window.game.petManager && !window.game.petsLoaded) {
        window.game.petsLoaded = true;
        window.game.loadPets();
      }

      // Create all obstacles
      data.obstacles.forEach(async (obstacle) => {
        const obj = await this.sceneManager.createObstacle(obstacle);
        if (obj) {
          // Object created successfully
        }
      });

      // After all obstacles are loaded, detect and add lights to lamps
      setTimeout(() => {
        this.sceneManager.detectLampsAndAddLights();
      }, 1000);

      // Create all food items
      if (data.foodItems && data.foodItems.length > 0) {
        data.foodItems.forEach(async (foodItem) => {
          const foodModel = await this.sceneManager.spawnFoodItem(
            foodItem.name,
            foodItem.x,
            foodItem.y,
            foodItem.z,
            foodItem.scale,
            foodItem.id // Pass existing ID for persistence
          );
          if (foodModel) {
            // Food model created successfully
          }
        });
        console.log(
          `🍔 Loaded ${data.foodItems.length} food items from server`
        );
      }
    });

    // Handle new player joining
    // Listen for cat updates from other players
    this.socket.on("catsUpdate", (cats) => {
      if (window.game && window.game.petManager) {
        window.game.petManager.receiveCatsUpdate(cats);
      }
    });

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

    // Handle player customization updates
    this.socket.on("playerCustomizationUpdated", (data) => {
      console.log(`🎨 Player ${data.playerId} updated customization:`, data);
      const player = this.playerManager.getAllPlayers().get(data.playerId);
      if (player) {
        // Update name tag
        if (data.name && player.nameTag) {
          player.nameTag.visible = false;
          player.group.remove(player.nameTag);
          this.playerManager.uiManager.createNameTag(
            player.group,
            data.name,
            player.color
          );
        }
        // Update skin (reload character model)
        if (
          typeof data.skinIndex === "number" &&
          data.skinIndex !== player.skinIndex
        ) {
          player.skinIndex = data.skinIndex;
          this.playerManager.updatePlayerModel(data.playerId, data.skinIndex);
        }
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
        const player = this.playerManager.players.get(serverPlayer.id);

        // Don't update position if player is sitting or lying (to prevent jitter)
        if (player && (player.isSitting || player.isLying)) {
          // Keep the sitting/lying player locked in position
          return;
        }

        this.playerManager.updatePlayerTarget(
          serverPlayer.id,
          serverPlayer.x,
          serverPlayer.y,
          serverPlayer.z,
          serverPlayer.rotation
        );

        // Update sitting/lying state if it changed on server
        if (player) {
          if (serverPlayer.isSitting !== player.isSitting) {
            player.isSitting = serverPlayer.isSitting;
          }
          if (serverPlayer.isLying !== player.isLying) {
            player.isLying = serverPlayer.isLying;
          }
        }
      });
    });

    // Handle world time updates from server
    this.socket.on("worldTimeUpdate", (data) => {
      if (this.sceneManager.dayNightCycle) {
        this.sceneManager.dayNightCycle.syncFromServer(data);
      }
    });

    // Handle platform size updates
    this.socket.on("platformSizeUpdate", (data) => {
      console.log(`📥 Received platform size update from server:`, data);
      if (data.platformSize && this.sceneManager) {
        console.log(
          `🔄 Updating scene floor to ${data.platformSize}x${data.platformSize}`
        );
        this.sceneManager.updatePlatformSize(data.platformSize);
        console.log(
          `✅ Platform size updated: ${data.platformSize}x${data.platformSize}`
        );
      }
    });

    // Handle path updates
    this.socket.on("pathUpdate", (data) => {
      if (data.playerId === this.playerId && data.path) {
        this.uiManager.drawPathTrace(data.path);
      }
    });

    // Handle obstacle updates
    this.socket.on("obstacleUpdated", (data) => {
      const { id, x, y, z, rotation, isPassthrough, opacity } = data;
      const obstacle = this.sceneManager.obstacles.find(
        (obs) => obs.userData.id === id
      );
      if (obstacle) {
        obstacle.position.set(x, y, z);
        if (rotation !== undefined) {
          obstacle.rotation.y = rotation;
        }
        if (isPassthrough !== undefined) {
          obstacle.userData.isPassthrough = isPassthrough;
        }
        if (opacity !== undefined) {
          obstacle.userData.opacity = opacity;
          obstacle.traverse((child) => {
            if (child.isMesh && child.material) {
              child.material.transparent = true;
              child.material.opacity = opacity;
              child.material.needsUpdate = true;
            }
          });
        }

        // Update lamp light position if this is a lamp
        if (this.sceneManager.lightingManager) {
          this.sceneManager.lightingManager.updateLightPosition(obstacle);
        }

        console.log(
          `📦 Obstacle ${id} updated by another player${
            isPassthrough !== undefined
              ? ` [PASSTHROUGH: ${isPassthrough}]`
              : ""
          }${
            opacity !== undefined
              ? ` [OPACITY: ${(opacity * 100).toFixed(0)}%]`
              : ""
          }`
        );
      }
    });

    // Handle opacity-only updates
    this.socket.on("obstacleOpacityUpdated", (data) => {
      const { id, opacity } = data;
      const obstacle = this.sceneManager.obstacles.find(
        (obs) => obs.userData.id === id
      );
      if (obstacle) {
        obstacle.userData.opacity = opacity;
        obstacle.traverse((child) => {
          if (child.isMesh && child.material) {
            child.material.transparent = true;
            child.material.opacity = opacity;
            child.material.needsUpdate = true;
          }
        });
        console.log(
          `👁️ Obstacle ${id} opacity: ${(opacity * 100).toFixed(0)}%`
        );
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

      // Log if it's a lamp (light should have been auto-added by createObstacle)
      if (
        obstacle &&
        this.sceneManager.lightingManager &&
        this.sceneManager.lightingManager.isLampObject(obstacle)
      ) {
        console.log(`💡 Lamp light auto-added for: ${obstacleData.id}`);
      }
    });

    // Handle spawn confirmation from server (when we spawn something)
    this.socket.on("spawnConfirmed", (data) => {
      console.log(`✅ Spawn confirmed by server:`, data);

      // Update the client object with server-generated UUID
      if (data.obstacle) {
        // Find object with clientId and update to serverId
        const obstacle = this.sceneManager.obstacles.find(
          (obj) => obj.userData && obj.userData.id === data.clientId
        );
        if (obstacle) {
          // Remove light with old ID if it's a lamp
          if (this.sceneManager.lightingManager) {
            this.sceneManager.lightingManager.removeLight(data.clientId);
          }

          // Update ID
          obstacle.userData.id = data.serverId;
          obstacle.userData.isPending = false;

          // Re-add light with new ID if it's a lamp
          if (
            this.sceneManager.lightingManager &&
            this.sceneManager.lightingManager.isLampObject(obstacle)
          ) {
            this.sceneManager.lightingManager.addLightToObject(obstacle);
            console.log(`🔦 Re-added lamp light with new ID: ${data.serverId}`);
          }

          console.log(
            `🔄 Updated obstacle ID: ${data.clientId} → ${data.serverId}`
          );
        }
      } else if (data.food) {
        // Find food with clientId and update to serverId
        const foodItem = this.sceneManager.foodItems.get(data.clientId);
        if (foodItem) {
          // Remove from map with old ID
          this.sceneManager.foodItems.delete(data.clientId);
          // Update ID
          foodItem.id = data.serverId;
          if (foodItem.model && foodItem.model.userData) {
            foodItem.model.userData.id = data.serverId;
            foodItem.model.userData.isPending = false;
          }
          // Re-add with new ID
          this.sceneManager.foodItems.set(data.serverId, foodItem);
          console.log(
            `🔄 Updated food ID: ${data.clientId} → ${data.serverId}`
          );
        }
      }
    });

    // Handle obstacle deleted by other players
    this.socket.on("obstacleDeleted", (data) => {
      const { id } = data;
      const obstacle = this.sceneManager.obstacles.find(
        (obs) => obs.userData.id === id
      );
      if (obstacle) {
        // Remove lamp light if this is a lamp
        if (this.sceneManager.lightingManager) {
          this.sceneManager.lightingManager.removeLight(id);
        }

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
      // Add collision box if enabled
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

    // 🔧 ERROR HANDLERS - Handle spawn failures
    this.socket.on("spawnError", (data) => {
      console.error(`❌ Spawn failed:`, data);
      // Notify input manager to remove the failed spawn
      if (this.inputManager) {
        this.inputManager.handleSpawnFailure(data.id, data.error);
      }
      // Show error to user
      this.showError(`Failed to spawn: ${data.error}`);
    });

    this.socket.on("validationError", (data) => {
      console.warn(`⚠️ Validation error:`, data);
      this.showError(`Validation failed: ${data.errors.join(", ")}`);
    });

    this.socket.on("rateLimitError", (data) => {
      console.warn(`⚠️ Rate limit:`, data);
      this.showError(data.message);
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

    // Handle player actions from other players
    this.socket.on("playerAction", (data) => {
      const { playerId, action } = data;

      // Don't execute for own player (already done locally)
      if (playerId === this.playerId) return;

      const otherPlayer = this.playerManager.getPlayer(playerId);
      if (otherPlayer) {
        // Execute the action animation
        this.executePlayerAction(playerId, otherPlayer, action);

        // Action indicator removed - animations are self-explanatory
      }
    });

    // Handle player sitting
    this.socket.on("playerSit", (data) => {
      if (this.interactionManager) {
        this.interactionManager.handleOtherPlayerSit(data);
      }
    });

    // Handle player standing up
    this.socket.on("playerStandUp", (data) => {
      if (this.interactionManager) {
        this.interactionManager.handleOtherPlayerStandUp(data);
      }
    });

    // Handle player lying down
    this.socket.on("playerLie", (data) => {
      if (this.interactionManager) {
        this.interactionManager.handleOtherPlayerLie(data);
      }
    });

    // Handle player getting up
    this.socket.on("playerGetUp", (data) => {
      if (this.interactionManager) {
        this.interactionManager.handleOtherPlayerGetUp(data);
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
   * Update obstacle position, rotation, and passthrough status on server
   */
  updateObstacle(
    id,
    x,
    y,
    z,
    rotation = 0,
    isPassthrough = undefined,
    opacity = undefined
  ) {
    if (this.socket) {
      const data = { id, x, y, z, rotation };
      if (isPassthrough !== undefined) {
        data.isPassthrough = isPassthrough;
      }
      if (opacity !== undefined) {
        data.opacity = opacity;
      }
      this.socket.emit("updateObstacle", data);
    }
  }

  /**
   * Update only the opacity of an obstacle
   */
  updateObstacleOpacity(id, opacity) {
    if (this.socket) {
      this.socket.emit("updateObstacleOpacity", { id, opacity });
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
   * Try to play a Blender animation for an action
   * @param {string} playerId - Player ID
   * @param {string} action - Action name
   * @returns {boolean} Whether a Blender animation was found and played
   */
  tryPlayBlenderAnimation(playerId, action) {
    // Map actions to actual Blender animation names
    const animationMap = {
      // jump: null, // No jump animation - will use procedural
      kick: "attack-kick-right", // Kick animation
      wave: "interact-right", // Interact animation for waving
      yes: "emote-yes", // Yes emote
      no: "emote-no", // No emote
      crouch: "pick-up", // Pick-up animation for crouching
      spin: "sprint", // Sprint for running/spinning
      point: "interact-left", // Interact left for pointing
      // Additional available animations
      sit: "sit", // Direct sit animation
      die: "die", // Die animation
      pickup: "pick-up", // Pickup animation
      idle: "idle", // Idle/standing
      walk: "walk", // Walking
    };

    const animName = animationMap[action];
    if (!animName) return false;

    // Get animation duration based on action
    const durations = {
      jump: 600,
      kick: 600,
      wave: 1500,
      yes: 1500,
      no: 1500,
      crouch: 2000,
      spin: 1000,
      point: 1500,
      // Additional
      sit: 3000,
      die: 2000,
      pickup: 1500,
      idle: null,
      walk: null,
    };

    const duration = durations[action];
    const loop = action === "sit" || action === "idle" || action === "walk"; // Loop continuous actions

    return this.playerManager.animationController.playAnimationClip(
      playerId,
      animName,
      duration,
      loop
    );
  }

  /**
   * Perform player action
   */
  performPlayerAction(action) {
    console.log(`🎬 Performing action: ${action}`);

    // Get local player
    const player = this.playerManager.players.get(this.playerId);
    if (!player) return;

    // Perform the action animation/effect locally
    this.executePlayerAction(this.playerId, player, action);

    // Send to server to broadcast to other players
    if (this.socket) {
      this.socket.emit("playerAction", {
        playerId: this.playerId,
        action: action,
      });
    }

    // Action indicator removed - animations are self-explanatory
    // this.uiManager.showActionIndicator(
    //   player.mesh,
    //   action,
    //   this.sceneManager.camera
    // );
  }

  /**
   * Execute a player action (animation/effect)
   */
  executePlayerAction(playerId, player, action) {
    const mesh = player.mesh;
    if (!mesh) return;

    // Get limbs from animation controller (stored in PlayerManager, not SceneManager)
    const animData =
      this.playerManager.animationController?.mixers.get(playerId);
    const limbs = animData?.limbs;
    const originalTransforms = animData?.originalTransforms;
    const hasAnimationClips =
      animData?.animationClips &&
      Object.keys(animData.animationClips).length > 0;

    // Debug logging
    if (!animData) {
      console.warn(`⚠️ No animation data found for player ${playerId}`);
    }

    // Try to play Blender animation first, fallback to procedural
    if (hasAnimationClips && this.tryPlayBlenderAnimation(playerId, action)) {
      return; // Blender animation is playing
    }

    // Store original position and rotation
    const originalY = mesh.position.y;
    const originalRotationY = mesh.rotation.y;

    // Cancel any existing animations
    if (player.actionAnimation) {
      cancelAnimationFrame(player.actionAnimation);
    }

    switch (action) {
      case "jump":
        // Jump animation - raise arms and tuck legs
        const jumpHeight = 2;
        const jumpDuration = 600;
        const jumpStartTime = Date.now();

        const animateJump = () => {
          const elapsed = Date.now() - jumpStartTime;
          const progress = elapsed / jumpDuration;

          if (progress < 1) {
            // Parabolic jump curve
            const jumpProgress = Math.sin(progress * Math.PI);
            mesh.position.y = originalY + jumpProgress * jumpHeight;

            // Raise arms during jump
            if (limbs?.leftArm && originalTransforms?.leftArm) {
              limbs.leftArm.rotation.x =
                originalTransforms.leftArm.rotation.x - jumpProgress * 1.5;
              limbs.leftArm.rotation.z =
                originalTransforms.leftArm.rotation.z + jumpProgress * 0.5;
            }
            if (limbs?.rightArm && originalTransforms?.rightArm) {
              limbs.rightArm.rotation.x =
                originalTransforms.rightArm.rotation.x - jumpProgress * 1.5;
              limbs.rightArm.rotation.z =
                originalTransforms.rightArm.rotation.z - jumpProgress * 0.5;
            }

            // Tuck legs during jump (bend at peak)
            if (limbs?.leftLeg && originalTransforms?.leftLeg) {
              limbs.leftLeg.rotation.x =
                originalTransforms.leftLeg.rotation.x + jumpProgress * 0.8;
            }
            if (limbs?.rightLeg && originalTransforms?.rightLeg) {
              limbs.rightLeg.rotation.x =
                originalTransforms.rightLeg.rotation.x + jumpProgress * 0.8;
            }

            player.actionAnimation = requestAnimationFrame(animateJump);
          } else {
            mesh.position.y = originalY;
            // Reset arms and legs
            if (limbs?.leftArm && originalTransforms?.leftArm) {
              limbs.leftArm.rotation.copy(originalTransforms.leftArm.rotation);
            }
            if (limbs?.rightArm && originalTransforms?.rightArm) {
              limbs.rightArm.rotation.copy(
                originalTransforms.rightArm.rotation
              );
            }
            if (limbs?.leftLeg && originalTransforms?.leftLeg) {
              limbs.leftLeg.rotation.copy(originalTransforms.leftLeg.rotation);
            }
            if (limbs?.rightLeg && originalTransforms?.rightLeg) {
              limbs.rightLeg.rotation.copy(
                originalTransforms.rightLeg.rotation
              );
            }
            player.actionAnimation = null;
          }
        };
        animateJump();
        break;

      case "sit":
        // Sit animation - bend legs and lower body
        if (limbs && originalTransforms) {
          // Bend legs
          if (limbs.leftLeg && originalTransforms.leftLeg) {
            limbs.leftLeg.rotation.x =
              originalTransforms.leftLeg.rotation.x + 1.2;
          }
          if (limbs.rightLeg && originalTransforms.rightLeg) {
            limbs.rightLeg.rotation.x =
              originalTransforms.rightLeg.rotation.x + 1.2;
          }
          // Tilt torso slightly forward
          if (limbs.torso && originalTransforms.torso) {
            limbs.torso.rotation.x = originalTransforms.torso.rotation.x + 0.2;
          }
        }

        mesh.position.y = originalY - 1;

        setTimeout(() => {
          mesh.position.y = originalY;
          // Reset limbs
          if (limbs && originalTransforms) {
            if (limbs.leftLeg && originalTransforms.leftLeg) {
              limbs.leftLeg.rotation.copy(originalTransforms.leftLeg.rotation);
            }
            if (limbs.rightLeg && originalTransforms.rightLeg) {
              limbs.rightLeg.rotation.copy(
                originalTransforms.rightLeg.rotation
              );
            }
            if (limbs.torso && originalTransforms.torso) {
              limbs.torso.rotation.copy(originalTransforms.torso.rotation);
            }
          }
        }, 3000);
        break;

      case "dance":
        // Dance animation - spin body, wave arms, and step with legs
        const danceStartTime = Date.now();
        const danceDuration = 2000;

        const animateDance = () => {
          const elapsed = Date.now() - danceStartTime;
          const progress = elapsed / danceDuration;

          if (progress < 1) {
            mesh.rotation.y =
              originalRotationY + Math.sin(progress * Math.PI * 4) * 0.5;
            mesh.position.y =
              originalY + Math.abs(Math.sin(progress * Math.PI * 8)) * 0.3;

            // Wave arms while dancing
            if (limbs && originalTransforms) {
              if (limbs.leftArm && originalTransforms.leftArm) {
                limbs.leftArm.rotation.x =
                  originalTransforms.leftArm.rotation.x +
                  Math.sin(progress * Math.PI * 6) * 0.8;
                limbs.leftArm.rotation.z =
                  originalTransforms.leftArm.rotation.z + 0.8;
              }
              if (limbs.rightArm && originalTransforms.rightArm) {
                limbs.rightArm.rotation.x =
                  originalTransforms.rightArm.rotation.x +
                  Math.sin(progress * Math.PI * 6 + Math.PI) * 0.8;
                limbs.rightArm.rotation.z =
                  originalTransforms.rightArm.rotation.z - 0.8;
              }

              // Alternate leg stepping
              if (limbs.leftLeg && originalTransforms.leftLeg) {
                limbs.leftLeg.rotation.x =
                  originalTransforms.leftLeg.rotation.x +
                  Math.sin(progress * Math.PI * 8) * 0.4;
              }
              if (limbs.rightLeg && originalTransforms.rightLeg) {
                limbs.rightLeg.rotation.x =
                  originalTransforms.rightLeg.rotation.x -
                  Math.sin(progress * Math.PI * 8) * 0.4;
              }
            }

            player.actionAnimation = requestAnimationFrame(animateDance);
          } else {
            mesh.rotation.y = originalRotationY;
            mesh.position.y = originalY;
            // Reset arms and legs
            if (limbs && originalTransforms) {
              if (limbs.leftArm && originalTransforms.leftArm) {
                limbs.leftArm.rotation.copy(
                  originalTransforms.leftArm.rotation
                );
              }
              if (limbs.rightArm && originalTransforms.rightArm) {
                limbs.rightArm.rotation.copy(
                  originalTransforms.rightArm.rotation
                );
              }
              if (limbs.leftLeg && originalTransforms.leftLeg) {
                limbs.leftLeg.rotation.copy(
                  originalTransforms.leftLeg.rotation
                );
              }
              if (limbs.rightLeg && originalTransforms.rightLeg) {
                limbs.rightLeg.rotation.copy(
                  originalTransforms.rightLeg.rotation
                );
              }
            }
            player.actionAnimation = null;
          }
        };
        animateDance();
        break;

      case "wave":
        // Wave animation - raise right arm up and wave side to side
        if (limbs?.rightArm && originalTransforms?.rightArm) {
          const waveStartTime = Date.now();
          const waveDuration = 1500;

          const animateWave = () => {
            const elapsed = Date.now() - waveStartTime;
            const progress = elapsed / waveDuration;

            if (progress < 1) {
              // Raise arm up (Z-axis rotation for sideways movement)
              // Wave side to side (Z-axis for left-right motion)
              const waveMotion = Math.sin(progress * Math.PI * 6) * 0.3;

              // Rotate arm up on Z-axis (raises arm to the side)
              limbs.rightArm.rotation.z =
                originalTransforms.rightArm.rotation.z - 1.5 + waveMotion;

              // Slight forward tilt on X-axis
              limbs.rightArm.rotation.x =
                originalTransforms.rightArm.rotation.x - 0.3;

              // Optional: slight Y-axis rotation for more natural look
              limbs.rightArm.rotation.y =
                originalTransforms.rightArm.rotation.y + waveMotion * 0.5;

              player.actionAnimation = requestAnimationFrame(animateWave);
            } else {
              limbs.rightArm.rotation.copy(
                originalTransforms.rightArm.rotation
              );
              player.actionAnimation = null;
            }
          };
          animateWave();
        } else {
          // Fallback to whole body rotation
          const waveStartTime = Date.now();
          const waveDuration = 1000;

          const animateWave = () => {
            const elapsed = Date.now() - waveStartTime;
            const progress = elapsed / waveDuration;

            if (progress < 1) {
              mesh.rotation.y =
                originalRotationY + Math.sin(progress * Math.PI * 4) * 0.3;
              player.actionAnimation = requestAnimationFrame(animateWave);
            } else {
              mesh.rotation.y = originalRotationY;
              player.actionAnimation = null;
            }
          };
          animateWave();
        }
        break;

      case "spin":
        // Spin animation (360 degree rotation)
        const spinStartTime = Date.now();
        const spinDuration = 1000;

        const animateSpin = () => {
          const elapsed = Date.now() - spinStartTime;
          const progress = elapsed / spinDuration;

          if (progress < 1) {
            mesh.rotation.y = originalRotationY + progress * Math.PI * 2;
            player.actionAnimation = requestAnimationFrame(animateSpin);
          } else {
            mesh.rotation.y = originalRotationY;
            player.actionAnimation = null;
          }
        };
        animateSpin();
        break;

      case "crouch":
        // Crouch animation - bend legs and lower torso
        if (limbs && originalTransforms) {
          // Bend legs more than sitting
          if (limbs.leftLeg && originalTransforms.leftLeg) {
            limbs.leftLeg.rotation.x =
              originalTransforms.leftLeg.rotation.x + 0.8;
          }
          if (limbs.rightLeg && originalTransforms.rightLeg) {
            limbs.rightLeg.rotation.x =
              originalTransforms.rightLeg.rotation.x + 0.8;
          }
          // Tilt torso forward more
          if (limbs.torso && originalTransforms.torso) {
            limbs.torso.rotation.x = originalTransforms.torso.rotation.x + 0.4;
          }
        }

        mesh.position.y = originalY - 0.5;

        setTimeout(() => {
          mesh.position.y = originalY;
          // Reset limbs
          if (limbs && originalTransforms) {
            if (limbs.leftLeg && originalTransforms.leftLeg) {
              limbs.leftLeg.rotation.copy(originalTransforms.leftLeg.rotation);
            }
            if (limbs.rightLeg && originalTransforms.rightLeg) {
              limbs.rightLeg.rotation.copy(
                originalTransforms.rightLeg.rotation
              );
            }
            if (limbs.torso && originalTransforms.torso) {
              limbs.torso.rotation.copy(originalTransforms.torso.rotation);
            }
          }
        }, 2000);
        break;

      case "cheer":
        // Cheer animation - bounce with arms up and legs bent
        const cheerStartTime = Date.now();
        const cheerDuration = 1500;

        const animateCheer = () => {
          const elapsed = Date.now() - cheerStartTime;
          const progress = elapsed / cheerDuration;

          if (progress < 1) {
            const bounce = Math.abs(Math.sin(progress * Math.PI * 6)) * 0.5;
            mesh.position.y = originalY + bounce;

            // Raise both arms up while cheering
            if (limbs && originalTransforms) {
              if (limbs.leftArm && originalTransforms.leftArm) {
                limbs.leftArm.rotation.x =
                  originalTransforms.leftArm.rotation.x - 1.8 + bounce * 0.5;
                limbs.leftArm.rotation.z =
                  originalTransforms.leftArm.rotation.z + 1.0;
              }
              if (limbs.rightArm && originalTransforms.rightArm) {
                limbs.rightArm.rotation.x =
                  originalTransforms.rightArm.rotation.x - 1.8 + bounce * 0.5;
                limbs.rightArm.rotation.z =
                  originalTransforms.rightArm.rotation.z - 1.0;
              }

              // Bend legs slightly with bounce for jumping cheer effect
              if (limbs.leftLeg && originalTransforms.leftLeg) {
                limbs.leftLeg.rotation.x =
                  originalTransforms.leftLeg.rotation.x + bounce * 0.6;
              }
              if (limbs.rightLeg && originalTransforms.rightLeg) {
                limbs.rightLeg.rotation.x =
                  originalTransforms.rightLeg.rotation.x + bounce * 0.6;
              }
            }

            player.actionAnimation = requestAnimationFrame(animateCheer);
          } else {
            mesh.position.y = originalY;
            // Reset arms and legs
            if (limbs && originalTransforms) {
              if (limbs.leftArm && originalTransforms.leftArm) {
                limbs.leftArm.rotation.copy(
                  originalTransforms.leftArm.rotation
                );
              }
              if (limbs.rightArm && originalTransforms.rightArm) {
                limbs.rightArm.rotation.copy(
                  originalTransforms.rightArm.rotation
                );
              }
              if (limbs.leftLeg && originalTransforms.leftLeg) {
                limbs.leftLeg.rotation.copy(
                  originalTransforms.leftLeg.rotation
                );
              }
              if (limbs.rightLeg && originalTransforms.rightLeg) {
                limbs.rightLeg.rotation.copy(
                  originalTransforms.rightLeg.rotation
                );
              }
            }
            player.actionAnimation = null;
          }
        };
        animateCheer();
        break;

      case "point":
        // Point animation - extend right arm forward with stable leg stance
        if (limbs?.rightArm && originalTransforms?.rightArm) {
          const pointStartTime = Date.now();
          const pointDuration = 1500;

          const animatePoint = () => {
            const elapsed = Date.now() - pointStartTime;
            const progress = elapsed / pointDuration;

            if (progress < 1) {
              const pointProgress = Math.sin(progress * Math.PI);
              // Point arm straight forward
              limbs.rightArm.rotation.x =
                originalTransforms.rightArm.rotation.x;
              limbs.rightArm.rotation.y =
                originalTransforms.rightArm.rotation.y;
              limbs.rightArm.rotation.z =
                originalTransforms.rightArm.rotation.z - pointProgress * 1.2;

              // Slight torso turn
              if (limbs.torso && originalTransforms.torso) {
                limbs.torso.rotation.y =
                  originalTransforms.torso.rotation.y + pointProgress * 0.2;
              }

              // Stable stance - left leg forward slightly
              if (limbs.leftLeg && originalTransforms.leftLeg) {
                limbs.leftLeg.rotation.x =
                  originalTransforms.leftLeg.rotation.x + pointProgress * 0.3;
              }
              if (limbs.rightLeg && originalTransforms.rightLeg) {
                limbs.rightLeg.rotation.x =
                  originalTransforms.rightLeg.rotation.x - pointProgress * 0.2;
              }

              player.actionAnimation = requestAnimationFrame(animatePoint);
            } else {
              limbs.rightArm.rotation.copy(
                originalTransforms.rightArm.rotation
              );
              if (limbs.torso && originalTransforms.torso) {
                limbs.torso.rotation.copy(originalTransforms.torso.rotation);
              }
              if (limbs.leftLeg && originalTransforms.leftLeg) {
                limbs.leftLeg.rotation.copy(
                  originalTransforms.leftLeg.rotation
                );
              }
              if (limbs.rightLeg && originalTransforms.rightLeg) {
                limbs.rightLeg.rotation.copy(
                  originalTransforms.rightLeg.rotation
                );
              }
              player.actionAnimation = null;
            }
          };
          animatePoint();
        } else {
          // Fallback
          const pointStartTime = Date.now();
          const pointDuration = 1000;

          const animatePoint = () => {
            const elapsed = Date.now() - pointStartTime;
            const progress = elapsed / pointDuration;

            if (progress < 1) {
              mesh.rotation.x = Math.sin(progress * Math.PI) * 0.2;
              player.actionAnimation = requestAnimationFrame(animatePoint);
            } else {
              mesh.rotation.x = 0;
              player.actionAnimation = null;
            }
          };
          animatePoint();
        }
        break;
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

  /**
   * Sync all furniture collision data to server
   * This ensures server-side collision detection matches visual collision boxes
   */
  /**
   * Show error message to user
   */
  showError(message) {
    // Create or update error notification
    let errorDiv = document.getElementById("error-notification");
    if (!errorDiv) {
      errorDiv = document.createElement("div");
      errorDiv.id = "error-notification";
      errorDiv.style.cssText = `
        position: fixed;
        top: 80px;
        right: 20px;
        background: linear-gradient(135deg, rgba(239, 68, 68, 0.95), rgba(220, 38, 38, 0.95));
        color: white;
        padding: 12px 16px;
        border-radius: 12px;
        font-size: 14px;
        font-weight: 500;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
        z-index: 10000;
        max-width: 300px;
        border: 1px solid rgba(255, 255, 255, 0.2);
        backdrop-filter: blur(10px);
        animation: slideInRight 0.3s ease-out;
      `;
      document.body.appendChild(errorDiv);
    }

    errorDiv.textContent = message;
    errorDiv.style.display = "block";

    // Auto-hide after 4 seconds
    setTimeout(() => {
      if (errorDiv) {
        errorDiv.style.animation = "slideOutRight 0.3s ease-in";
        setTimeout(() => {
          if (errorDiv && errorDiv.parentNode) {
            errorDiv.parentNode.removeChild(errorDiv);
          }
        }, 300);
      }
    }, 4000);
  }

  syncAllFurnitureCollisions() {
    if (!this.sceneManager || !this.socket) return;

    const furnitureData = [];

    // Get all obstacles from scene
    this.sceneManager.obstacles.forEach((furniture) => {
      if (furniture && furniture.userData && furniture.userData.id) {
        // Calculate actual bounding box
        const bbox = this.sceneManager.calculateBoundingBox(furniture);

        furnitureData.push({
          id: furniture.userData.id,
          width: bbox.width,
          height: bbox.height,
          depth: bbox.depth,
          centerX: bbox.center.x,
          centerY: bbox.center.y,
          centerZ: bbox.center.z,
        });
      }
    });

    if (furnitureData.length > 0) {
      this.socket.emit("syncFurnitureCollisions", furnitureData);
      console.log(
        `📦 Synced ${furnitureData.length} furniture collision boxes to server`
      );
    }
  }
}
