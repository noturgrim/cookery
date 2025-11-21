import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";

/**
 * Input Manager
 * Handles all input: mouse clicks, keyboard, emote wheel, obstacle editing
 */
export class InputManager {
  constructor(sceneManager, uiManager, networkManager, soundManager) {
    this.sceneManager = sceneManager;
    this.uiManager = uiManager;
    this.networkManager = networkManager;
    this.soundManager = soundManager;

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

    // Action wheel state
    this.actionWheelActive = false;
    this.selectedAction = null;

    // Camera panning state
    this.isPanning = false;
    this.lastPanPosition = { x: 0, y: 0 };
    this.cameraOffset = { x: 0, z: 0 };

    // Day-Night UI reference (will be set externally)
    this.dayNightUI = null;
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

    // Mouse wheel for zoom
    window.addEventListener("wheel", (e) => this.handleWheel(e), {
      passive: false,
    });

    // Keyboard
    window.addEventListener("keydown", (e) => this.handleKeyDown(e));

    // Prevent context menu on right-click
    window.addEventListener("contextmenu", (e) => e.preventDefault());

    // Emote wheel
    this.setupEmoteWheel();

    // Action wheel
    this.setupActionWheel();
  }

  /**
   * Handle key down events
   */
  handleKeyDown(e) {
    // If spawn menu is open
    if (this.isSpawnMenuOpen()) {
      // Check if user is typing in the search field
      const searchInput = document.getElementById("model-search");
      const isTypingInSearch =
        searchInput && document.activeElement === searchInput;

      // ESC always closes the menu
      if (e.code === "Escape") {
        e.preventDefault();
        this.closeSpawnMenu();
        return;
      }

      // B only closes menu if NOT typing in search field
      if (e.code === "KeyB" && !isTypingInSearch) {
        e.preventDefault();
        this.closeSpawnMenu();
        return;
      }

      // Block all other game hotkeys when menu is open (but allow typing in search)
      if (!isTypingInSearch) {
        return;
      }
      // If typing in search, let the key through for the input field
      return;
    }

    // If settings modal is open
    if (this.isSettingsOpen()) {
      // ESC closes the modal
      if (e.code === "Escape") {
        e.preventDefault();
        const modal = document.getElementById("settings-modal");
        if (modal) {
          modal.style.display = "none";
        }
        return;
      }
      // Block all game hotkeys when settings is open
      return;
    }

    if (e.code === "KeyE") {
      this.toggleEditMode();
    }

    if (e.code === "KeyB") {
      this.toggleSpawnMenu();
    }

    // Toggle speaker connection mode with L key (Link)
    if (e.code === "KeyL") {
      this.toggleConnectionMode();
    }

    // Toggle collision boxes with V key (when not in action wheel)
    if (e.code === "KeyV" && !this.actionWheelActive) {
      this.toggleCollisionBoxes();
    }

    // Toggle day-night UI with N key
    if (e.code === "KeyN") {
      this.toggleDayNightUI();
    }

    if (
      (e.code === "Delete" || e.code === "Backspace") &&
      this.editMode &&
      this.selectedObstacle
    ) {
      e.preventDefault();
      this.deleteSelectedObject();
    }

    // Controls for selected object in edit mode
    if (this.editMode && this.selectedObstacle) {
      // Rotation controls (Q and R keys)
      if (e.code === "KeyQ") {
        e.preventDefault();
        this.rotateSelectedObject(-Math.PI / 8); // Rotate 22.5 degrees left
      }
      if (e.code === "KeyR") {
        e.preventDefault();
        this.rotateSelectedObject(Math.PI / 8); // Rotate 22.5 degrees right
      }

      // Vertical movement controls (W and S keys)
      if (e.code === "KeyW") {
        e.preventDefault();
        this.moveSelectedObjectVertically(0.1); // Move up
      }
      if (e.code === "KeyS") {
        e.preventDefault();
        this.moveSelectedObjectVertically(-0.1); // Move down
      }

      // Toggle passthrough mode (P key) - for doorways/archways
      if (e.code === "KeyP") {
        e.preventDefault();
        this.togglePassthrough();
      }

      // Opacity controls ([ and ] keys) - for walls/objects
      if (e.code === "BracketLeft") {
        e.preventDefault();
        this.adjustOpacity(-0.1); // Decrease opacity (more transparent)
      }
      if (e.code === "BracketRight") {
        e.preventDefault();
        this.adjustOpacity(0.1); // Increase opacity (more opaque)
      }
    }
  }

