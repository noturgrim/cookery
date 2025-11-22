import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
import { GLTFLoader } from "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/GLTFLoader.js";

/**
 * Pet Manager
 * Handles spawning and managing wandering pets with procedural leg animation
 */
export class PetManager {
  constructor(sceneManager, networkManager) {
    this.sceneManager = sceneManager;
    this.networkManager = networkManager;
    this.gltfLoader = new GLTFLoader();
    this.pets = new Map(); // petId -> { mesh, legs, target, speed, walkCycle }
    this.petModels = new Map(); // modelName -> scene
    this.syncInterval = null;
    this.isHost = false; // Will be set by startSync()
    this.pendingCats = null; // For initial spawn sync
  }

  /**
   * Load a pet model
   */
  async loadPetModel(name, path) {
    return new Promise((resolve, reject) => {
      this.gltfLoader.load(
        path,
        (gltf) => {
          // Enable shadows
          gltf.scene.traverse((child) => {
            if (child.isMesh) {
              child.castShadow = true;
              child.receiveShadow = true;
            }
          });

          console.log(`🐱 Loaded pet: ${name}`);

          // Log structure to see what parts we have
          console.log("   Model structure:");
          gltf.scene.traverse((child) => {
            if (child.isMesh || child.name) {
              console.log(`     - ${child.name} (${child.type})`);
            }
          });

          this.petModels.set(name, gltf.scene);
          resolve(gltf.scene);
        },
        undefined,
        (error) => {
          console.error(`❌ Failed to load pet ${name}:`, error);
          reject(error);
        }
      );
    });
  }

  /**
   * Find a safe random spawn position (not on obstacles)
   */
  findSafeSpawnPosition() {
    const platformSize = this.sceneManager.platformSize || 40;
    const bound = platformSize / 2 - 3;
    const maxAttempts = 50;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const randomX = (Math.random() - 0.5) * 2 * bound;
      const randomZ = (Math.random() - 0.5) * 2 * bound;
      const testPos = new THREE.Vector3(randomX, 0, randomZ);

      if (this.isPositionWalkable(testPos)) {
        return { x: randomX, y: 0, z: randomZ };
      }
    }

