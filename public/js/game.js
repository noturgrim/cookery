import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
import { GLTFLoader } from "https://unpkg.com/three@0.160.0/examples/jsm/loaders/GLTFLoader.js";
import { io } from "https://cdn.socket.io/4.6.1/socket.io.esm.min.js";
import { SoundManager } from "./soundManager.js";
import { AnimationController } from "./animationController.js";
import { CharacterManager } from "./characterManager.js";

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
    this.characterManager = new CharacterManager();
    this.characterModels = []; // For backwards compatibility
    this.isModelsLoaded = false;
    this.foodModels = new Map(); // Cache for loaded food models
    this.foodItems = new Map(); // Active food items in the scene

    // Animation
    this.clock = new THREE.Clock();
    this.animationController = new AnimationController();
    this.mixers = new Map(); // For backwards compatibility

    // Input state
    this.inputState = { w: false, s: false, a: false, d: false };
    this.keyMap = {
      KeyW: "w",
      KeyS: "s",
      KeyA: "a",
      KeyD: "d",
    };

    // Click to move
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.targetPosition = null; // Click destination
    this.pathLine = null; // Visual path trace

    // Obstacle editing
    this.editMode = false; // Toggle with 'E' key
    this.selectedObstacle = null;
    this.isDraggingObstacle = false;
    this.dragOffset = new THREE.Vector3();

    // Player customization
    this.playerName = "";
    this.playerSkin = 0; // Index of character model
    this.availableSkins = Array.from({ length: 18 }, (_, i) => ({
      id: i,
      name: `Chef ${String.fromCharCode(65 + i)}`, // A, B, C, ..., R
      char: `character-${String.fromCharCode(97 + i)}`, // character-a, character-b, ..., character-r
    }));

    // Game state flags
    this.isGameRunning = false;

    // Sound manager
    this.soundManager = new SoundManager();
    this.footstepCounter = 0; // Track which foot is stepping

    // Show audio unlock notice if needed
    this.setupAudioUnlockNotice();

    // Emote/Voice wheel
    this.emoteWheelActive = false;
    this.selectedEmote = null;

    this.initWelcomeScreen();
  }

  /**
   * Setup audio unlock notice (browser security requirement)
   */
  setupAudioUnlockNotice() {
    const notice = document.getElementById("audio-unlock-notice");

    // Show notice after 2 seconds if audio isn't unlocked
    setTimeout(() => {
      if (!this.soundManager.audioUnlocked && notice) {
        notice.style.display = "block";
      }
    }, 2000);

    // Hide notice when audio is unlocked
    const hideNotice = () => {
      if (this.soundManager.audioUnlocked && notice) {
        notice.style.transition = "opacity 0.3s";
        notice.style.opacity = "0";
        setTimeout(() => {
          notice.style.display = "none";
        }, 300);
      }
    };

    // Check periodically
    const checkInterval = setInterval(() => {
      if (this.soundManager.audioUnlocked) {
        hideNotice();
        clearInterval(checkInterval);
      }
    }, 500);
  }

  /**
   * Initialize welcome screen and settings
   */
  initWelcomeScreen() {
    // Check if player data exists in localStorage
    const savedName = localStorage.getItem("supercooked_playerName");
    const savedSkin = localStorage.getItem("supercooked_playerSkin");

    if (savedName && savedSkin !== null) {
      // Auto-start with saved data
      this.playerName = savedName;
      this.playerSkin = parseInt(savedSkin);
      document.getElementById("welcome-modal").classList.add("hidden");

      // Initialize game immediately
      this.init();
    } else {
      // Initialize game first to load models for preview
      this.initForPreview();

      // Show welcome modal after models load
      this.setupWelcomeModal();
    }

    // Setup settings button
    document.getElementById("settings-btn").addEventListener("click", () => {
      this.showSettings();
    });
  }

  /**
   * Initialize just enough to show model previews (without socket)
   */
  initForPreview() {
    if (this.scene) return;

    this.setupScene();
    this.setupLights();
    this.createFloor();

    // Start rendering loop so we can see the scene
    this.animate();

    // Load models for preview
    this.loadCharacterModels();

    // Handle window resize
    window.addEventListener("resize", () => this.handleResize());

    // Don't call setupSocket or setupInput yet
  }

  /**
   * Setup welcome modal
   */
  setupWelcomeModal() {
    const skinSelector = document.getElementById("skin-selector");

    // Show loading state
    skinSelector.innerHTML =
      '<div style="color: white; padding: 20px; text-align: center;">Loading characters...</div>';

    // Wait for models to load, then generate previews
    const checkModelsLoaded = setInterval(() => {
      if (this.characterModels.length > 0) {
        clearInterval(checkModelsLoaded);
        skinSelector.innerHTML = ""; // Clear loading message

        // Generate skin options with 3D model previews
        this.availableSkins.forEach((skin) => {
          const option = document.createElement("div");
          option.className = "skin-option";
          option.dataset.skinId = skin.id;
          option.dataset.name = skin.name;

          // Create a mini canvas for each character preview
          const canvas = document.createElement("canvas");
          canvas.width = 200;
          canvas.height = 200;
          option.appendChild(canvas);

          // Render the character model to this canvas
          this.renderCharacterPreview(canvas, skin.id);

          if (skin.id === 0) {
            option.classList.add("selected");
            this.playerSkin = 0;
          }

          option.addEventListener("click", () => {
            document.querySelectorAll(".skin-option").forEach((o) => {
              o.classList.remove("selected");
            });
            option.classList.add("selected");
            this.playerSkin = skin.id;
          });

          skinSelector.appendChild(option);
        });
      }
    }, 100);

    // Handle start button
    document.getElementById("start-game-btn").addEventListener("click", () => {
      const nameInput = document.getElementById("player-name");
      const name = nameInput.value.trim();

      if (name.length < 2) {
        nameInput.style.border = "2px solid red";
        nameInput.placeholder = "Name must be at least 2 characters!";
        return;
      }

      this.playerName = name;

      // Save to localStorage
      localStorage.setItem("supercooked_playerName", this.playerName);
      localStorage.setItem("supercooked_playerSkin", this.playerSkin);

      // Hide modal
      document.getElementById("welcome-modal").classList.add("hidden");

      console.log(
        "🎮 Starting game with:",
        this.playerName,
        "Skin:",
        this.playerSkin
      );
      console.log(
        "Scene ready:",
        !!this.scene,
        "Renderer ready:",
        !!this.renderer
      );

      // Now fully initialize the game if not already done
      if (!this.socket) {
        // First time - complete initialization
        console.log("🔌 Initializing socket and input...");
        this.completeInitialization();
      } else {
        // Settings changed - update server
        console.log("♻️ Updating player customization...");
        this.socket.emit("playerCustomization", {
          name: this.playerName,
          skinIndex: this.playerSkin,
        });
      }
    });

    // Allow Enter key to submit
    document.getElementById("player-name").addEventListener("keypress", (e) => {
      if (e.key === "Enter") {
        document.getElementById("start-game-btn").click();
      }
    });
  }

  /**
   * Render a character model preview to a canvas
   */
  renderCharacterPreview(canvas, modelIndex) {
    if (modelIndex >= this.characterModels.length) {
      console.warn(
        `Model index ${modelIndex} out of range. Only ${this.characterModels.length} models loaded.`
      );
      return;
    }

    // Create a mini scene for preview
    const previewScene = new THREE.Scene();
    previewScene.background = new THREE.Color(0x2a2a3a);

    // Mini camera - wider FOV and further back to fit whole character
    const previewCamera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    previewCamera.position.set(0, 1.2, 3.5);
    previewCamera.lookAt(0, 0.8, 0);

    // Lighting for preview
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    previewScene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.6);
    directionalLight.position.set(1, 2, 2);
    previewScene.add(directionalLight);

    // Clone the character model
    const modelData = this.characterModels[modelIndex];
    if (!modelData || !modelData.scene) {
      console.warn(`Character model ${modelIndex} not loaded properly`);
      return;
    }

    const characterModel = modelData.scene.clone();
    characterModel.scale.set(1.2, 1.2, 1.2);
    characterModel.rotation.y = Math.PI / 6; // Slight angle
    characterModel.position.y = 0; // Center vertically
    previewScene.add(characterModel);

    // Create temporary offscreen canvas to avoid context limit
    const offscreenCanvas = document.createElement("canvas");
    offscreenCanvas.width = 200;
    offscreenCanvas.height = 200;

    // Create mini renderer on offscreen canvas
    const previewRenderer = new THREE.WebGLRenderer({
      canvas: offscreenCanvas,
      antialias: false,
      alpha: true,
      preserveDrawingBuffer: true,
    });
    previewRenderer.setSize(200, 200);

    // Render once
    previewRenderer.render(previewScene, previewCamera);

    // Copy to display canvas using 2D context
    const ctx = canvas.getContext("2d");
    ctx.drawImage(offscreenCanvas, 0, 0);

    // CRITICAL: Dispose renderer immediately to free WebGL context
    previewRenderer.dispose();
    previewRenderer.forceContextLoss();
    previewRenderer.domElement = null;
  }

  /**
   * Show settings to change name/skin
   */
  showSettings() {
    const modal = document.getElementById("welcome-modal");
    modal.classList.remove("hidden");

    // Pre-fill current values
    document.getElementById("player-name").value = this.playerName;

    // Re-generate skin selector if needed
    const skinSelector = document.getElementById("skin-selector");
    if (
      skinSelector.children.length === 0 ||
      !skinSelector.querySelector(".skin-option canvas")
    ) {
      // Need to regenerate with models
      this.setupWelcomeModal();
    } else {
      // Update selected skin
      document.querySelectorAll(".skin-option").forEach((option) => {
        option.classList.remove("selected");
        if (parseInt(option.dataset.skinId) === this.playerSkin) {
          option.classList.add("selected");
        }
      });
    }
  }

  init() {
    if (this.scene) return; // Already initialized

    this.setupScene();
    this.setupLights();
    this.createFloor();

    // Start animation loop
    this.animate();

    // Handle window resize
    window.addEventListener("resize", () => this.handleResize());

    this.loadCharacterModels().then(() => {
      this.isModelsLoaded = true;
      this.completeInitialization();
    });
  }

  /**
   * Complete the initialization after models load and user selects character
   */
  completeInitialization() {
    if (this.isGameRunning) {
      console.log("⚠️ Game already running");
      return;
    }

    console.log("🚀 Complete initialization starting...");

    this.setupSocket();
    this.setupInput();

    // If animate loop isn't running yet, start it
    if (!this.renderer) {
      console.log("🎬 Starting renderer...");
      this.animate();
      window.addEventListener("resize", () => this.handleResize());
    }

    this.isGameRunning = true;

    console.log("✅ Game fully started!");
    console.log("   - Scene:", !!this.scene);
    console.log("   - Renderer:", !!this.renderer);
    console.log("   - Camera:", !!this.camera);
    console.log("   - Socket:", !!this.socket);

    // Load sound effects
    this.loadSoundEffects();

    // Spawn some demo food items on counters
    this.spawnDemoFoodItems();
  }

  /**
   * Load all sound effects
   */
  async loadSoundEffects() {
    console.log("🔊 Loading sound effects...");

    // Helper function to try loading sound with multiple formats
    const tryLoadSound = async (name, basePath) => {
      const formats = [".m4a", ".mp3", ".ogg", ".wav"];

      for (const format of formats) {
        const success = await this.soundManager.loadSound(
          name,
          basePath + format
        );
        if (success) {
          console.log(`✅ Loaded ${name} as ${format}`);
          return true;
        }
      }

      console.warn(`⚠️ Could not load ${name} in any format`);
      return false;
    };

    // Load footstep sound (supports multiple formats)
    await tryLoadSound("footstep", "/sounds/step");

    // Load UI sounds (optional)
    await tryLoadSound("click", "/sounds/click");

    // Load voice/emote sounds (supports mp3, m4a, ogg, wav)
    await tryLoadSound("hello", "/sounds/voices/hello");
    await tryLoadSound("help", "/sounds/voices/help");
    await tryLoadSound("yes", "/sounds/voices/yes");
    await tryLoadSound("no", "/sounds/voices/no");
    await tryLoadSound("thanks", "/sounds/voices/thanks");
    await tryLoadSound("hurry", "/sounds/voices/hurry");
    await tryLoadSound("nice", "/sounds/voices/nice");
    await tryLoadSound("oops", "/sounds/voices/oops");

    console.log("🔊 Sound effects loaded!");
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

    // Create renderer with performance optimizations
    this.renderer = new THREE.WebGLRenderer({
      antialias: false, // Disable for performance
      powerPreference: "high-performance",
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    // Limit pixel ratio for performance on high-DPI displays
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.BasicShadowMap; // Faster shadow type

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

    // Configure shadow properties (optimized)
    directionalLight.shadow.camera.left = -30;
    directionalLight.shadow.camera.right = 30;
    directionalLight.shadow.camera.top = 30;
    directionalLight.shadow.camera.bottom = -30;
    directionalLight.shadow.mapSize.width = 1024; // Reduced from 2048
    directionalLight.shadow.mapSize.height = 1024;

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

    // Add grid helper for visual reference (optimized divisions)
    const gridHelper = new THREE.GridHelper(40, 20, 0x444444, 0x888888); // Reduced from 40 to 20 divisions
    this.scene.add(gridHelper);
  }

  /**
   * Load character models from GLB files (character-a.glb to character-r.glb)
   */
  async loadCharacterModels() {
    const loadedModels = await this.characterManager.loadCharacterModels();
    this.characterModels = loadedModels; // Keep for backwards compatibility
    this.isModelsLoaded = this.characterManager.areModelsLoaded();
    return loadedModels;
  }

  /**
   * Create a player with GLB model or fallback to primitives
   */
  createPlayer(playerData) {
    // Check if player already exists
    if (this.players.has(playerData.id)) {
      console.log("⚠️ Player already exists, removing old one:", playerData.id);
      const existingPlayer = this.players.get(playerData.id);
      if (existingPlayer.mesh) {
        this.scene.remove(existingPlayer.mesh);
      }
      this.players.delete(playerData.id);
      this.animationController.removePlayer(playerData.id);
    }

    // Create character model using CharacterManager
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

    // Add name tag for all players
    const isCurrentPlayer = playerData.id === this.playerId;
    const nameColor = isCurrentPlayer ? 0x00ff00 : 0xffffff;
    const displayName = playerData.name || (isCurrentPlayer ? "You" : "Player");
    this.createNameTag(group, displayName, nameColor);
  }

  /**
   * @deprecated - Now handled by AnimationController
   * Kept for backwards compatibility
   */
  createWalkingAnimation(characterModel, mixer) {
    // This method is now handled by AnimationController.initializeAnimation
    console.warn(
      "createWalkingAnimation is deprecated, use AnimationController instead"
    );
  }

  /**
   * Update walking animation based on movement
   */
  updateWalkingAnimation(playerId, isMoving) {
    // Use AnimationController to update animation
    const footstepEvent = this.animationController.updateAnimation(
      playerId,
      isMoving
    );

    // Handle footstep sound if a step occurred
    if (footstepEvent) {
      const isOwnPlayer = playerId === this.playerId;
      let distance = 0;

      if (!isOwnPlayer) {
        // Calculate 3D distance between this player and current player
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

      // Play footstep sound synced with leg contact (with spatial audio)
      this.soundManager.playFootstep(
        footstepEvent.footIndex, // 0 = right, 1 = left
        distance,
        isOwnPlayer
      );
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

    // Store obstacle data for editing
    obstacle.userData = {
      id: obstacleData.id,
      width: obstacleData.width,
      height: obstacleData.height,
      depth: obstacleData.depth,
    };

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

              // Fix transparency issues and optimize
              if (child.material) {
                child.material.transparent = false;
                child.material.opacity = 1.0;
                child.material.depthWrite = true;
                child.material.flatShading = true; // Better performance
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

    // Clear canvas with transparent background
    context.clearRect(0, 0, canvas.width, canvas.height);

    // Add semi-transparent background for better visibility
    // context.fillStyle = "rgba(0, 0, 0, 0.5)";
    // context.fillRect(0, 0, canvas.width, canvas.height);

    // Draw text
    context.fillStyle = `#${color.toString(16).padStart(6, "0")}`;
    context.font = "Bold 40px Arial";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(text, 128, 32);

    const texture = new THREE.CanvasTexture(canvas);
    const spriteMaterial = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false, // Always render on top
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(spriteMaterial);
    sprite.position.y = 4; // Position above character (adjusted for 1.2 scale)
    sprite.scale.set(2, 0.5, 1);
    sprite.renderOrder = 999; // Render last (on top)

    parentGroup.add(sprite);
  }

  /**
   * Setup Socket.io connection and event handlers
   */
  setupSocket() {
    this.socket = io();

    // Send player customization immediately on connection
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

      // Clear any existing players first (in case of reconnection)
      this.players.forEach((player) => {
        if (player.mesh) {
          this.scene.remove(player.mesh);
        }
      });
      this.players.clear();
      this.mixers.clear();

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

      // Don't create duplicate if player already exists
      if (!this.players.has(playerData.id)) {
        this.createPlayer(playerData);
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
      const player = this.players.get(playerId);
      if (player) {
        this.scene.remove(player.mesh);
        this.players.delete(playerId);
      }
      // Clean up animation
      this.animationController.removePlayer(playerId);
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

    // Handle path updates from server
    this.socket.on("pathUpdate", (data) => {
      if (data.playerId === this.playerId && data.path) {
        this.drawPathTrace(data.path);
      }
    });

    // Handle obstacle updates from server
    this.socket.on("obstacleUpdated", (data) => {
      const { id, x, y, z } = data;
      const obstacle = this.obstacles.find((obs) => obs.userData.id === id);
      if (obstacle) {
        obstacle.position.set(x, y, z);
        console.log(`📦 Obstacle ${id} updated by another player`);
      }
    });

    // Handle emote/voice from other players
    this.socket.on("playerEmote", (data) => {
      const { playerId, emote } = data;

      // Don't play for own player (already played locally)
      if (playerId === this.playerId) return;

      // Calculate distance for spatial audio
      const currentPlayer = this.players.get(this.playerId);
      const otherPlayer = this.players.get(playerId);

      if (currentPlayer && otherPlayer) {
        const dx = currentPlayer.mesh.position.x - otherPlayer.mesh.position.x;
        const dz = currentPlayer.mesh.position.z - otherPlayer.mesh.position.z;
        const distance = Math.sqrt(dx * dx + dz * dz);

        // Play voice with spatial audio
        this.soundManager.playVoice(emote, distance, false);

        // Show visual indicator
        this.showVoiceIndicator(playerId, emote);
      }
    });
  }

  /**
   * INPUT HANDLING - Click to Move + Emote Wheel
   * WASD controls disabled - using point-and-click movement
   */
  setupInput() {
    // Click to move
    window.addEventListener("click", (e) => this.handleClick(e));

    // Emote wheel (Hold T key)
    this.setupEmoteWheel();
    window.addEventListener("mousemove", (e) => this.handleMouseMove(e));
    window.addEventListener("mousedown", (e) => this.handleMouseDown(e));
    window.addEventListener("mouseup", (e) => this.handleMouseUp(e));

    // Toggle edit mode with 'E' key
    window.addEventListener("keydown", (e) => {
      if (e.code === "KeyE") {
        this.toggleEditMode();
      }
    });
  }

  /**
   * Setup emote/voice wheel (Hold T key)
   */
  setupEmoteWheel() {
    const container = document.getElementById("emote-wheel-container");
    const emoteOptions = document.querySelectorAll(".emote-option");

    // Show wheel when T is pressed
    window.addEventListener("keydown", (e) => {
      if ((e.key === "t" || e.key === "T") && !this.emoteWheelActive) {
        e.preventDefault();
        this.emoteWheelActive = true;
        container.classList.add("active");
      }
    });

    // Hide wheel and play sound when T is released
    window.addEventListener("keyup", (e) => {
      if ((e.key === "t" || e.key === "T") && this.emoteWheelActive) {
        e.preventDefault();
        this.emoteWheelActive = false;
        container.classList.remove("active");

        // Play selected emote
        if (this.selectedEmote) {
          this.playEmote(this.selectedEmote);
          this.selectedEmote = null;
        }

        // Remove all highlights
        emoteOptions.forEach((opt) => opt.classList.remove("highlighted"));
      }
    });

    // Highlight emotes on hover
    emoteOptions.forEach((option) => {
      option.addEventListener("mouseenter", () => {
        if (this.emoteWheelActive) {
          emoteOptions.forEach((opt) => opt.classList.remove("highlighted"));
          option.classList.add("highlighted");
          this.selectedEmote = option.dataset.emote;
        }
      });

      // Click to select (alternative to hold-release)
      option.addEventListener("click", (e) => {
        if (this.emoteWheelActive) {
          e.stopPropagation();
          this.playEmote(option.dataset.emote);
          this.emoteWheelActive = false;
          container.classList.remove("active");
          emoteOptions.forEach((opt) => opt.classList.remove("highlighted"));
        }
      });
    });
  }

  /**
   * Play an emote/voice sound
   */
  playEmote(emoteName) {
    console.log(`🎵 Playing emote: ${emoteName}`);

    // Play sound locally
    this.soundManager.playVoice(emoteName, 0, true);

    // Send to server so other players can hear
    this.socket.emit("playEmote", {
      playerId: this.playerId,
      emote: emoteName,
    });

    // Show visual indicator above player
    this.showVoiceIndicator(this.playerId, emoteName);
  }

  /**
   * Show voice indicator above a player
   */
  showVoiceIndicator(playerId, emoteName) {
    const player = this.players.get(playerId);
    if (!player || !player.mesh) return;

    // Get emoji for the emote
    const emoteEmojis = {
      hello: "👋",
      help: "🆘",
      yes: "✅",
      no: "❌",
      thanks: "🙏",
      hurry: "⏰",
      nice: "😄",
      oops: "😅",
    };

    // Create indicator element
    const indicator = document.createElement("div");
    indicator.className = "voice-indicator";
    indicator.textContent = emoteEmojis[emoteName] || "💬";
    indicator.style.position = "absolute";
    indicator.style.zIndex = "1000";

    document.body.appendChild(indicator);

    // Position above player (update every frame)
    const updatePosition = () => {
      if (!player.mesh || !indicator.parentElement) return;

      const vector = player.mesh.position.clone();
      vector.y += 3; // Above the player
      vector.project(this.camera);

      const x = (vector.x * 0.5 + 0.5) * window.innerWidth;
      const y = (-(vector.y * 0.5) + 0.5) * window.innerHeight;

      indicator.style.left = x + "px";
      indicator.style.top = y + "px";
    };

    // Update position for 2 seconds
    const intervalId = setInterval(updatePosition, 16);

    // Remove after 2 seconds
    setTimeout(() => {
      clearInterval(intervalId);
      indicator.remove();
    }, 2000);
  }

  /**
   * Handle mouse move for raycasting and dragging
   */
  handleMouseMove(event) {
    // Calculate mouse position in normalized device coordinates (-1 to +1)
    this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    // Handle obstacle dragging
    if (this.isDraggingObstacle && this.selectedObstacle) {
      this.raycaster.setFromCamera(this.mouse, this.camera);

      // Intersect with an invisible plane at obstacle height
      const plane = new THREE.Plane(
        new THREE.Vector3(0, 1, 0),
        -this.selectedObstacle.position.y
      );
      const intersection = new THREE.Vector3();

      this.raycaster.ray.intersectPlane(plane, intersection);

      if (intersection) {
        // Update obstacle position (subtract offset for accurate placement)
        this.selectedObstacle.position.x = intersection.x - this.dragOffset.x;
        this.selectedObstacle.position.z = intersection.z - this.dragOffset.z;
      }
    }
  }

  /**
   * Toggle edit mode for moving obstacles
   */
  toggleEditMode() {
    this.editMode = !this.editMode;

    // Update obstacle colors to indicate edit mode
    this.obstacles.forEach((obstacle) => {
      if (this.editMode) {
        obstacle.material.color.setHex(0xff6b6b); // Red tint in edit mode
        obstacle.material.emissive.setHex(0x330000);
      } else {
        obstacle.material.color.setHex(0x8b4513); // Brown (normal)
        obstacle.material.emissive.setHex(0x000000);
      }
    });

    console.log(
      this.editMode
        ? "🔧 Edit Mode ON - Click and drag tables"
        : "✅ Edit Mode OFF"
    );

    // Update UI
    this.updateEditModeUI();
  }

  /**
   * Update UI to show edit mode status
   */
  updateEditModeUI() {
    const controlsInfo = document.querySelector("#controls-info h3");
    if (controlsInfo) {
      if (this.editMode) {
        controlsInfo.textContent = "🔧 Edit Mode - Drag Tables";
        controlsInfo.style.color = "#ff6b6b";
      } else {
        controlsInfo.textContent = "Controls";
        controlsInfo.style.color = "#4caf50";
      }
    }
  }

  /**
   * Handle mouse down for obstacle dragging
   */
  handleMouseDown(event) {
    if (!this.editMode) return;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const intersects = this.raycaster.intersectObjects(this.obstacles);

    if (intersects.length > 0) {
      this.selectedObstacle = intersects[0].object;
      this.isDraggingObstacle = true;

      // Calculate offset from obstacle center
      const point = intersects[0].point;
      this.dragOffset.copy(point).sub(this.selectedObstacle.position);

      // Highlight selected obstacle
      this.selectedObstacle.material.emissive.setHex(0x660000);

      console.log(`📦 Selected obstacle: ${this.selectedObstacle.userData.id}`);
    }
  }

  /**
   * Handle mouse up to finish dragging
   */
  handleMouseUp(event) {
    if (this.isDraggingObstacle && this.selectedObstacle) {
      // Send new position to server
      if (this.socket) {
        this.socket.emit("updateObstacle", {
          id: this.selectedObstacle.userData.id,
          x: this.selectedObstacle.position.x,
          y: this.selectedObstacle.position.y,
          z: this.selectedObstacle.position.z,
        });
      }

      console.log(
        `✅ Moved ${
          this.selectedObstacle.userData.id
        } to (${this.selectedObstacle.position.x.toFixed(
          2
        )}, ${this.selectedObstacle.position.z.toFixed(2)})`
      );
    }

    this.isDraggingObstacle = false;
    if (this.selectedObstacle) {
      this.selectedObstacle.material.emissive.setHex(0x330000);
      this.selectedObstacle = null;
    }
  }

  /**
   * Handle click to move or interact with obstacles
   */
  handleClick(event) {
    // If in edit mode, don't move player
    if (this.editMode) return;

    // Update raycaster
    this.raycaster.setFromCamera(this.mouse, this.camera);

    // Check intersection with floor
    const intersects = this.raycaster.intersectObject(this.floor);

    if (intersects.length > 0) {
      const point = intersects[0].point;

      // Set target position
      this.targetPosition = { x: point.x, y: 0, z: point.z };

      // Send move command to server
      if (this.socket) {
        this.socket.emit("moveTo", {
          x: point.x,
          z: point.z,
        });
      }

      // Visual feedback - create a marker
      this.createMoveMarker(point.x, point.z);

      console.log(
        `🎯 Moving to: (${point.x.toFixed(2)}, ${point.z.toFixed(2)})`
      );
    }
  }

  /**
   * Create visual marker for click destination
   */
  createMoveMarker(x, z) {
    // Remove old marker if exists
    if (this.moveMarker) {
      this.scene.remove(this.moveMarker);
    }

    // Create a ring marker
    const geometry = new THREE.RingGeometry(0.3, 0.5, 16);
    const material = new THREE.MeshBasicMaterial({
      color: 0x00ff00,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.7,
    });
    this.moveMarker = new THREE.Mesh(geometry, material);
    this.moveMarker.rotation.x = -Math.PI / 2;
    this.moveMarker.position.set(x, 0.1, z);

    this.scene.add(this.moveMarker);

    // Fade out and remove after 1 second
    setTimeout(() => {
      if (this.moveMarker) {
        this.scene.remove(this.moveMarker);
        this.moveMarker = null;
      }
    }, 1000);
  }

  /**
   * Draw path trace line showing the route
   */
  drawPathTrace(path) {
    // Remove old path line
    if (this.pathLine) {
      this.scene.remove(this.pathLine);
    }

    if (!path || path.length < 2) return;

    // Create line geometry from path points
    const points = path.map(
      (point) => new THREE.Vector3(point.x, 0.15, point.z)
    );
    const geometry = new THREE.BufferGeometry().setFromPoints(points);

    // Create dashed line material
    const material = new THREE.LineBasicMaterial({
      color: 0x00ffff,
      linewidth: 3,
      transparent: true,
      opacity: 0.8,
    });

    this.pathLine = new THREE.Line(geometry, material);
    this.scene.add(this.pathLine);

    // Fade out path after 2 seconds
    setTimeout(() => {
      if (this.pathLine) {
        this.scene.remove(this.pathLine);
        this.pathLine = null;
      }
    }, 2000);
  }

  /**
   * Send input state to server (deprecated - using click-to-move only)
   */
  sendInput() {
    // No longer needed - click-to-move only
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

    // Don't render if scene/renderer not ready
    if (!this.scene || !this.renderer || !this.camera) return;

    const delta = this.clock.getDelta();

    // Skip frame if delta is too large (tab was inactive)
    if (delta > 0.1) return;

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

    // Update all animation mixers (not needed for procedural animation, but kept for compatibility)
    const allMixers = this.animationController.getAllMixers();
    allMixers.forEach((animData) => {
      if (animData.mixer) {
        animData.mixer.update(delta);
      }
    });

    this.renderer.render(this.scene, this.camera);
  }
}

// Initialize game when DOM is ready
window.addEventListener("DOMContentLoaded", () => {
  new Game();
});