  /**
   * Handle mouse wheel for camera zoom
   */
  handleWheel(e) {
    // Allow scrolling in spawn menu
    if (e.target.closest("#spawn-menu")) {
      return;
    }

    // Block zoom if any menu is open
    if (this.isAnyMenuOpen()) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    const camera = this.sceneManager.camera;
    const zoomSpeed = 0.1; // Zoom factor per scroll
    const minZoom = 0.5; // Maximum zoom out (smaller = more zoomed out)
    const maxZoom = 3.0; // Maximum zoom in (larger = more zoomed in)

    // For OrthographicCamera, adjust the zoom property
    // Negative deltaY = scroll up = zoom in (increase zoom)
    // Positive deltaY = scroll down = zoom out (decrease zoom)
    if (e.deltaY < 0) {
      // Zoom in
      camera.zoom = Math.min(maxZoom, camera.zoom + zoomSpeed);
    } else {
      // Zoom out
      camera.zoom = Math.max(minZoom, camera.zoom - zoomSpeed);
    }

    // Update the projection matrix to apply the zoom
    camera.updateProjectionMatrix();

    // Force an immediate render
    this.sceneManager.render();
  }

  /**
   * Rotate selected object
   */
  rotateSelectedObject(angle) {
    if (!this.selectedObstacle) return;

    this.selectedObstacle.rotation.y += angle;

    // Send update to server (furniture only, food doesn't need rotation saved)
    if (this.selectedObstacle.userData.type !== "food") {
      this.networkManager.updateObstacle(
        this.selectedObstacle.userData.id,
        this.selectedObstacle.position.x,
        this.selectedObstacle.position.y,
        this.selectedObstacle.position.z,
        this.selectedObstacle.rotation.y
      );
    }

    // console.log(
    //   `🔄 Rotated ${this.selectedObstacle.userData.id} to ${(
    //     (this.selectedObstacle.rotation.y * 180) /
    //     Math.PI
    //   ).toFixed(0)}°`
    // );
  }

  /**
   * Move selected object vertically (Y-axis)
   */
  moveSelectedObjectVertically(amount) {
    if (!this.selectedObstacle) return;

    // Update Y position
    this.selectedObstacle.position.y += amount;

    // Clamp to reasonable bounds (0 to 10 units)
    this.selectedObstacle.position.y = Math.max(
      0,
      Math.min(10, this.selectedObstacle.position.y)
    );

    // Update lamp light position if this is a lamp
    if (this.sceneManager.lightingManager) {
      this.sceneManager.lightingManager.updateLightPosition(
        this.selectedObstacle
      );
    }

    // Send update to server
    if (this.selectedObstacle.userData.type === "food") {
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
        this.selectedObstacle.position.z,
        this.selectedObstacle.rotation.y
      );
    }

