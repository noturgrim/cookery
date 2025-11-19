import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
import { SoundManager } from "./soundManager.js";
import { SceneManager } from "./managers/SceneManager.js";
import { PlayerManager } from "./managers/PlayerManager.js";
import { UIManager } from "./managers/UIManager.js";
import { InputManager } from "./managers/InputManager.js";
import { NetworkManager } from "./managers/NetworkManager.js";

/**
 * Main Game Class
 * Orchestrates all managers and handles the game loop
 */
class Game {
  constructor() {
    // Managers
    this.sceneManager = null;
    this.playerManager = null;
    this.uiManager = null;
    this.inputManager = null;
    this.networkManager = null;
    this.soundManager = new SoundManager();

    // Player customization
    this.playerName = "";
    this.playerSkin = 0;
    this.availableSkins = Array.from({ length: 18 }, (_, i) => ({
      id: i,
      name: `Chef ${String.fromCharCode(65 + i)}`,
      char: `character-${String.fromCharCode(97 + i)}`,
    }));

    // Game state
    this.isGameRunning = false;
    this.characterModels = []; // For backwards compatibility with preview

    // Setup audio unlock notice
    this.setupAudioUnlockNotice();

    // Initialize welcome screen
    this.initWelcomeScreen();
  }

  /**
   * Setup audio unlock notice
   */
  setupAudioUnlockNotice() {
    const notice = document.getElementById("audio-unlock-notice");

    setTimeout(() => {
      if (!this.soundManager.audioUnlocked && notice) {
        notice.style.display = "block";
      }
    }, 2000);

    const hideNotice = () => {
      if (this.soundManager.audioUnlocked && notice) {
        notice.style.transition = "opacity 0.3s";
        notice.style.opacity = "0";
        setTimeout(() => {
          notice.style.display = "none";
        }, 300);
      }
    };

    const checkInterval = setInterval(() => {
      if (this.soundManager.audioUnlocked) {
        hideNotice();
        clearInterval(checkInterval);
      }
    }, 500);
  }

  /**
   * Initialize welcome screen
   */
  initWelcomeScreen() {
    const savedName = localStorage.getItem("supercooked_playerName");
    const savedSkin = localStorage.getItem("supercooked_playerSkin");

    if (savedName && savedSkin !== null) {
      this.playerName = savedName;
      this.playerSkin = parseInt(savedSkin);
      document.getElementById("welcome-modal").classList.add("hidden");
      this.init();
    } else {
      this.initForPreview();
      this.setupWelcomeModal();
    }

    document.getElementById("settings-btn").addEventListener("click", () => {
      this.showSettings();
    });
  }

  /**
   * Initialize for preview (without socket)
   */
  initForPreview() {
    if (this.sceneManager) return;

    // Initialize scene manager
    this.sceneManager = new SceneManager();
    this.sceneManager.setupScene();
    this.sceneManager.setupLights();
    this.sceneManager.createFloor();

    // Initialize UI manager
    this.uiManager = new UIManager(this.sceneManager);

    // Initialize player manager
    this.playerManager = new PlayerManager(this.sceneManager, this.uiManager);

    // Start rendering loop
    this.animate();

    // Load models for preview
    this.loadCharacterModels();

    // Handle window resize
    window.addEventListener("resize", () => this.sceneManager.handleResize());
  }

