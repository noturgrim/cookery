import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";

/**
 * Animation Controller
 * Handles procedural character animations for walking
 */
export class AnimationController {
  constructor() {
    this.mixers = new Map(); // Store mixer data per player
  }

  /**
   * Initialize animation for a character model
   * @param {string} playerId - Unique player identifier
   * @param {THREE.Object3D} characterModel - The character 3D model
   * @param {THREE.AnimationMixer} mixer - Three.js animation mixer
   * @param {Array} animations - GLTF animation clips
   */
  initializeAnimation(playerId, characterModel, mixer, animations = []) {
    const limbs = this.findLimbs(characterModel);

    // Store animation clips
    const animationClips = {};
    if (animations && animations.length > 0) {
      animations.forEach((clip) => {
        animationClips[clip.name.toLowerCase()] = clip;
      });
      console.log(
        `🎬 Available animations for player ${playerId}:`,
        Object.keys(animationClips)
      );
    }

    // Store original positions and rotations for each limb
    const originalTransforms = {
      leftLeg: limbs.leftLeg
        ? {
            position: limbs.leftLeg.position.clone(),
            rotation: limbs.leftLeg.rotation.clone(),
          }
        : null,
      rightLeg: limbs.rightLeg
        ? {
            position: limbs.rightLeg.position.clone(),
            rotation: limbs.rightLeg.rotation.clone(),
          }
        : null,
      leftArm: limbs.leftArm
        ? {
            position: limbs.leftArm.position.clone(),
            rotation: limbs.leftArm.rotation.clone(),
          }
        : null,
      rightArm: limbs.rightArm
        ? {
            position: limbs.rightArm.position.clone(),
            rotation: limbs.rightArm.rotation.clone(),
          }
        : null,
      torso: limbs.torso
        ? {
            position: limbs.torso.position.clone(),
            rotation: limbs.torso.rotation.clone(),
          }
        : null,
      head: limbs.head
        ? {
            position: limbs.head.position.clone(),
            rotation: limbs.head.rotation.clone(),
          }
        : null,
    };

    this.mixers.set(playerId, {
      mixer: mixer,
      model: characterModel,
      isMoving: false,
      limbs: limbs,
      originalTransforms: originalTransforms,
      walkCycle: 0,
      previousWalkCycle: 0,
      animationClips: animationClips,
      currentAction: null,
    });

    console.log(`🎬 Animation initialized for player ${playerId}:`, {
      leftLeg: limbs.leftLeg?.name || "not found",
      rightLeg: limbs.rightLeg?.name || "not found",
      leftArm: limbs.leftArm?.name || "not found",
      rightArm: limbs.rightArm?.name || "not found",
      torso: limbs.torso?.name || "not found",
      head: limbs.head?.name || "not found",
      allObjects: limbs.allObjects,
    });

    // Log positions and pivots for debugging
    if (limbs.leftLeg) {
      console.log("Left Leg position:", limbs.leftLeg.position);
      console.log("Left Leg rotation:", limbs.leftLeg.rotation);
    }
    if (limbs.rightLeg) {
      console.log("Right Leg position:", limbs.rightLeg.position);
      console.log("Right Leg rotation:", limbs.rightLeg.rotation);
    }

    return limbs;
  }

  /**
   * Find limbs in the character model hierarchy
   * @param {THREE.Object3D} characterModel - The character model
   * @returns {Object} Object containing references to limbs
   */
  findLimbs(characterModel) {
    const limbs = {
      leftLeg: null,
      rightLeg: null,
      leftArm: null,
      rightArm: null,
      torso: null,
      head: null,
      allObjects: [], // For debugging
    };

    characterModel.traverse((child) => {
      if (child.name) {
        limbs.allObjects.push({
          name: child.name,
          type: child.type,
          hasChildren: child.children.length > 0,
          childCount: child.children.length,
        });
      }

      const name = child.name.toLowerCase();

      // IMPORTANT: We want the PARENT groups (with children), not the leaf meshes
      // The parent groups have the correct pivot points for rotation
      const hasChildren = child.children && child.children.length > 0;

      // Skip if this is just a mesh without children (likely the actual geometry, not the armature)
      // We want the parent object that contains the mesh
      const isMeshOnly = child.type === "Mesh" || child.type === "SkinnedMesh";

      // Find head first (before legs, to avoid false matches)
      if (
        name === "head" ||
        name.startsWith("head-") ||
        name.startsWith("head_")
      ) {
        // Prefer the parent group if it has children
        if (hasChildren || !limbs.head) {
          limbs.head = child;
        }
        return; // Skip other checks for this child
      }

      // Find legs - looking for parent groups
      if (name.includes("leg")) {
        if (name.includes("left") || name.includes("-l")) {
          // Prefer the parent group (has children), but take mesh if that's all we have
          if (hasChildren || !limbs.leftLeg) {
            limbs.leftLeg = child;
          }
        } else if (name.includes("right") || name.includes("-r")) {
          if (hasChildren || !limbs.rightLeg) {
            limbs.rightLeg = child;
          }
        }
        return;
      }

      // Find arms - looking for parent groups
      if (name.includes("arm")) {
        if (name.includes("left") || name.includes("-l")) {
          if (hasChildren || !limbs.leftArm) {
            limbs.leftArm = child;
          }
        } else if (name.includes("right") || name.includes("-r")) {
          if (hasChildren || !limbs.rightArm) {
            limbs.rightArm = child;
          }
        }
        return;
      }

      // Find torso/body - looking for parent group
      if (name.includes("torso") || name.includes("body")) {
        if (hasChildren || !limbs.torso) {
          limbs.torso = child;
        }
        return;
      }
    });

    return limbs;
  }

