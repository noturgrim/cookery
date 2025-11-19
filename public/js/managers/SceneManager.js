import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
import { GLTFLoader } from "https://unpkg.com/three@0.160.0/examples/jsm/loaders/GLTFLoader.js";

/**
 * Scene Manager
 * Handles Three.js scene, camera, renderer, lights, and floor setup
 */
export class SceneManager {
  constructor() {
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.floor = null;
    this.raycaster = new THREE.Raycaster();
    this.gltfLoader = new GLTFLoader();
    this.clock = new THREE.Clock();

    // Food items management
    this.foodModels = new Map();
    this.foodItems = new Map();

    // Obstacles
    this.obstacles = [];

    // Loading manager for textures
    this.loadingManager = new THREE.LoadingManager();
    this.textureLoader = new THREE.TextureLoader(this.loadingManager);

    // Track loading progress
    this.isLoading = true;
    this.setupLoadingManager();

    // Collision box visualization
    this.collisionBoxes = [];
    this.showCollisionBoxes = false;
  }

  /**
   * Setup loading manager to track asset loading
   */
  setupLoadingManager() {
    this.loadingManager.onStart = (url, itemsLoaded, itemsTotal) => {
      console.log(`🔄 Loading: ${url}`);
    };

    this.loadingManager.onProgress = (url, itemsLoaded, itemsTotal) => {
      const progress = Math.round((itemsLoaded / itemsTotal) * 100);
      console.log(`📦 Loading progress: ${progress}%`);

      // Update loading screen if it exists
      const loadingElement = document.getElementById("loading");
      if (loadingElement) {
        const loadingText = loadingElement.querySelector("div");
        if (loadingText) {
          loadingText.textContent = `Loading... ${progress}%`;
        }
      }
    };

    this.loadingManager.onLoad = () => {
      console.log("✅ All assets loaded!");
      this.isLoading = false;

      // Hide loading screen after a short delay
      setTimeout(() => {
        const loadingElement = document.getElementById("loading");
        if (loadingElement) {
          loadingElement.style.opacity = "0";
          setTimeout(() => {
            loadingElement.style.display = "none";
          }, 300);
        }
      }, 500);
    };

    this.loadingManager.onError = (url) => {
      console.error(`❌ Error loading: ${url}`);
    };
  }

  /**
   * Setup Three.js Scene with Orthographic Camera
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

    // Position camera for isometric angle
    this.camera.position.set(15, 15, 15);
    this.camera.lookAt(0, 0, 0);

    // Create renderer with performance optimizations
    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: "high-performance",
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.BasicShadowMap;

    document
      .getElementById("game-container")
      .appendChild(this.renderer.domElement);
  }

  /**
   * Setup lights in the scene
   */
  setupLights() {
    // Ambient light for overall illumination
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambientLight);

    // Directional light for shadows
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(10, 20, 10);
    directionalLight.castShadow = true;

    // Configure shadow properties
    directionalLight.shadow.camera.left = -30;
    directionalLight.shadow.camera.right = 30;
    directionalLight.shadow.camera.top = 30;
    directionalLight.shadow.camera.bottom = -30;
    directionalLight.shadow.mapSize.width = 1024;
    directionalLight.shadow.mapSize.height = 1024;

