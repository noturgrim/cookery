import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";

/**
 * Speaker Connection Manager
 * Handles connecting multiple speakers together with visual wires
 */
export class SpeakerConnectionManager {
  constructor(sceneManager, networkManager, musicPlayerManager) {
    this.sceneManager = sceneManager;
    this.networkManager = networkManager;
    this.musicPlayerManager = musicPlayerManager;

    // Speaker connections: Map of speakerId -> Set of connected speakerIds
    this.connections = new Map();

    // Visual wires: Map of connectionId -> THREE.Line
    this.wires = new Map();

    // Connection mode state
    this.connectionMode = false;
    this.firstSelectedSpeaker = null;

    // Wire material (thicker and more visible)
    this.wireMaterial = new THREE.LineBasicMaterial({
      color: 0x1a1a1a, // Dark gray/black wire
      linewidth: 3,
      opacity: 0.9,
      transparent: true,
    });

    // Music playing indicators (visual effects)
    this.playingIndicators = new Map(); // speakerId -> visual effect

    // Track if connections have been loaded from server
    this.connectionsLoaded = false;

    // Setup socket listeners
    this.setupSocketListeners();

    console.log("🔌 Speaker Connection Manager initialized");
  }

  /**
   * Add visual indicator that speaker is playing music (animated music notes)
   */
  addPlayingIndicator(speakerId) {
    const speaker = this.sceneManager.obstacles.find(
      (obj) => obj.userData.id === speakerId
    );

    if (!speaker || this.playingIndicators.has(speakerId)) return;

    // Create group to hold multiple music notes
    const notesGroup = new THREE.Group();
    const notes = [];

    // Create 3 music notes with different symbols
    const noteSymbols = ["♪", "♫", "♬"];
    const noteColors = [0x00ffff, 0xff00ff, 0xffff00]; // Cyan, Magenta, Yellow

    for (let i = 0; i < 3; i++) {
      // Create canvas for text
      const canvas = document.createElement("canvas");
      canvas.width = 128;
      canvas.height = 128;
      const ctx = canvas.getContext("2d");

      // Draw music note symbol
      ctx.font = "Bold 80px Arial";
      ctx.fillStyle = "#ffffff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(noteSymbols[i % noteSymbols.length], 64, 64);

      // Create sprite
      const texture = new THREE.CanvasTexture(canvas);
      const material = new THREE.SpriteMaterial({
        map: texture,
        color: noteColors[i % noteColors.length],
        transparent: true,
        opacity: 0.8,
      });

      const sprite = new THREE.Sprite(material);
      sprite.scale.set(0.5, 0.5, 1);

      // Random starting position around speaker
      const angle = (i / 3) * Math.PI * 2;
      sprite.position.set(
        Math.cos(angle) * 0.3,
        0.5, // Start from middle of speaker
        Math.sin(angle) * 0.3
      );

      notesGroup.add(sprite);
      notes.push({
        sprite,
        startY: 0.5,
        speed: 0.5 + Math.random() * 0.3, // Random speed
        phase: (i * Math.PI) / 3, // Phase offset for wave motion
      });
    }

    notesGroup.position.copy(speaker.position);
    this.sceneManager.scene.add(notesGroup);

    // Store reference
    this.playingIndicators.set(speakerId, {
      notesGroup,
      notes,
      startTime: Date.now(),
      speaker,
    });
  }

  /**
   * Remove visual indicator
   */
  removePlayingIndicator(speakerId) {
    const indicator = this.playingIndicators.get(speakerId);
    if (indicator) {
      this.sceneManager.scene.remove(indicator.notesGroup);

      // Dispose of all sprites and materials
      indicator.notes.forEach((note) => {
        note.sprite.material.map.dispose();
        note.sprite.material.dispose();
      });

      this.playingIndicators.delete(speakerId);
    }
  }

