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

    // Set sitting state
    this.isSitting = true;
    this.sittingOn = furniture;
    player.isSitting = true; // Mark player as sitting

    // Calculate proper sitting position based on furniture bounding box
    const sitPosition = this.calculateSittingPosition(furniture);

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
      position: { x: sitPosition.x, y: sitPosition.y, z: sitPosition.z },
      rotation: furniture.rotation.y,
    });

    // Update prompt
    this.updateSittingPrompt();
  }

  /**
   * Calculate proper sitting position on furniture
   */
  calculateSittingPosition(furniture) {
    const sitPosition = furniture.position.clone();

    // Get the actual bounding box of the furniture
    const bbox = this.sceneManager.calculateBoundingBox(furniture);

    // Use the bounding box center for X and Z positioning
    sitPosition.x = bbox.center.x;
    sitPosition.z = bbox.center.z;

    // Get furniture name to determine type-specific positioning
    const furnitureName = this.getFurnitureName(furniture).toLowerCase();

    // Calculate seat height based on furniture type
    let seatHeightMultiplier = 0.35; // Default for most furniture
    let forwardOffset = 0; // Offset in local Z axis

    // Type-specific adjustments
    if (furnitureName.includes("stool")) {
      // Bar stools and high stools
      seatHeightMultiplier = 0.55; // Stools are higher
      forwardOffset = 0;
    } else if (
      furnitureName.includes("lounge") &&
      furnitureName.includes("chair")
    ) {
      // Lounge/relaxing chairs
      seatHeightMultiplier = 0.25; // Lounge chairs are lower
      forwardOffset = -0.1;
    } else if (
      furnitureName.includes("sofa") ||
      furnitureName.includes("couch")
    ) {
      // Sofas and couches
      seatHeightMultiplier = 0.3;
      forwardOffset = -0.15; // Sit slightly back on the cushion
    } else if (furnitureName.includes("bench")) {
      // Benches
      seatHeightMultiplier = 0.4;
      forwardOffset = 0;
    } else if (furnitureName.includes("chair")) {
      // Regular chairs (check this last to avoid matching lounge chair)
      seatHeightMultiplier = 0.35;
      forwardOffset = 0; // Chairs usually centered
    }

    // Calculate seat height from furniture base
    const furnitureHeight = bbox.height;
    const furnitureBase =
      furniture.position.y -
      furnitureHeight / 2 +
      (bbox.center.y - furniture.position.y);
    const seatHeight = furnitureHeight * seatHeightMultiplier;

    // Set Y position (from base of furniture)
    sitPosition.y = furnitureBase + seatHeight;

    // Apply forward/backward offset based on furniture rotation
    if (forwardOffset !== 0) {
      const offset = new THREE.Vector3(0, 0, forwardOffset);
      offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), furniture.rotation.y);
      sitPosition.add(offset);
    }

    console.log(
      `📍 Sitting on ${furnitureName} at: (${sitPosition.x.toFixed(
        2
      )}, ${sitPosition.y.toFixed(2)}, ${sitPosition.z.toFixed(2)})`
    );
    console.log(
      `   Furniture bbox: height=${bbox.height.toFixed(
        2
      )}, center=(${bbox.center.x.toFixed(2)}, ${bbox.center.y.toFixed(
        2
      )}, ${bbox.center.z.toFixed(2)})`
    );

    return sitPosition;
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
    const { playerId, furnitureId, position, rotation } = data;
    const player = this.playerManager.players.get(playerId);

    if (player && player.mesh) {
      player.mesh.position.set(position.x, position.y, position.z);
      player.targetPosition.set(position.x, position.y, position.z);
      player.mesh.rotation.y = rotation;

      // Play sit animation for other player
      this.playerManager.animationController.playAnimationClip(
        playerId,
        "sit",
        null,
        true
      );
    }
  }

  /**
   * Handle other player standing up (from network)
   */
  handleOtherPlayerStandUp(data) {
    const { playerId } = data;

    this.playerManager.animationController.stopCurrentAnimation(playerId);
  }

  /**
   * Check if player is sitting
   */
  isPlayerSitting() {
    return this.isSitting;
  }
}
