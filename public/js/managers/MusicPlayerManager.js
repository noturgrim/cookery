import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";

/**
 * Music Player Manager
 * Handles synchronized music playback from speaker objects with spatial audio
 */
export class MusicPlayerManager {
  constructor(sceneManager, networkManager, soundManager) {
    this.sceneManager = sceneManager;
    this.networkManager = networkManager;
    this.soundManager = soundManager;

    // Active speakers playing music
    this.activeSpeakers = new Map(); // speakerId -> { audio, speakerObj, songName, startTime, isPaused }

    // Available songs (loaded from server)
    this.availableSongs = [];

    // Pagination
    this.currentPage = 0;
    this.songsPerPage = 10;

    // Currently interacting speaker
    this.currentSpeaker = null;

    // Auto-play next song
    this.autoPlayEnabled = true;

    // Speaker volumes (per speaker)
    this.speakerVolumes = new Map(); // speakerId -> volume (0-1)

    // Pending speakers (waiting for audio unlock)
    this.pendingSpeakers = [];
    this.audioUnlockHandlerSetup = false;

    // Retry timers (prevent duplicate retries)
    this.retryTimers = new Set();

    // Spatial audio settings
    this.maxHearingDistance = 50; // Maximum distance to hear music
    this.maxVolume = 0.4; // Maximum volume at close range

    // Load available songs
    this.loadAvailableSongs();

    // Setup socket listeners
    this.setupSocketListeners();

    // Setup connection manager callback (will be called when connections load)
    this.setupConnectionManagerCallback();

    // Setup update loop for spatial audio
    this.setupSpatialAudioUpdate();

    console.log("🎵 Music Player Manager initialized");
  }

  /**
   * Load available songs from server
   */
  async loadAvailableSongs() {
    try {
      const response = await fetch("/api/music/list");
      if (response.ok) {
        this.availableSongs = await response.json();
        console.log(
          `🎵 Loaded ${this.availableSongs.length} songs:`,
          this.availableSongs.map((s) => s.name).join(", ")
        );
      } else {
        console.error("Failed to load available songs");
        this.availableSongs = [];
      }
    } catch (error) {
      console.error("Error loading songs:", error);
      this.availableSongs = [];
    }
  }

  /**
   * Setup socket listeners for music sync
   */
  setupSocketListeners() {
    const socket = this.networkManager.socket;

    // When speaker starts playing music
    socket.on("speakerMusicStarted", (data) => {
      console.log(
        `📡 Network event: speakerMusicStarted for ${data.speakerId.substring(
          0,
          8
        )}: ${data.songName}`
      );
      this.startSpeakerMusic(
        data.speakerId,
        data.songName,
        data.serverTime,
        false
      );
    });

    // When speaker stops music
    socket.on("speakerMusicStopped", (data) => {
      this.stopSpeakerMusic(data.speakerId, false);
    });

    // When speaker music changes
    socket.on("speakerMusicChanged", (data) => {
      this.changeSpeakerMusic(
        data.speakerId,
        data.songName,
        data.serverTime,
        false
      );
    });

    // Initial sync of all active speakers
    socket.on("speakersStateSync", (speakers) => {
      console.log(`🎵 Received music state sync: ${speakers.length} speakers`);

      // Check if connections manager exists and has been loaded from server
      const connectionsManager = this.sceneManager.speakerConnectionManager;
      const hasConnectionsManager = !!connectionsManager;
      const connectionsLoaded =
        hasConnectionsManager && connectionsManager.connectionsLoaded;

      if (!connectionsLoaded && speakers.length > 0) {
        console.log(
          `   ⏳ Connections not loaded yet, storing speakers for later sync`
        );
        // Store speakers to sync after connections load
        this.pendingMusicSync = speakers;
        return;
      }

      // Process the music sync immediately (connections are loaded)
      console.log(
        `   ✅ Processing music sync now (connections ready: ${connectionsLoaded})`
      );
      this.processMusicSync(speakers);
    });

    // When speaker is paused by another player
    socket.on("speakerMusicPaused", (data) => {
      console.log(`⏸️ Received pause for speaker ${data.speakerId}`);
      this.pauseSpeakerMusic(data.speakerId, false);
    });

    // When speaker is resumed by another player
    socket.on("speakerMusicResumed", (data) => {
      console.log(`▶️ Received resume for speaker ${data.speakerId}`);
      this.resumeSpeakerMusic(data.speakerId, false);
    });

    // When speaker volume is changed by another player
    socket.on("speakerVolumeChanged", (data) => {
      console.log(
        `🔊 Received volume change for speaker ${data.speakerId}: ${data.volume}%`
      );
      this.setSpeakerVolume(data.speakerId, data.volume, false);
    });
  }

