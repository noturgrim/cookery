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
   * Draw path trace line showing the route with cute thick rounded animated effect
   */
  drawPathTrace(path) {
    // Remove old path line
    if (this.pathLine) {
      this.sceneManager.remove(this.pathLine);
    }

    if (!path || path.length < 2) return;

    // Create path points (slightly elevated)
    const points = path.map(
      (point) => new THREE.Vector3(point.x, 0.25, point.z)
    );

    // Create a thick tube along the path for rounded appearance
    const curve = new THREE.CatmullRomCurve3(points);
    const tubeGeometry = new THREE.TubeGeometry(curve, 32, 0.15, 8, false);

    // Create glowing material (use MeshStandardMaterial for emissive support)
    const material = new THREE.MeshStandardMaterial({
      color: 0xffdd00, // Bright yellow/gold
      transparent: true,
      opacity: 0.85,
      emissive: 0xffdd00,
      emissiveIntensity: 0.5,
      metalness: 0,
      roughness: 0.5,
    });

    this.pathLine = new THREE.Mesh(tubeGeometry, material);
    this.sceneManager.add(this.pathLine);

    // Add animated pulsing glow effect
    let opacity = 0.85;
    let emissiveIntensity = 0.5;
    let fadeDirection = -1;
    const animateInterval = setInterval(() => {
      if (this.pathLine && this.pathLine.material) {
        opacity += fadeDirection * 0.04;
        emissiveIntensity += fadeDirection * 0.04;

        if (opacity <= 0.5 || opacity >= 0.85) {
          fadeDirection *= -1;
        }

        this.pathLine.material.opacity = opacity;
        this.pathLine.material.emissiveIntensity = emissiveIntensity;
      }
    }, 50);

    // Fade out path after 3 seconds
    setTimeout(() => {
      clearInterval(animateInterval);
      if (this.pathLine) {
        // Smooth fade out
        const fadeOut = setInterval(() => {
          if (this.pathLine && this.pathLine.material.opacity > 0) {
            this.pathLine.material.opacity -= 0.08;
            this.pathLine.material.emissiveIntensity -= 0.05;
          } else {
            clearInterval(fadeOut);
            if (this.pathLine) {
              this.sceneManager.remove(this.pathLine);
              this.pathLine = null;
            }
          }
        }, 50);
      }
    }, 3000);
  }

  /**
   * Show voice indicator above a player
   */
  showVoiceIndicator(playerMesh, emoteName, camera) {
    if (!playerMesh) return;

    // Get text labels for emotes
    const emoteLabels = {
      hello: "Hello!",
      help: "Help!",
      yes: "Yes!",
      no: "No!",
      thanks: "Thanks!",
      hurry: "Hurry Up!",
      nice: "Nice!",
      oops: "Oops!",
    };

    // Get color for each emote type
    const emoteColors = {
      hello: "#4CAF50", // Green
      help: "#FF5722", // Red-orange
      yes: "#2196F3", // Blue
      no: "#F44336", // Red
      thanks: "#9C27B0", // Purple
      hurry: "#FF9800", // Orange
      nice: "#00BCD4", // Cyan
      oops: "#FFC107", // Amber
    };

    const label = emoteLabels[emoteName] || emoteName.toUpperCase();
    const color = emoteColors[emoteName] || "#FFFFFF";

    // Create indicator element
    const indicator = document.createElement("div");
    indicator.className = "voice-indicator";
    indicator.textContent = label;
    indicator.style.position = "absolute";
    indicator.style.zIndex = "1000";
    indicator.style.color = color;
    indicator.style.fontWeight = "bold";
    indicator.style.fontSize = "18px";
    indicator.style.textShadow =
      "2px 2px 4px rgba(0,0,0,0.8), -1px -1px 2px rgba(0,0,0,0.5)";
    indicator.style.pointerEvents = "none";
    indicator.style.fontFamily = "Arial, sans-serif";
    indicator.style.whiteSpace = "nowrap";
    indicator.style.transition = "opacity 0.3s";

    document.body.appendChild(indicator);

    // Track existing indicators for this player for cleanup
    if (!this.playerVoiceIndicators) {
      this.playerVoiceIndicators = new Map();
    }

    if (!this.playerVoiceIndicators.has(playerMesh)) {
      this.playerVoiceIndicators.set(playerMesh, []);
    }

    const indicators = this.playerVoiceIndicators.get(playerMesh);
    indicators.push(indicator);

    // Animation state
    let progress = 0;
    const duration = 2.5; // 2.5 seconds total
    const floatSpeed = 50; // pixels per second upward (increased for more visibility)

    // Position above player (update every frame)
    const updatePosition = () => {
      if (!playerMesh || !indicator.parentElement) return;

      progress += 0.016; // ~60fps
      const t = progress / duration;

      // Calculate base position
      const vector = playerMesh.position.clone();
      vector.y += 3;
      vector.project(camera);

      const baseX = (vector.x * 0.5 + 0.5) * window.innerWidth;
      const baseY = (-(vector.y * 0.5) + 0.5) * window.innerHeight;

      // Float upward from the same starting position (no offset)
      const floatAmount = progress * floatSpeed;

      indicator.style.left = baseX - indicator.offsetWidth / 2 + "px";
      indicator.style.top = baseY - floatAmount + "px";

      // Fade out in the last 0.5 seconds
      if (t > 0.8) {
        const fadeT = (t - 0.8) / 0.2;
        indicator.style.opacity = 1 - fadeT;
      }
    };

    // Update position every frame
    const intervalId = setInterval(updatePosition, 16);

    // Remove after duration
    setTimeout(() => {
      clearInterval(intervalId);
      indicator.remove();

      // Remove from tracking
      const indicators = this.playerVoiceIndicators.get(playerMesh);
      if (indicators) {
        const index = indicators.indexOf(indicator);
        if (index > -1) {
          indicators.splice(index, 1);
        }
        // Clean up if no indicators left
        if (indicators.length === 0) {
          this.playerVoiceIndicators.delete(playerMesh);
        }
      }
    }, duration * 1000);
  }

  /**
   * Show action indicator above player
   */
  showActionIndicator(playerMesh, actionName, camera) {
    if (!playerMesh) return;

    // Get text labels and emojis for actions
    const actionLabels = {
      jump: "🦘 Jump!",
      kick: "🦵 Kick!",
      wave: "👋 Wave!",
      yes: "✅ Yes!",
      no: "❌ No!",
      crouch: "⬇️ Pickup!",
      spin: "🏃 Sprint!",
      point: "☝️ Point!",
      sit: "🪑 Sit!",
    };

    const label = actionLabels[actionName] || actionName.toUpperCase();

    // Create indicator element
    const indicator = document.createElement("div");
    indicator.className = "action-indicator";
    indicator.textContent = label;
    indicator.style.position = "absolute";
    indicator.style.zIndex = "1000";
    indicator.style.pointerEvents = "none";
    indicator.style.whiteSpace = "nowrap";
    indicator.style.transition = "opacity 0.3s";

    document.body.appendChild(indicator);

    // Track existing indicators for this player for cleanup
    if (!this.playerActionIndicators) {
      this.playerActionIndicators = new Map();
    }

    if (!this.playerActionIndicators.has(playerMesh)) {
      this.playerActionIndicators.set(playerMesh, []);
    }

    const indicators = this.playerActionIndicators.get(playerMesh);
    indicators.push(indicator);

    // Animation state
    let progress = 0;
    const duration = 2.0; // 2 seconds total
    const floatSpeed = 50; // pixels per second upward

    // Position above player (update every frame)
    const updatePosition = () => {
      if (!playerMesh || !indicator.parentElement) return;

      progress += 0.016; // ~60fps
      const t = progress / duration;

      // Calculate base position
      const vector = playerMesh.position.clone();
      vector.y += 3;
      vector.project(camera);

      const x = (vector.x * 0.5 + 0.5) * window.innerWidth;
      const y = (vector.y * -0.5 + 0.5) * window.innerHeight;

      // Float upward
      const floatOffset = progress * floatSpeed;
      indicator.style.left = x - indicator.offsetWidth / 2 + "px";
      indicator.style.top = y - floatOffset + "px";

      // Fade out in last 30% of duration
      if (t > 0.7) {
        indicator.style.opacity = 1 - (t - 0.7) / 0.3;
      }

      if (t < 1) {
        requestAnimationFrame(updatePosition);
      }
    };
    updatePosition();

    // Remove after duration
    setTimeout(() => {
      indicator.style.opacity = "0";
      setTimeout(() => {
        if (indicator.parentElement) {
          indicator.remove();
        }

        // Clean up from tracking
        const idx = indicators.indexOf(indicator);
        if (idx > -1) {
          indicators.splice(idx, 1);
        }
        if (indicators.length === 0) {
          this.playerActionIndicators.delete(playerMesh);
        }
      }, 300);
    }, duration * 1000);
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