  /**
   * Setup welcome modal
   */
  setupWelcomeModal() {
    const skinSelector = document.getElementById("skin-selector");
    skinSelector.innerHTML =
      '<div style="color: white; padding: 20px; text-align: center;">Loading characters...</div>';

    const checkModelsLoaded = setInterval(() => {
      if (this.characterModels.length > 0) {
        clearInterval(checkModelsLoaded);
        skinSelector.innerHTML = "";

        this.availableSkins.forEach((skin) => {
          const option = document.createElement("div");
          option.className = "skin-option";
          option.dataset.skinId = skin.id;
          option.dataset.name = skin.name;

          const canvas = document.createElement("canvas");
          canvas.width = 200;
          canvas.height = 200;
          option.appendChild(canvas);

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

    document.getElementById("start-game-btn").addEventListener("click", () => {
      const nameInput = document.getElementById("player-name");
      const name = nameInput.value.trim();

      if (name.length < 2) {
        nameInput.style.border = "2px solid red";
        nameInput.placeholder = "Name must be at least 2 characters!";
        return;
      }

      this.playerName = name;

      localStorage.setItem("supercooked_playerName", this.playerName);
      localStorage.setItem("supercooked_playerSkin", this.playerSkin);

      document.getElementById("welcome-modal").classList.add("hidden");

      console.log(
        "🎮 Starting game with:",
        this.playerName,
        "Skin:",
        this.playerSkin
      );

      if (!this.networkManager) {
        console.log("🔌 Initializing socket and input...");
        this.completeInitialization();
      } else {
        console.log("♻️ Updating player customization...");
        this.networkManager.updatePlayerCustomization(
          this.playerName,
          this.playerSkin
        );
      }
    });

    document.getElementById("player-name").addEventListener("keypress", (e) => {
      if (e.key === "Enter") {
        document.getElementById("start-game-btn").click();
      }
    });
  }

  /**
   * Render character preview to canvas
   */
  renderCharacterPreview(canvas, modelIndex) {
    if (modelIndex >= this.characterModels.length) {
      console.warn(
        `Model index ${modelIndex} out of range. Only ${this.characterModels.length} models loaded.`
      );
      return;
    }

    const previewScene = new THREE.Scene();
    previewScene.background = new THREE.Color(0x2a2a3a);

    const previewCamera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    previewCamera.position.set(0, 1.2, 3.5);
    previewCamera.lookAt(0, 0.8, 0);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    previewScene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.6);
    directionalLight.position.set(1, 2, 2);
    previewScene.add(directionalLight);

    const modelData = this.characterModels[modelIndex];
    if (!modelData || !modelData.scene) {
      console.warn(`Character model ${modelIndex} not loaded properly`);
      return;
    }

    const characterModel = modelData.scene.clone();
    characterModel.scale.set(1.2, 1.2, 1.2);
    characterModel.rotation.y = Math.PI / 6;
    characterModel.position.y = 0;
    previewScene.add(characterModel);

    const offscreenCanvas = document.createElement("canvas");
    offscreenCanvas.width = 200;
    offscreenCanvas.height = 200;

    const previewRenderer = new THREE.WebGLRenderer({
      canvas: offscreenCanvas,
      antialias: false,
      alpha: true,
      preserveDrawingBuffer: true,
    });
    previewRenderer.setSize(200, 200);
    previewRenderer.render(previewScene, previewCamera);

    const ctx = canvas.getContext("2d");
    ctx.drawImage(offscreenCanvas, 0, 0);

    previewRenderer.dispose();
    previewRenderer.forceContextLoss();
    previewRenderer.domElement = null;
  }

  /**
   * Show settings modal
   */
  showSettings() {
    const modal = document.getElementById("welcome-modal");
    modal.classList.remove("hidden");

    document.getElementById("player-name").value = this.playerName;

    const skinSelector = document.getElementById("skin-selector");
    if (
      skinSelector.children.length === 0 ||
      !skinSelector.querySelector(".skin-option canvas")
    ) {
      this.setupWelcomeModal();
    } else {
      document.querySelectorAll(".skin-option").forEach((option) => {
        option.classList.remove("selected");
        if (parseInt(option.dataset.skinId) === this.playerSkin) {
          option.classList.add("selected");
        }
      });
    }
  }

  /**
   * Initialize game
   */
  init() {
    if (this.sceneManager) return;

    // Initialize scene manager
    this.sceneManager = new SceneManager();
    this.sceneManager.setupScene();
    this.sceneManager.setupLights();
    this.sceneManager.createFloor();

    // Initialize UI manager
    this.uiManager = new UIManager(this.sceneManager);

    // Initialize player manager
    this.playerManager = new PlayerManager(this.sceneManager, this.uiManager);

    // Start animation loop
    this.animate();

    // Handle window resize
    window.addEventListener("resize", () => this.sceneManager.handleResize());

    this.loadCharacterModels().then(() => {
      this.completeInitialization();
    });
  }

  /**
   * Complete initialization after models load
   */
  completeInitialization() {
    if (this.isGameRunning) {
      console.log("⚠️ Game already running");
      return;
    }

    console.log("🚀 Complete initialization starting...");

    // Initialize network manager
    this.networkManager = new NetworkManager(
      this.playerManager,
      this.sceneManager,
      this.uiManager,
      this.soundManager
    );
    this.networkManager.setPlayerData(this.playerName, this.playerSkin);
    this.networkManager.setupSocket();

    // Initialize input manager
    this.inputManager = new InputManager(
      this.sceneManager,
      this.uiManager,
      this.networkManager
    );
    this.inputManager.setupInput();

    // Set input manager reference in network manager for edit mode sync
    this.networkManager.setInputManager(this.inputManager);

    // If animate loop isn't running yet, start it
    if (!this.sceneManager.renderer) {
      console.log("🎬 Starting renderer...");
      this.animate();
      window.addEventListener("resize", () => this.sceneManager.handleResize());
    }

    this.isGameRunning = true;

    console.log("✅ Game fully started!");
    console.log("   - Scene:", !!this.sceneManager.scene);
    console.log("   - Renderer:", !!this.sceneManager.renderer);
    console.log("   - Camera:", !!this.sceneManager.camera);
    console.log("   - Socket:", this.networkManager.isConnected());

    // Load sound effects
    this.loadSoundEffects();

    // Spawn demo food items
    this.spawnDemoFoodItems();
  }

  /**
   * Load all sound effects
   */
  async loadSoundEffects() {
    console.log("🔊 Loading sound effects...");

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

    await tryLoadSound("footstep", "/sounds/step");
    await tryLoadSound("click", "/sounds/click");
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
   * Load character models
   */
  async loadCharacterModels() {
    const loadedModels = await this.playerManager.loadCharacterModels();
    this.characterModels = loadedModels;
    return loadedModels;
  }

  /**
   * Spawn demo food items on the table
   * (Currently disabled - use Press B to spawn objects)
   */
  spawnDemoFoodItems() {
    // No default food items
    // Players can spawn items using the spawn menu (Press B key)
  }

  /**
   * Main animation loop
   */
  animate() {
    requestAnimationFrame(() => this.animate());

    if (!this.sceneManager || !this.sceneManager.renderer) return;

    const delta = this.sceneManager.getDelta();

    // Skip frame if delta is too large (tab was inactive)
    if (delta > 0.1) return;

    // Update all players
    if (this.playerManager) {
      this.playerManager.updatePlayers(delta, this.soundManager);
    }

    // Render the scene
    this.sceneManager.render();
  }
}

// Initialize game when DOM is ready
window.addEventListener("DOMContentLoaded", () => {
  new Game();
});