  /**
   * Update playing indicators (call every frame) - Animated floating music notes
   */
  updatePlayingIndicators() {
    const now = Date.now();

    this.playingIndicators.forEach((indicator, speakerId) => {
      const elapsed = (now - indicator.startTime) / 1000;

      // Update each music note
      indicator.notes.forEach((note, index) => {
        // Float upward
        note.sprite.position.y = note.startY + ((elapsed * note.speed) % 2.0);

        // Wave motion (side to side)
        const wave = Math.sin(elapsed * 2 + note.phase) * 0.2;
        note.sprite.position.x =
          Math.cos((index / 3) * Math.PI * 2) * 0.3 + wave;
        note.sprite.position.z =
          Math.sin((index / 3) * Math.PI * 2) * 0.3 + wave * 0.5;

        // Fade out as it goes up
        const fadeProgress = ((elapsed * note.speed) % 2.0) / 2.0;
        note.sprite.material.opacity = 0.8 * (1 - fadeProgress);

        // Scale pulse
        const scale = 0.5 + Math.sin(elapsed * 3 + note.phase) * 0.1;
        note.sprite.scale.set(scale, scale, 1);
      });

      // Follow speaker position if it moves
      indicator.notesGroup.position.copy(indicator.speaker.position);
    });
  }

  /**
   * Setup socket listeners
   */
  setupSocketListeners() {
    const socket = this.networkManager.socket;

    // When speakers are connected by another player
    socket.on("speakersConnected", (data) => {
      this.connectSpeakers(data.speaker1, data.speaker2, false);
    });

    // When speakers are disconnected by another player
    socket.on("speakersDisconnected", (data) => {
      this.disconnectSpeakers(data.speaker1, data.speaker2, false);
    });

    // Initial sync of all connections
    socket.on("connectionsStateSync", (connections) => {
      console.log(`🔌 Received connections state sync`);
      this.loadConnections(connections);
    });

    // Note: Connection sync is now requested by NetworkManager before music sync
  }

  /**
   * Toggle connection mode on/off
   */
  toggleConnectionMode() {
    this.connectionMode = !this.connectionMode;
    this.firstSelectedSpeaker = null;

    console.log(`🔌 Connection mode: ${this.connectionMode ? "ON" : "OFF"}`);

    // Update UI indicator
    this.updateConnectionModeUI();

    return this.connectionMode;
  }

  /**
   * Update connection mode UI indicator
   */
  updateConnectionModeUI() {
    // Check if UI element exists
    let indicator = document.getElementById("connection-mode-indicator");

    if (this.connectionMode) {
      if (!indicator) {
        // Add CSS animation keyframe
        if (!document.getElementById("connection-mode-style")) {
          const style = document.createElement("style");
          style.id = "connection-mode-style";
          style.textContent = `
            @keyframes slideIn {
              from {
                opacity: 0;
                transform: translateX(20px);
              }
              to {
                opacity: 1;
                transform: translateX(0);
              }
            }
          `;
          document.head.appendChild(style);
        }

        indicator = document.createElement("div");
        indicator.id = "connection-mode-indicator";
        indicator.style.cssText = `
          position: fixed;
          top: 20px;
          right: 20px;
          background: rgba(0, 0, 0, 0.85);
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          color: #fff;
          padding: 10px 16px;
          border-radius: 12px;
          font-weight: 600;
          font-size: 13px;
          z-index: 1000;
          border: 1.5px solid rgba(0, 255, 0, 0.3);
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
          display: flex;
          align-items: center;
          gap: 8px;
          animation: slideIn 0.3s ease-out;
        `;
        indicator.innerHTML = `
          <span style="font-size: 16px;">🔌</span>
          <div style="line-height: 1.3;">
            <div style="color: #00ff00; font-size: 12px; font-weight: 600;">CONNECTION MODE</div>
            <div style="color: rgba(255,255,255,0.7); font-size: 11px; font-weight: 400;">Click 2 or more speakers to connect them</div>
          </div>
        `;
        document.body.appendChild(indicator);
      }
    } else {
      if (indicator) {
        indicator.remove();
      }
    }
  }

