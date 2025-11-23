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
import { PetManager } from "./managers/PetManager.js";
import { PlatformManager } from "./managers/PlatformManager.js";
import { SpeakerConnectionManager } from "./managers/SpeakerConnectionManager.js";

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
    this.petManager = null;
    this.platformManager = null;

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
    this.isAdmin = false;
    this.currentUser = null;
    this.adminControlsInitialized = false;
    this.adminSelectedPlatformId = null;
    this.adminSelectedBridgeId = null;

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

    const settingsBtn = document.getElementById("settings-btn");
    settingsBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.showSettings();
    });

    // Prevent mouse events from propagating through settings button
    settingsBtn.addEventListener("mousedown", (e) => {
      e.stopPropagation();
    });
    settingsBtn.addEventListener("mouseup", (e) => {
      e.stopPropagation();
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
        this.isAdmin = Boolean(user.isAdmin);
        this.currentUser = user;
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

    // Platform label visibility toggle
    const platformLabelsToggle = document.getElementById(
      "platform-labels-toggle"
    );
    if (platformLabelsToggle) {
      const labelsVisible =
        this.platformManager?.labelsVisible !== undefined
          ? this.platformManager.labelsVisible
          : true;
      platformLabelsToggle.checked = labelsVisible;
      platformLabelsToggle.onchange = () => {
        if (this.platformManager) {
          this.platformManager.setPlatformLabelsVisible(
            platformLabelsToggle.checked
          );
        }
      };
    }

    // Admin controls visibility
    const adminPanel = document.getElementById("admin-panel");
    const adminPill = document.getElementById("admin-username-pill");
    if (adminPanel) {
      if (this.isAdmin) {
        adminPanel.classList.remove("hidden");
        if (adminPill) {
          adminPill.textContent = this.username ? `@${this.username}` : "Admin";
        }
        this.initAdminControls();
        this.refreshAdminPlatformLists();
      } else {
        adminPanel.classList.add("hidden");
      }
    }

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
   * Handle authenticated user payload from server
   */
  handleAuthenticatedUser(user) {
    this.currentUser = user;
    const wasAdmin = this.isAdmin;
    this.isAdmin = Boolean(user?.isAdmin);

    if (this.isAdmin && !this.adminControlsInitialized) {
      this.initAdminControls();
    }

    if (
      this.isAdmin &&
      (this.adminControlsInitialized || wasAdmin !== this.isAdmin)
    ) {
      this.refreshAdminPlatformLists();
    }
  }

  /**
   * Initialize admin control listeners (only once)
   */
  initAdminControls() {
    if (this.adminControlsInitialized) return;

    const platformSelect = document.getElementById("admin-platform-select");
    const nameInput = document.getElementById("admin-platform-name");
    const sizeInput = document.getElementById("admin-platform-size");
    const textureInput = document.getElementById("admin-platform-texture");
    const refreshPlatformsBtn = document.getElementById(
      "admin-platform-refresh"
    );
    const updatePlatformBtn = document.getElementById("admin-platform-update");
    const deletePlatformBtn = document.getElementById("admin-platform-delete");

    if (
      !platformSelect ||
      !nameInput ||
      !sizeInput ||
      !textureInput ||
      !refreshPlatformsBtn ||
      !updatePlatformBtn ||
      !deletePlatformBtn
    ) {
      return;
    }

    platformSelect.addEventListener("change", () => {
      this.adminSelectedPlatformId = platformSelect.value || null;
      this.fillAdminPlatformForm(this.adminSelectedPlatformId);
    });

    refreshPlatformsBtn.addEventListener("click", () =>
      this.refreshAdminPlatformLists()
    );

    updatePlatformBtn.addEventListener("click", () => {
      if (!this.adminSelectedPlatformId) {
        alert("Select a platform to update.");
        return;
      }
      const payload = {
        platformId: this.adminSelectedPlatformId,
      };

      const name = nameInput.value.trim();
      if (name.length > 0) {
        payload.name = name;
      }

      const sizeValue = parseInt(sizeInput.value, 10);
      if (!Number.isNaN(sizeValue)) {
        payload.size = sizeValue;
      }

      const texture = textureInput.value.trim();
      if (texture.length > 0) {
        payload.floorTexture = texture;
      }

      if (Object.keys(payload).length === 1) {
        alert("Enter at least one field to update.");
        return;
      }

      this.networkManager?.requestPlatformUpdate(payload);
    });

    deletePlatformBtn.addEventListener("click", () => {
      if (!this.adminSelectedPlatformId) {
        alert("Select a platform to delete.");
        return;
      }
      if (
        confirm(
          "Delete this platform? This will also remove any bridges attached to it."
        )
      ) {
        this.networkManager?.requestPlatformDeletion(
          this.adminSelectedPlatformId
        );
      }
    });

    this.adminControlsInitialized = true;
  }

  /**
   * Refresh platform/bridge lists in admin panel
   */
  refreshAdminPlatformLists() {
    if (!this.isAdmin) return;
    const platformSelect = document.getElementById("admin-platform-select");
    if (!platformSelect) return;

    const platforms = this.platformManager
      ? [...this.platformManager.getAllPlatforms()]
      : [];
    platforms.sort((a, b) => a.name.localeCompare(b.name));

    platformSelect.innerHTML = "";
    if (platforms.length === 0) {
      const opt = document.createElement("option");
      opt.textContent = "No platforms available";
      opt.disabled = true;
      platformSelect.appendChild(opt);
      this.adminSelectedPlatformId = null;
    } else {
      if (
        !this.adminSelectedPlatformId ||
        !platforms.find((p) => p.id === this.adminSelectedPlatformId)
      ) {
        this.adminSelectedPlatformId = platforms[0].id;
      }

      platforms.forEach((platform) => {
        const option = document.createElement("option");
        option.value = platform.id;
        option.textContent = `${platform.name} (${platform.owner})`;
        platformSelect.appendChild(option);
      });
      platformSelect.value = this.adminSelectedPlatformId;
    }

    this.fillAdminPlatformForm(this.adminSelectedPlatformId);
  }

  /**
   * Populate admin form inputs for selected platform
   */
  fillAdminPlatformForm(platformId) {
    const nameInput = document.getElementById("admin-platform-name");
    const sizeInput = document.getElementById("admin-platform-size");
    const textureInput = document.getElementById("admin-platform-texture");
    if (!nameInput || !sizeInput || !textureInput) return;

    if (!platformId) {
      nameInput.value = "";
      sizeInput.value = "";
      textureInput.value = "";
      return;
    }

    const platform = this.platformManager?.getPlatformById(platformId);
    if (!platform) return;

    nameInput.value = platform.name || "";
    sizeInput.value = platform.size || "";
    textureInput.value = platform.floorTexture || "";
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

    // Initialize pet manager (will get networkManager later)
    this.petManager = new PetManager(this.sceneManager, null);

    // Initialize platform manager (will get networkManager later)
    this.platformManager = new PlatformManager(this.sceneManager, null);
    this.sceneManager.platformManager = this.platformManager;

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

    // Connect pet manager to network
    if (this.petManager) {
      this.petManager.networkManager = this.networkManager;
    }

    // Connect platform manager to network
    if (this.platformManager) {
      this.platformManager.networkManager = this.networkManager;
    }

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

    // Initialize speaker connection manager
    this.speakerConnectionManager = new SpeakerConnectionManager(
      this.sceneManager,
      this.networkManager,
      this.musicPlayerManager
    );

    // Store references (needed for spatial audio and cleanup)
    this.sceneManager.playerManager = this.playerManager;
    this.sceneManager.musicPlayerManager = this.musicPlayerManager;
    this.sceneManager.speakerConnectionManager = this.speakerConnectionManager;

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

    // Setup platform creation button
    this.setupPlatformButton();

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

    // Load and spawn pets AFTER network is connected
    // This will be triggered by the network init event
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
   * Load and spawn pets
   */
  async loadPets() {
    console.log("🐱 Loading pets...");

    try {
      // Load geometric cat model with separated legs
      await this.petManager.loadPetModel("cat", "/pets/glb/cat2.glb");

      // Check if server has cats already
      if (
        this.petManager.pendingCats &&
        this.petManager.pendingCats.length > 0
      ) {
        // Apply positions from server
        this.petManager.applyPendingCats();
      } else {
        // First player - spawn cats at random safe positions
        const numCats = 3;

        for (let i = 0; i < numCats; i++) {
          this.petManager.spawnPet("cat", null);
        }

        console.log(`🐱 Spawned ${numCats} wandering cats!`);
      }

      // Start syncing cat positions to server
      this.petManager.startSync();
    } catch (error) {
      console.error("❌ Failed to load pets:", error);
    }
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

    // Update pets (wandering and leg animation)
    if (this.petManager) {
      this.petManager.updatePets(delta);
    }

    // Update interactions
    if (this.interactionManager) {
      this.interactionManager.update();
    }

    // Update speaker connection visuals (playing indicators)
    if (this.speakerConnectionManager) {
      this.speakerConnectionManager.updatePlayingIndicators();
    }

    // Render the scene
    this.sceneManager.render();
  }

  /**
   * Setup platform creation button
   */
  setupPlatformButton() {
    const platformBtn = document.getElementById("create-platform-btn");
    const modal = document.getElementById("platform-modal");
    const nameInput = document.getElementById("platform-name-input");
    const sizeInput = document.getElementById("platform-size-input");
    const cancelBtn = document.getElementById("platform-modal-cancel");
    const confirmBtn = document.getElementById("platform-modal-confirm");

    if (platformBtn && modal) {
      // Show modal when button clicked
      platformBtn.addEventListener("click", () => {
        // Set default name
        nameInput.value = `${this.playerName || "Player"}'s Platform`;
        sizeInput.value = "40";

        // Show modal
        modal.style.display = "flex";

        // Disable keyboard shortcuts and input manager
        this.isPlatformModalOpen = true;
        if (this.inputManager) {
          this.inputManager.isPlatformModalOpen = true;
        }
        console.log("🔒 Platform modal opened - keyboard shortcuts disabled");

        // Focus on name input
        setTimeout(() => nameInput.focus(), 100);
      });

      // Cancel button
      cancelBtn.addEventListener("click", () => {
        modal.style.display = "none";

        // Re-enable keyboard shortcuts and input manager
        this.isPlatformModalOpen = false;
        if (this.inputManager) {
          this.inputManager.isPlatformModalOpen = false;
        }
        console.log("🔓 Platform modal closed - keyboard shortcuts enabled");
      });

      // Confirm button
      confirmBtn.addEventListener("click", () => {
        const name = nameInput.value.trim();
        const size = parseInt(sizeInput.value);

        // Validate
        if (!name || name.length === 0) {
          alert("Please enter a platform name!");
          return;
        }

        // Check for duplicate platform names
        const allPlatforms = this.platformManager.getAllPlatforms();
        const isDuplicate = allPlatforms.some(
          (platform) => platform.name.toLowerCase() === name.toLowerCase()
        );

        if (isDuplicate) {
          alert(
            `A platform named "${name}" already exists!\nPlease choose a different name.`
          );
          nameInput.focus();
          return;
        }

        if (isNaN(size) || size < 20 || size > 200) {
          alert("Invalid size! Please enter a number between 20 and 200.");
          return;
        }

        // Hide modal
        modal.style.display = "none";

        // Re-enable keyboard shortcuts and input manager
        this.isPlatformModalOpen = false;
        if (this.inputManager) {
          this.inputManager.isPlatformModalOpen = false;
        }

        // Store name for later use
        this.platformName = name;

        // Start placement mode
        this.platformManager.startPlacementMode(size);
        this.inputManager.platformPlacementMode = true;

        // Visual feedback
        platformBtn.classList.add("active");

        console.log(`👻 Platform placement mode activated! Size: ${size}`);
        console.log("   Click to place, ESC to cancel");

        // Remove active class when placement ends
        const checkPlacementEnd = setInterval(() => {
          if (!this.inputManager.platformPlacementMode) {
            platformBtn.classList.remove("active");
            clearInterval(checkPlacementEnd);
          }
        }, 100);
      });

      // ESC to close modal
      window.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && modal.style.display === "flex") {
          modal.style.display = "none";

          // Re-enable keyboard shortcuts and input manager
          this.isPlatformModalOpen = false;
          if (this.inputManager) {
            this.inputManager.isPlatformModalOpen = false;
          }
        }
      });

      console.log("🏗️ Platform creation button initialized");
    }
  }

  /**
   * Setup music player UI handlers
   */
  setupMusicPlayerUI() {
    // Modal backdrop click to close
    const musicModal = document.getElementById("music-player-modal");
    if (musicModal) {
      musicModal.addEventListener("click", (e) => {
        // Only close if clicking the backdrop (not the content)
        if (e.target === musicModal) {
          this.musicPlayerManager.closeMusicPlayer();
        }
      });
    }

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

    // Pause button
    const pauseBtn = document.getElementById("music-pause-btn");
    if (pauseBtn) {
      pauseBtn.addEventListener("click", () => {
        if (this.musicPlayerManager.currentSpeaker) {
          this.musicPlayerManager.pauseSpeakerMusic(
            this.musicPlayerManager.currentSpeaker,
            true // Broadcast to all players
          );
        }
      });
    }

    // Resume button
    const resumeBtn = document.getElementById("music-resume-btn");
    if (resumeBtn) {
      resumeBtn.addEventListener("click", () => {
        if (this.musicPlayerManager.currentSpeaker) {
          this.musicPlayerManager.resumeSpeakerMusic(
            this.musicPlayerManager.currentSpeaker,
            true // Broadcast to all players
          );
        }
      });
    }

    // Volume slider
    const volumeSlider = document.getElementById("music-volume-slider");
    const volumeValue = document.getElementById("music-volume-value");
    if (volumeSlider) {
      volumeSlider.addEventListener("input", (e) => {
        const volume = parseInt(e.target.value);
        if (volumeValue) {
          volumeValue.textContent = `${volume}%`;
        }
        if (this.musicPlayerManager.currentSpeaker) {
          this.musicPlayerManager.setSpeakerVolume(
            this.musicPlayerManager.currentSpeaker,
            volume,
            true // Broadcast to all players
          );
        }
      });
    }

    // Auto-play checkbox
    const autoPlayCheckbox = document.getElementById("music-autoplay-checkbox");
    if (autoPlayCheckbox) {
      autoPlayCheckbox.addEventListener("change", (e) => {
        this.musicPlayerManager.autoPlayEnabled = e.target.checked;
        console.log(
          `🎵 Auto-play ${e.target.checked ? "enabled" : "disabled"}`
        );
      });
    }

    // Pagination buttons
    const prevBtn = document.getElementById("music-prev-page");
    const nextBtn = document.getElementById("music-next-page");
    if (prevBtn) {
      prevBtn.addEventListener("click", () => {
        this.musicPlayerManager.previousPage();
      });
    }
    if (nextBtn) {
      nextBtn.addEventListener("click", () => {
        this.musicPlayerManager.nextPage();
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
  const game = new Game();
  window.game = game; // Make accessible to NetworkManager

  // Debug command to check cat status
  window.checkCats = () => {
    if (!game.petManager) {
      console.log("❌ Pet Manager not initialized");
      return;
    }

    const status = game.petManager.getHostStatus();
    console.log("🐱 Cat Status:");
    console.log(
      `   - Is Host: ${
        status.isHost
          ? "✅ YES (cats should be moving)"
          : "❌ NO (waiting for host updates)"
      }`
    );
    console.log(`   - Cat Count: ${status.petCount}`);

    if (status.petCount === 0) {
      console.log("   ⚠️ No cats spawned yet!");
    }

    // List all cats
    game.petManager.pets.forEach((pet, id) => {
      const pos = pet.mesh.position;
      console.log(
        `   - Cat ${id.substring(0, 8)}: (${pos.x.toFixed(1)}, ${pos.z.toFixed(
          1
        )}) Target: ${pet.target ? "YES" : "NO"}`
      );
    });

    console.log("\n💡 Type checkCats() again to refresh status");
    console.log("💡 Type takeOverCats() to force take control of cats");
  };

  // Allow manual takeover of cat control
  window.takeOverCats = () => {
    if (!game.petManager) {
      console.log("❌ Pet Manager not initialized");
      return;
    }

    console.log("👑 Manually taking over cat control...");
    game.petManager.forceHostControl();
  };

  // Toggle pathfinding debug mode
  window.togglePathDebug = () => {
    if (!game.networkManager?.socket) {
      console.log("❌ Not connected to server");
      return;
    }

    game.networkManager.socket.emit("togglePathDebug");
    console.log("� Toggling pathfinding debug mode on server...");
  };

  console.log(
    "�💡 Debug: Type checkCats() in console to check cat movement status"
  );
  console.log("💡 Debug: Type takeOverCats() to manually take control of cats");
  console.log(
    "💡 Debug: Type togglePathDebug() to see detailed pathfinding info"
  );
});
