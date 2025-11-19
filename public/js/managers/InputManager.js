import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";

/**
 * Input Manager
 * Handles all input: mouse clicks, keyboard, emote wheel, obstacle editing
 */
export class InputManager {
  constructor(sceneManager, uiManager, networkManager) {
    this.sceneManager = sceneManager;
    this.uiManager = uiManager;
    this.networkManager = networkManager;

    this.mouse = new THREE.Vector2();
    this.raycaster = new THREE.Raycaster();

    // Edit mode state
    this.editMode = false;
    this.selectedObstacle = null;
    this.isDraggingObstacle = false;
    this.dragOffset = new THREE.Vector3();
    this.deleteMode = false;

    // Available models
    this.furnitureModels = [];
    this.foodModels = [];

    // Emote wheel state
    this.emoteWheelActive = false;
    this.selectedEmote = null;
  }

  /**
   * Setup all input listeners
   */
  setupInput() {
    // Click to move
    window.addEventListener("click", (e) => this.handleClick(e));

    // Mouse movement
    window.addEventListener("mousemove", (e) => this.handleMouseMove(e));
    window.addEventListener("mousedown", (e) => this.handleMouseDown(e));
    window.addEventListener("mouseup", (e) => this.handleMouseUp(e));

    // Keyboard
    window.addEventListener("keydown", (e) => this.handleKeyDown(e));

    // Emote wheel
    this.setupEmoteWheel();
  }

  /**
   * Handle key down events
   */
  handleKeyDown(e) {
    if (e.code === "KeyE") {
      this.toggleEditMode();
    }

    if (e.code === "KeyB") {
      this.toggleSpawnMenu();
    }

    if (
      (e.code === "Delete" || e.code === "Backspace") &&
      this.editMode &&
      this.selectedObstacle
    ) {
      e.preventDefault();
      this.deleteSelectedObject();
    }
  }

  /**
   * Handle click events
   */
  handleClick(event) {
    // If in edit mode, don't move player
    if (this.editMode) return;

    // Update raycaster
    this.raycaster.setFromCamera(this.mouse, this.sceneManager.camera);

    // Check intersection with floor
    const intersects = this.raycaster.intersectObject(this.sceneManager.floor);

    if (intersects.length > 0) {
      const point = intersects[0].point;

      // Send move command to server
      this.networkManager.moveTo(point.x, point.z);

      // Visual feedback
      this.uiManager.createMoveMarker(point.x, point.z);

      console.log(
        `🎯 Moving to: (${point.x.toFixed(2)}, ${point.z.toFixed(2)})`
      );
    }
  }

  /**
   * Handle mouse move events
   */
  handleMouseMove(event) {
    // Calculate mouse position in normalized device coordinates
    this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    // Handle obstacle dragging
    if (this.isDraggingObstacle && this.selectedObstacle) {
      this.raycaster.setFromCamera(this.mouse, this.sceneManager.camera);

      // Intersect with an invisible plane at obstacle height
      const plane = new THREE.Plane(
        new THREE.Vector3(0, 1, 0),
        -this.selectedObstacle.position.y
      );
      const intersection = new THREE.Vector3();

      this.raycaster.ray.intersectPlane(plane, intersection);

      if (intersection) {
        this.selectedObstacle.position.x = intersection.x - this.dragOffset.x;
        this.selectedObstacle.position.z = intersection.z - this.dragOffset.z;
      }
    }
  }

  /**
   * Handle mouse down events
   */
  handleMouseDown(event) {
    if (!this.editMode) return;

    this.raycaster.setFromCamera(this.mouse, this.sceneManager.camera);
    const editableObjects = this.sceneManager.getAllEditableObjects();
    const intersects = this.raycaster.intersectObjects(editableObjects, true);

    if (intersects.length > 0) {
      // Find the parent object (not a child mesh)
      let targetObject = intersects[0].object;
      while (targetObject.parent && !targetObject.userData.id) {
        targetObject = targetObject.parent;
      }

      // If in delete mode, delete the object
      if (this.deleteMode) {
        this.deleteObject(targetObject);
        return;
      }

      this.selectedObstacle = targetObject;
      this.isDraggingObstacle = true;

      // Calculate offset from obstacle center
      const point = intersects[0].point;
      this.dragOffset.copy(point).sub(this.selectedObstacle.position);

      // Highlight selected obstacle
      this.highlightObject(this.selectedObstacle);

      console.log(
        `📦 Selected: ${this.selectedObstacle.userData.id || "object"}`
      );
    }
  }