    // Fallback to origin if no safe spot found
    return { x: 0, y: 0, z: 0 };
  }

  /**
   * Spawn a pet in the world
   */
  spawnPet(modelName, position = null, customId = null) {
    // If no position provided, find a safe random one
    if (!position) {
      position = this.findSafeSpawnPosition();
    }
    const modelData = this.petModels.get(modelName);
    if (!modelData) {
      console.error(`❌ Pet model ${modelName} not loaded`);
      return null;
    }

    // Clone the model
    const petMesh = modelData.clone();
    petMesh.scale.set(0.02, 0.02, 0.02); // Smaller cat size

    // Calculate bounding box to find the bottom of the model
    const box = new THREE.Box3().setFromObject(petMesh);
    const bottomY = box.min.y;
    const height = box.max.y - box.min.y;

    console.log(
      `📦 Cat bounding box - Bottom: ${bottomY.toFixed(
        2
      )}, Height: ${height.toFixed(2)}`
    );

    // Position so the bottom sits on Y=0 (the floor)
    petMesh.position.set(position.x, -bottomY, position.z);
    console.log(
      `🐱 Positioned cat at Y=${(-bottomY).toFixed(2)} to sit on floor`
    );

    // Since this is a unified mesh, we need to create separate leg objects
    const legs = this.createAnimatableLegs(petMesh);

    if (legs.frontLeft && legs.frontRight && legs.backLeft && legs.backRight) {
      console.log(`✅ Created 4 animatable legs from unified mesh`);
    } else {
      console.log(`⚠️ Could not separate legs - will use body animation only`);
    }

    this.sceneManager.scene.add(petMesh);

    // Use custom ID if provided (from server), otherwise generate unique ID
    const petId =
      customId ||
      `pet_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Store pet data
    this.pets.set(petId, {
      mesh: petMesh,
      legs: legs,
      target: null,
      speed: 0.08, // Faster movement speed
      wanderTimer: 0,
      wanderInterval: 3,
      walkCycle: 0,
      floorY: -bottomY,
      baseY: -bottomY,
      originalLegRotations: this.storeOriginalRotations(legs),
      stuckCounter: 0, // Track if cat is stuck
      lastPosition: petMesh.position.clone(), // For stuck detection
      ghostMode: false, // Can walk through obstacles when true
      ghostModeTimer: 0, // How long to stay in ghost mode
      // For smooth interpolation on non-host clients
      targetPosition: null, // Server position to lerp towards
      targetRotation: null, // Server rotation to lerp towards
      lerpSpeed: 0.15, // Interpolation speed
    });

    console.log(
      `🐱 Spawned pet at (${position.x}, ${-bottomY}, ${position.z})`
    );

    return petId;
  }

  /**
   * Find the separated leg meshes by name
   */
  createAnimatableLegs(catMesh) {
    const legs = {
      frontLeft: null,
      frontRight: null,
      backLeft: null,
      backRight: null,
    };

    // Find legs by the names you set in Blender
    catMesh.traverse((child) => {
      const name = child.name.toLowerCase();

      if (name.includes("front-left") || name.includes("front_left")) {
        legs.frontLeft = child;
        console.log(`🦵 Found front-left leg: ${child.name}`);
      } else if (name.includes("front-right") || name.includes("front_right")) {
        legs.frontRight = child;
        console.log(`🦵 Found front-right leg: ${child.name}`);
      } else if (name.includes("back-left") || name.includes("back_left")) {
        legs.backLeft = child;
        console.log(`🦵 Found back-left leg: ${child.name}`);
      } else if (name.includes("back-right") || name.includes("back_right")) {
        legs.backRight = child;
        console.log(`🦵 Found back-right leg: ${child.name}`);
      } else if (name.includes("body")) {
        console.log(`🐱 Found body: ${child.name}`);
      }
    });

    return legs;
  }

  /**
   * Store original leg rotations
   */
  storeOriginalRotations(legs) {
    const original = {};
    for (const [key, leg] of Object.entries(legs)) {
      if (leg) {
        original[key] = {
          x: leg.rotation.x,
          y: leg.rotation.y,
          z: leg.rotation.z,
        };
      }
    }
    return original;
  }

  /**
   * Start syncing cat positions to server
   * Only the HOST player (first connected) controls cat movement
   */
  startSync() {
    if (!this.networkManager || !this.networkManager.socket) {
      console.log(`⚠️ Cannot sync - no network connection`);
      return;
    }

    // Wait a bit for socket to be fully connected before requesting host status
    setTimeout(() => {
      if (!this.networkManager || !this.networkManager.socket) {
        console.log(`⚠️ Socket disconnected, cannot sync`);
        return;
      }

      // Request host status from server
      this.networkManager.socket.emit("requestHostStatus");

      this.networkManager.socket.once("hostStatus", (data) => {
        if (!data.isHost) {
          console.log(`👥 Not host - receiving cat positions from host player`);
          this.isHost = false;

          // Set up fallback: If we don't receive updates for 5 seconds, take over as fallback host
          this.lastCatUpdateTime = Date.now();
          this.fallbackCheckInterval = setInterval(() => {
            const timeSinceUpdate = Date.now() - this.lastCatUpdateTime;

            // If no updates for 5 seconds and we have cats, take over control
            if (timeSinceUpdate > 5000 && this.pets.size > 0 && !this.isHost) {
              console.log(
                `👑 No host updates received for 5s - taking over cat control (fallback mode)`
              );
              this.isHost = true;

              // Start syncing at higher frequency for smooth movement
              if (!this.syncInterval) {
                this.syncInterval = setInterval(() => {
                  this.syncToServer();
                }, 100);
              }

              // Clear fallback check
              if (this.fallbackCheckInterval) {
                clearInterval(this.fallbackCheckInterval);
                this.fallbackCheckInterval = null;
              }
            }
          }, 1000); // Check every second

          // Log status to help debug
          setTimeout(() => {
            console.log(
              `🐱 Cat Status (Non-Host): ${this.pets.size} cats loaded, waiting for host updates`
            );
            console.log(
              `   💡 Will take over control if no updates received for 5 seconds`
            );
          }, 2000);
          return;
        }

        console.log(`👑 HOST player - controlling cat movement`);
        this.isHost = true;

        // Log status to help debug
        setTimeout(() => {
          console.log(
            `🐱 Cat Status (Host): ${this.pets.size} cats loaded, AI active`
          );
        }, 2000);

        // Host syncs to server frequently for smooth movement (10 times per second)
        this.syncInterval = setInterval(() => {
          this.syncToServer();
        }, 100);
      });
    }, 500); // Wait 500ms for socket to be fully ready
  }

  /**
   * Send cat positions to server
   */
  syncToServer() {
    if (!this.networkManager || !this.networkManager.socket) {
      console.log(`⚠️ Cannot sync - no network connection`);
      return;
    }

    const catData = [];
    this.pets.forEach((pet, petId) => {
      catData.push({
        id: petId,
        x: pet.mesh.position.x,
        y: pet.mesh.position.y,
        z: pet.mesh.position.z,
        rotation: pet.mesh.rotation.y,
      });
    });

    if (catData.length > 0) {
      this.networkManager.socket.emit("updateCatPositions", catData);
      // Only log very occasionally to avoid spam (now syncing 10x per second)
      if (Math.random() < 0.01) {
        console.log(`📤 Synced ${catData.length} cat positions to server`);
      }
    }
  }

  /**
   * Receive cat positions from server (real-time updates from HOST player)
   */
  receiveCatsUpdate(cats) {
    if (!cats || cats.length === 0) return;

    // Update last update time for fallback detection
    this.lastCatUpdateTime = Date.now();

    // If we have no cats yet, store as pending for initial spawn
    if (this.pets.size === 0) {
      this.pendingCats = cats;
      console.log(`🐱 Stored pending cats for initial spawn`);
      return;
    }

    // If we're the host, ignore server updates (we control movement)
    if (this.isHost) {
      return;
    }

    // Non-host players: Set target positions for smooth interpolation
    cats.forEach((serverCat) => {
      const pet = this.pets.get(serverCat.id);
      if (pet) {
        // Store target position and rotation for smooth lerping
        if (!pet.targetPosition) {
          pet.targetPosition = new THREE.Vector3();
        }
        pet.targetPosition.set(serverCat.x, serverCat.y, serverCat.z);
        pet.targetRotation = serverCat.rotation;
      }
    });
  }

  /**
   * Apply pending cats after model is loaded
   */
  applyPendingCats() {
    if (!this.pendingCats || this.pendingCats.length === 0) {
      console.log(`⚠️ No pending cats to apply`);
      return;
    }

    const modelData = this.petModels.get("cat");
    if (!modelData) {
      console.log(`⚠️ Cat model not loaded yet`);
      return;
    }

    console.log(
      `📍 Applying ${this.pendingCats.length} cat positions from server`
    );

    this.pendingCats.forEach((catData) => {
      console.log(
        `   Cat ${catData.id}: (${catData.x.toFixed(2)}, ${catData.z.toFixed(
          2
        )})`
      );

      // Spawn at the synced position with the server's ID
      this.spawnPet(
        "cat",
        {
          x: catData.x,
          y: catData.y,
          z: catData.z,
        },
        catData.id
      ); // Pass the server ID

      // Set rotation
      const pet = this.pets.get(catData.id);
      if (pet) {
        pet.mesh.rotation.y = catData.rotation;
      }
    });

    console.log(`✅ Applied all cat positions from server`);
    this.pendingCats = null;
  }

  /**
   * Update all pets (movement and leg animation)
   */
  updatePets(delta) {
    this.pets.forEach((pet, petId) => {
      // Only HOST player controls cat movement AI
      let isMoving = false;

      if (this.isHost) {
        isMoving = this.updateWandering(pet, delta);
      } else {
        // Non-host: Smoothly interpolate towards target position from server
        isMoving = this.updateInterpolation(pet, delta);
      }

      // Animate legs if moving and legs exist
      if (isMoving) {
        if (pet.legs && pet.legs.frontLeft) {
          this.animateLegs(pet, delta);
        } else {
          this.animateBody(pet, delta);
        }
      } else {
        // Reset to neutral position when stopped
        pet.mesh.rotation.z = 0;
        pet.mesh.position.y = pet.baseY;
        if (pet.legs && pet.originalLegRotations) {
          this.resetLegs(pet);
        }
      }
    });
  }

  /**
   * Smoothly interpolate cat position for non-host players
   */
  updateInterpolation(pet, delta) {
    // If we have a target position from the server, lerp towards it
    if (pet.targetPosition) {
      const distance = pet.mesh.position.distanceTo(pet.targetPosition);

      // If very close, snap to target
      if (distance < 0.01) {
        pet.mesh.position.copy(pet.targetPosition);
        if (pet.targetRotation !== null) {
          pet.mesh.rotation.y = pet.targetRotation;
        }
        return false; // Not moving anymore
      }

      // Smooth interpolation
      pet.mesh.position.lerp(pet.targetPosition, pet.lerpSpeed);

      // Smooth rotation interpolation
      if (pet.targetRotation !== null) {
        let currentAngle = pet.mesh.rotation.y;
        let targetAngle = pet.targetRotation;

        // Normalize angles to -PI to PI range
        while (currentAngle > Math.PI) currentAngle -= Math.PI * 2;
        while (currentAngle < -Math.PI) currentAngle += Math.PI * 2;
        while (targetAngle > Math.PI) targetAngle -= Math.PI * 2;
        while (targetAngle < -Math.PI) targetAngle += Math.PI * 2;

        let angleDiff = targetAngle - currentAngle;

        // Take shortest rotation path
        if (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
        if (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

        // Smoothly interpolate rotation
        pet.mesh.rotation.y += angleDiff * pet.lerpSpeed;
      }

      return true; // Is moving
    }

    return false; // No target, not moving
  }

  /**
   * Get current host status
   */
  getHostStatus() {
    return {
      isHost: this.isHost,
      petCount: this.pets.size,
    };
  }

  /**
   * Reset legs to original position
   */
  resetLegs(pet) {
    const { legs, originalLegRotations } = pet;
    for (const [key, leg] of Object.entries(legs)) {
      if (leg && originalLegRotations[key]) {
        leg.rotation.x = originalLegRotations[key].x;
        leg.rotation.y = originalLegRotations[key].y;
        leg.rotation.z = originalLegRotations[key].z;
      }
    }
  }

  /**
   * Animate legs with 4-leg walking pattern synced to movement speed
   */
  animateLegs(pet, delta) {
    // Sync walk cycle to actual movement distance for no sliding
    const actualSpeed = pet.speed; // 0.05 units per frame
    pet.walkCycle += actualSpeed * 1; // Very slow for tiny cat

    const { legs } = pet;
    const swingAmount = 0.25; // Very subtle swing

    // Diagonal leg pairs move together (realistic 4-legged gait)
    if (legs.frontLeft) {
      legs.frontLeft.rotation.x = Math.sin(pet.walkCycle) * swingAmount;
    }
    if (legs.frontRight) {
      legs.frontRight.rotation.x =
        Math.sin(pet.walkCycle + Math.PI) * swingAmount;
    }
    if (legs.backLeft) {
      legs.backLeft.rotation.x =
        Math.sin(pet.walkCycle + Math.PI) * swingAmount;
    }
    if (legs.backRight) {
      legs.backRight.rotation.x = Math.sin(pet.walkCycle) * swingAmount;
    }
  }

  /**
   * Update wandering behavior with smooth rotation and ghost mode unstuck logic
   */
  updateWandering(pet, delta) {
    pet.wanderTimer += delta;

    // Handle ghost mode timer
    if (pet.ghostMode) {
      pet.ghostModeTimer -= delta;
      if (pet.ghostModeTimer <= 0) {
        pet.ghostMode = false;
        console.log(`👻 Cat exited ghost mode`);
      }
    }

    // Check if cat is stuck (hasn't moved much)
    const distanceMoved = pet.mesh.position.distanceTo(pet.lastPosition);
    if (distanceMoved < 0.005 && pet.target && !pet.ghostMode) {
      pet.stuckCounter++;

      // If stuck for 120 frames (~2 seconds), enable ghost mode
      if (pet.stuckCounter > 120) {
        console.log(`👻 Cat stuck! Enabling ghost mode to pass through...`);
        pet.ghostMode = true;
        pet.ghostModeTimer = 3; // Stay in ghost mode for 3 seconds
        pet.stuckCounter = 0;
        // Keep the same target, but now can walk through obstacles
      }
    } else {
      pet.stuckCounter = 0; // Reset if moving
    }

    pet.lastPosition.copy(pet.mesh.position);

    // Pick new target periodically
    if (pet.wanderTimer >= pet.wanderInterval || !pet.target) {
      pet.target = this.getRandomWanderTarget(pet.mesh.position, pet.floorY);
      pet.wanderTimer = 0;
      pet.stuckCounter = 0; // Reset stuck counter on new target
    }

    // Move towards target
    if (pet.target) {
      const direction = new THREE.Vector3()
        .subVectors(pet.target, pet.mesh.position)
        .normalize();
      const distance = pet.mesh.position.distanceTo(pet.target);

      // If close enough to target, stop
      if (distance < 0.5) {
        pet.target = null;
        pet.ghostMode = false; // Exit ghost mode when reaching target
        return false; // Not moving
      }

      // Smooth rotation towards movement direction
      const targetAngle = Math.atan2(direction.x, direction.z);
      let currentAngle = pet.mesh.rotation.y;

      // Normalize angles to -PI to PI range
      while (currentAngle > Math.PI) currentAngle -= Math.PI * 2;
      while (currentAngle < -Math.PI) currentAngle += Math.PI * 2;

      let angleDiff = targetAngle - currentAngle;

      // Take shortest rotation path
      if (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
      if (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

      // Smoothly interpolate rotation
      const rotationSpeed = 0.15;
      pet.mesh.rotation.y += angleDiff * rotationSpeed;

      // Check if path is clear before moving (skip check if in ghost mode)
      const nextPos = pet.mesh.position
        .clone()
        .add(direction.multiplyScalar(pet.speed));

      if (pet.ghostMode || this.isPositionWalkable(nextPos)) {
        // Move freely in ghost mode or if path is clear
        pet.mesh.position.add(direction.multiplyScalar(pet.speed));
        return true; // Is moving
      } else {
        // Hit obstacle, pick new target immediately
        pet.target = null;
        pet.wanderTimer = pet.wanderInterval;
      }
    }

    return false; // Not moving
  }

  /**
   * Animate body with bobbing and tilting (for unified mesh models)
   */
  animateBody(pet, delta) {
    // Increase walk cycle
    pet.walkCycle += delta * 10; // Speed of animation

    const bobAmount = 0.05; // How much to bob up and down
    const tiltAmount = 0.1; // How much to tilt side to side

    // Bob up and down
    pet.mesh.position.y =
      pet.baseY + Math.abs(Math.sin(pet.walkCycle)) * bobAmount;

    // Tilt side to side (simulates weight shifting)
    pet.mesh.rotation.z = Math.sin(pet.walkCycle) * tiltAmount;
  }

  /**
   * Get a random wander target that avoids obstacles
   */
  getRandomWanderTarget(currentPos, floorY = 0) {
    const platformSize = this.sceneManager.platformSize || 40;
    const maxDistance = 8; // Increased range for more exploration
    const maxAttempts = 10;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      const distance = 2 + Math.random() * maxDistance; // Min 2, max 10

      let targetX = currentPos.x + Math.cos(angle) * distance;
      let targetZ = currentPos.z + Math.sin(angle) * distance;

      const bound = platformSize / 2 - 2;
      targetX = Math.max(-bound, Math.min(bound, targetX));
      targetZ = Math.max(-bound, Math.min(bound, targetZ));

      const targetPos = new THREE.Vector3(targetX, floorY, targetZ);

      // Check if target position is safe (not on obstacle)
      if (this.isPositionWalkable(targetPos)) {
        return targetPos;
      }
    }

    // If all attempts fail, try moving in a random direction that's likely clear
    const angle = Math.random() * Math.PI * 2;
    const targetX = currentPos.x + Math.cos(angle) * 3;
    const targetZ = currentPos.z + Math.sin(angle) * 3;

    return new THREE.Vector3(targetX, floorY, targetZ);
  }

  /**
   * Check if a position is walkable
   */
  isPositionWalkable(position) {
    const platformSize = this.sceneManager.platformSize || 40;
    const bound = platformSize / 2 - 1;

    if (Math.abs(position.x) > bound || Math.abs(position.z) > bound) {
      return false;
    }

    // Check against obstacles
    const obstacles = this.sceneManager.obstacles || [];
    for (const obstacle of obstacles) {
      if (obstacle.userData.isPassthrough) continue;

      const obstaclePos = obstacle.position;
      const distance = Math.sqrt(
        Math.pow(position.x - obstaclePos.x, 2) +
          Math.pow(position.z - obstaclePos.z, 2)
      );

      const minDistance =
        (obstacle.userData.width || 1) / 2 +
        (obstacle.userData.depth || 1) / 2 +
        0.5;

      if (distance < minDistance) {
        return false;
      }
    }

    return true;
  }

  /**
   * Remove a pet
   */
  removePet(petId) {
    const pet = this.pets.get(petId);
    if (pet) {
      this.sceneManager.scene.remove(pet.mesh);
      this.pets.delete(petId);
      console.log(`🐱 Removed pet ${petId}`);
    }
  }

  /**
   * Cleanup all pets
   */
  cleanup() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }

    if (this.fallbackCheckInterval) {
      clearInterval(this.fallbackCheckInterval);
      this.fallbackCheckInterval = null;
    }

    this.pets.forEach((pet) => {
      this.sceneManager.scene.remove(pet.mesh);
    });
    this.pets.clear();
  }
}
