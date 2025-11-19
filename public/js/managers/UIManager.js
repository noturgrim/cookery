import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";

/**
 * UI Manager
 * Handles UI elements like name tags, visual indicators, and markers
 */
export class UIManager {
  constructor(sceneManager) {
    this.sceneManager = sceneManager;
    this.moveMarker = null;
    this.pathLine = null;
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
      depthTest: false,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(spriteMaterial);
    sprite.position.y = 4;
    sprite.scale.set(2, 0.5, 1);
    sprite.renderOrder = 999;

    parentGroup.add(sprite);
  }

  /**
   * Create visual marker for click destination
   */
  createMoveMarker(x, z) {
    // Remove old marker if exists
    if (this.moveMarker) {
      this.sceneManager.remove(this.moveMarker);
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

    this.sceneManager.add(this.moveMarker);

    // Fade out and remove after 1 second
    setTimeout(() => {
      if (this.moveMarker) {
        this.sceneManager.remove(this.moveMarker);
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
      this.sceneManager.remove(this.pathLine);
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
    this.sceneManager.add(this.pathLine);

    // Fade out path after 2 seconds
    setTimeout(() => {
      if (this.pathLine) {
        this.sceneManager.remove(this.pathLine);
        this.pathLine = null;
      }
    }, 2000);
  }

  /**
   * Show voice indicator above a player
   */
  showVoiceIndicator(playerMesh, emoteName, camera) {
    if (!playerMesh) return;

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
      if (!playerMesh || !indicator.parentElement) return;

      const vector = playerMesh.position.clone();
      vector.y += 3;
      vector.project(camera);

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
   * Update edit mode UI
   */
  updateEditModeUI(isEditMode) {
    const controlsInfo = document.querySelector("#controls-info h3");
    if (controlsInfo) {
      if (isEditMode) {
        controlsInfo.textContent = "🔧 Edit Mode - Drag Tables";
        controlsInfo.style.color = "#ff6b6b";
      } else {
        controlsInfo.textContent = "Controls";
        controlsInfo.style.color = "#4caf50";
      }
    }
  }
}
