import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
import { GLTFLoader } from "https://unpkg.com/three@0.160.0/examples/jsm/loaders/GLTFLoader.js";
import { io } from "https://cdn.socket.io/4.6.1/socket.io.esm.min.js";

/**
 * SCENE SETUP - Orthographic Camera for Isometric "Overcooked" Look
 */
class Game {
  constructor() {
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.socket = null;
    this.playerId = null;

    // Game objects
    this.players = new Map();
    this.obstacles = [];
    this.floor = null;

    // Model loading
    this.gltfLoader = new GLTFLoader();
    this.characterModels = [];
    this.isModelsLoaded = false;
    this.foodModels = new Map(); // Cache for loaded food models
    this.foodItems = new Map(); // Active food items in the scene

    // Animation
    this.clock = new THREE.Clock();
    this.mixers = new Map(); // Animation mixers for each player

    // Input state
    this.inputState = { w: false, s: false, a: false, d: false };
    this.keyMap = {
      KeyW: "w",
      KeyS: "s",
      KeyA: "a",
      KeyD: "d",
    };

    this.init();
  }

  init() {
    this.setupScene();
    this.setupLights();
    this.createFloor();
    this.loadCharacterModels().then(() => {
      this.isModelsLoaded = true;
      this.setupSocket();
      console.log("✅ Character models loaded");

      // Spawn some demo food items on counters
      this.spawnDemoFoodItems();
    });
    this.setupInput();
    this.animate();

    // Handle window resize
    window.addEventListener("resize", () => this.handleResize());
  }

  /**
   * Setup Three.js Scene with Orthographic Camera
   * This creates the isometric/"birds-eye" view similar to Overcooked
   */
  setupScene() {
    // Create scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x87ceeb); // Sky blue

    // Orthographic Camera Setup for Isometric View
    const aspect = window.innerWidth / window.innerHeight;
    const frustumSize = 20; // Controls zoom level

    this.camera = new THREE.OrthographicCamera(
      (frustumSize * aspect) / -2, // left
      (frustumSize * aspect) / 2, // right
      frustumSize / 2, // top
      frustumSize / -2, // bottom
      0.1, // near
      1000 // far
    );

    // Position camera for isometric angle (45° from top-down, looking down at ~30-45°)
    this.camera.position.set(15, 15, 15);
    this.camera.lookAt(0, 0, 0);

    // Create renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    document
      .getElementById("game-container")
      .appendChild(this.renderer.domElement);
  }

  setupLights() {
    // Ambient light for overall illumination
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambientLight);

    // Directional light for shadows (sun-like)
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(10, 20, 10);
    directionalLight.castShadow = true;

    // Configure shadow properties
    directionalLight.shadow.camera.left = -30;
    directionalLight.shadow.camera.right = 30;
    directionalLight.shadow.camera.top = 30;
    directionalLight.shadow.camera.bottom = -30;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;

