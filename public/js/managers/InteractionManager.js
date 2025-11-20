import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";

/**
 * Interaction Manager
 * Handles player interactions with furniture and objects
 */
export class InteractionManager {
  constructor(sceneManager, playerManager, networkManager, uiManager) {
    this.sceneManager = sceneManager;
    this.playerManager = playerManager;
    this.networkManager = networkManager;
    this.uiManager = uiManager;

    // Interaction state
    this.interactionRange = 2.5; // Distance to interact
    this.nearbyFurniture = null;
    this.showingPrompt = false;

    // Sitting state
    this.isSitting = false;
    this.sittingOn = null;

    // Define furniture types that can be sat on
    this.sittableFurniture = [
      "chair",
      "sofa",
      "couch",
      "bench",
      "stool",
      "armchair",
      "seat",
    ];

    // Setup interaction prompt
    this.setupInteractionPrompt();

    // Setup keyboard listener
    this.setupKeyboardListener();
  }

  /**
   * Setup interaction prompt UI
   */
  setupInteractionPrompt() {
    // Create prompt element
    const prompt = document.createElement("div");
    prompt.id = "interaction-prompt";
    prompt.style.cssText = `
      position: fixed;
      bottom: 150px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(138, 43, 226, 0.9);
      color: white;
      padding: 12px 24px;
      border-radius: 12px;
      font-size: 16px;
      font-weight: bold;
      z-index: 1500;
      border: 2px solid rgba(168, 85, 247, 0.8);
      box-shadow: 0 4px 15px rgba(0, 0, 0, 0.5);
      display: none;
      pointer-events: none;
      font-family: 'Inter', Arial, sans-serif;
    `;
    document.body.appendChild(prompt);
  }

  /**
   * Setup keyboard listener for interactions
   */
  setupKeyboardListener() {
    window.addEventListener("keydown", (e) => {
      if (e.code === "KeyF") {
        this.handleInteraction();
      }
    });
  }

  /**
   * Update interactions (call every frame)
   */
  update() {
    // Show stand-up prompt if sitting
    if (this.isSitting) {
      this.updateSittingPrompt();
      return;
    }

    const player = this.playerManager.players.get(this.networkManager.playerId);
    if (!player || !player.mesh) return;

    const playerPos = player.mesh.position;

    // Find nearby furniture
    const nearby = this.findNearbyFurniture(playerPos);

    if (nearby) {
      this.nearbyFurniture = nearby;
      this.showPrompt(nearby);
    } else {
      this.nearbyFurniture = null;
      this.hidePrompt();
    }
  }

  /**
   * Find furniture within interaction range
   */
  findNearbyFurniture(playerPos) {
    let closest = null;
    let closestDistance = this.interactionRange;

    this.sceneManager.obstacles.forEach((furniture) => {
      // Check if this furniture can be sat on
      const furnitureName =
        furniture.userData.model || furniture.userData.type || "";
      const isSittable = this.sittableFurniture.some((type) =>
        furnitureName.toLowerCase().includes(type)
      );

      if (!isSittable) return;

      // Calculate distance to furniture's bounding box center for more accurate detection
      const bbox = this.sceneManager.calculateBoundingBox(furniture);
      const furnitureCenter = bbox.center;

      const distance = playerPos.distanceTo(furnitureCenter);
      if (distance < closestDistance) {
        closest = furniture;
        closestDistance = distance;
      }
    });

    return closest;
  }

  /**
   * Show interaction prompt
   */
  showPrompt(furniture) {
    const prompt = document.getElementById("interaction-prompt");
    if (!prompt) return;

    const furnitureName = this.getFurnitureName(furniture);
    prompt.innerHTML = `Press <strong>F</strong> to sit on ${furnitureName}`;
    prompt.style.display = "block";
    this.showingPrompt = true;
  }

  /**
   * Hide interaction prompt
   */
  hidePrompt() {
    const prompt = document.getElementById("interaction-prompt");
    if (prompt) {
      prompt.style.display = "none";
    }
    this.showingPrompt = false;
  }

  /**
   * Get furniture display name
   */
  getFurnitureName(furniture) {
    const name =
      furniture.userData.model || furniture.userData.type || "furniture";
    return name.replace(/-/g, " ");
  }

  /**
   * Handle interaction (F key pressed)
   */
  handleInteraction() {
    if (this.isSitting) {
      this.standUp();
    } else if (this.nearbyFurniture) {
      this.sitDown(this.nearbyFurniture);
    }
  }