  /**
   * Setup callback for when speaker connections are loaded
   */
  setupConnectionManagerCallback() {
    // Wait for connection manager to be available, then set callback
    const checkConnectionManager = () => {
      if (this.sceneManager.speakerConnectionManager) {
        // Set the callback that will be triggered when connections finish loading
        this.sceneManager.speakerConnectionManager.onConnectionsLoaded = () => {
          if (this.pendingMusicSync && this.pendingMusicSync.length > 0) {
            console.log(
              `   🔗 Connections loaded, now processing pending music sync`
            );
            this.processMusicSync(this.pendingMusicSync);
            this.pendingMusicSync = null;
          }
        };
      } else {
        // Connection manager not ready yet, try again in 50ms
        setTimeout(checkConnectionManager, 50);
      }
    };

    checkConnectionManager();
  }

  /**
   * Process music sync for multiple speakers (filters out connected duplicates)
   */
  processMusicSync(speakers) {
    console.log(`🎵 Processing music sync: ${speakers.length} speakers`);

    // Check what speakers are currently active
    const activeSpeakerIds = Array.from(this.activeSpeakers.keys()).map((id) =>
      id.substring(0, 8)
    );
    console.log(
      `   📍 Currently active speakers: [${
        activeSpeakerIds.join(", ") || "none"
      }]`
    );

    // Filter speakers to only sync "primary" ones (not connected duplicates)
    // For each group of connected speakers, we only need to start one
    const speakersToSync = this.filterPrimarySpeakers(speakers);

    console.log(
      `   📍 Filtered to ${speakersToSync.length} primary speakers (avoiding connected duplicates)`,
      speakersToSync.map((s) => s.id)
    );

    // Store pending speakers to start after audio unlock
    this.pendingSpeakers = speakersToSync.filter(
      (s) => s.isPlaying && s.currentSong
    );

    // Start all speakers with synchronized timing
    speakersToSync.forEach(async (speaker) => {
      if (speaker.isPlaying && speaker.currentSong) {
        console.log(
          `   🔊 Syncing speaker ${speaker.id}: ${
            speaker.currentSong
          } (paused: ${speaker.isPaused || false}, volume: ${
            speaker.volume || 70
          }%)`
        );

        // Get connected speakers group FIRST
        let speakersInGroup = [speaker.id];
        if (this.sceneManager.speakerConnectionManager) {
          speakersInGroup =
            this.sceneManager.speakerConnectionManager.getConnectedSpeakers(
              speaker.id
            );
          if (speakersInGroup.length > 1) {
            console.log(
              `   🔗 Syncing ${speakersInGroup.length} speakers together as a group:`,
              speakersInGroup
            );
          }
        }

        // Set speaker volume if provided - APPLY TO ALL SPEAKERS IN GROUP
        if (speaker.volume !== undefined) {
          speakersInGroup.forEach((speakerId) => {
            this.speakerVolumes.set(speakerId, speaker.volume / 100);
            console.log(
              `   📊 Set speaker ${speakerId.substring(0, 8)} volume to ${
                speaker.volume
              }%`
            );
          });
        }

        // Calculate sync time ONCE for all speakers in the group
        const groupSyncTime = Date.now();
        console.log(
          `   ⏱️ Group sync time: ${groupSyncTime} (ensures perfect sync)`
        );

        // Start all speakers in the group with the SAME sync time
        const startPromises = speakersInGroup.map((speakerId) => {
          console.log(`   🔊 Starting speaker: ${speakerId}`);
          return this.startSpeakerMusic(
            speakerId,
            speaker.currentSong,
            speaker.serverTime,
            false, // Don't broadcast - this is initial sync
            groupSyncTime // Pass the SAME sync time to all speakers
          );
        });

        // Wait for all speakers to start
        await Promise.all(startPromises);

        // If speaker should be paused, pause it after starting
        if (speaker.isPaused) {
          speakersInGroup.forEach((speakerId) => {
            console.log(`   ⏸️ Pausing synced speaker: ${speakerId}`);
            this.pauseSpeakerMusic(speakerId, false);
          });
        }
      }
    });

    // If audio isn't unlocked yet, show notice and retry after unlock
    // Check if we have pending speakers OR if audio is locked (will affect future plays)
    if (this.pendingSpeakers.length > 0 && !this.soundManager.audioUnlocked) {
      console.log(
        "⚠️ Audio not unlocked yet. Music will start after you interact with the page."
      );
      this.setupAudioUnlockHandler();
    }
  }

  /**
   * Filter speakers to only return "primary" speakers from each connection group
   * This prevents starting the same song multiple times on connected speakers
   */
  filterPrimarySpeakers(speakers) {
    if (!this.sceneManager.speakerConnectionManager) {
      return speakers; // No connection manager, return all
    }

    const processedSpeakers = new Set();
    const primarySpeakers = [];

    speakers.forEach((speaker) => {
      // Skip if we've already processed this speaker as part of a group
      if (processedSpeakers.has(speaker.id)) {
        return;
      }

      // Get all speakers connected to this one
      const connectedGroup =
        this.sceneManager.speakerConnectionManager.getConnectedSpeakers(
          speaker.id
        );

      // Mark all speakers in this group as processed
      connectedGroup.forEach((id) => processedSpeakers.add(id));

      // Add this speaker as the primary for its group
      primarySpeakers.push(speaker);

      // Log the group
      if (connectedGroup.length > 1) {
        console.log(
          `   🔗 Speaker group: ${speaker.id} (primary) + ${
            connectedGroup.length - 1
          } connected`
        );
      }
    });

    return primarySpeakers;
  }