  /**
   * Handle mouse up events
   */
  handleMouseUp(event) {
    if (this.isDraggingObstacle && this.selectedObstacle) {
      const isFood = this.selectedObstacle.userData.type === "food";

      // Send new position to server (food or furniture)
      if (isFood) {
        this.networkManager.updateFood(
          this.selectedObstacle.userData.id,
          this.selectedObstacle.position.x,
          this.selectedObstacle.position.y,
          this.selectedObstacle.position.z
        );
      } else {
        this.networkManager.updateObstacle(
          this.selectedObstacle.userData.id,
          this.selectedObstacle.position.x,
          this.selectedObstacle.position.y,
          this.selectedObstacle.position.z
        );
      }

      console.log(
        `✅ Moved ${isFood ? "🍔" : "🪑"} ${
          this.selectedObstacle.userData.id
        } to (${this.selectedObstacle.position.x.toFixed(
          2
        )}, ${this.selectedObstacle.position.z.toFixed(2)})`
      );

      // Log the code snippet for easy copy-paste (furniture only)
      if (!isFood) {
        console.log(`📋 Copy this to server/index.js:`);
        console.log(`  {`);
        console.log(`    id: "${this.selectedObstacle.userData.id}",`);
        console.log(`    x: ${this.selectedObstacle.position.x.toFixed(2)},`);
        console.log(`    y: ${this.selectedObstacle.position.y.toFixed(2)},`);
        console.log(`    z: ${this.selectedObstacle.position.z.toFixed(2)},`);
        console.log(`    width: ${this.selectedObstacle.userData.width},`);
        console.log(`    height: ${this.selectedObstacle.userData.height},`);
        console.log(`    depth: ${this.selectedObstacle.userData.depth},`);
        console.log(`  },`);
      }
    }

    this.isDraggingObstacle = false;
    if (this.selectedObstacle) {
      this.removeHighlight(this.selectedObstacle);
      this.selectedObstacle = null;
    }
  }

  /**
   * Highlight an object (works with both simple meshes and 3D models)
   */
  highlightObject(object) {
    object.traverse((child) => {
      if (child.isMesh && child.material) {
        if (!child.userData.originalEmissive) {
          child.userData.originalEmissive = child.material.emissive
            ? child.material.emissive.getHex()
            : 0x000000;
        }
        if (child.material.emissive) {
          child.material.emissive.setHex(0xff6b00); // Orange highlight
        }
      }
    });
  }

  /**
   * Remove highlight from an object
   */
  removeHighlight(object) {
    object.traverse((child) => {
      if (child.isMesh && child.material) {
        if (
          child.material.emissive &&
          child.userData.originalEmissive !== undefined
        ) {
          child.material.emissive.setHex(child.userData.originalEmissive);
        }
      }
    });
  }

  /**
   * Toggle edit mode
   */
  toggleEditMode() {
    this.editMode = !this.editMode;

    // Update all editable objects visual feedback
    const allEditableObjects = this.sceneManager.getAllEditableObjects();
    allEditableObjects.forEach((object) => {
      if (this.editMode) {
        this.highlightObject(object);
      } else {
        this.removeHighlight(object);
      }
    });

    console.log(
      this.editMode
        ? "🔧 Edit Mode ON - Click and drag tables"
        : "✅ Edit Mode OFF"
    );

    // Log all current positions when entering edit mode
    if (this.editMode) {
      console.log("\n📍 Current Layout (copy to server/index.js):");
      console.log("obstacles: [");
      this.sceneManager.obstacles.forEach((obstacle) => {
        console.log(`  {`);
        console.log(`    id: "${obstacle.userData.id}",`);
        console.log(`    x: ${obstacle.position.x.toFixed(2)},`);
        console.log(`    y: ${obstacle.position.y.toFixed(2)},`);
        console.log(`    z: ${obstacle.position.z.toFixed(2)},`);
        console.log(`    width: ${obstacle.userData.width},`);
        console.log(`    height: ${obstacle.userData.height},`);
        console.log(`    depth: ${obstacle.userData.depth},`);
        console.log(`  },`);
      });
      console.log("];\n");
    }

    this.uiManager.updateEditModeUI(this.editMode);
  }

  /**
   * Setup emote/voice wheel
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
          this.networkManager.playEmote(this.selectedEmote);
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

      // Click to select
      option.addEventListener("click", (e) => {
        if (this.emoteWheelActive) {
          e.stopPropagation();
          this.networkManager.playEmote(option.dataset.emote);
          this.emoteWheelActive = false;
          container.classList.remove("active");
          emoteOptions.forEach((opt) => opt.classList.remove("highlighted"));
        }
      });
    });
  }

  /**
   * Toggle spawn menu
   */
  toggleSpawnMenu() {
    const menu = document.getElementById("spawn-menu");
    menu.classList.toggle("active");

    // Load available models if not already loaded
    if (this.furnitureModels.length === 0) {
      this.loadAvailableModels();
    }
  }