  /**
   * Sit down on furniture
   */
  sitDown(furniture) {
    const player = this.playerManager.players.get(this.networkManager.playerId);
    if (!player || !player.mesh) return;

    console.log(`🪑 Sitting on ${this.getFurnitureName(furniture)}`);

    // Calculate seat information before sitting
    const bbox = this.sceneManager.calculateBoundingBox(furniture);
    const furnitureName = this.getFurnitureName(furniture).toLowerCase();
    const seatCapacity = this.getFurnitureSeatCapacity(furnitureName, bbox);
    const seatIndex = this.findAvailableSeat(furniture, seatCapacity);

    // Set sitting state
    this.isSitting = true;
    this.sittingOn = furniture;
    player.isSitting = true; // Mark player as sitting
    player.sittingOn = furniture.userData.id; // Track which furniture
    player.seatIndex = seatIndex; // Track which seat

    // Calculate proper sitting position based on furniture bounding box
    const sitPosition = this.calculateSittingPosition(furniture, seatIndex);

    player.mesh.position.copy(sitPosition);
    player.targetPosition.copy(sitPosition);

    // Face forward relative to furniture
    player.mesh.rotation.y = furniture.rotation.y;

    // Stop any movement
    player.isMoving = false;

    // Play sit animation (loop it) - only if animation exists
    const hasAnimation =
      this.playerManager.animationController.playAnimationClip(
        this.networkManager.playerId,
        "sit",
        null,
        true // Loop the animation
      );

    if (!hasAnimation) {
      console.warn("⚠️ No sit animation found in character model");
    }

    // Notify server
    this.networkManager.socket.emit("playerSit", {
      playerId: this.networkManager.playerId,
      furnitureId: furniture.userData.id,
      seatIndex: seatIndex,
      position: { x: sitPosition.x, y: sitPosition.y, z: sitPosition.z },
      rotation: furniture.rotation.y,
    });

    // Update prompt
    this.updateSittingPrompt();
  }