  /**
   * Setup handler to retry music playback after audio unlock
   */
  setupAudioUnlockHandler() {
    if (this.audioUnlockHandlerSetup) return; // Already setup
    this.audioUnlockHandlerSetup = true;

    // Show user-friendly notification
    this.showAudioUnlockNotice();

    const checkAudioUnlock = setInterval(() => {
      if (
        this.soundManager.audioUnlocked &&
        this.pendingSpeakers &&
        this.pendingSpeakers.length > 0
      ) {
        console.log("🔓 Audio unlocked! Starting pending music...");

        // Hide the notice
        this.hideAudioUnlockNotice();

        // Retry starting all pending speakers with a SHARED sync time
        const speakersToRetry = [...this.pendingSpeakers]; // Copy array
        this.pendingSpeakers = []; // Clear before retrying

        // Calculate sync time ONCE for all pending speakers (perfect synchronization)
        const sharedSyncTime = Date.now();
        console.log(
          `   ⏱️ Retrying ${speakersToRetry.length} speakers with shared sync time: ${sharedSyncTime}`
        );

        speakersToRetry.forEach((speaker) => {
          this.startSpeakerMusic(
            speaker.id,
            speaker.currentSong,
            speaker.serverTime,
            false,
            sharedSyncTime // Pass the SAME sync time to all speakers
          );
        });

        clearInterval(checkAudioUnlock);
      }
    }, 500); // Check every 500ms
  }

  /**
   * Show audio unlock notice to user
   */
  showAudioUnlockNotice() {
    // Check if notice already exists
    let notice = document.getElementById("music-unlock-notice");
    if (notice) {
      notice.style.display = "block";
      return;
    }

    // Create notice element
    notice = document.createElement("div");
    notice.id = "music-unlock-notice";
    notice.style.cssText = `
      position: fixed;
      bottom: 100px;
      left: 50%;
      transform: translateX(-50%);
      background: linear-gradient(135deg, rgba(147, 51, 234, 0.95), rgba(168, 85, 247, 0.95));
      color: white;
      padding: 16px 24px;
      border-radius: 12px;
      font-weight: 600;
      font-size: 14px;
      z-index: 3000;
      box-shadow: 0 8px 32px rgba(147, 51, 234, 0.4);
      backdrop-filter: blur(10px);
      border: 1px solid rgba(255, 255, 255, 0.2);
      animation: slideUpBounce 0.5s ease-out;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
      display: flex;
      align-items: center;
      gap: 12px;
      cursor: pointer;
    `;
    notice.innerHTML = `
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M9 18V5l12-2v13M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 19a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/>
      </svg>
      <div>
        <div style="font-size: 15px; margin-bottom: 2px;">🎵 Music is waiting!</div>
        <div style="font-size: 12px; opacity: 0.9;">Click anywhere to enable audio playback</div>
      </div>
    `;

    // Add click handler to dismiss
    notice.addEventListener("click", () => {
      notice.style.display = "none";
    });

    // Add animation keyframe if not exists
    if (!document.getElementById("music-unlock-animation")) {
      const style = document.createElement("style");
      style.id = "music-unlock-animation";
      style.textContent = `
        @keyframes slideUpBounce {
          0% {
            transform: translateX(-50%) translateY(100px);
            opacity: 0;
          }
          60% {
            transform: translateX(-50%) translateY(-10px);
            opacity: 1;
          }
          80% {
            transform: translateX(-50%) translateY(5px);
          }
          100% {
            transform: translateX(-50%) translateY(0);
          }
        }
      `;
      document.head.appendChild(style);
    }

    document.body.appendChild(notice);
  }

  /**
   * Hide audio unlock notice
   */
  hideAudioUnlockNotice() {
    const notice = document.getElementById("music-unlock-notice");
    if (notice) {
      notice.style.animation = "fadeOut 0.3s ease-out";
      setTimeout(() => {
        notice.remove();
      }, 300);
    }

    // Add fadeOut animation if not exists
    if (!document.getElementById("fadeout-animation")) {
      const style = document.createElement("style");
      style.id = "fadeout-animation";
      style.textContent = `
        @keyframes fadeOut {
          from {
            opacity: 1;
            transform: translateX(-50%) translateY(0);
          }
          to {
            opacity: 0;
            transform: translateX(-50%) translateY(20px);
          }
        }
      `;
      document.head.appendChild(style);
    }
  }

