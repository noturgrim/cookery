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
    const intersects = this.raycaster.intersectObjects(
      this.sceneManager.obstacles
    );

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
   * Handle mouse up events
   */
  handleMouseUp(event) {
    if (this.isDraggingObstacle && this.selectedObstacle) {
      // Send new position to server
      this.networkManager.updateObstacle(
        this.selectedObstacle.userData.id,
        this.selectedObstacle.position.x,
        this.selectedObstacle.position.y,
        this.selectedObstacle.position.z
      );

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
   * Toggle edit mode
   */
  toggleEditMode() {
    this.editMode = !this.editMode;

    // Update obstacle colors
    this.sceneManager.obstacles.forEach((obstacle) => {
      if (this.editMode) {
        obstacle.material.color.setHex(0xff6b6b);
        obstacle.material.emissive.setHex(0x330000);
      } else {
        obstacle.material.color.setHex(0x8b4513);
        obstacle.material.emissive.setHex(0x000000);
      }
    });

    console.log(
      this.editMode
        ? "🔧 Edit Mode ON - Click and drag tables"
        : "✅ Edit Mode OFF"
    );

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
}