  /**
   * Load available models from directories
   */
  async loadAvailableModels() {
    // Hardcoded list of furniture models (from your glb directory)
    this.furnitureModels = [
      "table",
      "tableRound",
      "tableCoffee",
      "tableCoffeeSquare",
      "kitchenCabinet",
      "kitchenBar",
      "kitchenSink",
      "kitchenStove",
      "chair",
      "chairCushion",
      "stoolBar",
      "desk",
      "bookcase",
      "shelf",
    ];

    // Hardcoded list of food models
    this.foodModels = [
      "apple",
      "banana",
      "orange",
      "tomato",
      "lettuce",
      "onion",
      "cheese",
      "bread",
      "burger",
      "pizza",
      "hotdog",
      "carrot",
      "potato",
      "pumpkin",
      "cucumber",
      "meat",
      "fish",
      "chicken",
    ];

    this.populateSpawnMenu();
  }

  /**
   * Populate spawn menu with items
   */
  populateSpawnMenu() {
    const furnitureContainer = document.getElementById("furniture-items");
    const foodContainer = document.getElementById("food-items");

    // Clear existing items
    furnitureContainer.innerHTML = "";
    foodContainer.innerHTML = "";

    // Add furniture items
    this.furnitureModels.forEach((model) => {
      const item = document.createElement("div");
      item.className = "spawn-item";
      item.textContent = model;
      item.onclick = () => this.spawnFurniture(model);
      furnitureContainer.appendChild(item);
    });

    // Add food items
    this.foodModels.forEach((model) => {
      const item = document.createElement("div");
      item.className = "spawn-item";
      item.textContent = model;
      item.onclick = () => this.spawnFood(model);
      foodContainer.appendChild(item);
    });

    // Setup delete mode button
    const deleteBtn = document.getElementById("delete-mode-btn");
    deleteBtn.onclick = () => this.toggleDeleteMode();
  }

  /**
   * Spawn furniture at center
   */
  async spawnFurniture(modelName) {
    try {
      const furniture = await this.sceneManager.loadFurnitureModel(modelName);
      furniture.position.set(0, 0, 0);
      furniture.scale.set(4, 4, 4); // Default scale 4 for furniture

      furniture.userData = {
        id: `furniture_${modelName}_${Date.now()}`,
        type: "furniture",
        name: modelName,
        width: 4,
        height: 2,
        depth: 4,
        model: modelName,
        scale: 4,
      };

      this.sceneManager.scene.add(furniture);
      this.sceneManager.obstacles.push(furniture);

      // Highlight only if edit mode is on
      if (this.editMode) {
        this.highlightObject(furniture);
      }

      // Send to server for database persistence
      this.networkManager.spawnObstacle(furniture.userData);

      console.log(`✨ Spawned furniture: ${modelName} at scale 4`);
    } catch (error) {
      console.error(`Failed to spawn furniture ${modelName}:`, error);
    }
  }

  /**
   * Spawn food at center
   */
  async spawnFood(foodName) {
    const foodModel = await this.sceneManager.spawnFoodItem(
      foodName,
      0,
      1.5, // Height above ground
      0,
      1.5 // Default scale 1.5 for food
    );
    if (foodModel) {
      // Highlight only if edit mode is on
      if (this.editMode) {
        this.highlightObject(foodModel);
      }

      // Send to server for database persistence
      this.networkManager.spawnFood({
        id: foodModel.userData.id,
        name: foodName,
        x: 0,
        y: 1.5,
        z: 0,
        scale: 1.5,
      });

      console.log(`✨ Spawned food: ${foodName} at scale 1.5`);
    }
  }

  /**
   * Toggle delete mode
   */
  toggleDeleteMode() {
    this.deleteMode = !this.deleteMode;
    const btn = document.getElementById("delete-mode-btn");

    if (this.deleteMode) {
      btn.textContent = "🗑️ Delete Mode (ON)";
      btn.classList.add("active");
      console.log("🗑️ Delete Mode ON - Click objects to delete them");
    } else {
      btn.textContent = "🗑️ Delete Mode (OFF)";
      btn.classList.remove("active");
      console.log("✅ Delete Mode OFF");
    }
  }

  /**
   * Delete an object
   */
  deleteObject(object) {
    if (!object || !object.userData.id) return;

    const objectId = object.userData.id;
    const objectType = object.userData.type;

    // Remove from scene
    this.sceneManager.scene.remove(object);

    // Remove from appropriate array
    if (objectType === "food") {
      this.sceneManager.foodItems.delete(objectId);
      // Delete from database via server
      this.networkManager.deleteFood(objectId);
    } else {
      const index = this.sceneManager.obstacles.indexOf(object);
      if (index > -1) {
        this.sceneManager.obstacles.splice(index, 1);
      }
      // Delete from database via server
      this.networkManager.deleteObstacle(objectId);
    }

    console.log(`🗑️ Deleted: ${objectId}`);
  }

  /**
   * Delete selected object
   */
  deleteSelectedObject() {
    if (this.selectedObstacle) {
      this.deleteObject(this.selectedObstacle);
      this.selectedObstacle = null;
    }
  }
}