  /**
   * Setup spatial audio update loop
   */
  setupSpatialAudioUpdate() {
    let debugLogged = false; // Only log once
    let lastDebugTime = 0;

    const updateSpatialAudio = () => {
      // Get the local player from the player manager
      const playerManager = this.sceneManager?.playerManager;
      const playerId = this.networkManager?.playerId;
      const localPlayer =
        playerManager && playerId ? playerManager.players.get(playerId) : null;

      // Debug: Check why spatial audio isn't working (log once per session + every 5 seconds if still having issues)
      const now = Date.now();
      if (!debugLogged && this.activeSpeakers.size > 0) {
        console.log("🎧 Spatial Audio Debug:", {
          hasSceneManager: !!this.sceneManager,
          hasPlayerManager: !!playerManager,
          hasPlayerId: !!playerId,
          hasLocalPlayer: !!localPlayer,
          hasLocalPlayerMesh: !!localPlayer?.mesh,
          activeSpeakers: this.activeSpeakers.size,
          soundEnabled: this.soundManager.enabled,
          masterVolume: this.soundManager.masterVolume,
        });
        debugLogged = true;
        lastDebugTime = now;
      }

      if (localPlayer && localPlayer.mesh) {
        const listenerPos = localPlayer.mesh.position;
        let anyVolumeSet = false;

        this.activeSpeakers.forEach((speakerData, speakerId) => {
          const speaker = speakerData.speakerObj;
          if (!speaker || !speakerData.audio) return;

          // Calculate distance to speaker
          const speakerPos = speaker.position;
          const distance = listenerPos.distanceTo(speakerPos);

          // Calculate volume based on distance
          let volume = 0;
          if (distance <= this.maxHearingDistance) {
            const distanceFactor = 1 - distance / this.maxHearingDistance;
            volume = this.maxVolume * distanceFactor * distanceFactor; // Square falloff for more natural sound
          }

          // Get speaker's base volume (user-set volume)
          const baseVolume =
            speakerData.baseVolume || this.speakerVolumes.get(speakerId) || 0.7;

          // Apply volume with master volume and speaker's base volume
          const finalVolume =
            volume *
            baseVolume *
            this.soundManager.masterVolume *
            (this.soundManager.enabled ? 1 : 0);

          speakerData.audio.volume = finalVolume;

          if (finalVolume > 0) {
            anyVolumeSet = true;
          }

          // Debug logging every 5 seconds if volumes are still 0
          if (
            now - lastDebugTime > 5000 &&
            !anyVolumeSet &&
            this.activeSpeakers.size > 0
          ) {
            console.log(
              `🔊 Spatial Audio Update - Speaker: ${speakerId.substring(
                0,
                8
              )}, Distance: ${distance.toFixed(
                2
              )}, Volume: ${finalVolume.toFixed(
                3
              )}, Base: ${baseVolume}, Master: ${
                this.soundManager.masterVolume
              }`
            );
            lastDebugTime = now;
          }
        });
      } else {
        // If player not ready, use a default volume so music is audible
        this.activeSpeakers.forEach((speakerData, speakerId) => {
          if (speakerData.audio) {
            const baseVolume =
              speakerData.baseVolume ||
              this.speakerVolumes.get(speakerId) ||
              0.7;
            const fallbackVolume =
              baseVolume *
              this.soundManager.masterVolume *
              (this.soundManager.enabled ? 1 : 0);
            speakerData.audio.volume = fallbackVolume;
          }
        });
      }

      requestAnimationFrame(updateSpatialAudio);
    };

    updateSpatialAudio();
  }

