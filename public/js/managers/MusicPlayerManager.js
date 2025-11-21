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

      // Store pending speakers to start after audio unlock
      this.pendingSpeakers = speakers.filter(
        (s) => s.isPlaying && s.currentSong
      );

      speakers.forEach((speaker) => {
        if (speaker.isPlaying && speaker.currentSong) {
          console.log(
            `   🔊 Syncing speaker ${speaker.id}: ${speaker.currentSong}`
          );
          this.startSpeakerMusic(
            speaker.id,
            speaker.currentSong,
            speaker.serverTime,
            false
          );
        }
      });

      // If audio isn't unlocked yet, show notice and retry after unlock
      if (!this.soundManager.audioUnlocked && this.pendingSpeakers.length > 0) {
        console.log(
          "⚠️ Audio not unlocked yet. Music will start after you interact with the page."
        );
        this.setupAudioUnlockHandler();
      }
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
   * Setup handler to retry music playback after audio unlock
   */
  setupAudioUnlockHandler() {
    if (this.audioUnlockHandlerSetup) return; // Already setup
    this.audioUnlockHandlerSetup = true;

    const checkAudioUnlock = setInterval(() => {
      if (
        this.soundManager.audioUnlocked &&
        this.pendingSpeakers &&
        this.pendingSpeakers.length > 0
      ) {
        console.log("🔓 Audio unlocked! Starting pending music...");

        // Retry starting all pending speakers
        this.pendingSpeakers.forEach((speaker) => {
          this.startSpeakerMusic(
            speaker.id,
            speaker.currentSong,
            speaker.serverTime,
            false
          );
        });

        this.pendingSpeakers = [];
        clearInterval(checkAudioUnlock);
      }
    }, 500); // Check every 500ms
  }

  /**
   * Setup spatial audio update loop
   */
  setupSpatialAudioUpdate() {
    let debugLogged = false; // Only log once

    const updateSpatialAudio = () => {
      // Get the local player from the player manager
      const playerManager = this.sceneManager?.playerManager;
      const playerId = this.networkManager?.playerId;
      const localPlayer =
        playerManager && playerId ? playerManager.players.get(playerId) : null;

      // Debug: Check why spatial audio isn't working
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
      }

      if (localPlayer && localPlayer.mesh) {
        const listenerPos = localPlayer.mesh.position;

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

          // Debug logging (comment out after fixing)
          // if (finalVolume > 0) {
          //   console.log(
          //     `🔊 Speaker distance: ${distance.toFixed(
          //       2
          //     )}, Volume: ${finalVolume.toFixed(3)}`
          //   );
          // }
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
   */
  async startSpeakerMusic(speakerId, songName, serverTime, broadcast = true) {
    try {
      // Check if this speaker is already playing this exact song at this time
      const existingSpeaker = this.activeSpeakers.get(speakerId);
      if (
        existingSpeaker &&
        existingSpeaker.songName === songName &&
        existingSpeaker.startTime === serverTime
      ) {
        console.log(
          `🔄 Speaker ${speakerId} already playing ${songName}, skipping duplicate`
        );
        return;
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
      audio.volume = 0; // Start at 0, spatial audio will adjust

      // Add ended event listener for auto-play
      audio.addEventListener("ended", () => {
        console.log(`🎵 Song ended: ${songName}`);
        if (this.autoPlayEnabled) {
          this.playNextSong(speakerId);
        } else {
          this.stopSpeakerMusic(speakerId, true);
        }
      });

      // Calculate playback position based on server time
      const clientTime = Date.now();
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

      // Play audio
      await audio.play();

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
        `   Audio paused: ${audio.paused}, Volume: ${
          audio.volume
        }, Current time: ${audio.currentTime.toFixed(2)}s`
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

      // Start music on all connected speakers
      if (this.sceneManager.speakerConnectionManager) {
        const connectedSpeakers =
          this.sceneManager.speakerConnectionManager.getConnectedSpeakers(
            speakerId
          );
        connectedSpeakers.forEach((connectedId) => {
          if (
            connectedId !== speakerId &&
            !this.activeSpeakers.has(connectedId)
          ) {
            console.log(
              `🔌 Syncing music to connected speaker: ${connectedId}`
            );
            this.startSpeakerMusic(connectedId, songName, serverTime, false);
          }
        });
      }

      // Update UI if this is the current speaker
      if (this.currentSpeaker === speakerId) {
        this.updateMusicPlayerUI();
      }
    } catch (error) {
      console.error(`Error starting music on speaker ${speakerId}:`, error);
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

      console.log(`🔇 Stopped music on speaker ${speakerId}`);

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
    this.currentSpeaker = speakerId;

    // Show the music player modal
    const modal = document.getElementById("music-player-modal");
    if (modal) {
      modal.style.display = "flex";
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

    console.log(`🔊 Set volume for speaker ${speakerId}: ${volume}%`);

    // Broadcast to other clients
    if (broadcast) {
      this.networkManager.socket.emit("changeSpeakerVolume", {
        speakerId,
        volume,
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

    console.log(`⏭️ Auto-playing next song: ${nextSong.name}`);
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
