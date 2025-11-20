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
    this.interactionRange = 2.5; // Distance to interact (from bounding box surface)
    this.nearbyFurniture = null;
    this.showingPrompt = false;

    console.log(
      "💡 Interaction Detection: Using visual collision boxes for accuracy"
    );

    // Sitting state
    this.isSitting = false;
    this.sittingOn = null;

    // Lying state
    this.isLying = false;
    this.lyingOn = null;

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

    // Define furniture types that can be laid on
    this.lyingFurniture = ["bed", "bathtub"];

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

    // Show get-up prompt if lying
    if (this.isLying) {
      this.updateLyingPrompt();
      return;
    }

    const player = this.playerManager.players.get(this.networkManager.playerId);
    if (!player || !player.mesh) return;

    const playerPos = player.mesh.position;

    // Find nearby furniture (both sittable and lying)
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
      const furnitureName =
        furniture.userData.model || furniture.userData.type || "";
      const furnitureNameLower = furnitureName.toLowerCase();

      // Check if this furniture can be sat on or laid on
      const isSittable = this.sittableFurniture.some((type) =>
        furnitureNameLower.includes(type)
      );
      const isLyingFurniture = this.lyingFurniture.some((type) =>
        furnitureNameLower.includes(type)
      );

      if (!isSittable && !isLyingFurniture) return;

      // Calculate distance to furniture's actual bounding box (same as visual collision box)
      const bbox = this.sceneManager.calculateBoundingBox(furniture);

      // Calculate closest point on the bounding box to the player
      // This matches exactly how the visual collision box works
      const closestPoint = new THREE.Vector3(
        Math.max(
          bbox.center.x - bbox.width / 2,
          Math.min(playerPos.x, bbox.center.x + bbox.width / 2)
        ),
        Math.max(
          bbox.center.y - bbox.height / 2,
          Math.min(playerPos.y, bbox.center.y + bbox.height / 2)
        ),
        Math.max(
          bbox.center.z - bbox.depth / 2,
          Math.min(playerPos.z, bbox.center.z + bbox.depth / 2)
        )
      );

      // Distance to closest point on the bounding box surface
      const distance = playerPos.distanceTo(closestPoint);

      if (distance < closestDistance) {
        closest = furniture;
        closestDistance = distance;
        // Mark furniture type for interaction
        furniture.userData.interactionType = isLyingFurniture ? "lie" : "sit";
      }
    });

    // Debug: Log when furniture is in range (uncomment to debug)
    // if (closest) {
    //   console.log(`🎯 Nearby: ${this.getFurnitureName(closest)} (${closestDistance.toFixed(2)}m away)`);
    // }

    return closest;
  }

  /**
   * Show interaction prompt
   */
  showPrompt(furniture) {
    const prompt = document.getElementById("interaction-prompt");
    if (!prompt) return;

    const furnitureName = this.getFurnitureName(furniture);
    const interactionType = furniture.userData.interactionType || "sit";
    const action = interactionType === "lie" ? "lie down on" : "sit on";

    prompt.innerHTML = `Press <strong>F</strong> to ${action} ${furnitureName}`;
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
    } else if (this.isLying) {
      this.getUp();
    } else if (this.nearbyFurniture) {
      const interactionType =
        this.nearbyFurniture.userData.interactionType || "sit";
      if (interactionType === "lie") {
        this.lieDown(this.nearbyFurniture);
      } else {
        this.sitDown(this.nearbyFurniture);
      }
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

    // Try to play sit animation from GLB, fallback to procedural
    const hasAnimation =
      this.playerManager.animationController.playAnimationClip(
        this.networkManager.playerId,
        "sit",
        null,
        true // Loop the animation
      );

    if (!hasAnimation) {
      // Use procedural sitting pose
      this.playerManager.animationController.applySittingPose(
        this.networkManager.playerId
      );
      console.log("🪑 Using procedural sitting animation");
    }

    // Notify server with EXACT furniture dimensions AND center (for accurate collision)
    // Reuse bbox calculated earlier
    this.networkManager.socket.emit("playerSit", {
      playerId: this.networkManager.playerId,
      furnitureId: furniture.userData.id,
      seatIndex: seatIndex,
      position: { x: sitPosition.x, y: sitPosition.y, z: sitPosition.z },
      rotation: furniture.rotation.y,
      furnitureDimensions: {
        width: furniture.userData.width,
        height: furniture.userData.height,
        depth: furniture.userData.depth,
        centerX: bbox.center.x,
        centerY: bbox.center.y,
        centerZ: bbox.center.z,
      },
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

    // Get the actual bounding box of the furniture (EXACT collision box)
    const bbox = this.sceneManager.calculateBoundingBox(furniture);

    // Ensure userData is synced with live bbox (for server accuracy)
    furniture.userData.width = bbox.width;
    furniture.userData.height = bbox.height;
    furniture.userData.depth = bbox.depth;

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
   * Get lying capacity for beds based on size
   */
  getBedLyingCapacity(furnitureName, bbox) {
    // Single beds: 1 person
    if (furnitureName.includes("single") || bbox.width < 1.5) {
      return 1;
    }

    // Large beds: calculate based on the SHORTER dimension (bed width, not length)
    // Players lie side-by-side across the bed width
    // Each person needs roughly 1 meter of space
    if (furnitureName.includes("bed") || furnitureName.includes("bathtub")) {
      const bedWidth = Math.min(bbox.width, bbox.depth); // Use shorter dimension
      return Math.max(1, Math.floor(bedWidth / 1.0)); // 1 meter per person
    }

    return 1; // Default
  }

  /**
   * Find available lying position on bed
   */
  findAvailableLyingPosition(furniture, lyingCapacity) {
    const occupiedPositions = new Set();

    // Check all players to see which positions are occupied
    this.playerManager.players.forEach((player, playerId) => {
      if (
        player.isLying &&
        player.lyingOn === furniture.userData.id &&
        player.lyingIndex !== undefined
      ) {
        occupiedPositions.add(player.lyingIndex);
      }
    });

    console.log(
      `🛏️ Bed ${furniture.userData.id}: ${occupiedPositions.size}/${lyingCapacity} positions occupied`
    );

    // Find first available position
    for (let i = 0; i < lyingCapacity; i++) {
      if (!occupiedPositions.has(i)) {
        return i;
      }
    }

    return null; // All positions occupied
  }

  /**
   * Calculate lying position on bed based on position index
   */
  calculateLyingPosition(furniture, lyingIndex = 0) {
    const bbox = this.sceneManager.calculateBoundingBox(furniture);
    const lyingPosition = bbox.center.clone();

    // Get bed capacity
    const furnitureName = this.getFurnitureName(furniture).toLowerCase();
    const lyingCapacity = this.getBedLyingCapacity(furnitureName, bbox);

    // Determine which axis is the bed width (shorter dimension)
    const useXAxis = bbox.width < bbox.depth; // TRUE if width is along X axis
    const bedWidth = Math.min(bbox.width, bbox.depth);
    const bedLength = Math.max(bbox.width, bbox.depth);

    // Fine-tune position along bed length
    // Positive = toward headboard, Negative = toward footboard
    const backwardOffset = bedLength * 0.3;

    const lengthOffset = new THREE.Vector3(
      useXAxis ? 0 : backwardOffset,
      0,
      useXAxis ? backwardOffset : 0
    );

    // Rotate length offset to match bed rotation
    lengthOffset.applyAxisAngle(
      new THREE.Vector3(0, 1, 0),
      furniture.rotation.y
    );

    lyingPosition.x += lengthOffset.x;
    lyingPosition.z += lengthOffset.z;

    // If bed can fit multiple people, offset positions across bed width
    if (lyingCapacity > 1) {
      const spacing = bedWidth / lyingCapacity;

      // Calculate offset from center
      const totalWidth = spacing * (lyingCapacity - 1);
      const localOffset = -totalWidth / 2 + spacing * lyingIndex;

      const widthOffset = new THREE.Vector3(
        useXAxis ? localOffset : 0,
        0,
        useXAxis ? 0 : localOffset
      );

      // Rotate width offset to match bed rotation
      widthOffset.applyAxisAngle(
        new THREE.Vector3(0, 1, 0),
        furniture.rotation.y
      );

      lyingPosition.x += widthOffset.x;
      lyingPosition.z += widthOffset.z;

      console.log(
        `🛏️ Lying position ${
          lyingIndex + 1
        }/${lyingCapacity} at width offset ${localOffset.toFixed(2)}m on ${
          useXAxis ? "X" : "Z"
        } axis, backward ${Math.abs(backwardOffset).toFixed(2)}m`
      );
    } else {
      console.log(
        `🛏️ Lying at center, backward ${Math.abs(backwardOffset).toFixed(
          2
        )}m from headboard`
      );
    }

    // Adjust height - lie on top of bed surface
    lyingPosition.y = furniture.position.y + bbox.height * 0.5;

    return lyingPosition;
  }

  /**
   * Stand up from furniture
   */
  standUp() {
    const player = this.playerManager.players.get(this.networkManager.playerId);
    if (!player || !player.mesh) return;

    console.log("🚶 Standing up");

    // Get furniture reference before clearing
    const furniture = this.sittingOn;

    // Clear sitting state
    this.isSitting = false;
    this.sittingOn = null;
    player.isSitting = false; // Mark player as no longer sitting
    player.sittingOn = null; // Clear furniture reference
    player.seatIndex = undefined; // Clear seat index

    // Calculate a safe standing position
    let standPosition = player.mesh.position.clone();

    // If we have the furniture reference, move away from it intelligently
    if (furniture) {
      const furnitureBBox = this.sceneManager.calculateBoundingBox(furniture);
      const furnitureCenter = furnitureBBox.center;

      // Sync userData with live bbox
      furniture.userData.width = furnitureBBox.width;
      furniture.userData.height = furnitureBBox.height;
      furniture.userData.depth = furnitureBBox.depth;

      // Calculate direction away from furniture center
      const awayDirection = new THREE.Vector3(
        standPosition.x - furnitureCenter.x,
        0,
        standPosition.z - furnitureCenter.z
      );

      // If player is at furniture center, use forward direction
      if (awayDirection.length() < 0.1) {
        awayDirection.set(0, 0, 1);
        awayDirection.applyQuaternion(player.mesh.quaternion);
      } else {
        awayDirection.normalize();
      }

      // Move at least 2.5 units away from furniture (beyond collision range)
      const furnitureSize = Math.max(furnitureBBox.width, furnitureBBox.depth);
      const playerCollisionSize = 0.6; // Player collision box size
      const safeDistance = furnitureSize / 2 + playerCollisionSize + 0.5; // Furniture radius + player size + buffer

      standPosition.x = furnitureCenter.x + awayDirection.x * safeDistance;
      standPosition.z = furnitureCenter.z + awayDirection.z * safeDistance;
    } else {
      // Fallback: move forward from current rotation
      const forwardOffset = new THREE.Vector3(0, 0, 2.5);
      forwardOffset.applyQuaternion(player.mesh.quaternion);
      standPosition.add(forwardOffset);
    }

    // Ensure ground level
    standPosition.y = 0;

    // Set position immediately
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

    console.log(
      `📍 Standing at: (${standPosition.x.toFixed(
        2
      )}, ${standPosition.z.toFixed(2)}) - moved away from furniture`
    );

    // Hide prompt
    this.hidePrompt();
  }

  /**
   * Lie down on furniture (beds, bathtubs)
   */
  lieDown(furniture) {
    const player = this.playerManager.players.get(this.networkManager.playerId);
    if (!player || !player.mesh) return;

    console.log(`🛏️ Lying down on ${this.getFurnitureName(furniture)}`);

    // Calculate bed capacity and find available position
    const bbox = this.sceneManager.calculateBoundingBox(furniture);
    const furnitureName = this.getFurnitureName(furniture).toLowerCase();
    const lyingCapacity = this.getBedLyingCapacity(furnitureName, bbox);
    const lyingIndex = this.findAvailableLyingPosition(
      furniture,
      lyingCapacity
    );

    if (lyingIndex === null) {
      console.log("❌ No available lying positions on this bed");
      return;
    }

    // Set lying state
    this.isLying = true;
    this.lyingOn = furniture;
    player.isLying = true;
    player.lyingOn = furniture.userData.id;
    player.lyingIndex = lyingIndex; // Track which position on the bed

    // Calculate lying position based on bed size and position index
    const lyingPosition = this.calculateLyingPosition(furniture, lyingIndex);

    // Sync userData with live bbox
    furniture.userData.width = bbox.width;
    furniture.userData.height = bbox.height;
    furniture.userData.depth = bbox.depth;

    player.mesh.position.copy(lyingPosition);
    player.targetPosition.copy(lyingPosition);

    // Rotate player to align with bed
    player.mesh.rotation.y = furniture.rotation.y;

    // Stop any movement
    player.isMoving = false;

    // Try to play lie animation from GLB
    let hasAnimation = this.playerManager.animationController.playAnimationClip(
      this.networkManager.playerId,
      "lie",
      null,
      true // Loop
    );

    if (!hasAnimation) {
      // Use procedural lying pose
      this.playerManager.animationController.applyLyingPose(
        this.networkManager.playerId
      );
      console.log("🛏️ Using procedural lying animation");
    }

    // Get bbox for accurate collision center
    const bboxForSync = this.sceneManager.calculateBoundingBox(furniture);

    // Notify server with EXACT furniture dimensions AND center (for accurate collision)
    this.networkManager.socket.emit("playerLie", {
      playerId: this.networkManager.playerId,
      furnitureId: furniture.userData.id,
      lyingIndex: lyingIndex, // Track position on bed
      position: {
        x: lyingPosition.x,
        y: lyingPosition.y,
        z: lyingPosition.z,
      },
      rotation: furniture.rotation.y,
      furnitureDimensions: {
        width: furniture.userData.width,
        height: furniture.userData.height,
        depth: furniture.userData.depth,
        centerX: bboxForSync.center.x,
        centerY: bboxForSync.center.y,
        centerZ: bboxForSync.center.z,
      },
    });

    // Update prompt
    this.updateLyingPrompt();
  }

  /**
   * Get up from lying position
   */
  getUp() {
    const player = this.playerManager.players.get(this.networkManager.playerId);
    if (!player || !player.mesh) return;

    console.log("🚶 Getting up");

    // Get furniture reference before clearing
    const furniture = this.lyingOn;

    // Clear lying state
    this.isLying = false;
    this.lyingOn = null;
    player.isLying = false;
    player.lyingOn = null;
    player.lyingIndex = undefined; // Clear lying position index

    // Calculate a safe standing position (same logic as standUp)
    let standPosition = player.mesh.position.clone();

    if (furniture) {
      const furnitureBBox = this.sceneManager.calculateBoundingBox(furniture);
      const furnitureCenter = furnitureBBox.center;

      // Sync userData with live bbox
      furniture.userData.width = furnitureBBox.width;
      furniture.userData.height = furnitureBBox.height;
      furniture.userData.depth = furnitureBBox.depth;

      const awayDirection = new THREE.Vector3(
        standPosition.x - furnitureCenter.x,
        0,
        standPosition.z - furnitureCenter.z
      );

      if (awayDirection.length() < 0.1) {
        awayDirection.set(0, 0, 1);
        awayDirection.applyQuaternion(player.mesh.quaternion);
      } else {
        awayDirection.normalize();
      }

      const furnitureSize = Math.max(furnitureBBox.width, furnitureBBox.depth);
      const playerCollisionSize = 0.6; // Player collision box size
      const safeDistance = furnitureSize / 2 + playerCollisionSize + 0.5; // Furniture radius + player size + buffer

      standPosition.x = furnitureCenter.x + awayDirection.x * safeDistance;
      standPosition.z = furnitureCenter.z + awayDirection.z * safeDistance;
    } else {
      const forwardOffset = new THREE.Vector3(0, 0, 2.5);
      forwardOffset.applyQuaternion(player.mesh.quaternion);
      standPosition.add(forwardOffset);
    }

    standPosition.y = 0;

    // Force update position immediately
    player.mesh.position.copy(standPosition);
    player.targetPosition.copy(standPosition);

    // Ensure movement is enabled
    player.isMoving = false;

    // Double-check lying state is cleared
    player.isLying = false;
    player.lyingOn = null;
    this.isLying = false;
    this.lyingOn = null;

    // Stop animation and reset to idle
    this.playerManager.animationController.stopCurrentAnimation(
      this.networkManager.playerId
    );
    this.playerManager.animationController.resetToIdle(
      this.networkManager.playerId
    );

    // Notify server
    this.networkManager.socket.emit("playerGetUp", {
      playerId: this.networkManager.playerId,
      position: { x: standPosition.x, y: standPosition.y, z: standPosition.z },
    });

    console.log(
      `📍 Getting up at: (${standPosition.x.toFixed(
        2
      )}, ${standPosition.z.toFixed(2)}) - moved away from bed`
    );
    console.log(
      `   State cleared: isLying=${player.isLying}, isSitting=${player.isSitting}`
    );
    console.log(
      `   Position: mesh=(${player.mesh.position.x.toFixed(
        2
      )}, ${player.mesh.position.z.toFixed(
        2
      )}), target=(${player.targetPosition.x.toFixed(
        2
      )}, ${player.targetPosition.z.toFixed(2)})`
    );

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
   * Update prompt while lying
   */
  updateLyingPrompt() {
    const prompt = document.getElementById("interaction-prompt");
    if (!prompt) return;

    prompt.innerHTML = `Press <strong>F</strong> to get up`;
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

      // Try GLB animation, fallback to procedural
      const hasAnimation =
        this.playerManager.animationController.playAnimationClip(
          playerId,
          "sit",
          null,
          true // Loop the animation
        );

      if (!hasAnimation) {
        this.playerManager.animationController.applySittingPose(playerId);
      }

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
   * Handle other player lying down (from network)
   */
  handleOtherPlayerLie(data) {
    const { playerId, furnitureId, position, rotation, lyingIndex } = data;
    const player = this.playerManager.players.get(playerId);

    if (player && player.mesh) {
      // Mark player as lying
      player.isLying = true;
      player.isMoving = false;
      player.lyingOn = furnitureId;
      player.lyingIndex = lyingIndex !== undefined ? lyingIndex : 0;

      // Set position and rotation
      player.mesh.position.set(position.x, position.y, position.z);
      player.targetPosition.set(position.x, position.y, position.z);
      player.mesh.rotation.y = rotation;
      player.targetRotation = rotation;

      // Try GLB lie animation, fallback to procedural
      let hasAnimation =
        this.playerManager.animationController.playAnimationClip(
          playerId,
          "lie",
          null,
          true
        );

      if (!hasAnimation) {
        this.playerManager.animationController.applyLyingPose(playerId);
      }

      console.log(
        `👀 Player ${playerId} is now lying on ${furnitureId} (position ${
          lyingIndex + 1
        })`
      );
    }
  }

  /**
   * Handle other player getting up (from network)
   */
  handleOtherPlayerGetUp(data) {
    const { playerId, position } = data;
    const player = this.playerManager.players.get(playerId);

    if (player) {
      // Clear lying position index
      player.lyingIndex = undefined;
      // Mark player as no longer lying
      player.isLying = false;
      player.lyingOn = null;

      // Update position if provided
      if (position) {
        player.mesh.position.set(position.x, position.y, position.z);
        player.targetPosition.set(position.x, position.y, position.z);
      }

      // Stop animation and reset to idle
      this.playerManager.animationController.stopCurrentAnimation(playerId);
      this.playerManager.animationController.resetToIdle(playerId);

      console.log(`👀 Player ${playerId} got up`);
    }
  }

  /**
   * Check if player is sitting
   */
  isPlayerSitting() {
    return this.isSitting;
  }

  /**
   * Check if player is lying
   */
  isPlayerLying() {
    return this.isLying;
  }
}