  /**
   * Start playing music from a speaker (synced)
   * @param {string} speakerId - ID of the speaker obstacle
   * @param {string} songName - Name of the song file
   * @param {number} serverTime - Server timestamp when song started
   * @param {boolean} broadcast - Whether to broadcast to other clients
   * @param {number} syncTime - Optional: Pre-calculated client time for perfect sync
   */
  async startSpeakerMusic(
    speakerId,
    songName,
    serverTime,
    broadcast = true,
    syncTime = null
  ) {
    console.log(
      `🎬 startSpeakerMusic called: speaker=${speakerId.substring(
        0,
        8
      )}..., song=${songName}, broadcast=${broadcast}, syncTime=${
        syncTime ? "provided" : "null"
      }`
    );

    try {
      // Check if this speaker is already playing this exact song
      const existingSpeaker = this.activeSpeakers.get(speakerId);
      if (
        existingSpeaker &&
        existingSpeaker.songName === songName &&
        !existingSpeaker.audio.paused
      ) {
        // Check if the time difference is reasonable (within 2 seconds)
        const timeDiff =
          Math.abs(existingSpeaker.startTime - serverTime) / 1000;
        if (timeDiff < 2) {
          console.log(
            `🔄 Speaker ${speakerId.substring(
              0,
              8
            )} already playing ${songName}, skipping duplicate (time diff: ${timeDiff.toFixed(
              2
            )}s)`
          );
          return;
        }
      }

      // Stop any existing music from this speaker
      this.stopSpeakerMusic(speakerId, false);

      // Find the speaker object in the scene
      const speaker = this.sceneManager.obstacles.find(
        (obj) => obj.userData.id === speakerId
      );

      if (!speaker) {
        console.warn(
          `Speaker ${speakerId} not found in scene, retrying in 1s...`
        );
        // Retry after 1 second (speaker might still be loading)
        // Use a retry flag to prevent multiple retries
        if (!this.retryTimers) this.retryTimers = new Set();
        if (!this.retryTimers.has(speakerId)) {
          this.retryTimers.add(speakerId);
          setTimeout(() => {
            this.retryTimers.delete(speakerId);
            this.startSpeakerMusic(speakerId, songName, serverTime, false);
          }, 1000);
        }
        return;
      }

      // Create audio element
      const audio = new Audio(`/sounds/music/${songName}`);
      audio.loop = false; // Don't loop - we'll handle auto-play

      // Get speaker's base volume (user-set volume) - default to 70%
      const baseVolume = this.speakerVolumes.get(speakerId) || 0.7;
      // Start with a reasonable initial volume (spatial audio will adjust)
      audio.volume =
        baseVolume *
        this.maxVolume *
        this.soundManager.masterVolume *
        (this.soundManager.enabled ? 1 : 0);

      // Add ended event listener for auto-play
      // Only the "primary" speaker in a group should trigger auto-play to avoid duplicates
      audio.addEventListener("ended", () => {
        console.log(
          `🎵 Song ended on speaker ${speakerId.substring(0, 8)}: ${songName}`
        );

        // Check if this speaker is the primary in its connection group
        const isPrimarySpeaker = this.isPrimarySpeakerInGroup(speakerId);

        if (!isPrimarySpeaker) {
          console.log(
            `   ⏭️ Skipping auto-play - this is a connected speaker, not primary`
          );
          return;
        }

        if (this.autoPlayEnabled) {
          console.log(`   ⏭️ Primary speaker triggering auto-play`);
          this.playNextSong(speakerId);
        } else {
          this.stopSpeakerMusic(speakerId, true);
        }
      });

      // Calculate playback position based on server time
      // Use provided syncTime for perfect synchronization across multiple speakers
      const clientTime = syncTime !== null ? syncTime : Date.now();
      const timeDiff = (clientTime - serverTime) / 1000; // Seconds since start

      // Wait for audio to load metadata
      await new Promise((resolve, reject) => {
        audio.addEventListener("loadedmetadata", resolve, { once: true });
        audio.addEventListener("error", reject, { once: true });
      });

      // Sync playback position
      const duration = audio.duration;
      if (duration > 0 && timeDiff > 0) {
        audio.currentTime = timeDiff % duration; // Sync with loop
      }

      // Try to play audio with autoplay policy handling
      try {
        await audio.play();
      } catch (playError) {
        // Handle autoplay policy errors
        if (
          playError.name === "NotAllowedError" ||
          playError.message.includes("user didn't interact")
        ) {
          console.warn(
            `⚠️ Autoplay blocked for speaker ${speakerId}. Adding to pending list.`
          );

          // Add to pending speakers for retry after user interaction
          if (!this.pendingSpeakers) {
            this.pendingSpeakers = [];
          }

          // Check if not already in pending list
          const alreadyPending = this.pendingSpeakers.some(
            (s) => s.id === speakerId
          );
          if (!alreadyPending) {
            this.pendingSpeakers.push({
              id: speakerId,
              currentSong: songName,
              serverTime: serverTime,
              isPlaying: true,
            });
          }

          // Setup audio unlock handler if not already setup
          this.setupAudioUnlockHandler();

          // Cleanup the failed audio element
          audio.pause();
          audio.remove();

          // Don't continue with the rest of the function
          return;
        } else {
          // Re-throw other types of errors
          throw playError;
        }
      }

      // Store active speaker data
      this.activeSpeakers.set(speakerId, {
        audio,
        speakerObj: speaker,
        songName,
        startTime: serverTime,
        isPaused: false,
        baseVolume: this.speakerVolumes.get(speakerId) || 0.7, // Store base volume
      });

      console.log(`🎵 Started music on speaker ${speakerId}: ${songName}`);
      console.log(
        `   Audio paused: ${audio.paused}, Volume: ${audio.volume.toFixed(
          3
        )} (base: ${baseVolume.toFixed(
          2
        )}), Current time: ${audio.currentTime.toFixed(2)}s`
      );
      console.log(
        `   Sound settings - Master: ${this.soundManager.masterVolume}, Enabled: ${this.soundManager.enabled}, MaxVolume: ${this.maxVolume}`
      );

      // Add visual indicator that speaker is playing
      if (this.sceneManager.speakerConnectionManager) {
        this.sceneManager.speakerConnectionManager.addPlayingIndicator(
          speakerId
        );
      }

      // Broadcast to other clients
      if (broadcast) {
        this.networkManager.socket.emit("startSpeakerMusic", {
          speakerId,
          songName,
          serverTime: Date.now(),
        });
      }

      // Start music on all connected speakers (only if broadcasting AND not already playing)
      if (broadcast && this.sceneManager.speakerConnectionManager) {
        const connectedSpeakers =
          this.sceneManager.speakerConnectionManager.getConnectedSpeakers(
            speakerId
          );

        // Use the same sync time for all connected speakers to ensure perfect sync
        const groupSyncTime = syncTime !== null ? syncTime : Date.now();

        connectedSpeakers.forEach((connectedId) => {
          if (connectedId !== speakerId) {
            const existingData = this.activeSpeakers.get(connectedId);
            // Only start if not playing, or playing different song
            if (!existingData || existingData.songName !== songName) {
              console.log(
                `🔌 Syncing music to connected speaker: ${connectedId}`
              );
              // Pass the same serverTime and groupSyncTime for perfect sync
              this.startSpeakerMusic(
                connectedId,
                songName,
                serverTime,
                false,
                groupSyncTime
              );
            }
          }
        });
      }

      // Update UI if this is the current speaker
      if (this.currentSpeaker === speakerId) {
        this.updateMusicPlayerUI();
      }
    } catch (error) {
      console.error(`❌ Error starting music on speaker ${speakerId}:`, error);

      // Show user-friendly message for autoplay issues
      if (
        error.name === "NotAllowedError" ||
        error.message.includes("user didn't interact")
      ) {
        console.log(
          "💡 Tip: Click anywhere on the page to enable audio playback"
        );
      }
    }
  }

