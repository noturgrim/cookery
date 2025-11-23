import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";

/**
 * Platform Manager
 * Handles multiple platforms, bridges, and platform-related functionality
 */
export class PlatformManager {
  constructor(sceneManager, networkManager) {
    this.sceneManager = sceneManager;
    this.networkManager = networkManager;

    // Platform storage
    this.platforms = new Map(); // id -> platform object
    this.bridges = new Map(); // id -> bridge object

    // Platform meshes
    this.platformMeshes = new Map(); // id -> THREE.Mesh
    this.bridgeMeshes = new Map(); // id -> THREE.Mesh

    // Ghost platform for placement
    this.ghostPlatform = null;
    this.isPlacingPlatform = false;
    this.ghostPlatformSize = 40;

    // Bridge drawing
    this.isDrawingBridge = false;
    this.bridgeWaypoints = [];
    this.bridgeStartPlatform = null;
    this.bridgeEndPlatform = null;
    this.bridgePathLine = null;
    this.waypointMarkers = [];
    this.pendingPlatformData = null; // Store platform data while drawing bridge

    // Texture loader
    this.textureLoader = new THREE.TextureLoader();

    // Platform label visibility preference
    const storedPreference = window?.localStorage?.getItem(
      "platformLabelsVisible"
    );
    this.labelsVisible =
      storedPreference === null ? true : storedPreference === "true";
  }

  /**
   * Initialize platforms from server data
   */
  initialize(platformsData, bridgesData) {
    console.log(
      `🏗️ Initializing ${platformsData.length} platforms and ${bridgesData.length} bridges`
    );

    // Clear existing platforms
    this.clearAll();

    // Create platforms
    for (const platformData of platformsData) {
      this.createPlatform(platformData);
    }

    // Create bridges
    for (const bridgeData of bridgesData) {
      this.createBridge(bridgeData);
    }
  }

  /**
   * Create a platform mesh
   */
  createPlatform(platformData) {
    if (this.platforms.has(platformData.id)) {
      console.warn(`Platform ${platformData.id} already exists`);
      return;
    }

    // Store platform data
    this.platforms.set(platformData.id, platformData);

    // Create platform geometry
    const geometry = new THREE.PlaneGeometry(
      platformData.size,
      platformData.size
    );

    // Load texture
    const texture = this.textureLoader.load(
      `/floor/${platformData.floorTexture}`
    );
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    const tileRepeat = platformData.size / 5;
    texture.repeat.set(tileRepeat, tileRepeat);

    // Create material
    const material = new THREE.MeshStandardMaterial({
      map: texture,
      roughness: 0.8,
      metalness: 0.1,
    });

    // Create mesh
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(platformData.x, platformData.y, platformData.z);
    mesh.receiveShadow = true;

    // Add to scene
    this.sceneManager.scene.add(mesh);
    this.platformMeshes.set(platformData.id, mesh);

    // Add grid helper
    const gridHelper = new THREE.GridHelper(
      platformData.size,
      Math.max(10, platformData.size / 2),
      0x999999,
      0xcccccc
    );
    gridHelper.material.opacity = 0.2;
    gridHelper.material.transparent = true;
    gridHelper.position.set(platformData.x, 0.01, platformData.z);
    this.sceneManager.scene.add(gridHelper);

    // Store grid helper reference
    mesh.userData.gridHelper = gridHelper;

    // Create platform label
    this.createPlatformLabel(platformData);

    console.log(
      `🏗️ Created platform: ${platformData.name} (${platformData.id})`
    );
  }