  /**
   * Calculate proper sitting position on furniture
   * @param {Object} furniture - The furniture object
   * @param {number} seatIndex - The seat index to use (optional, will find available if not provided)
   */
  calculateSittingPosition(furniture, seatIndex = null) {
    const sitPosition = furniture.position.clone();

    // Get the actual bounding box of the furniture
    const bbox = this.sceneManager.calculateBoundingBox(furniture);

    // Get furniture name to determine type-specific positioning
    const furnitureName = this.getFurnitureName(furniture).toLowerCase();

    // Determine how many seats this furniture has
    const seatCapacity = this.getFurnitureSeatCapacity(furnitureName, bbox);

    // Use provided seat index or find available seat
    if (seatIndex === null) {
      seatIndex = this.findAvailableSeat(furniture, seatCapacity);
    }

    // Calculate seat height based on furniture type
    let seatHeightMultiplier = 0.35; // Default for most furniture
    let forwardOffset = 0; // Offset in local Z axis

    // Type-specific adjustments
    if (furnitureName.includes("stool")) {
      seatHeightMultiplier = 0.55;
      forwardOffset = 0;
    } else if (
      furnitureName.includes("lounge") &&
      furnitureName.includes("chair")
    ) {
      seatHeightMultiplier = 0.25;
      forwardOffset = -0.1;
    } else if (
      furnitureName.includes("sofa") ||
      furnitureName.includes("couch")
    ) {
      seatHeightMultiplier = 0.3;
      forwardOffset = -0.15;
    } else if (furnitureName.includes("bench")) {
      seatHeightMultiplier = 0.4;
      forwardOffset = 0;
    } else if (furnitureName.includes("chair")) {
      seatHeightMultiplier = 0.35;
      forwardOffset = 0;
    }

    // Calculate base position for center of furniture
    const furnitureHeight = bbox.height;
    const furnitureBase =
      furniture.position.y -
      furnitureHeight / 2 +
      (bbox.center.y - furniture.position.y);
    const seatHeight = furnitureHeight * seatHeightMultiplier;

    // Calculate seat position based on seat index and capacity
    const seatOffset = this.calculateSeatOffset(
      seatCapacity,
      seatIndex,
      bbox,
      furniture.rotation.y,
      furnitureName
    );

    // Set base position
    sitPosition.x = bbox.center.x + seatOffset.x;
    sitPosition.z = bbox.center.z + seatOffset.z;
    sitPosition.y = furnitureBase + seatHeight;

    // Apply forward/backward offset based on furniture rotation
    if (forwardOffset !== 0) {
      const offset = new THREE.Vector3(0, 0, forwardOffset);
      offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), furniture.rotation.y);
      sitPosition.add(offset);
    }

    console.log(
      `📍 Sitting on ${furnitureName} at seat ${
        seatIndex + 1
      }/${seatCapacity}: (${sitPosition.x.toFixed(2)}, ${sitPosition.y.toFixed(
        2
      )}, ${sitPosition.z.toFixed(2)})`
    );

    return sitPosition;
  }

  /**
   * Determine seat capacity based on furniture type and size
   */
  getFurnitureSeatCapacity(furnitureName, bbox) {
    // Single seat furniture
    if (furnitureName.includes("chair") || furnitureName.includes("stool")) {
      return 1;
    }

    // Corner furniture (L-shaped) - special handling
    if (furnitureName.includes("corner")) {
      // Corner sofas typically have 2-3 seats
      // Calculate based on combined width + depth
      const totalSize = bbox.width + bbox.depth;
      if (totalSize < 4) return 2;
      if (totalSize < 6) return 3;
      return 4;
    }

    // Multi-seat furniture - base on width/depth
    const furnitureWidth = Math.max(bbox.width, bbox.depth);

    if (furnitureName.includes("sofa") || furnitureName.includes("couch")) {
      // Sofas: 1 seat per 1.5 units of width
      if (furnitureWidth < 2) return 1;
      if (furnitureWidth < 3.5) return 2;
      if (furnitureWidth < 5) return 3;
      return Math.floor(furnitureWidth / 1.5);
    }

    if (furnitureName.includes("bench")) {
      // Benches: 1 seat per 1.2 units of width
      if (furnitureWidth < 1.5) return 1;
      if (furnitureWidth < 2.5) return 2;
      if (furnitureWidth < 3.5) return 3;
      return Math.floor(furnitureWidth / 1.2);
    }

    return 1; // Default single seat
  }

  /**
   * Find an available seat on the furniture
   */
  findAvailableSeat(furniture, seatCapacity) {
    if (seatCapacity === 1) return 0;

    // Check which players are sitting on this furniture
    const occupiedSeats = new Set();
    this.playerManager.players.forEach((player, playerId) => {
      if (
        player.sittingOn === furniture.userData.id &&
        player.seatIndex !== undefined
      ) {
        occupiedSeats.add(player.seatIndex);
        console.log(
          `   Seat ${player.seatIndex} occupied by player ${playerId.substring(
            0,
            8
          )}...`
        );
      }
    });

    // Find first available seat
    for (let i = 0; i < seatCapacity; i++) {
      if (!occupiedSeats.has(i)) {
        console.log(`   ✓ Found available seat: ${i}`);
        return i;
      }
    }

    // All seats full, use last seat (will overlap but shouldn't happen often)
    console.warn(`   ⚠️ All ${seatCapacity} seats occupied! Using last seat.`);
    return seatCapacity - 1;
  }

  /**
   * Calculate seat offset based on seat index
   */
  calculateSeatOffset(seatCapacity, seatIndex, bbox, rotation, furnitureName) {
    if (seatCapacity === 1) {
      return { x: 0, z: 0 };
    }

    let offset = new THREE.Vector3(0, 0, 0);

    // Special handling for corner/L-shaped furniture
    if (furnitureName.includes("corner")) {
      // Corner sofas have an L-shape
      // Distribute seats along both arms
      const halfWidth = bbox.width / 2;
      const halfDepth = bbox.depth / 2;

      if (seatCapacity === 2) {
        // 2 seats: one on each arm
        if (seatIndex === 0) {
          offset.x = -halfWidth * 0.5; // Left arm
          offset.z = -halfDepth * 0.3;
        } else {
          offset.x = halfWidth * 0.3;
          offset.z = -halfDepth * 0.5; // Front arm
        }
      } else if (seatCapacity === 3) {
        // 3 seats: 2 on long arm, 1 on short arm
        if (seatIndex === 0) {
          offset.x = -halfWidth * 0.6;
          offset.z = -halfDepth * 0.3;
        } else if (seatIndex === 1) {
          offset.x = -halfWidth * 0.2;
          offset.z = -halfDepth * 0.3;
        } else {
          offset.x = halfWidth * 0.3;
          offset.z = -halfDepth * 0.5;
        }
      } else {
        // 4+ seats: distribute evenly
        const seatsPerArm = Math.ceil(seatCapacity / 2);
        if (seatIndex < seatsPerArm) {
          // Left/back arm
          const spacing = bbox.width / seatsPerArm;
          offset.x = -halfWidth + spacing * (seatIndex + 0.5);
          offset.z = -halfDepth * 0.3;
        } else {
          // Front arm
          const frontSeatIndex = seatIndex - seatsPerArm;
          const frontSeats = seatCapacity - seatsPerArm;
          const spacing = bbox.depth / frontSeats;
          offset.x = halfWidth * 0.3;
          offset.z = -halfDepth + spacing * (frontSeatIndex + 0.5);
        }
      }
    } else {
      // Standard linear furniture (sofas, benches)
      const furnitureWidth = Math.max(bbox.width, bbox.depth);
      const spacing = furnitureWidth / seatCapacity;

      // Calculate offset from center (in local space)
      const totalWidth = spacing * (seatCapacity - 1);
      const localOffset = -totalWidth / 2 + spacing * seatIndex;

      // Determine if furniture is oriented along X or Z axis
      const useXAxis = bbox.width >= bbox.depth;

      offset = new THREE.Vector3(
        useXAxis ? localOffset : 0,
        0,
        useXAxis ? 0 : localOffset
      );
    }

    // Rotate offset to match furniture rotation
    offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), rotation);

    return { x: offset.x, z: offset.z };
  }

  /**
   * Stand up from furniture
   */
  standUp() {
    const player = this.playerManager.players.get(this.networkManager.playerId);
    if (!player || !player.mesh) return;

    console.log("🚶 Standing up");

    // Clear sitting state
    this.isSitting = false;
    const previousFurniture = this.sittingOn;
    this.sittingOn = null;
    player.isSitting = false; // Mark player as no longer sitting
    player.sittingOn = null; // Clear furniture reference
    player.seatIndex = undefined; // Clear seat index

    // Move player slightly forward from furniture
    const standPosition = player.mesh.position.clone();
    const forwardOffset = new THREE.Vector3(0, 0, 1.5);
    forwardOffset.applyQuaternion(player.mesh.quaternion);
    standPosition.add(forwardOffset);
    standPosition.y = 0; // Reset to ground level

    player.mesh.position.copy(standPosition);
    player.targetPosition.copy(standPosition);

    // Stop sit animation and reset to idle
    this.playerManager.animationController.stopCurrentAnimation(
      this.networkManager.playerId
    );
    this.playerManager.animationController.resetToIdle(
      this.networkManager.playerId
    );

    // Notify server
    this.networkManager.socket.emit("playerStandUp", {
      playerId: this.networkManager.playerId,
      position: { x: standPosition.x, y: standPosition.y, z: standPosition.z },
    });

    // Hide prompt
    this.hidePrompt();
  }

  /**
   * Update prompt while sitting
   */
  updateSittingPrompt() {
    const prompt = document.getElementById("interaction-prompt");
    if (!prompt) return;

    prompt.innerHTML = `Press <strong>F</strong> to stand up`;
    prompt.style.display = "block";
  }

  /**
   * Handle other player sitting (from network)
   */
  handleOtherPlayerSit(data) {
    const { playerId, furnitureId, seatIndex, position, rotation } = data;
    const player = this.playerManager.players.get(playerId);

    if (player && player.mesh) {
      // Mark player as sitting
      player.isSitting = true;
      player.isMoving = false;
      player.sittingOn = furnitureId;
      player.seatIndex = seatIndex !== undefined ? seatIndex : 0;

      // Set position and rotation
      player.mesh.position.set(position.x, position.y, position.z);
      player.targetPosition.set(position.x, position.y, position.z);
      player.mesh.rotation.y = rotation;
      player.targetRotation = rotation;

      // Play sit animation for other player (loop it)
      this.playerManager.animationController.playAnimationClip(
        playerId,
        "sit",
        null,
        true // Loop the animation
      );

      console.log(
        `👀 Player ${playerId} is now sitting on ${furnitureId} (seat ${
          player.seatIndex + 1
        })`
      );
    }
  }

  /**
   * Handle other player standing up (from network)
   */
  handleOtherPlayerStandUp(data) {
    const { playerId, position } = data;
    const player = this.playerManager.players.get(playerId);

    if (player) {
      // Mark player as no longer sitting
      player.isSitting = false;
      player.sittingOn = null;
      player.seatIndex = undefined;

      // Update position if provided
      if (position) {
        player.mesh.position.set(position.x, position.y, position.z);
        player.targetPosition.set(position.x, position.y, position.z);
      }

      // Stop sit animation and reset to idle
      this.playerManager.animationController.stopCurrentAnimation(playerId);
      this.playerManager.animationController.resetToIdle(playerId);

      console.log(`👀 Player ${playerId} stood up`);
    }
  }

  /**
   * Check if player is sitting
   */
  isPlayerSitting() {
    return this.isSitting;
  }
}