  /**
   * Stop music from a speaker
   * @param {string} speakerId - ID of the speaker obstacle
   * @param {boolean} broadcast - Whether to broadcast to other clients
   */
  stopSpeakerMusic(speakerId, broadcast = true) {
    const speakerData = this.activeSpeakers.get(speakerId);
    if (speakerData) {
      if (speakerData.audio) {
        speakerData.audio.pause();
        speakerData.audio.currentTime = 0;
        speakerData.audio.remove();
      }
      this.activeSpeakers.delete(speakerId);

      console.log(`🔇 Stopped music on speaker ${speakerId.substring(0, 8)}`);

      // Remove visual indicator
      if (this.sceneManager.speakerConnectionManager) {
        this.sceneManager.speakerConnectionManager.removePlayingIndicator(
          speakerId
        );
      }

      // Broadcast to other clients
      if (broadcast) {
        this.networkManager.socket.emit("stopSpeakerMusic", { speakerId });
      }

      // Stop all connected speakers (without broadcasting each one)
      if (broadcast && this.sceneManager.speakerConnectionManager) {
        const connectedSpeakers =
          this.sceneManager.speakerConnectionManager.getConnectedSpeakers(
            speakerId
          );
        connectedSpeakers.forEach((connectedId) => {
          if (connectedId !== speakerId) {
            this.stopSpeakerMusic(connectedId, false); // Don't broadcast for connected speakers
          }
        });
      }

      // Update UI if this is the current speaker
      if (this.currentSpeaker === speakerId) {
        this.updateMusicPlayerUI();
      }
    }
  }

  /**
   * Change song on a speaker
   * @param {string} speakerId - ID of the speaker obstacle
   * @param {string} songName - Name of the new song
   * @param {number} serverTime - Server timestamp
   * @param {boolean} broadcast - Whether to broadcast to other clients
   */
  changeSpeakerMusic(speakerId, songName, serverTime, broadcast = true) {
    this.startSpeakerMusic(speakerId, songName, serverTime, broadcast);
  }

  /**
   * Open music player UI for a speaker
   * @param {string} speakerId - ID of the speaker obstacle
   */
  openMusicPlayer(speakerId) {
    console.log(`Opening music player for speaker ${speakerId}`);
    this.currentSpeaker = speakerId;

    // Show the music player modal
    const modal = document.getElementById("music-player-modal");
    if (modal) {
      modal.style.display = "flex";
      modal.style.pointerEvents = "auto"; // Ensure it blocks clicks
      this.updateMusicPlayerUI();
    }
  }

  /**
   * Close music player UI
   */
  closeMusicPlayer() {
    this.currentSpeaker = null;
    const modal = document.getElementById("music-player-modal");
    if (modal) {
      modal.style.display = "none";
      modal.style.pointerEvents = "none"; // Allow clicks through when closed
    }
  }