  /**
   * Create a visible label for the platform
   */
  createPlatformLabel(platformData) {
    const mesh = this.platformMeshes.get(platformData.id);
    if (!mesh) return;

    // Remove previous label if it exists
    if (mesh.userData.labelSprite) {
      this.sceneManager.scene.remove(mesh.userData.labelSprite);
      mesh.userData.labelSprite.material.map?.dispose();
      mesh.userData.labelSprite.material.dispose();
      mesh.userData.labelSprite = null;
    }

    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    const width = 384;
    const height = 120;
    canvas.width = width;
    canvas.height = height;

    const drawRoundedRect = (ctx, x, y, w, h, r) => {
      const radius = Math.min(r, w / 2, h / 2);
      ctx.beginPath();
      ctx.moveTo(x + radius, y);
      ctx.lineTo(x + w - radius, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
      ctx.lineTo(x + w, y + h - radius);
      ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
      ctx.lineTo(x + radius, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
      ctx.lineTo(x, y + radius);
      ctx.quadraticCurveTo(x, y, x + radius, y);
      ctx.closePath();
    };

    // Background with subtle gradient
    const gradient = context.createLinearGradient(0, 0, width, 0);
    gradient.addColorStop(0, "rgba(20, 20, 30, 0.95)");
    gradient.addColorStop(1, "rgba(33, 33, 45, 0.95)");

    context.clearRect(0, 0, width, height);
    context.shadowColor = "rgba(0, 0, 0, 0.35)";
    context.shadowBlur = 12;
    drawRoundedRect(context, 16, 16, width - 32, height - 40, 24);
    context.fillStyle = gradient;
    context.fill();
    context.shadowBlur = 0;

    context.lineWidth = 1.5;
    context.strokeStyle = "rgba(255, 255, 255, 0.1)";
    drawRoundedRect(context, 16, 16, width - 32, height - 40, 24);
    context.stroke();

    // Platform name text (auto-shrink if needed)
    const name = platformData.name || "Unnamed Platform";
    let fontSize = 34;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillStyle = "#ffffff";
    do {
      context.font = `600 ${fontSize}px "Inter", "SF Pro Display", Arial`;
      fontSize -= 2;
    } while (context.measureText(name).width > width - 120 && fontSize > 22);
    context.fillText(name, width / 2, height / 2 - 6);

    // Owner text
    const ownerName =
      platformData.owner ||
      platformData.owner_username ||
      platformData.ownerName ||
      "unknown";
    context.font = `500 20px "Inter", "SF Pro Display", Arial`;
    context.fillStyle = "rgba(255, 255, 255, 0.7)";
    context.fillText(`by ${ownerName}`, width / 2, height / 2 + 26);

    // Create texture from canvas
    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;

    // Create sprite
    const spriteMaterial = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(spriteMaterial);
    sprite.scale.set(5.4, 1.8, 1);
    sprite.position.set(platformData.x, platformData.y + 4.5, platformData.z);
    sprite.center.set(0.5, 0);
    sprite.renderOrder = 999;
    sprite.visible = this.labelsVisible;

    // Add to scene and store reference
    this.sceneManager.scene.add(sprite);
    mesh.userData.labelSprite = sprite;
  }

  /**
   * Toggle platform label visibility
   */
  setPlatformLabelsVisible(showLabels) {
    this.labelsVisible = !!showLabels;
    window?.localStorage?.setItem(
      "platformLabelsVisible",
      this.labelsVisible ? "true" : "false"
    );

    for (const mesh of this.platformMeshes.values()) {
      if (mesh.userData.labelSprite) {
        mesh.userData.labelSprite.visible = this.labelsVisible;
      }
    }
  }

  /**
   * Create a bridge mesh between two platforms
   */
  createBridge(bridgeData) {
    if (this.bridges.has(bridgeData.id)) {
      console.warn(`Bridge ${bridgeData.id} already exists`);
      return;
    }

    // Store bridge data
    this.bridges.set(bridgeData.id, bridgeData);

    console.log(`🔍 Bridge data:`, bridgeData);
    console.log(`   Start: (${bridgeData.startX}, ${bridgeData.startZ})`);
    console.log(`   End: (${bridgeData.endX}, ${bridgeData.endZ})`);

    // Calculate bridge dimensions
    const dx = bridgeData.endX - bridgeData.startX;
    const dz = bridgeData.endZ - bridgeData.startZ;
    const length = Math.sqrt(dx * dx + dz * dz);
    const angle = Math.atan2(dz, dx);

    console.log(
      `   Length: ${length.toFixed(2)}, Angle: ${(
        (angle * 180) /
        Math.PI
      ).toFixed(1)}°`
    );

    // Create flat pathway geometry
    const pathwayWidth = Math.max(bridgeData.width * 1.8, 3);
    const geometry = new THREE.PlaneGeometry(length, pathwayWidth);
    geometry.rotateX(-Math.PI / 2); // Lay flat on ground before rotation

    // Load pathway texture
    const texture = this.textureLoader.load("/floor/floor3.jpg");
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(Math.max(length / 5, 1), Math.max(pathwayWidth / 3, 1));

    const material = new THREE.MeshStandardMaterial({
      map: texture,
      roughness: 0.6,
      metalness: 0.05,
      side: THREE.DoubleSide,
    });

    // Create mesh
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.y = angle;
    mesh.position.set(
      (bridgeData.startX + bridgeData.endX) / 2,
      bridgeData.startY + 0.05,
      (bridgeData.startZ + bridgeData.endZ) / 2
    );
    mesh.receiveShadow = true;

    // Mark as passthrough (walkable)
    mesh.userData.isPassthrough = true;
    mesh.userData.type = "bridge";
    mesh.userData.id = bridgeData.id;

    // Add to scene
    this.sceneManager.scene.add(mesh);
    this.bridgeMeshes.set(bridgeData.id, mesh);

    console.log(`🌉 Created bridge: ${bridgeData.id}`);
    console.log(
      `   From: (${bridgeData.startX.toFixed(1)}, ${bridgeData.startZ.toFixed(
        1
      )}) To: (${bridgeData.endX.toFixed(1)}, ${bridgeData.endZ.toFixed(1)})`
    );
  }

  /**
   * Start platform placement mode
   */
  startPlacementMode(size = 40) {
    if (this.isPlacingPlatform) return;

    this.isPlacingPlatform = true;
    this.ghostPlatformSize = size;

    // Create ghost platform
    const geometry = new THREE.PlaneGeometry(size, size);
    const material = new THREE.MeshStandardMaterial({
      color: 0x00ff00,
      transparent: true,
      opacity: 0.3,
      side: THREE.DoubleSide,
    });

    this.ghostPlatform = new THREE.Mesh(geometry, material);
    this.ghostPlatform.rotation.x = -Math.PI / 2;
    this.ghostPlatform.position.y = 0.1;

    this.sceneManager.scene.add(this.ghostPlatform);

    console.log("👻 Ghost platform placement mode started");
  }

  /**
   * Update ghost platform position based on mouse
   */
  updateGhostPosition(worldX, worldZ) {
    if (!this.ghostPlatform || !this.isPlacingPlatform) return;

    // Snap to grid (optional)
    const gridSize = 5;
    const snappedX = Math.round(worldX / gridSize) * gridSize;
    const snappedZ = Math.round(worldZ / gridSize) * gridSize;

    this.ghostPlatform.position.x = snappedX;
    this.ghostPlatform.position.z = snappedZ;

    // Check if placement is valid
    const isValid = this.isPlacementValid(
      snappedX,
      snappedZ,
      this.ghostPlatformSize
    );

    // Update ghost color based on validity
    if (isValid) {
      this.ghostPlatform.material.color.setHex(0x00ff00); // Green
    } else {
      this.ghostPlatform.material.color.setHex(0xff0000); // Red
    }
  }

  /**
   * Check if platform placement is valid
   */
  isPlacementValid(x, z, size) {
    // Check if too close to existing platforms
    for (const [id, platform] of this.platforms) {
      const distance = Math.sqrt(
        Math.pow(platform.x - x, 2) + Math.pow(platform.z - z, 2)
      );
      const minDistance = (platform.size + size) / 2 + 10; // 10 units gap minimum

      if (distance < minDistance) {
        return false;
      }
    }

    return true;
  }

  /**
   * Confirm platform placement and start bridge drawing
   */
  confirmPlacement(platformName) {
    if (!this.ghostPlatform || !this.isPlacingPlatform) return false;

    const x = this.ghostPlatform.position.x;
    const z = this.ghostPlatform.position.z;

    // Check if placement is valid
    if (!this.isPlacementValid(x, z, this.ghostPlatformSize)) {
      console.warn("❌ Invalid platform placement");
      return false;
    }

    // Store pending platform data
    this.pendingPlatformData = {
      name: platformName,
      x: x,
      z: z,
      size: this.ghostPlatformSize,
      floorTexture: "floor2.jpg",
    };

    // Make ghost platform semi-transparent to show it's pending
    this.ghostPlatform.material.opacity = 0.15;
    this.ghostPlatform.material.color.setHex(0x4444ff);

    // Exit placement mode
    this.isPlacingPlatform = false;

    // Find nearest platform to connect to
    this.bridgeEndPlatform = this.findNearestPlatformTo(x, z);

    if (!this.bridgeEndPlatform) {
      // No existing platform, create without bridge
      this.createPlatformWithBridge(null);
      return true;
    }

    // Start bridge drawing mode
    this.startBridgeDrawing();

    console.log(
      `✅ Platform placed at (${x}, ${z}). Now draw the bridge path!`
    );
    console.log(`   Click to add waypoints, ENTER to confirm, ESC to cancel`);
    return true;
  }

  /**
   * Cancel platform placement
   */
  cancelPlacement() {
    if (this.ghostPlatform) {
      this.sceneManager.scene.remove(this.ghostPlatform);
      this.ghostPlatform.geometry.dispose();
      this.ghostPlatform.material.dispose();
      this.ghostPlatform = null;
    }

    this.isPlacingPlatform = false;
    console.log("❌ Platform placement cancelled");
  }

  /**
   * Get platform at position
   */
  getPlatformAtPosition(x, z) {
    for (const [id, platform] of this.platforms) {
      const halfSize = platform.size / 2;
      if (
        x >= platform.x - halfSize &&
        x <= platform.x + halfSize &&
        z >= platform.z - halfSize &&
        z <= platform.z + halfSize
      ) {
        return platform;
      }
    }
    return null;
  }

  /**
   * Delete a platform
   */
  deletePlatform(platformId) {
    const mesh = this.platformMeshes.get(platformId);
    if (mesh) {
      // Remove grid helper
      if (mesh.userData.gridHelper) {
        this.sceneManager.scene.remove(mesh.userData.gridHelper);
        mesh.userData.gridHelper.geometry.dispose();
        mesh.userData.gridHelper.material.dispose();
      }

      // Remove label sprite
      if (mesh.userData.labelSprite) {
        this.sceneManager.scene.remove(mesh.userData.labelSprite);
        mesh.userData.labelSprite.material.map.dispose();
        mesh.userData.labelSprite.material.dispose();
      }

      // Remove mesh
      this.sceneManager.scene.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.map?.dispose();
      mesh.material.dispose();
    }

    this.platforms.delete(platformId);
    this.platformMeshes.delete(platformId);

    console.log(`🗑️ Deleted platform: ${platformId}`);
  }

  /**
   * Delete a bridge
   */
  deleteBridge(bridgeId) {
    const mesh = this.bridgeMeshes.get(bridgeId);
    if (mesh) {
      this.sceneManager.scene.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
    }

    this.bridges.delete(bridgeId);
    this.bridgeMeshes.delete(bridgeId);

    console.log(`🗑️ Deleted bridge: ${bridgeId}`);
  }

  /**
   * Clear all platforms and bridges
   */
  clearAll() {
    // Clear platforms
    for (const [id] of this.platforms) {
      this.deletePlatform(id);
    }

    // Clear bridges
    for (const [id] of this.bridges) {
      this.deleteBridge(id);
    }
  }

  /**
   * Get all platforms
   */
  getAllPlatforms() {
    return Array.from(this.platforms.values());
  }

  /**
   * Get all bridges
   */
  getAllBridges() {
    return Array.from(this.bridges.values());
  }

  /**
   * Find nearest platform to given position
   */
  findNearestPlatformTo(x, z) {
    let nearest = null;
    let minDist = Infinity;

    for (const [id, platform] of this.platforms) {
      const dist = Math.sqrt(
        Math.pow(platform.x - x, 2) + Math.pow(platform.z - z, 2)
      );
      if (dist < minDist) {
        minDist = dist;
        nearest = platform;
      }
    }

    return nearest;
  }

  /**
   * Start bridge drawing mode
   */
  startBridgeDrawing() {
    this.isDrawingBridge = true;
    this.bridgeWaypoints = [];

    // Show bridge drawing overlay
    const overlay = document.getElementById("bridge-drawing-overlay");
    if (overlay) {
      overlay.style.display = "block";
    }

    console.log("🎨 Bridge drawing mode started");
    console.log("   1️⃣ Click on NEW platform edge to set START point");
    console.log("   2️⃣ Click waypoints to create path");
    console.log("   3️⃣ Click on TARGET platform edge to set END point");
    console.log("   ⏎ Press ENTER when done");
    console.log("   ⎋ Press ESC for auto straight bridge");
  }

  /**
   * Add waypoint to bridge path
   */
  addWaypoint(x, z, isStart = false) {
    this.bridgeWaypoints.push({ x, z });

    // Create visual marker
    const markerGeometry = new THREE.SphereGeometry(0.5, 16, 16);
    const markerMaterial = new THREE.MeshStandardMaterial({
      color: isStart ? 0x00ff00 : 0xffaa00,
      emissive: isStart ? 0x00ff00 : 0xffaa00,
      emissiveIntensity: 0.5,
    });
    const marker = new THREE.Mesh(markerGeometry, markerMaterial);
    marker.position.set(x, 0.5, z);
    this.sceneManager.scene.add(marker);
    this.waypointMarkers.push(marker);

    // Update path line
    this.updateBridgePathLine();

    console.log(`📍 Waypoint added at (${x.toFixed(1)}, ${z.toFixed(1)})`);
  }

  /**
   * Update the visual line showing the bridge path
   */
  updateBridgePathLine() {
    // Remove old line
    if (this.bridgePathLine) {
      this.sceneManager.scene.remove(this.bridgePathLine);
      this.bridgePathLine.geometry.dispose();
      this.bridgePathLine.material.dispose();
    }

    if (this.bridgeWaypoints.length < 2) return;

    // Create line geometry
    const points = this.bridgeWaypoints.map(
      (wp) => new THREE.Vector3(wp.x, 0.3, wp.z)
    );
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({
      color: 0xffaa00,
      linewidth: 3,
    });

    this.bridgePathLine = new THREE.Line(geometry, material);
    this.sceneManager.scene.add(this.bridgePathLine);
  }

  /**
   * Update bridge path with mouse position (for preview)
   */
  updateBridgePreview(x, z) {
    if (!this.isDrawingBridge || this.bridgeWaypoints.length === 0) return;

    // Remove old preview line
    if (this.bridgePreviewLine) {
      this.sceneManager.scene.remove(this.bridgePreviewLine);
      this.bridgePreviewLine.geometry.dispose();
      this.bridgePreviewLine.material.dispose();
    }

    // Create preview line from last waypoint to mouse
    const lastWp = this.bridgeWaypoints[this.bridgeWaypoints.length - 1];
    const points = [
      new THREE.Vector3(lastWp.x, 0.3, lastWp.z),
      new THREE.Vector3(x, 0.3, z),
    ];
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({
      color: 0xffaa00,
      linewidth: 2,
      opacity: 0.5,
      transparent: true,
    });

    this.bridgePreviewLine = new THREE.Line(geometry, material);
    this.sceneManager.scene.add(this.bridgePreviewLine);
  }

  /**
   * Finish bridge drawing and create platform
   */
  finishBridgeDrawing() {
    if (!this.isDrawingBridge) return;

    // Check if user clicked at least 2 waypoints (start and end)
    if (this.bridgeWaypoints.length < 2) {
      console.warn("❌ Need at least 2 waypoints (start and end)!");
      console.warn("   Click at least 2 points or press ESC for auto bridge");
      return;
    }

    // Create platform with custom bridge path (exactly as user clicked)
    this.createPlatformWithBridge(this.bridgeWaypoints);

    // Clean up
    this.cancelBridgeDrawing();

    console.log(
      `✅ Bridge path confirmed with ${this.bridgeWaypoints.length} waypoints!`
    );
  }

  /**
   * Cancel bridge drawing
   */
  cancelBridgeDrawing() {
    this.isDrawingBridge = false;

    // Hide bridge drawing overlay
    const overlay = document.getElementById("bridge-drawing-overlay");
    if (overlay) {
      overlay.style.display = "none";
    }

    // Remove waypoint markers
    this.waypointMarkers.forEach((marker) => {
      this.sceneManager.scene.remove(marker);
      marker.geometry.dispose();
      marker.material.dispose();
    });
    this.waypointMarkers = [];

    // Remove path line
    if (this.bridgePathLine) {
      this.sceneManager.scene.remove(this.bridgePathLine);
      this.bridgePathLine.geometry.dispose();
      this.bridgePathLine.material.dispose();
      this.bridgePathLine = null;
    }

    // Remove preview line
    if (this.bridgePreviewLine) {
      this.sceneManager.scene.remove(this.bridgePreviewLine);
      this.bridgePreviewLine.geometry.dispose();
      this.bridgePreviewLine.material.dispose();
      this.bridgePreviewLine = null;
    }

    // Remove ghost platform
    if (this.ghostPlatform) {
      this.sceneManager.scene.remove(this.ghostPlatform);
      this.ghostPlatform.geometry.dispose();
      this.ghostPlatform.material.dispose();
      this.ghostPlatform = null;
    }

    console.log("❌ Bridge drawing cancelled");
  }

  /**
   * Create platform with custom bridge path
   */
  createPlatformWithBridge(waypoints) {
    if (!this.pendingPlatformData) return;

    // Send to server with waypoints
    this.networkManager.socket.emit("createPlatform", {
      ...this.pendingPlatformData,
      bridgeWaypoints: waypoints,
    });

    // Clean up
    this.pendingPlatformData = null;
    this.bridgeWaypoints = [];
    this.bridgeEndPlatform = null;

    console.log(
      `🏗️ Creating platform with ${waypoints ? waypoints.length : 0} waypoints`
    );
  }
}