    this.scene.add(directionalLight);
  }

  /**
   * Create the game floor with texture
   */
  createFloor() {
    const floorGeometry = new THREE.PlaneGeometry(40, 40);

    // Load texture from file using the loading manager
    const texture = this.textureLoader.load("/floor/floor2.jpg");

    // Configure texture for tiling
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(8, 8); // Adjust this number to make tiles bigger (smaller number) or smaller (larger number)

    const floorMaterial = new THREE.MeshStandardMaterial({
      map: texture,
      roughness: 0.8,
      metalness: 0.1,
    });

    this.floor = new THREE.Mesh(floorGeometry, floorMaterial);
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.receiveShadow = true;
    this.scene.add(this.floor);

    // Add subtle grid helper (optional - remove if you don't want the grid)
    const gridHelper = new THREE.GridHelper(40, 20, 0x999999, 0xcccccc);
    gridHelper.material.opacity = 0.2;
    gridHelper.material.transparent = true;
    this.scene.add(gridHelper);
  }

  /**
   * Load a furniture model from GLB
   */
  async loadFurnitureModel(furnitureName) {
    return new Promise((resolve, reject) => {
      this.gltfLoader.load(
        `/furniture/glb/${furnitureName}.glb`,
        (gltf) => {
          gltf.scene.traverse((child) => {
            if (child.isMesh) {
              child.castShadow = true;
              child.receiveShadow = true;

              if (child.material) {
                child.material.transparent = false;
                child.material.opacity = 1.0;
                child.material.depthWrite = true;
              }
            }
          });
          resolve(gltf.scene);
        },
        undefined,
        (error) => {
          console.warn(`Failed to load furniture ${furnitureName}:`, error);
          reject(error);
        }
      );
    });
  }

  /**
   * Create an obstacle/counter with 3D model
   */
  async createObstacle(obstacleData) {
    let obstacle;

    // Try to load a 3D model for kitchen counters
    if (obstacleData.model) {
      try {
        const model = await this.loadFurnitureModel(obstacleData.model);
        obstacle = model;

        // Scale the model if specified
        if (obstacleData.scale) {
          obstacle.scale.set(
            obstacleData.scale,
            obstacleData.scale,
            obstacleData.scale
          );
        }
      } catch (error) {
        console.warn(
          `Failed to load model ${obstacleData.model}, using box instead`
        );
        obstacle = this.createBoxObstacle(obstacleData);
      }
    } else {
      // Fallback to simple box
      obstacle = this.createBoxObstacle(obstacleData);
    }

    obstacle.position.set(obstacleData.x, obstacleData.y, obstacleData.z);

    // Apply rotation if specified
    if (obstacleData.rotation) {
      obstacle.rotation.y = obstacleData.rotation;
    }

    // Calculate actual bounding box if it's a 3D model
    let bbox = null;
    if (obstacleData.model) {
      bbox = this.calculateBoundingBox(obstacle);
    }

    obstacle.userData = {
      id: obstacleData.id,
      type: obstacleData.type || "furniture",
      width: bbox ? bbox.width : obstacleData.width,
      height: bbox ? bbox.height : obstacleData.height,
      depth: bbox ? bbox.depth : obstacleData.depth,
    };

    this.scene.add(obstacle);
    this.obstacles.push(obstacle);

    return obstacle;
  }

  /**
   * Create a simple box obstacle (fallback)
   */
  createBoxObstacle(obstacleData) {
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
    obstacle.castShadow = true;
    obstacle.receiveShadow = true;

    return obstacle;
  }

  /**
   * Load a food model from GLB
   */
  async loadFoodModel(foodName) {
    if (this.foodModels.has(foodName)) {
      return this.foodModels.get(foodName).clone();
    }

    return new Promise((resolve, reject) => {
      this.gltfLoader.load(
        `/food/glb/${foodName}.glb`,
        (gltf) => {
          gltf.scene.traverse((child) => {
            if (child.isMesh) {
              child.castShadow = true;
              child.receiveShadow = true;

              if (child.material) {
                child.material.transparent = false;
                child.material.opacity = 1.0;
                child.material.depthWrite = true;
                child.material.flatShading = true;
              }
            }
          });

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
  async spawnFoodItem(foodName, x, y, z, scale = 0.3, itemId = null) {
    try {
      const foodModel = await this.loadFoodModel(foodName);
      foodModel.scale.set(scale, scale, scale);
      foodModel.position.set(x, y, z);

      // Calculate actual bounding box after scaling
      const bbox = this.calculateBoundingBox(foodModel);

      // Add metadata to make it editable
      // Use provided ID for persistence, or generate new one
      const finalItemId = itemId || `food_${foodName}_${Date.now()}`;
      foodModel.userData = {
        id: finalItemId,
        type: "food",
        name: foodName,
        x: x,
        y: y,
        z: z,
        scale: scale,
        width: bbox.width,
        height: bbox.height,
        depth: bbox.depth,
        rotation: 0,
      };

      this.scene.add(foodModel);

      this.foodItems.set(finalItemId, {
        model: foodModel,
        name: foodName,
        position: { x, y, z },
        scale: scale,
      });

      console.log(
        `✅ Spawned ${foodName} at (${x}, ${y}, ${z}) scale:${scale} size:(${bbox.width.toFixed(
          2
        )}x${bbox.height.toFixed(2)}x${bbox.depth.toFixed(
          2
        )}) id:${finalItemId}`
      );
      return foodModel;
    } catch (error) {
      console.error(`Failed to spawn ${foodName}:`, error);
      return null;
    }
  }

  /**
   * Get all editable objects (obstacles + food)
   */
  getAllEditableObjects() {
    const editableObjects = [...this.obstacles];

    // Add all food items
    this.foodItems.forEach((foodData) => {
      editableObjects.push(foodData.model);
    });

    return editableObjects;
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
   * Get delta time
   */
  getDelta() {
    return this.clock.getDelta();
  }

  /**
   * Render the scene
   */
  render() {
    if (this.scene && this.renderer && this.camera) {
      this.renderer.render(this.scene, this.camera);
    }
  }

  /**
   * Add object to scene
   */
  add(object) {
    this.scene.add(object);
  }

  /**
   * Remove object from scene
   */
  remove(object) {
    this.scene.remove(object);
  }

  /**
   * Calculate actual bounding box for an object (including scale)
   */
  calculateBoundingBox(object) {
    const box = new THREE.Box3().setFromObject(object);
    const size = new THREE.Vector3();
    box.getSize(size);
    const center = new THREE.Vector3();
    box.getCenter(center);

    return {
      width: size.x,
      height: size.y,
      depth: size.z,
      center: center,
    };
  }

  /**
   * Create a collision box helper (green wireframe box) from object
   */
  createCollisionBoxFromObject(object) {
    const bbox = this.calculateBoundingBox(object);

    const geometry = new THREE.BoxGeometry(bbox.width, bbox.height, bbox.depth);
    const edges = new THREE.EdgesGeometry(geometry);
    const material = new THREE.LineBasicMaterial({
      color: 0x00ff00,
      linewidth: 2,
      transparent: true,
      opacity: 0.8,
    });
    const wireframe = new THREE.LineSegments(edges, material);

    // Position at the center of the bounding box
    wireframe.position.copy(bbox.center);
    wireframe.userData.isCollisionBox = true;
    wireframe.userData.boundingBox = bbox;

    return wireframe;
  }

  /**
   * Create a collision box helper (green wireframe box) - legacy method
   */
  createCollisionBox(width, height, depth, x, y, z) {
    const geometry = new THREE.BoxGeometry(width, height, depth);
    const edges = new THREE.EdgesGeometry(geometry);
    const material = new THREE.LineBasicMaterial({
      color: 0x00ff00,
      linewidth: 2,
      transparent: true,
      opacity: 0.8,
    });
    const wireframe = new THREE.LineSegments(edges, material);
    wireframe.position.set(x, y, z);
    wireframe.userData.isCollisionBox = true;
    return wireframe;
  }

  /**
   * Create collision box for player based on actual model geometry
   */
  createPlayerCollisionBox(playerMesh) {
    // Calculate actual bounding box from the player mesh
    const bbox = this.calculateBoundingBox(playerMesh);

    const geometry = new THREE.BoxGeometry(bbox.width, bbox.height, bbox.depth);
    const edges = new THREE.EdgesGeometry(geometry);
    const material = new THREE.LineBasicMaterial({
      color: 0x00ffff, // Cyan for players (different from green obstacles)
      linewidth: 2,
      transparent: true,
      opacity: 0.9,
    });
    const wireframe = new THREE.LineSegments(edges, material);

    // Position at the center of the bounding box
    wireframe.position.copy(bbox.center);
    wireframe.userData.isCollisionBox = true;
    wireframe.userData.isPlayerBox = true;
    wireframe.userData.boundingBox = bbox;

    return wireframe;
  }

  /**
   * Update player collision box to match current mesh position
   */
  updatePlayerCollisionBox(collisionBox, playerMesh) {
    if (!collisionBox || !playerMesh) return;

    // Recalculate bounding box for current position/pose
    const bbox = this.calculateBoundingBox(playerMesh);

    // Update position to match new bounding box center
    collisionBox.position.copy(bbox.center);
    collisionBox.userData.boundingBox = bbox;
  }

  /**
   * Toggle collision box visualization for all objects
   */
  toggleCollisionBoxes(playerManager) {
    this.showCollisionBoxes = !this.showCollisionBoxes;

    if (this.showCollisionBoxes) {
      // Create collision boxes for all obstacles
      this.obstacles.forEach((obstacle) => {
        const collisionBox = this.createCollisionBoxFromObject(obstacle);

        // Store reference to parent object
        collisionBox.userData.parentObject = obstacle;
        obstacle.userData.collisionBox = collisionBox;

        this.scene.add(collisionBox);
        this.collisionBoxes.push(collisionBox);
      });

      // Create collision boxes for all food items
      this.foodItems.forEach((foodData, itemId) => {
        const model = foodData.model;
        const collisionBox = this.createCollisionBoxFromObject(model);

        // Store reference to parent object
        collisionBox.userData.parentObject = model;
        model.userData.collisionBox = collisionBox;

        this.scene.add(collisionBox);
        this.collisionBoxes.push(collisionBox);
      });

      // Create collision boxes for all players
      if (playerManager) {
        playerManager.getAllPlayers().forEach((player, playerId) => {
          if (!player.collisionBox && player.mesh) {
            const collisionBox = this.createPlayerCollisionBox(player.mesh);
            player.collisionBox = collisionBox;
            this.scene.add(collisionBox);
            this.collisionBoxes.push(collisionBox);
          }
        });
      }

      const playerCount = playerManager
        ? playerManager.getAllPlayers().size
        : 0;
      console.log(
        `✅ Collision boxes ON (${this.collisionBoxes.length} boxes: objects + ${playerCount} players)`
      );
    } else {
      // Remove all collision boxes
      this.collisionBoxes.forEach((box) => {
        this.scene.remove(box);
      });
      this.collisionBoxes = [];

      // Clear collision box references
      this.obstacles.forEach((obstacle) => {
        delete obstacle.userData.collisionBox;
      });
      this.foodItems.forEach((foodData) => {
        delete foodData.model.userData.collisionBox;
      });

      // Clear player collision boxes
      if (playerManager) {
        playerManager.getAllPlayers().forEach((player) => {
          player.collisionBox = null;
        });
      }

      console.log("❌ Collision boxes OFF");
    }

    this.render();
  }

  /**
   * Update collision box positions (called when objects are moved)
   */
  updateCollisionBoxes() {
    if (!this.showCollisionBoxes) return;

    this.collisionBoxes.forEach((box) => {
      const parent = box.userData.parentObject;
      if (parent) {
        // Recalculate bounding box to account for rotation/scale changes
        const bbox = this.calculateBoundingBox(parent);
        box.position.copy(bbox.center);
        box.userData.boundingBox = bbox;
      }
    });
  }

  /**
   * Add collision box for a single object
   */
  addCollisionBoxForObject(object) {
    if (!this.showCollisionBoxes) return;

    // Remove existing collision box if present
    if (object.userData.collisionBox) {
      this.removeCollisionBoxForObject(object);
    }

    const collisionBox = this.createCollisionBoxFromObject(object);

    collisionBox.userData.parentObject = object;
    object.userData.collisionBox = collisionBox;

    this.scene.add(collisionBox);
    this.collisionBoxes.push(collisionBox);

    return collisionBox;
  }

  /**
   * Remove collision box for a single object
   */
  removeCollisionBoxForObject(object) {
    if (object.userData.collisionBox) {
      this.scene.remove(object.userData.collisionBox);
      const index = this.collisionBoxes.indexOf(object.userData.collisionBox);
      if (index > -1) {
        this.collisionBoxes.splice(index, 1);
      }
      delete object.userData.collisionBox;
    }
  }
}