  /**
   * Update music player UI
   */
  updateMusicPlayerUI() {
    if (!this.currentSpeaker) return;

    const speakerData = this.activeSpeakers.get(this.currentSpeaker);
    const isPlaying = !!speakerData && !speakerData.isPaused;
    const isPaused = !!speakerData && speakerData.isPaused;
    const currentSong = speakerData?.songName || null;

    // Update current song display
    const currentSongEl = document.getElementById("current-song-name");
    if (currentSongEl) {
      currentSongEl.textContent = currentSong
        ? currentSong.replace(/\.(mp3|wav|ogg)$/i, "")
        : "No song playing";
    }

    // Update pause/resume buttons
    const pauseBtn = document.getElementById("music-pause-btn");
    const resumeBtn = document.getElementById("music-resume-btn");
    const stopBtn = document.getElementById("music-stop-btn");

    if (pauseBtn) {
      pauseBtn.style.display = isPlaying ? "flex" : "none";
    }
    if (resumeBtn) {
      resumeBtn.style.display = isPaused ? "flex" : "none";
    }
    if (stopBtn) {
      stopBtn.disabled = !speakerData;
    }

    // Update volume slider
    const volumeSlider = document.getElementById("music-volume-slider");
    const volumeValue = document.getElementById("music-volume-value");
    if (volumeSlider && this.currentSpeaker) {
      const volume = this.getSpeakerVolume(this.currentSpeaker);
      volumeSlider.value = volume;
      if (volumeValue) {
        volumeValue.textContent = `${Math.round(volume)}%`;
      }
    }

    // Update auto-play checkbox
    const autoPlayCheckbox = document.getElementById("music-autoplay-checkbox");
    if (autoPlayCheckbox) {
      autoPlayCheckbox.checked = this.autoPlayEnabled;
    }

    // Highlight selected song in list
    const songItems = document.querySelectorAll(".music-song-item");
    songItems.forEach((item) => {
      const songName = item.dataset.song;
      if (songName === currentSong) {
        item.classList.add("selected");
      } else {
        item.classList.remove("selected");
      }
    });
  }

  /**
   * Pause music on a speaker
   * @param {string} speakerId - ID of the speaker
   * @param {boolean} broadcast - Whether to broadcast to other clients (default: true)
   */
  pauseSpeakerMusic(speakerId, broadcast = true) {
    const speakerData = this.activeSpeakers.get(speakerId);
    if (speakerData && speakerData.audio && !speakerData.isPaused) {
      speakerData.audio.pause();
      speakerData.isPaused = true;
      speakerData.pausedTime = Date.now();
      console.log(`⏸️ Paused music on speaker ${speakerId}`);

      // Broadcast to other clients
      if (broadcast) {
        this.networkManager.socket.emit("pauseSpeakerMusic", { speakerId });
      }

      // Pause all connected speakers (without broadcasting each one)
      if (broadcast && this.sceneManager.speakerConnectionManager) {
        const connectedSpeakers =
          this.sceneManager.speakerConnectionManager.getConnectedSpeakers(
            speakerId
          );
        connectedSpeakers.forEach((connectedId) => {
          if (connectedId !== speakerId) {
            this.pauseSpeakerMusic(connectedId, false); // Don't broadcast for connected speakers
          }
        });
      }

      this.updateMusicPlayerUI();
    }
  }

  /**
   * Resume music on a speaker
   * @param {string} speakerId - ID of the speaker
   * @param {boolean} broadcast - Whether to broadcast to other clients (default: true)
   */
  resumeSpeakerMusic(speakerId, broadcast = true) {
    const speakerData = this.activeSpeakers.get(speakerId);
    if (speakerData && speakerData.audio && speakerData.isPaused) {
      speakerData.audio.play();
      speakerData.isPaused = false;
      console.log(`▶️ Resumed music on speaker ${speakerId}`);

      // Broadcast to other clients
      if (broadcast) {
        this.networkManager.socket.emit("resumeSpeakerMusic", { speakerId });
      }

      // Resume all connected speakers (without broadcasting each one)
      if (broadcast && this.sceneManager.speakerConnectionManager) {
        const connectedSpeakers =
          this.sceneManager.speakerConnectionManager.getConnectedSpeakers(
            speakerId
          );
        connectedSpeakers.forEach((connectedId) => {
          if (connectedId !== speakerId) {
            this.resumeSpeakerMusic(connectedId, false); // Don't broadcast for connected speakers
          }
        });
      }

      this.updateMusicPlayerUI();
    }
  }

  /**
   * Set volume for a speaker
   * @param {string} speakerId - ID of the speaker
   * @param {number} volume - Volume level (0-100)
   * @param {boolean} broadcast - Whether to broadcast to other clients (default: true)
   */
  setSpeakerVolume(speakerId, volume, broadcast = true) {
    // volume is 0-100, convert to 0-1
    const normalizedVolume = volume / 100;
    this.speakerVolumes.set(speakerId, normalizedVolume);

    // Update active speaker if playing
    const speakerData = this.activeSpeakers.get(speakerId);
    if (speakerData && speakerData.audio) {
      // Store base volume, spatial audio will adjust it
      speakerData.baseVolume = normalizedVolume;
    }

    console.log(
      `🔊 Set volume for speaker ${speakerId.substring(0, 8)}: ${volume}%`
    );

    // Get all connected speakers FIRST (before broadcasting)
    let connectedSpeakers = [speakerId];
    if (this.sceneManager.speakerConnectionManager) {
      connectedSpeakers =
        this.sceneManager.speakerConnectionManager.getConnectedSpeakers(
          speakerId
        );
    }

    // Sync volume to all connected speakers locally (without broadcasting each one)
    if (broadcast) {
      connectedSpeakers.forEach((connectedId) => {
        if (connectedId !== speakerId) {
          // Apply locally without broadcasting
          this.setSpeakerVolume(connectedId, volume, false);
        }
      });
    }

    // Broadcast to other clients - send ALL speakers in the group
    if (broadcast) {
      // Broadcast volume change for ALL connected speakers so other clients update them too
      connectedSpeakers.forEach((connectedId) => {
        console.log(
          `   📡 Broadcasting volume change for speaker ${connectedId.substring(
            0,
            8
          )}: ${volume}%`
        );
        this.networkManager.socket.emit("changeSpeakerVolume", {
          speakerId: connectedId,
          volume,
        });
      });
    }
  }