  /**
   * Check if an object is a speaker
   */
  isSpeaker(object) {
    const name = (object.userData.model || "").toLowerCase();
    return name.includes("speaker");
  }

  /**
   * Handle speaker click in connection mode
   */
  handleSpeakerClick(speaker) {
    if (!this.connectionMode) return false;
    if (!this.isSpeaker(speaker)) return false;

    const speakerId = speaker.userData.id;

    if (!this.firstSelectedSpeaker) {
      // First speaker selected
      this.firstSelectedSpeaker = speakerId;
      this.highlightSpeaker(speaker, true);
      console.log(`🔌 First speaker selected: ${speakerId}`);
      return true;
    } else if (this.firstSelectedSpeaker === speakerId) {
      // Clicked same speaker - deselect
      this.firstSelectedSpeaker = null;
      this.highlightSpeaker(speaker, false);
      console.log(`🔌 Speaker deselected`);
      return true;
    } else {
      // Second speaker selected - create connection
      this.connectSpeakers(this.firstSelectedSpeaker, speakerId);

      // Clear selection
      const firstSpeaker = this.sceneManager.obstacles.find(
        (obj) => obj.userData.id === this.firstSelectedSpeaker
      );
      if (firstSpeaker) {
        this.highlightSpeaker(firstSpeaker, false);
      }
      this.firstSelectedSpeaker = null;

      return true;
    }
  }

  /**
   * Highlight a speaker (visual feedback)
   */
  highlightSpeaker(speaker, highlight) {
    speaker.traverse((child) => {
      if (child.isMesh && child.material) {
        if (highlight) {
          child.material.emissive = new THREE.Color(0x00ff00);
          child.material.emissiveIntensity = 0.5;
        } else {
          child.material.emissive = new THREE.Color(0x000000);
          child.material.emissiveIntensity = 0;
        }
      }
    });
  }

  /**
   * Connect two speakers
   */
  connectSpeakers(
    speakerId1,
    speakerId2,
    broadcast = true,
    skipMusicSync = false
  ) {
    // Don't connect speaker to itself
    if (speakerId1 === speakerId2) return;

    // Check if already connected
    if (this.areConnected(speakerId1, speakerId2)) {
      console.log(`🔌 Speakers already connected, disconnecting...`);
      this.disconnectSpeakers(speakerId1, speakerId2, broadcast);
      return;
    }

    // Add bidirectional connection
    if (!this.connections.has(speakerId1)) {
      this.connections.set(speakerId1, new Set());
    }
    if (!this.connections.has(speakerId2)) {
      this.connections.set(speakerId2, new Set());
    }

    this.connections.get(speakerId1).add(speakerId2);
    this.connections.get(speakerId2).add(speakerId1);

    // Create visual wire
    this.createWire(speakerId1, speakerId2);

    console.log(`🔌 Connected speakers: ${speakerId1} ↔ ${speakerId2}`);

    // Broadcast to server
    if (broadcast) {
      this.networkManager.socket.emit("connectSpeakers", {
        speaker1: speakerId1,
        speaker2: speakerId2,
      });
    }

    // If either speaker is playing music, sync to all connected speakers
    // Skip during initial connection load to prevent duplicates
    if (!skipMusicSync) {
      this.syncMusicAcrossConnections(speakerId1);
    }
  }

  /**
   * Disconnect two speakers
   */
  disconnectSpeakers(speakerId1, speakerId2, broadcast = true) {
    // Remove bidirectional connection
    if (this.connections.has(speakerId1)) {
      this.connections.get(speakerId1).delete(speakerId2);
    }
    if (this.connections.has(speakerId2)) {
      this.connections.get(speakerId2).delete(speakerId1);
    }

    // Remove visual wire
    this.removeWire(speakerId1, speakerId2);

    console.log(`🔌 Disconnected speakers: ${speakerId1} ↔ ${speakerId2}`);

    // Broadcast to server
    if (broadcast) {
      this.networkManager.socket.emit("disconnectSpeakers", {
        speaker1: speakerId1,
        speaker2: speakerId2,
      });
    }
  }