  /**
   * Update walking animation for a player
   * @param {string} playerId - Player identifier
   * @param {boolean} isMoving - Whether the player is currently moving
   * @returns {Object|null} Footstep event data if a step occurred
   */
  updateAnimation(playerId, isMoving) {
    const animData = this.mixers.get(playerId);
    if (!animData) return null;

    const { limbs, originalTransforms } = animData;

    // Store previous walk cycle for footstep detection
    animData.previousWalkCycle = animData.walkCycle || 0;

    // Update walk cycle
    if (isMoving) {
      animData.walkCycle += 0.15;
      animData.isMoving = true;
    } else {
      // Gradually return to idle pose
      animData.walkCycle *= 0.9;
      if (Math.abs(animData.walkCycle) < 0.01) {
        animData.walkCycle = 0;
        animData.isMoving = false;
      }
    }

    // Detect footstep events
    const footstepEvent = this.detectFootstep(
      animData.previousWalkCycle,
      animData.walkCycle,
      isMoving
    );

    // Apply procedural animation with original transforms
    this.applyWalkingAnimation(limbs, animData.walkCycle, originalTransforms);

    return footstepEvent;
  }

  /**
   * Detect when a foot hits the ground
   * @param {number} previousCycle - Previous walk cycle value
   * @param {number} currentCycle - Current walk cycle value
   * @param {boolean} isMoving - Whether player is moving
   * @returns {Object|null} Footstep event with foot identifier
   */
  detectFootstep(previousCycle, currentCycle, isMoving) {
    if (!isMoving) return null;

    const currentSin = Math.sin(currentCycle);
    const previousSin = Math.sin(previousCycle);

    // Left leg hits ground when sin goes from positive to negative (crosses 0 downward)
    const crossedZeroDown = previousSin > 0 && currentSin <= 0;

    // Right leg hits ground when sin goes from negative to positive (crosses 0 upward)
    const crossedZeroUp = previousSin < 0 && currentSin >= 0;

    if (crossedZeroUp) {
      return { foot: "right", footIndex: 0 };
    } else if (crossedZeroDown) {
      return { foot: "left", footIndex: 1 };
    }

    return null;
  }

  /**
   * Apply procedural walking animation to limbs
   * @param {Object} limbs - Object containing limb references
   * @param {number} walkCycle - Current walk cycle value
   * @param {Object} originalTransforms - Original positions and rotations
   */
  applyWalkingAnimation(limbs, walkCycle, originalTransforms) {
    // Calculate animation values with reduced amplitudes to prevent clipping
    const legSwing = Math.sin(walkCycle) * 0.25; // Slightly increased for visibility
    const armSwing = Math.sin(walkCycle) * 0.2; // Slightly increased
    const bodyBob = Math.abs(Math.sin(walkCycle * 2)) * 0.02; // Keep subtle

    // Animate legs (opposite swing) - rotate around X axis from original rotation
    // IMPORTANT: Preserve original position, only modify rotation
    if (limbs.leftLeg && originalTransforms.leftLeg) {
      limbs.leftLeg.rotation.x =
        originalTransforms.leftLeg.rotation.x + legSwing;
      // Ensure position stays at original
      limbs.leftLeg.position.copy(originalTransforms.leftLeg.position);
    }
    if (limbs.rightLeg && originalTransforms.rightLeg) {
      limbs.rightLeg.rotation.x =
        originalTransforms.rightLeg.rotation.x - legSwing;
      // Ensure position stays at original
      limbs.rightLeg.position.copy(originalTransforms.rightLeg.position);
    }

    // Animate arms (opposite to corresponding leg) - rotate around X axis from original
    if (limbs.leftArm && originalTransforms.leftArm) {
      limbs.leftArm.rotation.x =
        originalTransforms.leftArm.rotation.x - armSwing;
      limbs.leftArm.position.copy(originalTransforms.leftArm.position);
    }
    if (limbs.rightArm && originalTransforms.rightArm) {
      limbs.rightArm.rotation.x =
        originalTransforms.rightArm.rotation.x + armSwing;
      limbs.rightArm.position.copy(originalTransforms.rightArm.position);
    }

    // Add subtle body bob for walking effect (only to torso, not head)
    if (limbs.torso && originalTransforms.torso) {
      limbs.torso.position.x = originalTransforms.torso.position.x;
      limbs.torso.position.y = originalTransforms.torso.position.y + bodyBob;
      limbs.torso.position.z = originalTransforms.torso.position.z;
      limbs.torso.rotation.copy(originalTransforms.torso.rotation);
    }

    // Keep head in original position
    if (limbs.head && originalTransforms.head) {
      limbs.head.position.copy(originalTransforms.head.position);
      limbs.head.rotation.copy(originalTransforms.head.rotation);
    }
  }