  /**
   * Get volume for a speaker
   */
  getSpeakerVolume(speakerId) {
    return (this.speakerVolumes.get(speakerId) || 0.7) * 100; // Default 70%
  }

  /**
   * Check if this speaker is the primary speaker in its connection group
   * Used to determine which speaker should trigger auto-play
   */
  isPrimarySpeakerInGroup(speakerId) {
    if (!this.sceneManager.speakerConnectionManager) {
      return true; // No connection manager, treat as primary
    }

    // Get all speakers in this group
    const connectedSpeakers =
      this.sceneManager.speakerConnectionManager.getConnectedSpeakers(
        speakerId
      );

    // If alone, it's primary
    if (connectedSpeakers.length === 1) {
      return true;
    }

    // The primary is the one with the "smallest" ID (alphabetically first)
    // This ensures consistent primary selection across all clients
    const sortedSpeakers = [...connectedSpeakers].sort();
    const primarySpeaker = sortedSpeakers[0];

    return speakerId === primarySpeaker;
  }

  /**
   * Play next song in queue (auto-play)
   */
  playNextSong(speakerId) {
    if (!this.autoPlayEnabled || this.availableSongs.length === 0) return;

    const currentData = this.activeSpeakers.get(speakerId);
    const currentSong = currentData?.songName;

    // Find current song index
    const currentIndex = this.availableSongs.findIndex(
      (song) => song.filename === currentSong
    );

    // Get next song (loop to start if at end)
    const nextIndex = (currentIndex + 1) % this.availableSongs.length;
    const nextSong = this.availableSongs[nextIndex];

    console.log(
      `⏭️ Auto-playing next song on speaker ${speakerId.substring(0, 8)}: ${
        nextSong.name
      }`
    );
    this.startSpeakerMusic(speakerId, nextSong.filename, Date.now(), true);
  }

  /**
   * Populate song list in UI with pagination
   */
  populateSongList() {
    const container = document.getElementById("music-song-list");
    if (!container) return;

    container.innerHTML = "";

    // Calculate pagination
    const totalPages = Math.ceil(
      this.availableSongs.length / this.songsPerPage
    );
    const startIdx = this.currentPage * this.songsPerPage;
    const endIdx = Math.min(
      startIdx + this.songsPerPage,
      this.availableSongs.length
    );
    const songsToShow = this.availableSongs.slice(startIdx, endIdx);

    // Show pagination if more than one page
    const paginationEl = document.getElementById("music-pagination");
    if (paginationEl) {
      if (totalPages > 1) {
        paginationEl.style.display = "flex";
        document.getElementById("music-page-info").textContent = `Page ${
          this.currentPage + 1
        } of ${totalPages}`;

        const prevBtn = document.getElementById("music-prev-page");
        const nextBtn = document.getElementById("music-next-page");

        if (prevBtn) prevBtn.disabled = this.currentPage === 0;
        if (nextBtn) nextBtn.disabled = this.currentPage === totalPages - 1;
      } else {
        paginationEl.style.display = "none";
      }
    }

    // Populate songs for current page
    songsToShow.forEach((song) => {
      const item = document.createElement("div");
      item.className = "music-song-item";
      item.dataset.song = song.filename;
      item.textContent = song.name;

      item.addEventListener("click", () => {
        if (this.currentSpeaker) {
          this.startSpeakerMusic(
            this.currentSpeaker,
            song.filename,
            Date.now(),
            true
          );
        }
      });

      container.appendChild(item);
    });
  }

  /**
   * Go to next page
   */
  nextPage() {
    const totalPages = Math.ceil(
      this.availableSongs.length / this.songsPerPage
    );
    if (this.currentPage < totalPages - 1) {
      this.currentPage++;
      this.populateSongList();
      this.updateMusicPlayerUI();
    }
  }

  /**
   * Go to previous page
   */
  previousPage() {
    if (this.currentPage > 0) {
      this.currentPage--;
      this.populateSongList();
      this.updateMusicPlayerUI();
    }
  }

  /**
   * Check if a furniture is a speaker
   */
  isSpeaker(furnitureName) {
    const name = furnitureName.toLowerCase();
    return name.includes("speaker");
  }

  /**
   * Cleanup - stop all music
   */
  cleanup() {
    this.activeSpeakers.forEach((speakerData, speakerId) => {
      this.stopSpeakerMusic(speakerId, false);
    });
    this.activeSpeakers.clear();
  }
}
