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

    // Currently interacting speaker
    this.currentSpeaker = null;

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
      speakers.forEach((speaker) => {
        if (speaker.isPlaying && speaker.currentSong) {
          this.startSpeakerMusic(
            speaker.id,
            speaker.currentSong,
            speaker.serverTime,
            false
          );
        }
      });
    });
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

          // Apply volume with master volume
          const finalVolume =
            volume *
            this.soundManager.masterVolume *
            (this.soundManager.enabled ? 1 : 0);

          speakerData.audio.volume = finalVolume;

          // Debug logging (comment out after fixing)
          if (finalVolume > 0) {
            console.log(
              `🔊 Speaker distance: ${distance.toFixed(
                2
              )}, Volume: ${finalVolume.toFixed(3)}`
            );
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
   */
  async startSpeakerMusic(speakerId, songName, serverTime, broadcast = true) {
    try {
      // Stop any existing music from this speaker
      this.stopSpeakerMusic(speakerId, false);

      // Find the speaker object in the scene
      const speaker = this.sceneManager.obstacles.find(
        (obj) => obj.userData.id === speakerId
      );

      if (!speaker) {
        console.warn(`Speaker ${speakerId} not found in scene`);
        return;
      }

      // Create audio element
      const audio = new Audio(`/sounds/music/${songName}`);
      audio.loop = true; // Loop the music
      audio.volume = 0; // Start at 0, spatial audio will adjust

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
      });

      console.log(`🎵 Started music on speaker ${speakerId}: ${songName}`);
      console.log(
        `   Audio paused: ${audio.paused}, Volume: ${
          audio.volume
        }, Current time: ${audio.currentTime.toFixed(2)}s`
      );

      // Broadcast to other clients
      if (broadcast) {
        this.networkManager.socket.emit("startSpeakerMusic", {
          speakerId,
          songName,
          serverTime: Date.now(),
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
    const isPlaying = !!speakerData;
    const currentSong = speakerData?.songName || null;

    // Update current song display
    const currentSongEl = document.getElementById("current-song-name");
    if (currentSongEl) {
      currentSongEl.textContent = currentSong
        ? currentSong.replace(".mp3", "")
        : "No song playing";
    }

    // Update play/stop button
    const playBtn = document.getElementById("music-play-btn");
    const stopBtn = document.getElementById("music-stop-btn");
    if (playBtn) {
      playBtn.disabled = isPlaying;
    }
    if (stopBtn) {
      stopBtn.disabled = !isPlaying;
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
   * Populate song list in UI
   */
  populateSongList() {
    const container = document.getElementById("music-song-list");
    if (!container) return;

    container.innerHTML = "";

    this.availableSongs.forEach((song) => {
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
