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
   * Create the game floor
   */
  createFloor() {
    const floorGeometry = new THREE.PlaneGeometry(40, 40);
    const floorMaterial = new THREE.MeshStandardMaterial({
      color: 0x90ee90,
      roughness: 0.8,
      metalness: 0.2,
    });

    this.floor = new THREE.Mesh(floorGeometry, floorMaterial);
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.receiveShadow = true;
    this.scene.add(this.floor);

    // Add grid helper
    const gridHelper = new THREE.GridHelper(40, 20, 0x444444, 0x888888);
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

    obstacle.userData = {
      id: obstacleData.id,
      type: obstacleData.type || "furniture",
      width: obstacleData.width,
      height: obstacleData.height,
      depth: obstacleData.depth,
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
  async spawnFoodItem(foodName, x, y, z, scale = 0.3) {
    try {
      const foodModel = await this.loadFoodModel(foodName);
      foodModel.scale.set(scale, scale, scale);
      foodModel.position.set(x, y, z);

      // Add metadata to make it editable
      const itemId = `food_${foodName}_${Date.now()}`;
      foodModel.userData = {
        id: itemId,
        type: "food",
        name: foodName,
        scale: scale,
        width: 1,
        height: 1,
        depth: 1,
      };

      this.scene.add(foodModel);

      this.foodItems.set(itemId, {
        model: foodModel,
        name: foodName,
        position: { x, y, z },
        scale: scale,
      });

      console.log(
        `✅ Spawned ${foodName} at (${x}, ${y}, ${z}) scale:${scale}`
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
}