    this.scene.add(directionalLight);
  }

  /**
   * Create the game floor/ground plane
   */
  createFloor() {
    const floorGeometry = new THREE.PlaneGeometry(40, 40);
    const floorMaterial = new THREE.MeshStandardMaterial({
      color: 0x90ee90,
      roughness: 0.8,
      metalness: 0.2,
    });

    this.floor = new THREE.Mesh(floorGeometry, floorMaterial);
    this.floor.rotation.x = -Math.PI / 2; // Rotate to be horizontal
    this.floor.receiveShadow = true;
    this.scene.add(this.floor);

    // Add grid helper for visual reference
    const gridHelper = new THREE.GridHelper(40, 40, 0x444444, 0x888888);
    this.scene.add(gridHelper);
  }

  /**
   * Load character models from GLB files (character-a.glb to character-r.glb)
   */
  async loadCharacterModels() {
    // Generate array of character names from 'a' to 'r'
    const characters = Array.from({ length: 18 }, (_, i) =>
      String.fromCharCode(97 + i)
    ); // 97 = 'a' in ASCII

    const loadPromises = characters.map((letter) => {
      return new Promise((resolve) => {
        this.gltfLoader.load(
          `/models/glb/character-${letter}.glb`,
          (gltf) => {
            // Enable shadows for all meshes
            gltf.scene.traverse((child) => {
              if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
              }
            });
            // Store both scene and animations
            resolve({ scene: gltf.scene, animations: gltf.animations });
          },
          undefined,
          (error) => {
            console.warn(`Failed to load character-${letter}.glb:`, error);
            resolve(null); // Don't reject, just skip this model
          }
        );
      });
    });

    const loadedModels = await Promise.all(loadPromises);
    this.characterModels = loadedModels.filter((model) => model !== null);

    // Fallback: if no models loaded, we'll use primitives
    if (this.characterModels.length === 0) {
      console.warn("⚠️ No GLB models loaded, will use primitive shapes");
    } else {
      console.log(`✅ Loaded ${this.characterModels.length} character models`);
    }
  }

  /**
   * Create a player with GLB model or fallback to primitives
   */
  createPlayer(playerData) {
    const group = new THREE.Group();

    // Use GLB model if available, otherwise fallback to primitives
    if (this.characterModels.length > 0) {
      // Deterministically select a character model based on player ID
      const modelIndex =
        Math.abs(
          playerData.id.split("").reduce((a, b) => a + b.charCodeAt(0), 0)
        ) % this.characterModels.length;
      const modelData = this.characterModels[modelIndex];
      const characterModel = modelData.scene.clone();

      // Keep original textures but fix transparency issues
      characterModel.traverse((child) => {
        if (child.isMesh) {
          // Clone material to avoid modifying the original
          child.material = child.material.clone();

          // Fix transparency issues (keep original colors/textures)
          child.material.transparent = false;
          child.material.opacity = 1.0;
          child.material.alphaTest = 0;
          child.material.depthWrite = true;
          child.material.side = THREE.FrontSide;

          // Force material update
          child.material.needsUpdate = true;
        }
      });

      // Scale and position the model (Kenney models need scaling)
      characterModel.scale.set(1.2, 1.2, 1.2); // Increased from 0.8 to make characters taller
      group.add(characterModel);

      // Setup animation mixer for procedural animation
      const mixer = new THREE.AnimationMixer(characterModel);
      this.mixers.set(playerData.id, {
        mixer: mixer,
        model: characterModel,
        isMoving: false,
      });

      // Create procedural walking animation
      this.createWalkingAnimation(characterModel, mixer);
    } else {
      // Fallback: Use primitive shapes (original code)
      const bodyGeometry = new THREE.CylinderGeometry(0.4, 0.4, 1.5, 8);
      const bodyMaterial = new THREE.MeshStandardMaterial({
        color: playerData.color,
        roughness: 0.7,
        metalness: 0.3,
      });
      const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
      body.castShadow = true;
      body.position.y = 1;
      group.add(body);

      const headGeometry = new THREE.SphereGeometry(0.35, 8, 6);
      const headMaterial = new THREE.MeshStandardMaterial({
        color: playerData.color,
        roughness: 0.6,
        metalness: 0.2,
      });
      const head = new THREE.Mesh(headGeometry, headMaterial);
      head.castShadow = true;
      head.position.y = 2;
      group.add(head);

      const noseGeometry = new THREE.ConeGeometry(0.15, 0.3, 6);
      const noseMaterial = new THREE.MeshStandardMaterial({ color: 0x333333 });
      const nose = new THREE.Mesh(noseGeometry, noseMaterial);
      nose.rotation.x = Math.PI / 2;
      nose.position.set(0, 2, 0.4);
      nose.castShadow = true;
      group.add(nose);
    }

    // Position the player
    group.position.set(playerData.x, playerData.y, playerData.z);
    group.rotation.y = playerData.rotation || 0;

    this.scene.add(group);
    this.players.set(playerData.id, {
      mesh: group,
      targetPosition: new THREE.Vector3(
        playerData.x,
        playerData.y,
        playerData.z
      ),
      targetRotation: playerData.rotation || 0,
      color: playerData.color,
    });

    // Add name tag for current player
    if (playerData.id === this.playerId) {
      this.createNameTag(group, "You", 0x00ff00);
    }
  }

  /**
   * Create procedural walking animation for character
   */
  createWalkingAnimation(characterModel, mixer) {
    // Find all limb meshes (Kenney models use mesh groups, not bones)
    let leftLeg = null;
    let rightLeg = null;
    let leftArm = null;
    let rightArm = null;
    let body = null;

    // Debug: log all objects in the model
    const allObjects = [];
    characterModel.traverse((child) => {
      if (child.name) {
        allObjects.push(child.name);
      }

      const name = child.name.toLowerCase();

      // Try to find limbs by name
      if (name.includes("leg") || name.includes("lower")) {
        if (
          name.includes("left") ||
          name.includes("_l") ||
          name.includes(".l")
        ) {
          leftLeg = child;
        } else if (
          name.includes("right") ||
          name.includes("_r") ||
          name.includes(".r")
        ) {
          rightLeg = child;
        }
      }

      if (name.includes("arm") || name.includes("upper")) {
        if (
          name.includes("left") ||
          name.includes("_l") ||
          name.includes(".l")
        ) {
          leftArm = child;
        } else if (
          name.includes("right") ||
          name.includes("_r") ||
          name.includes(".r")
        ) {
          rightArm = child;
        }
      }

      if (name.includes("body") || name.includes("torso")) {
        body = child;
      }
    });

    console.log("Found objects in model:", allObjects);
    console.log("Found limbs:", {
      leftLeg: leftLeg?.name,
      rightLeg: rightLeg?.name,
      leftArm: leftArm?.name,
      rightArm: rightArm?.name,
    });

    // Store limb references for animation
    mixer.userData = {
      leftLeg,
      rightLeg,
      leftArm,
      rightArm,
      body,
      walkCycle: 0,
      characterModel, // Store reference to whole model
    };
  }

  /**
   * Update walking animation based on movement
   */
  updateWalkingAnimation(playerId, isMoving) {
    const mixerData = this.mixers.get(playerId);
    if (!mixerData) return;

    const { mixer } = mixerData;
    const limbs = mixer.userData;

    // Update walk cycle
    if (isMoving) {
      limbs.walkCycle += 0.15;
      mixerData.isMoving = true;
    } else {
      // Gradually return to idle pose
      limbs.walkCycle *= 0.9;
      if (Math.abs(limbs.walkCycle) < 0.01) {
        limbs.walkCycle = 0;
        mixerData.isMoving = false;
      }
    }

    // Apply walking animation
    const legSwing = Math.sin(limbs.walkCycle) * 0.4;
    const armSwing = Math.sin(limbs.walkCycle) * 0.3;
    const bodyBob = Math.abs(Math.sin(limbs.walkCycle * 2)) * 0.05;

    // Animate limbs if found
    if (limbs.leftLeg) {
      limbs.leftLeg.rotation.x = legSwing;
    }
    if (limbs.rightLeg) {
      limbs.rightLeg.rotation.x = -legSwing;
    }
    if (limbs.leftArm) {
      limbs.leftArm.rotation.x = -armSwing;
    }
    if (limbs.rightArm) {
      limbs.rightArm.rotation.x = armSwing;
    }

    // Add body bob for walking effect
    if (limbs.body) {
      limbs.body.position.y = bodyBob;
    }

    // Fallback: Animate the whole character model if no limbs found
    if (!limbs.leftLeg && !limbs.rightLeg && limbs.characterModel) {
      // Simple bobbing animation for the entire model
      const bob = Math.sin(limbs.walkCycle * 2) * 0.1;
      const tilt = Math.sin(limbs.walkCycle) * 0.05;
      limbs.characterModel.position.y = bob;
      limbs.characterModel.rotation.z = tilt;
    }
  }

  /**
   * Create obstacle/counter (static cube)
   */
  createObstacle(obstacleData) {
    const geometry = new THREE.BoxGeometry(
      obstacleData.width,
      obstacleData.height,
      obstacleData.depth
    );
    const material = new THREE.MeshStandardMaterial({
      color: 0x8b4513,
      roughness: 0.8,
      metalness: 0.2,
    });

    const obstacle = new THREE.Mesh(geometry, material);
    obstacle.position.set(obstacleData.x, obstacleData.y, obstacleData.z);
    obstacle.castShadow = true;
    obstacle.receiveShadow = true;

    this.scene.add(obstacle);
    this.obstacles.push(obstacle);
  }

  /**
   * Load a food model from GLB
   */
  async loadFoodModel(foodName) {
    // Check cache first
    if (this.foodModels.has(foodName)) {
      return this.foodModels.get(foodName).clone();
    }

    return new Promise((resolve, reject) => {
      this.gltfLoader.load(
        `/food/glb/${foodName}.glb`,
        (gltf) => {
          // Enable shadows
          gltf.scene.traverse((child) => {
            if (child.isMesh) {
              child.castShadow = true;
              child.receiveShadow = true;

              // Fix transparency issues
              if (child.material) {
                child.material.transparent = false;
                child.material.opacity = 1.0;
                child.material.depthWrite = true;
              }
            }
          });

          // Cache the model
          this.foodModels.set(foodName, gltf.scene);
          resolve(gltf.scene.clone());
        },
        undefined,
        (error) => {
          console.warn(`Failed to load food model ${foodName}:`, error);
          reject(error);
        }
      );
    });
  }

  /**
   * Spawn a food item in the scene
   */
  async spawnFoodItem(foodName, x, y, z) {
    try {
      const foodModel = await this.loadFoodModel(foodName);

      // Scale the food model appropriately
      foodModel.scale.set(0.3, 0.3, 0.3);
      foodModel.position.set(x, y, z);

      this.scene.add(foodModel);

      // Store reference
      const itemId = `food_${Date.now()}_${Math.random()}`;
      this.foodItems.set(itemId, {
        model: foodModel,
        name: foodName,
        position: { x, y, z },
      });

      console.log(`✅ Spawned ${foodName} at (${x}, ${y}, ${z})`);
      return itemId;
    } catch (error) {
      console.error(`Failed to spawn ${foodName}:`, error);
      return null;
    }
  }

  /**
   * Remove a food item from the scene
   */
  removeFoodItem(itemId) {
    const item = this.foodItems.get(itemId);
    if (item) {
      this.scene.remove(item.model);
      this.foodItems.delete(itemId);
    }
  }

  /**
   * Spawn demo food items on counters
   */
  spawnDemoFoodItems() {
    // Spawn various food items on the counters
    const demoFoods = [
      { name: "tomato", x: 5, y: 1.5, z: 0 },
      { name: "cheese", x: 5.5, y: 1.5, z: 1 },
      { name: "bread", x: 4.5, y: 1.5, z: -1 },
      { name: "burger", x: -5, y: 1.5, z: 5 },
      { name: "pizza", x: -4, y: 1.5, z: 5 },
      { name: "carrot", x: 0, y: 1.5, z: -8 },
      { name: "apple", x: 1, y: 1.5, z: -8 },
      { name: "banana", x: -1, y: 1.5, z: -8 },
    ];

    demoFoods.forEach((food) => {
      this.spawnFoodItem(food.name, food.x, food.y, food.z);
    });
  }

  /**
   * Create name tag above player
   */
  createNameTag(parentGroup, text, color) {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    canvas.width = 256;
    canvas.height = 64;

    context.fillStyle = `#${color.toString(16).padStart(6, "0")}`;
    context.font = "Bold 40px Arial";
    context.textAlign = "center";
    context.fillText(text, 128, 45);

    const texture = new THREE.CanvasTexture(canvas);
    const spriteMaterial = new THREE.SpriteMaterial({ map: texture });
    const sprite = new THREE.Sprite(spriteMaterial);
    sprite.position.y = 3;
    sprite.scale.set(2, 0.5, 1);

    parentGroup.add(sprite);
  }

  /**
   * Setup Socket.io connection and event handlers
   */
  setupSocket() {
    this.socket = io();

    // Initialize game state
    this.socket.on("init", (data) => {
      console.log("🎮 Connected to game server");
      this.playerId = data.playerId;

      // Create all existing players
      data.players.forEach((player) => {
        this.createPlayer(player);
      });

      // Create all obstacles
      data.obstacles.forEach((obstacle) => {
        this.createObstacle(obstacle);
      });
    });

    // Handle new player joining
    this.socket.on("playerJoined", (playerData) => {
      console.log("👋 Player joined:", playerData.id);
      this.createPlayer(playerData);
    });

    // Handle player leaving
    this.socket.on("playerLeft", (playerId) => {
      console.log("👋 Player left:", playerId);
      const player = this.players.get(playerId);
      if (player) {
        this.scene.remove(player.mesh);
        this.players.delete(playerId);
      }
      // Clean up mixer
      if (this.mixers.has(playerId)) {
        this.mixers.delete(playerId);
      }
    });

    // Handle game state updates from server
    this.socket.on("gameState", (state) => {
      state.players.forEach((serverPlayer) => {
        const localPlayer = this.players.get(serverPlayer.id);
        if (localPlayer) {
          // Check if player is moving (position changed significantly)
          const posChanged =
            Math.abs(serverPlayer.x - localPlayer.targetPosition.x) > 0.01 ||
            Math.abs(serverPlayer.z - localPlayer.targetPosition.z) > 0.01;

          // Update target position for smooth interpolation
          localPlayer.targetPosition.set(
            serverPlayer.x,
            serverPlayer.y,
            serverPlayer.z
          );
          localPlayer.targetRotation = serverPlayer.rotation;
          localPlayer.isMoving = posChanged;
        }
      });
    });
  }

  /**
   * INPUT HANDLING - WASD to 3D Vector Movement
   * Translates key presses to movement in X and Z axes (Y is height)
   */
  setupInput() {
    // Keydown event
    window.addEventListener("keydown", (e) => {
      const key = this.keyMap[e.code];
      if (key && !this.inputState[key]) {
        this.inputState[key] = true;
        this.sendInput();
      }
    });

    // Keyup event
    window.addEventListener("keyup", (e) => {
      const key = this.keyMap[e.code];
      if (key && this.inputState[key]) {
        this.inputState[key] = false;
        this.sendInput();
      }
    });
  }

  /**
   * Send input state to server
   * Server processes input and updates authoritative position
   */
  sendInput() {
    if (this.socket) {
      this.socket.emit("input", this.inputState);
    }
  }

  /**
   * Handle window resize
   */
  handleResize() {
    const aspect = window.innerWidth / window.innerHeight;
    const frustumSize = 20;

    this.camera.left = (frustumSize * aspect) / -2;
    this.camera.right = (frustumSize * aspect) / 2;
    this.camera.top = frustumSize / 2;
    this.camera.bottom = frustumSize / -2;
    this.camera.updateProjectionMatrix();

    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  /**
   * Animation loop with linear interpolation for smooth movement
   */
  animate() {
    requestAnimationFrame(() => this.animate());

    const delta = this.clock.getDelta();

    // Interpolate player positions for smooth movement
    const lerpFactor = 0.3; // Smoothing factor (0-1)

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
      this.updateWalkingAnimation(playerId, player.isMoving || false);
    });

    // Update all animation mixers
    this.mixers.forEach((mixerData) => {
      if (mixerData.mixer) {
        mixerData.mixer.update(delta);
      }
    });

    this.renderer.render(this.scene, this.camera);
  }
}

// Initialize game when DOM is ready
window.addEventListener("DOMContentLoaded", () => {
  new Game();
});