  /**
   * Check if two speakers are connected
   */
  areConnected(speakerId1, speakerId2) {
    return (
      this.connections.has(speakerId1) &&
      this.connections.get(speakerId1).has(speakerId2)
    );
  }

  /**
   * Get all speakers connected to a given speaker (including the speaker itself)
   */
  getConnectedSpeakers(speakerId) {
    const connected = new Set([speakerId]); // Include itself

    // BFS to find all connected speakers (handles chains)
    const queue = [speakerId];
    const visited = new Set([speakerId]);

    while (queue.length > 0) {
      const current = queue.shift();
      const neighbors = this.connections.get(current);

      if (neighbors) {
        neighbors.forEach((neighbor) => {
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            connected.add(neighbor);
            queue.push(neighbor);
          }
        });
      }
    }

    return Array.from(connected);
  }

  /**
   * Create visual wire between two speakers
   */
  createWire(speakerId1, speakerId2) {
    const speaker1 = this.sceneManager.obstacles.find(
      (obj) => obj.userData.id === speakerId1
    );
    const speaker2 = this.sceneManager.obstacles.find(
      (obj) => obj.userData.id === speakerId2
    );

    if (!speaker1 || !speaker2) {
      console.warn("Speakers not found for wire creation");
      return;
    }

    // Get positions (ON the floor, not under)
    const pos1 = speaker1.position.clone();
    pos1.y = 0.05; // Very close to floor surface

    const pos2 = speaker2.position.clone();
    pos2.y = 0.05;

    // Calculate distance for segment count (more segments for longer cables)
    const distance = Math.sqrt(
      Math.pow(pos2.x - pos1.x, 2) + Math.pow(pos2.z - pos1.z, 2)
    );
    const segmentCount = Math.max(30, Math.min(100, Math.floor(distance * 10)));

    // Create realistic curved wire with natural sag and twists
    const points = this.createCatenaryPoints(pos1, pos2, segmentCount);

    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const wire = new THREE.Line(geometry, this.wireMaterial);

    // Cast shadow for more realism
    wire.castShadow = false; // Wires typically don't cast noticeable shadows
    wire.receiveShadow = true;

    // Add to scene
    this.sceneManager.scene.add(wire);

    // Store wire
    const connectionId = this.getConnectionId(speakerId1, speakerId2);
    this.wires.set(connectionId, {
      line: wire,
      speaker1: speakerId1,
      speaker2: speakerId2,
    });

    console.log(
      `🔌 Created wire with ${segmentCount} segments for distance ${distance.toFixed(
        2
      )}`
    );
  }

  /**
   * Create realistic cable curve with natural sag, twists, and randomness
   */
  createCatenaryPoints(pos1, pos2, segments = 50) {
    const points = [];
    const distance = Math.sqrt(
      Math.pow(pos2.x - pos1.x, 2) + Math.pow(pos2.z - pos1.z, 2)
    );

    // Scale effects based on distance - longer cables sag and curve more
    const sagAmount = Math.min(0.8, distance * 0.08); // More sag for longer cables
    const wiggleIntensity = Math.min(1.2, distance * 0.15); // More wiggle for longer cables
    const twists = Math.floor(distance / 3); // Add twists every 3 units

    // Random seed based on position for consistent but unique curves
    const seed =
      Math.abs(Math.sin(pos1.x * 12.9898 + pos1.z * 78.233) * 43758.5453) % 1;

    // Calculate perpendicular direction for wiggle
    const perpX = -(pos2.z - pos1.z);
    const perpZ = pos2.x - pos1.x;
    const perpLength = Math.sqrt(perpX * perpX + perpZ * perpZ);
    const perpNormX = perpLength > 0 ? perpX / perpLength : 0;
    const perpNormZ = perpLength > 0 ? perpZ / perpLength : 0;

    for (let i = 0; i <= segments; i++) {
      const t = i / segments;

      // Base interpolation
      const x = pos1.x + (pos2.x - pos1.x) * t;
      const z = pos1.z + (pos2.z - pos1.z) * t;

      // Natural catenary sag (parabolic curve with more droop in middle)
      const sagCurve = Math.sin(t * Math.PI); // 0 at ends, 1 in middle
      const y = 0.02 + sagCurve * sagAmount * 0.3;

      // Primary wave (natural cable curve)
      const primaryWave =
        Math.sin(t * Math.PI * 2 + seed * Math.PI) * wiggleIntensity * 0.3;

      // Secondary wave (smaller variations)
      const secondaryWave =
        Math.sin(t * Math.PI * 5 + seed * 2) * wiggleIntensity * 0.15;

      // Twist/spiral effect for long cables
      const spiralWave =
        twists > 0
          ? Math.sin(t * Math.PI * twists + seed * 3) * wiggleIntensity * 0.2
          : 0;

      // Random micro-variations (different for each cable)
      const microVariation =
        Math.sin(t * Math.PI * 8 + seed * 5) * 0.05 +
        Math.sin(t * Math.PI * 13 + seed * 7) * 0.03;

      // Combine all wave effects
      const totalWiggle =
        primaryWave + secondaryWave + spiralWave + microVariation;

      // Apply perpendicular wiggle
      const finalX = x + perpNormX * totalWiggle;
      const finalZ = z + perpNormZ * totalWiggle;

      // Add slight vertical variation for more realism
      const verticalVariation = Math.sin(t * Math.PI * 7 + seed * 4) * 0.02;

      points.push(new THREE.Vector3(finalX, y + verticalVariation, finalZ));
    }

    return points;
  }

  /**
   * Remove wire between two speakers
   */
  removeWire(speakerId1, speakerId2) {
    const connectionId = this.getConnectionId(speakerId1, speakerId2);
    const wireData = this.wires.get(connectionId);

    if (wireData) {
      this.sceneManager.scene.remove(wireData.line);
      wireData.line.geometry.dispose();
      this.wires.delete(connectionId);
    }
  }

  /**
   * Get connection ID (order-independent)
   */
  getConnectionId(speakerId1, speakerId2) {
    return speakerId1 < speakerId2
      ? `${speakerId1}-${speakerId2}`
      : `${speakerId2}-${speakerId1}`;
  }

  /**
   * Handle speaker deletion - remove all connections
   */
  handleSpeakerDeleted(speakerId) {
    // Find all connections involving this speaker
    const connectionsToRemove = [];

    this.connections.forEach((pair, connectionId) => {
      if (pair[0] === speakerId || pair[1] === speakerId) {
        connectionsToRemove.push({ connectionId, pair });
      }
    });

    // Remove each connection
    connectionsToRemove.forEach(({ connectionId, pair }) => {
      console.log(
        `🔌 Removing connection due to speaker deletion: ${connectionId}`
      );

      // Remove from local state
      this.connections.delete(connectionId);
      this.removeVisualWire(connectionId);

      // Notify server (which will broadcast to others)
      this.networkManager.socket.emit("disconnectSpeakers", {
        speakerId1: pair[0],
        speakerId2: pair[1],
      });
    });

    // Remove playing indicator if exists
    this.removePlayingIndicator(speakerId);

    console.log(
      `🗑️ Cleaned up ${connectionsToRemove.length} connections for deleted speaker ${speakerId}`
    );
  }

  /**
   * Sync music across all connected speakers
   */
  syncMusicAcrossConnections(speakerId) {
    // Get active speaker data
    const speakerData = this.musicPlayerManager.activeSpeakers.get(speakerId);

    if (!speakerData) return; // No music playing

    // Get all connected speakers
    const connectedSpeakers = this.getConnectedSpeakers(speakerId);

    // Calculate sync time ONCE for perfect synchronization
    const groupSyncTime = Date.now();

    console.log(
      `🔗 Syncing music to ${
        connectedSpeakers.length - 1
      } connected speakers (song: ${speakerData.songName})`
    );

    // Start music on all connected speakers with the SAME sync time
    connectedSpeakers.forEach((connectedId) => {
      if (connectedId !== speakerId) {
        // Check if connected speaker is already playing the same song
        const connectedData =
          this.musicPlayerManager.activeSpeakers.get(connectedId);
        if (
          connectedData &&
          connectedData.songName === speakerData.songName &&
          !connectedData.audio.paused
        ) {
          console.log(
            `   ⏭️ Speaker ${connectedId} already playing ${speakerData.songName}, skipping`
          );
          return;
        }

        console.log(`   🔊 Syncing to speaker: ${connectedId}`);
        this.musicPlayerManager.startSpeakerMusic(
          connectedId,
          speakerData.songName,
          speakerData.startTime,
          false, // Don't broadcast, already handled
          groupSyncTime // Pass the SAME sync time for perfect sync
        );
      }
    });
  }

  /**
   * Handle speaker deleted - remove all connections
   */
  handleSpeakerDeleted(speakerId) {
    // Get all connections
    const connections = this.connections.get(speakerId);

    if (connections) {
      // Disconnect from all
      connections.forEach((connectedId) => {
        this.disconnectSpeakers(speakerId, connectedId, false);
      });
    }

    // Remove from map
    this.connections.delete(speakerId);
  }

  /**
   * Update wire positions (called when speakers are moved)
   */
  updateWirePositions() {
    this.wires.forEach((wireData) => {
      const speaker1 = this.sceneManager.obstacles.find(
        (obj) => obj.userData.id === wireData.speaker1
      );
      const speaker2 = this.sceneManager.obstacles.find(
        (obj) => obj.userData.id === wireData.speaker2
      );

      if (speaker1 && speaker2) {
        const pos1 = speaker1.position.clone();
        pos1.y = 0.05;

        const pos2 = speaker2.position.clone();
        pos2.y = 0.05;

        // Calculate distance for proper segment count
        const distance = Math.sqrt(
          Math.pow(pos2.x - pos1.x, 2) + Math.pow(pos2.z - pos1.z, 2)
        );
        const segmentCount = Math.max(
          30,
          Math.min(100, Math.floor(distance * 10))
        );

        const points = this.createCatenaryPoints(pos1, pos2, segmentCount);
        wireData.line.geometry.setFromPoints(points);
        wireData.line.geometry.attributes.position.needsUpdate = true;
      }
    });
  }

  /**
   * Load connections from server
   */
  loadConnections(connectionsData) {
    console.log(`🔌 Loading ${connectionsData.length} speaker connections`);

    connectionsData.forEach((conn) => {
      // Pass skipMusicSync=true to prevent duplicate music sync during load
      this.connectSpeakers(conn.speaker1, conn.speaker2, false, true);
    });

    // Mark connections as loaded
    this.connectionsLoaded = true;

    // Always notify that connections are loaded (even if 0 connections)
    // This is important for music sync to proceed
    if (this.onConnectionsLoaded) {
      console.log(
        `🔌 Connections loaded (${connectionsData.length} total), notifying listeners`
      );
      this.onConnectionsLoaded();
    }
  }

  /**
   * Cleanup
   */
  cleanup() {
    this.wires.forEach((wireData) => {
      this.sceneManager.scene.remove(wireData.line);
      wireData.line.geometry.dispose();
    });
    this.wires.clear();
    this.connections.clear();
  }
}