  /**
   * Reset animation to idle pose
   * @param {string} playerId - Player identifier
   */
  resetToIdle(playerId) {
    const animData = this.mixers.get(playerId);
    if (!animData) return;

    const { limbs, originalTransforms } = animData;

    // Reset all rotations and positions to original values
    if (limbs.leftLeg && originalTransforms.leftLeg) {
      limbs.leftLeg.position.copy(originalTransforms.leftLeg.position);
      limbs.leftLeg.rotation.copy(originalTransforms.leftLeg.rotation);
    }
    if (limbs.rightLeg && originalTransforms.rightLeg) {
      limbs.rightLeg.position.copy(originalTransforms.rightLeg.position);
      limbs.rightLeg.rotation.copy(originalTransforms.rightLeg.rotation);
    }
    if (limbs.leftArm && originalTransforms.leftArm) {
      limbs.leftArm.position.copy(originalTransforms.leftArm.position);
      limbs.leftArm.rotation.copy(originalTransforms.leftArm.rotation);
    }
    if (limbs.rightArm && originalTransforms.rightArm) {
      limbs.rightArm.position.copy(originalTransforms.rightArm.position);
      limbs.rightArm.rotation.copy(originalTransforms.rightArm.rotation);
    }
    if (limbs.torso && originalTransforms.torso) {
      limbs.torso.position.copy(originalTransforms.torso.position);
      limbs.torso.rotation.copy(originalTransforms.torso.rotation);
    }
    if (limbs.head && originalTransforms.head) {
      limbs.head.position.copy(originalTransforms.head.position);
      limbs.head.rotation.copy(originalTransforms.head.rotation);
    }

    animData.walkCycle = 0;
    animData.isMoving = false;
  }

  /**
   * Update mixer (for frame-based animations)
   * @param {string} playerId - Player identifier
   * @param {number} delta - Time delta
   */
  updateMixer(playerId, delta) {
    const animData = this.mixers.get(playerId);
    if (animData && animData.mixer) {
      animData.mixer.update(delta);
    }
  }

  /**
   * Check if player is currently moving
   * @param {string} playerId - Player identifier
   * @returns {boolean} Whether player is moving
   */
  isMoving(playerId) {
    const animData = this.mixers.get(playerId);
    return animData ? animData.isMoving : false;
  }

  /**
   * Remove animation data for a player
   * @param {string} playerId - Player identifier
   */
  removePlayer(playerId) {
    this.mixers.delete(playerId);
  }

  /**
   * Play an animation clip by name
   * @param {string} playerId - Player identifier
   * @param {string} animationName - Name of the animation to play
   * @param {number} duration - Duration to play (optional, plays full clip if not specified)
   * @param {boolean} loop - Whether to loop the animation
   * @returns {boolean} Whether animation was found and played
   */
  playAnimationClip(playerId, animationName, duration = null, loop = false) {
    const animData = this.mixers.get(playerId);
    if (!animData || !animData.mixer) return false;

    const clipName = animationName.toLowerCase();
    const clip = animData.animationClips[clipName];

    if (!clip) {
      console.warn(
        `Animation "${animationName}" not found for player ${playerId}`
      );
      return false;
    }

    // Stop current action if any
    if (animData.currentAction) {
      animData.currentAction.stop();
    }

    // Create and play new action
    const action = animData.mixer.clipAction(clip);
    action.reset();
    action.setLoop(
      loop ? THREE.LoopRepeat : THREE.LoopOnce,
      loop ? Infinity : 1
    );
    action.clampWhenFinished = true;
    action.play();

    animData.currentAction = action;

    // Auto-stop after duration if specified
    if (duration && !loop) {
      setTimeout(() => {
        if (animData.currentAction === action) {
          action.stop();
          animData.currentAction = null;
        }
      }, duration);
    }

    console.log(
      `▶️ Playing animation "${animationName}" for player ${playerId}`
    );
    return true;
  }

  /**
   * Stop current animation for a player
   * @param {string} playerId - Player identifier
   */
  stopCurrentAnimation(playerId) {
    const animData = this.mixers.get(playerId);
    if (animData && animData.currentAction) {
      animData.currentAction.stop();
      animData.currentAction = null;
    }
  }

  /**
   * Get all mixer data (for debugging)
   * @returns {Map} All mixer data
   */
  getAllMixers() {
    return this.mixers;
  }
}