    // console.log(
    //   `⬆️ Moved ${
    //     this.selectedObstacle.userData.id
    //   } to Y: ${this.selectedObstacle.position.y.toFixed(2)}`
    // );
  }

  /**
   * Toggle passthrough mode for selected object (for doorways/archways)
   */
  togglePassthrough() {
    if (!this.selectedObstacle) return;

    // Only allow passthrough for furniture, not food items
    if (this.selectedObstacle.userData.type === "food") {
      console.log("⚠️ Cannot set passthrough on food items");
      return;
    }

    // Toggle the passthrough property
    this.selectedObstacle.userData.isPassthrough =
      !this.selectedObstacle.userData.isPassthrough;

    const isPassthrough = this.selectedObstacle.userData.isPassthrough;

    // Update the visual highlight color to indicate passthrough status
    if (isPassthrough) {
      // Green tint for passthrough objects
      this.selectedObstacle.traverse((child) => {
        if (child.isMesh && child.material) {
          if (!child.material.emissive) {
            child.material.emissive = new THREE.Color();
          }
          child.material.emissive.setHex(0x00ff00); // Green
        }
      });
    } else {
      // Orange tint for solid objects (regular highlight)
      this.highlightObject(this.selectedObstacle);
    }

    // Send update to server
    this.networkManager.updateObstacle(
      this.selectedObstacle.userData.id,
      this.selectedObstacle.position.x,
      this.selectedObstacle.position.y,
      this.selectedObstacle.position.z,
      this.selectedObstacle.rotation.y,
      isPassthrough
    );

    // console.log(
    //   `🚪 ${this.selectedObstacle.userData.id} passthrough: ${
    //     isPassthrough ? "ON (walkable)" : "OFF (solid)"
    //   }`
    // );

    // Force render
    this.sceneManager.render();
  }

  /**
   * Adjust opacity of selected object (for walls to see through them)
   */
  adjustOpacity(delta) {
    if (!this.selectedObstacle) return;

    // Initialize opacity if not set
    if (this.selectedObstacle.userData.opacity === undefined) {
      this.selectedObstacle.userData.opacity = 1.0;
    }

    // Adjust opacity (clamp between 0.1 and 1.0)
    this.selectedObstacle.userData.opacity = Math.max(
      0.1,
      Math.min(1.0, this.selectedObstacle.userData.opacity + delta)
    );

    const newOpacity = this.selectedObstacle.userData.opacity;

    // Apply opacity to all materials in the object
    this.selectedObstacle.traverse((child) => {
      if (child.isMesh && child.material) {
        // Enable transparency
        child.material.transparent = true;
        child.material.opacity = newOpacity;
        child.material.needsUpdate = true;
      }
    });

    console.log(
      `👁️ ${this.selectedObstacle.userData.id} opacity: ${(
        newOpacity * 100
      ).toFixed(0)}%`
    );

    // Send update to server (we'll need to add opacity to the update)
    this.networkManager.updateObstacleOpacity(
      this.selectedObstacle.userData.id,
      newOpacity
    );

    // Force render
    this.sceneManager.render();
  }

  /**
   * Handle click events
   */
  handleClick(event) {
    // Check for speaker connection mode FIRST (before any other checks)
    if (this.sceneManager.speakerConnectionManager?.connectionMode) {
      // Update mouse coordinates
      this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
      this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

      // Cast ray to find clicked object
      this.raycaster.setFromCamera(this.mouse, this.sceneManager.camera);
      const intersects = this.raycaster.intersectObjects(
        this.sceneManager.obstacles,
        true // Check all descendants
      );

      if (intersects.length > 0) {
        // Find the root obstacle object
        let object = intersects[0].object;
        while (object.parent && !object.userData.id) {
          object = object.parent;
        }

        // If we found an obstacle with ID, let connection manager handle it
        if (object.userData.id) {
          const handled =
            this.sceneManager.speakerConnectionManager.handleSpeakerClick(
              object
            );

          if (handled) {
            // Play click sound for feedback
            this.soundManager?.play("click", { volume: 0.6 });
            return; // Stop processing - connection mode handled it
          }
        }
      }
    }

    // Block clicks if any menu is open
    if (this.isAnyMenuOpen()) {
      return;
    }

    // If in edit mode, don't move player
    if (this.editMode) return;

    // Don't allow movement clicks if player is sitting or lying
    if (
      this.networkManager.interactionManager?.isPlayerSitting() ||
      this.networkManager.interactionManager?.isPlayerLying()
    ) {
      return;
    }

    // Update raycaster
    this.raycaster.setFromCamera(this.mouse, this.sceneManager.camera);

    // First check if clicking on an object (obstacle or food)
    const allObjects = [...this.sceneManager.obstacles];

    // Add food item models to clickable objects
    this.sceneManager.foodItems.forEach((foodData) => {
      allObjects.push(foodData.model);
    });

    const objectIntersects = this.raycaster.intersectObjects(
      allObjects,
      true // Check children
    );

    if (objectIntersects.length > 0) {
      // Find the parent object (obstacle or food)
      let clickedObject = objectIntersects[0].object;
      while (clickedObject.parent && !clickedObject.userData.id) {
        clickedObject = clickedObject.parent;
      }

      if (clickedObject.userData.id) {
        const objPos = clickedObject.position;

        // Play click sound
        this.soundManager?.play("click", { volume: 0.6 });

        // Send move command to object's position (server will find best interaction spot)
        this.networkManager.moveTo(objPos.x, objPos.z);

        // Visual feedback at object position
        this.uiManager.createMoveMarker(objPos.x, objPos.z);

        // console.log(
        //   `🎯 Moving to interact with: ${
        //     clickedObject.userData.id
        //   } at (${objPos.x.toFixed(2)}, ${objPos.z.toFixed(2)})`
        // );
        return;
      }
    }

    // If no object clicked, check intersection with floor
    const intersects = this.raycaster.intersectObject(this.sceneManager.floor);

    if (intersects.length > 0) {
      const point = intersects[0].point;

      // Play click sound
      this.soundManager?.play("click", { volume: 0.6 });

      // Send move command to server
      this.networkManager.moveTo(point.x, point.z);

      // Visual feedback
      this.uiManager.createMoveMarker(point.x, point.z);

      // console.log(
      //   `🎯 Moving to: (${point.x.toFixed(2)}, ${point.z.toFixed(2)})`
      // );
    }
  }

  /**
   * Handle mouse move events
   */
  handleMouseMove(event) {
    // Block mouse interactions if any menu is open
    if (this.isAnyMenuOpen()) {
      return;
    }

    // Calculate mouse position in normalized device coordinates
    this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    // Handle camera panning (right-click drag)
    if (this.isPanning) {
      const deltaX = event.clientX - this.lastPanPosition.x;
      const deltaY = event.clientY - this.lastPanPosition.y;

      // Calculate pan amount based on camera distance and angle
      const panSpeed = 0.02;
      const camera = this.sceneManager.camera;

      // For isometric camera, pan in the direction of drag
      // Since camera is at 45 degrees, we need to transform screen space to world space
      const worldDeltaX = (deltaX + deltaY) * panSpeed;
      const worldDeltaZ = (deltaY - deltaX) * panSpeed;

      this.cameraOffset.x -= worldDeltaX;
      this.cameraOffset.z -= worldDeltaZ;

      // Apply offset to camera position and look-at point
      const basePosition = { x: 15, y: 15, z: 15 };
      camera.position.set(
        basePosition.x + this.cameraOffset.x,
        basePosition.y,
        basePosition.z + this.cameraOffset.z
      );
      camera.lookAt(this.cameraOffset.x, 0, this.cameraOffset.z);

      this.lastPanPosition = { x: event.clientX, y: event.clientY };

      // Show cursor feedback
      document.body.style.cursor = "grabbing";
      return;
    }

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

        // Update lamp light position if this is a lamp
        if (this.sceneManager.lightingManager) {
          this.sceneManager.lightingManager.updateLightPosition(
            this.selectedObstacle
          );
        }
      }
    }
  }

  /**
   * Handle mouse down events
   */
  handleMouseDown(event) {
    // Block mouse down if any menu is open
    if (this.isAnyMenuOpen()) {
      return;
    }

    // Right-click to start panning
    if (event.button === 2) {
      this.isPanning = true;
      this.lastPanPosition = { x: event.clientX, y: event.clientY };
      document.body.style.cursor = "grab";
      return;
    }

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

      // Check if object is pending server confirmation
      if (targetObject.userData.isPending) {
        console.log(
          `⏳ Object ${targetObject.userData.id} is pending server confirmation...`
        );
        return; // Don't allow interaction with pending objects
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

      // Show object info including passthrough status
      const isPassthrough =
        this.selectedObstacle.userData.isPassthrough || false;
      console.log(
        `📦 Selected: ${this.selectedObstacle.userData.id || "object"} ${
          isPassthrough ? "[PASSTHROUGH]" : ""
        }`
      );
      console.log(
        `   Controls: Q/R = rotate, W/S = height, P = passthrough, [/] = opacity, Delete = remove`
      );
    }
  }

  /**
   * Handle mouse up events
   */
  handleMouseUp(event) {
    // Block mouse up if any menu is open (except for panning cleanup)
    if (this.isAnyMenuOpen() && !this.isPanning) {
      return;
    }

    // Stop panning on right-click release
    if (event.button === 2 || this.isPanning) {
      this.isPanning = false;
      document.body.style.cursor = "default";
      return;
    }

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
          this.selectedObstacle.position.z,
          this.selectedObstacle.rotation.y
        );
      }

      // console.log(
      //   `✅ Moved ${isFood ? "🍔" : "🪑"} ${
      //     this.selectedObstacle.userData.id
      //   } to (${this.selectedObstacle.position.x.toFixed(
      //     2
      //   )}, ${this.selectedObstacle.position.z.toFixed(2)})`
      // );

      // Log the code snippet for easy copy-paste (furniture only)
      // if (!isFood) {
      //   console.log(`📋 Copy this to server/index.js:`);
      //   console.log(`  {`);
      //   console.log(`    id: "${this.selectedObstacle.userData.id}",`);
      //   console.log(`    x: ${this.selectedObstacle.position.x.toFixed(2)},`);
      //   console.log(`    y: ${this.selectedObstacle.position.y.toFixed(2)},`);
      //   console.log(`    z: ${this.selectedObstacle.position.z.toFixed(2)},`);
      //   console.log(`    width: ${this.selectedObstacle.userData.width},`);
      //   console.log(`    height: ${this.selectedObstacle.userData.height},`);
      //   console.log(`    depth: ${this.selectedObstacle.userData.depth},`);
      //   console.log(`  },`);
      // }
    }

    this.isDraggingObstacle = false;
    this.selectedObstacle = null;
  }

  /**
   * Highlight an object (works with both simple meshes and 3D models)
   */
  highlightObject(object) {
    object.traverse((child) => {
      if (child.isMesh && child.material) {
        // Store original emissive value
        if (child.userData.originalEmissive === undefined) {
          child.userData.originalEmissive = child.material.emissive
            ? child.material.emissive.getHex()
            : 0x000000;
        }
        // Apply orange highlight
        if (child.material.emissive) {
          child.material.emissive.setHex(0xff6b00); // Orange highlight
        }
        // Mark as highlighted
        child.userData.isHighlighted = true;
      }
    });
  }

  /**
   * Remove highlight from an object
   */
  removeHighlight(object) {
    object.traverse((child) => {
      if (child.isMesh && child.material) {
        // Check if this child was highlighted
        if (child.userData.isHighlighted) {
          // Restore original emissive value
          if (child.material.emissive) {
            if (child.userData.originalEmissive !== undefined) {
              child.material.emissive.setHex(child.userData.originalEmissive);
            } else {
              // Fallback: set to black if no original was stored
              child.material.emissive.setHex(0x000000);
            }
          }

          // Clear highlight flag and stored value
          child.userData.isHighlighted = false;
          delete child.userData.originalEmissive;
        }

        // Safety check: if emissive is still orange, force it to black
        if (
          child.material.emissive &&
          child.material.emissive.getHex() === 0xff6b00
        ) {
          child.material.emissive.setHex(0x000000);
          console.log(
            `🔧 Force-removed orange highlight from ${
              object.userData.id || "unknown"
            }`
          );
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

    console.log(
      this.editMode
        ? `🔧 Edit Mode ON - Highlighting ${allEditableObjects.length} objects`
        : `✅ Edit Mode OFF - Removing highlights from ${allEditableObjects.length} objects`
    );

    allEditableObjects.forEach((object) => {
      if (this.editMode) {
        this.highlightObject(object);
      } else {
        this.removeHighlight(object);
      }
    });

    // Force render to show changes
    this.sceneManager.render();

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
        // Don't activate if any menu is open
        if (this.isAnyMenuOpen()) {
          return;
        }
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
   * Setup action wheel
   */
  setupActionWheel() {
    const container = document.getElementById("action-wheel-container");
    const actionOptions = document.querySelectorAll(".action-option");

    // Show wheel when C is pressed
    window.addEventListener("keydown", (e) => {
      if ((e.key === "c" || e.key === "C") && !this.actionWheelActive) {
        // Don't activate if any menu is open
        if (this.isAnyMenuOpen()) {
          return;
        }
        e.preventDefault();
        this.actionWheelActive = true;
        container.classList.add("active");
      }
    });

    // Hide wheel and perform action when C is released
    window.addEventListener("keyup", (e) => {
      if ((e.key === "c" || e.key === "C") && this.actionWheelActive) {
        e.preventDefault();
        this.actionWheelActive = false;
        container.classList.remove("active");

        // Perform selected action
        if (this.selectedAction) {
          this.performAction(this.selectedAction);
          this.selectedAction = null;
        }

        // Clear highlights
        actionOptions.forEach((opt) => opt.classList.remove("highlighted"));
      }
    });

    // Highlight actions on hover
    actionOptions.forEach((option) => {
      option.addEventListener("mouseenter", () => {
        if (this.actionWheelActive) {
          actionOptions.forEach((opt) => opt.classList.remove("highlighted"));
          option.classList.add("highlighted");
          this.selectedAction = option.dataset.action;
        }
      });

      // Click to select
      option.addEventListener("click", (e) => {
        if (this.actionWheelActive) {
          e.stopPropagation();
          this.performAction(option.dataset.action);
          this.actionWheelActive = false;
          container.classList.remove("active");
          actionOptions.forEach((opt) => opt.classList.remove("highlighted"));
        }
      });
    });
  }

  /**
   * Perform player action
   */
  performAction(action) {
    // console.log(`🎬 Performing action: ${action}`);

    // Send action to network manager to broadcast to other players
    if (this.networkManager && this.networkManager.playerManager) {
      this.networkManager.performPlayerAction(action);
    }
  }

  /**
   * Toggle spawn menu
   */
  toggleSpawnMenu() {
    const menu = document.getElementById("spawn-menu");
    const isActive = menu.classList.toggle("active");

    // Show/hide the menu
    if (isActive) {
      menu.style.display = "flex";

      // Setup background click to close (only once)
      if (!menu.dataset.clickHandlerAdded) {
        menu.addEventListener("click", (e) => {
          if (e.target === menu) {
            this.closeSpawnMenu();
          }
        });
        menu.dataset.clickHandlerAdded = "true";
      }

      // Focus on search input when menu opens
      setTimeout(() => {
        const searchInput = document.getElementById("model-search");
        if (searchInput) {
          searchInput.focus();
        }
      }, 100);
    } else {
      menu.style.display = "none";
    }

    // Load available models if not already loaded
    if (this.furnitureModels.length === 0) {
      this.loadAvailableModels();
    }
  }

  /**
   * Close spawn menu
   */
  closeSpawnMenu() {
    const menu = document.getElementById("spawn-menu");
    menu.classList.remove("active");
    menu.style.display = "none";
  }

  /**
   * Check if spawn menu is open
   */
  isSpawnMenuOpen() {
    const menu = document.getElementById("spawn-menu");
    return menu && menu.classList.contains("active");
  }

  /**
   * Check if settings modal is open
   */
  isSettingsOpen() {
    const modal = document.getElementById("settings-modal");
    return (
      modal && modal.style.display !== "none" && modal.style.display !== ""
    );
  }

  /**
   * Check if any modal/menu is open
   */
  isAnyMenuOpen() {
    return this.isSpawnMenuOpen() || this.isSettingsOpen();
  }

  /**
   * Load available models from directories (dynamically from server)
   */
  async loadAvailableModels() {
    try {
      // Fetch furniture models from server
      const furnitureResponse = await fetch("/api/models/furniture");
      if (furnitureResponse.ok) {
        this.furnitureModels = await furnitureResponse.json();
        // console.log(
        //   `📦 Loaded ${this.furnitureModels.length} furniture models`
        // );
      } else {
        console.error("Failed to load furniture models");
        this.furnitureModels = [];
      }

      // Fetch food models from server
      const foodResponse = await fetch("/api/models/food");
      if (foodResponse.ok) {
        this.foodModels = await foodResponse.json();
        // console.log(`🍔 Loaded ${this.foodModels.length} food models`);
      } else {
        console.error("Failed to load food models");
        this.foodModels = [];
      }

      this.populateSpawnMenu();
    } catch (error) {
      console.error("Error loading models:", error);
      this.furnitureModels = [];
      this.foodModels = [];
    }
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

    // Update counts
    document.getElementById(
      "furniture-count"
    ).textContent = `${this.furnitureModels.length} items`;
    document.getElementById(
      "food-count"
    ).textContent = `${this.foodModels.length} items`;

    // Add furniture items with compact Tailwind styling
    this.furnitureModels.forEach((model) => {
      const item = document.createElement("button");
      item.className =
        "spawn-item p-2 rounded-md bg-gradient-to-br from-gray-700 to-gray-800 hover:from-yellow-600 hover:to-orange-600 border border-gray-600 hover:border-yellow-500 text-white text-xs font-medium transition-all hover:scale-105 active:scale-95 break-words";
      item.textContent = model;
      item.dataset.name = model.toLowerCase();
      item.onclick = () => this.spawnFurniture(model);
      furnitureContainer.appendChild(item);
    });

    // Add food items with compact Tailwind styling
    this.foodModels.forEach((model) => {
      const item = document.createElement("button");
      item.className =
        "spawn-item p-2 rounded-md bg-gradient-to-br from-gray-700 to-gray-800 hover:from-green-600 hover:to-lime-600 border border-gray-600 hover:border-green-500 text-white text-xs font-medium transition-all hover:scale-105 active:scale-95 break-words";
      item.textContent = model;
      item.dataset.name = model.toLowerCase();
      item.onclick = () => this.spawnFood(model);
      foodContainer.appendChild(item);
    });

    // Setup delete mode button
    const deleteBtn = document.getElementById("delete-mode-btn");
    deleteBtn.onclick = () => this.toggleDeleteMode();

    // Setup search functionality
    this.setupSearch();
  }

  /**
   * Setup search functionality
   */
  setupSearch() {
    const searchInput = document.getElementById("model-search");
    if (!searchInput) return;

    searchInput.addEventListener("input", (e) => {
      const searchTerm = e.target.value.toLowerCase().trim();
      const allItems = document.querySelectorAll(".spawn-item");

      allItems.forEach((item) => {
        const itemName = item.dataset.name;
        if (itemName.includes(searchTerm)) {
          item.style.display = "";
        } else {
          item.style.display = "none";
        }
      });
    });
  }

  /**
   * Handle spawn failure from server
   */
  handleSpawnFailure(clientId, errorMessage) {
    console.error(`🚫 Spawn failed for ${clientId}: ${errorMessage}`);

    // Find and remove the failed object from scene
    // For obstacles/furniture
    const obstacleIndex = this.sceneManager.obstacles.findIndex(
      (obj) => obj.userData && obj.userData.id === clientId
    );
    if (obstacleIndex !== -1) {
      const failedObj = this.sceneManager.obstacles[obstacleIndex];
      this.sceneManager.scene.remove(failedObj);
      this.sceneManager.obstacles.splice(obstacleIndex, 1);
      console.log(`🗑️ Removed failed obstacle ${clientId} from scene`);
      return;
    }

    // For food items
    const foodItem = this.sceneManager.foodItems.get(clientId);
    if (foodItem && foodItem.model) {
      this.sceneManager.scene.remove(foodItem.model);
      this.sceneManager.foodItems.delete(clientId);
      console.log(`🗑️ Removed failed food ${clientId} from scene`);
    }
  }

  /**
   * Spawn furniture at center
   */
  async spawnFurniture(modelName) {
    try {
      const furniture = await this.sceneManager.loadFurnitureModel(modelName);
      furniture.position.set(0, 0, 0);
      furniture.scale.set(4, 4, 4); // Default scale 4 for furniture

      // Calculate actual bounding box after scaling
      const bbox = this.sceneManager.calculateBoundingBox(furniture);

      const clientId = `furniture_${modelName}_${Date.now()}`;

      furniture.userData = {
        id: clientId,
        type: "furniture",
        name: modelName,
        x: furniture.position.x,
        y: furniture.position.y,
        z: furniture.position.z,
        width: bbox.width,
        height: bbox.height,
        depth: bbox.depth,
        model: modelName,
        scale: 4,
        rotation: 0,
        isPassthrough: false, // Default to solid obstacle
        isPending: true, // Mark as pending until server confirms
      };

      this.sceneManager.scene.add(furniture);
      this.sceneManager.obstacles.push(furniture);

      // Highlight only if edit mode is on
      if (this.editMode) {
        this.highlightObject(furniture);
      }

      // Send to server for database persistence (only send serializable data)
      this.networkManager.spawnObstacle({
        id: furniture.userData.id,
        type: furniture.userData.type,
        name: furniture.userData.name,
        x: furniture.userData.x,
        y: furniture.userData.y,
        z: furniture.userData.z,
        width: furniture.userData.width,
        height: furniture.userData.height,
        depth: furniture.userData.depth,
        model: furniture.userData.model,
        scale: furniture.userData.scale,
        rotation: furniture.userData.rotation,
        isPassthrough: furniture.userData.isPassthrough || false,
      });

      // console.log(
      //   `✨ Spawned furniture: ${modelName} at scale 4 size:(${bbox.width.toFixed(
      //     2
      //   )}x${bbox.height.toFixed(2)}x${bbox.depth.toFixed(2)})`
      // );
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
        width: foodModel.userData.width,
        height: foodModel.userData.height,
        depth: foodModel.userData.depth,
      });

      // console.log(`✨ Spawned food: ${foodName} at scale 1.5`);
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
      btn.className =
        "w-full py-2 px-4 rounded-lg bg-green-500/30 hover:bg-green-500/40 border-2 border-green-500 text-white font-bold text-sm transition-all hover:scale-105 active:scale-95";
      // console.log("🗑️ Delete Mode ON - Click objects to delete them");
    } else {
      btn.textContent = "🗑️ Delete Mode (OFF)";
      btn.className =
        "w-full py-2 px-4 rounded-lg bg-red-500/20 hover:bg-red-500/30 border-2 border-red-500 text-white font-bold text-sm transition-all hover:scale-105 active:scale-95";
      // console.log("✅ Delete Mode OFF");
    }
  }

  /**
   * Delete an object
   */
  deleteObject(object) {
    if (!object || !object.userData.id) return;

    const objectId = object.userData.id;
    const objectType = object.userData.type;

    // Remove light if this is a lamp
    if (this.sceneManager.lightingManager) {
      this.sceneManager.lightingManager.removeLight(objectId);
    }

    // Stop music if this is a speaker playing music
    if (this.sceneManager.musicPlayerManager && objectType !== "food") {
      const furnitureName = object.userData.model || "";
      if (furnitureName.toLowerCase().includes("speaker")) {
        this.sceneManager.musicPlayerManager.stopSpeakerMusic(objectId, true);
        console.log(`🔇 Stopping music for deleted speaker ${objectId}`);
      }
    }

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

    // console.log(`🗑️ Deleted: ${objectId}`);
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

  /**
   * Toggle collision box visualization
   */
  toggleCollisionBoxes() {
    // Get player manager from network manager
    const playerManager = this.networkManager?.playerManager;

    if (this.sceneManager) {
      this.sceneManager.toggleCollisionBoxes(playerManager);

      // Show notification in console
      const isOn = this.sceneManager.showCollisionBoxes;
      console.log(
        `${isOn ? "✅" : "❌"} Collision Boxes: ${
          isOn ? "ON" : "OFF"
        } (Press V to toggle)`
      );
    }
  }

  /**
   * Toggle day-night UI
   */
  toggleDayNightUI() {
    if (this.dayNightUI) {
      const isVisible = this.dayNightUI.toggle();
      console.log(
        `${isVisible ? "🌅" : "❌"} Day-Night UI: ${
          isVisible ? "OPEN" : "CLOSED"
        } (Press N to toggle)`
      );
    }
  }

  /**
   * Toggle speaker connection mode
   */
  toggleConnectionMode() {
    if (this.sceneManager.speakerConnectionManager) {
      const isOn =
        this.sceneManager.speakerConnectionManager.toggleConnectionMode();
      console.log(
        `${isOn ? "🔌" : "❌"} Connection Mode: ${
          isOn ? "ON" : "OFF"
        } (Press L to toggle)`
      );
    }
  }
}
