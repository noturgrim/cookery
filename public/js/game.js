import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
import { SoundManager } from "./soundManager.js";
import { SceneManager } from "./managers/SceneManager.js";
import { PlayerManager } from "./managers/PlayerManager.js";
import { UIManager } from "./managers/UIManager.js";
import { InputManager } from "./managers/InputManager.js";
import { NetworkManager } from "./managers/NetworkManager.js";
import { InteractionManager } from "./managers/InteractionManager.js";
import { DayNightUI } from "./managers/DayNightUI.js";
import { TimeDisplay } from "./managers/TimeDisplay.js";
import { MusicPlayerManager } from "./managers/MusicPlayerManager.js";

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
    this.interactionManager = null;
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
  async initWelcomeScreen() {
    // Check authentication first
    const isAuthenticated = await this.checkAuthentication();
    if (!isAuthenticated) {
      return; // Will redirect to login
    }

    // User is authenticated, continue with game
    document.getElementById("welcome-modal").classList.add("hidden");
    this.init();

    document.getElementById("settings-btn").addEventListener("click", () => {
      this.showSettings();
    });
  }

  /**
   * Check authentication before starting game
   */
  async checkAuthentication() {
    const sessionToken = localStorage.getItem("sessionToken");

    if (!sessionToken) {
      // No session token, redirect to login
      console.log("⚠️ No session token, redirecting to login");
      window.location.href = "/auth.html";
      return false;
    }

    try {
      // Validate session with server
      const response = await fetch("/api/auth/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionToken }),
      });

      const data = await response.json();

      if (data.valid) {
        // Session is valid, load user data
        const user = data.user;
        this.playerName = user.displayName;
        this.playerSkin = user.skinIndex;
        this.userId = user.id;
        this.username = user.username;
        this.sessionToken = sessionToken;
        console.log(
          `✅ Authenticated as ${user.displayName} (@${user.username})`
        );
        return true;
      } else {
        // Invalid session, clear and redirect to login
        console.log("⚠️ Invalid session, redirecting to login");
        localStorage.removeItem("sessionToken");
        localStorage.removeItem("user");
        window.location.href = "/auth.html";
        return false;
      }
    } catch (error) {
      console.error("❌ Authentication check failed:", error);
      // On error, redirect to login
      window.location.href = "/auth.html";
      return false;
    }
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

    // Day-Night UI will be initialized after input manager is ready
    this.dayNightUI = null;
    this.timeDisplay = null;

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
    const modal = document.getElementById("settings-modal");
    modal.classList.add("active");
    modal.style.display = "flex";

    // Populate current values
    document.getElementById("settings-player-name").value = this.playerName;

    // Update platform size slider with current value
    if (this.sceneManager) {
      const currentSize = this.sceneManager.platformSize || 40;
      const platformSizeSlider = document.getElementById(
        "platform-size-slider"
      );
      const platformSizeValue = document.getElementById("platform-size-value");
      platformSizeSlider.value = currentSize;
      platformSizeValue.textContent = `${currentSize}x${currentSize}`;
    }

    // Setup skin selector only if not already initialized
    const skinSelector = document.getElementById("settings-skin-selector");
    if (skinSelector.children.length === 0) {
      this.setupSettingsSkinSelector();
    } else {
      // Just update the selected skin visually
      document
        .querySelectorAll("#settings-skin-selector > div")
        .forEach((option) => {
          const skinId = parseInt(option.dataset.skinId);
          if (skinId === this.playerSkin) {
            option.classList.add(
              "!border-purple-500",
              "!border-4",
              "bg-purple-500/20"
            );
          } else {
            option.classList.remove(
              "!border-purple-500",
              "!border-4",
              "bg-purple-500/20"
            );
          }
        });
    }

    const closeModal = () => {
      modal.classList.remove("active");
      modal.style.display = "none";
    };

    // Close button
    document.getElementById("settings-close-btn").onclick = closeModal;

    // Platform size slider
    const platformSizeSlider = document.getElementById("platform-size-slider");
    const platformSizeValue = document.getElementById("platform-size-value");
    const platformSizeApply = document.getElementById("platform-size-apply");

    // Update platform size value display on slider change
    platformSizeSlider.oninput = () => {
      const size = platformSizeSlider.value;
      platformSizeValue.textContent = `${size}x${size}`;
    };

    // Apply platform size change
    platformSizeApply.onclick = () => {
      const newSize = parseInt(platformSizeSlider.value);
      if (newSize >= 20 && newSize <= 200) {
        if (this.networkManager) {
          this.networkManager.updatePlatformSize(newSize);
          console.log(
            `📏 Platform size change requested: ${newSize}x${newSize}`
          );
        }
      } else {
        alert("Platform size must be between 20 and 200!");
      }
    };

    // Save button
    document.getElementById("settings-save-btn").onclick = () => {
      const newName = document
        .getElementById("settings-player-name")
        .value.trim();
      if (newName) {
        this.playerName = newName;
        localStorage.setItem("supercooked_playerName", newName);

        // Update server if game is running
        if (this.networkManager) {
          this.networkManager.updatePlayerCustomization(
            this.playerName,
            this.playerSkin
          );
        }

        console.log(
          `✅ Settings saved: ${this.playerName}, Skin: ${this.playerSkin}`
        );

        // Close modal
        closeModal();
      } else {
        alert("Please enter a name!");
      }
    };

    // Logout button
    document.getElementById("logout-btn").onclick = async () => {
      if (confirm("Are you sure you want to logout?")) {
        const sessionToken = localStorage.getItem("sessionToken");

        // Call logout API
        try {
          await fetch("/api/auth/logout", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionToken }),
          });
        } catch (error) {
          console.error("❌ Logout error:", error);
        }

        // Clear local storage
        localStorage.removeItem("sessionToken");
        localStorage.removeItem("user");

        // Redirect to login
        window.location.href = "/auth.html";
      }
    };

    // Close on background click
    modal.onclick = (e) => {
      if (e.target === modal) {
        closeModal();
      }
    };
  }

  /**
   * Setup skin selector for settings modal
   */
  setupSettingsSkinSelector() {
    const skinSelector = document.getElementById("settings-skin-selector");
    skinSelector.innerHTML = "";

    if (this.characterModels.length === 0) {
      skinSelector.innerHTML =
        '<div style="color: white; padding: 20px; text-align: center; grid-column: span 4;">Loading characters...</div>';

      // Wait for models to load
      const checkModelsLoaded = setInterval(() => {
        if (this.characterModels.length > 0) {
          clearInterval(checkModelsLoaded);
          this.setupSettingsSkinSelector(); // Retry
        }
      }, 100);
      return;
    }

    this.availableSkins.forEach((skin) => {
      const option = document.createElement("div");
      option.className =
        "aspect-square border-2 border-gray-600 rounded-lg cursor-pointer transition-all hover:scale-110 hover:border-purple-500 bg-gray-700/50 flex items-center justify-center overflow-hidden p-1";
      option.dataset.skinId = skin.id;

      const canvas = document.createElement("canvas");
      canvas.width = 100;
      canvas.height = 100;
      canvas.className = "w-full h-full object-contain rounded";
      option.appendChild(canvas);

      this.renderCharacterPreview(canvas, skin.id);

      if (skin.id === this.playerSkin) {
        option.classList.add(
          "!border-purple-500",
          "!border-4",
          "bg-purple-500/20"
        );
      }

      option.addEventListener("click", () => {
        document
          .querySelectorAll("#settings-skin-selector > div")
          .forEach((o) => {
            o.classList.remove(
              "!border-purple-500",
              "!border-4",
              "bg-purple-500/20"
            );
          });
        option.classList.add(
          "!border-purple-500",
          "!border-4",
          "bg-purple-500/20"
        );
        this.playerSkin = skin.id;
        localStorage.setItem("supercooked_playerSkin", skin.id);
      });

      skinSelector.appendChild(option);
    });
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
      this.networkManager,
      this.soundManager
    );
    this.inputManager.setupInput();

    // Set input manager reference in network manager for edit mode sync
    this.networkManager.setInputManager(this.inputManager);

    // Initialize Day-Night UI now that input manager is ready
    if (this.sceneManager.dayNightCycle) {
      this.dayNightUI = new DayNightUI(this.sceneManager.dayNightCycle);
      this.inputManager.dayNightUI = this.dayNightUI;

      // Initialize minimal time display
      this.timeDisplay = new TimeDisplay(this.sceneManager.dayNightCycle);

      // Connect network manager to day-night cycle for syncing
      this.sceneManager.dayNightCycle.setNetworkManager(this.networkManager);

      console.log("🌅 Day-Night Cycle initialized! Press N to open controls");
    }

    // Initialize music player manager
    this.musicPlayerManager = new MusicPlayerManager(
      this.sceneManager,
      this.networkManager,
      this.soundManager
    );

    // Store reference to player manager (needed for spatial audio)
    this.sceneManager.playerManager = this.playerManager;

    // Initialize interaction manager
    this.interactionManager = new InteractionManager(
      this.sceneManager,
      this.playerManager,
      this.networkManager,
      this.uiManager,
      this.musicPlayerManager
    );

    // Set interaction manager reference in network manager
    this.networkManager.setInteractionManager(this.interactionManager);

    // Setup music player UI handlers
    this.setupMusicPlayerUI();

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

    const tryLoadSound = async (name, basePath, usePool = false) => {
      // Try formats in order based on what we have
      // Voices are .m4a, others are .mp3
      const formats = [".mp3", ".m4a", ".ogg", ".wav"];

      for (const format of formats) {
        const success = await this.soundManager.loadSound(
          name,
          basePath + format,
          usePool
        );
        if (success) {
          console.log(
            `✅ Loaded ${name} as ${format}${usePool ? " (pooled)" : ""}`
          );
          return true;
        }
      }

      console.warn(`⚠️ Could not load ${name} in any format`);
      return false;
    };

    // Use audio pool for footsteps (most frequent sound)
    await tryLoadSound("footstep", "/sounds/step", true);
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

    // Update interactions
    if (this.interactionManager) {
      this.interactionManager.update();
    }

    // Render the scene
    this.sceneManager.render();
  }

  /**
   * Setup music player UI handlers
   */
  setupMusicPlayerUI() {
    // Close button
    const closeBtn = document.getElementById("music-player-close-btn");
    if (closeBtn) {
      closeBtn.addEventListener("click", () => {
        this.musicPlayerManager.closeMusicPlayer();
      });
    }

    // Stop button
    const stopBtn = document.getElementById("music-stop-btn");
    if (stopBtn) {
      stopBtn.addEventListener("click", () => {
        if (this.musicPlayerManager.currentSpeaker) {
          this.musicPlayerManager.stopSpeakerMusic(
            this.musicPlayerManager.currentSpeaker,
            true
          );
        }
      });
    }

    // Populate song list when modal opens
    const modal = document.getElementById("music-player-modal");
    if (modal) {
      // Watch for modal display changes
      const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
          if (
            mutation.type === "attributes" &&
            mutation.attributeName === "style"
          ) {
            const isVisible =
              modal.style.display === "flex" ||
              modal.classList.contains("active");
            if (isVisible) {
              this.musicPlayerManager.populateSongList();
            }
          }
        });
      });

      observer.observe(modal, {
        attributes: true,
        attributeFilter: ["style", "class"],
      });
    }

    // Request music sync from server
    if (this.networkManager && this.networkManager.socket) {
      this.networkManager.socket.emit("requestMusicSync");
    }

    console.log("🎵 Music Player UI initialized");
  }
}

// Initialize game when DOM is ready
window.addEventListener("DOMContentLoaded", () => {
  new Game();
});
