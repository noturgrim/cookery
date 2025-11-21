# 🎵 Music Player System Guide

## Overview

The Music Player System allows players to spawn speakers in the game world and play synchronized music that all nearby players can hear together. The system uses spatial audio, so the music gets louder as you get closer to the speaker and fades with distance.

## Features

✅ **Synced Playback** - All players hear the same music at the same time  
✅ **Spatial Audio** - Volume decreases naturally with distance (up to 50 units)  
✅ **Persistent State** - Speaker music state is saved to the database  
✅ **Multiple Speakers** - Each speaker can play different songs independently  
✅ **Easy Song Management** - Add songs by dropping MP3 files in the folder

## Setup Instructions

### 1. Database Migration

If you have an existing database, run the migration to add music columns:

```bash
node migrate-music.js
```

### 2. Add Music Files

Place your MP3 files in the `public/sounds/music/` directory:

```
public/sounds/music/
  ├── Pag-Ibig ay Kanibalismo.mp3  (sample included)
  ├── Your-Song-1.mp3
  ├── Your-Song-2.mp3
  └── ...
```

**Supported formats:** MP3, WAV, OGG

### 3. Start the Server

```bash
npm start
```

The server will automatically detect all music files in the music folder.

## How to Use

### In-Game Instructions

1. **Spawn a Speaker**

   - Press `B` to open the spawn menu
   - Navigate to the **Furniture** section
   - Search for "speaker" or scroll to find:
     - `speaker` - Large speaker
     - `speakersmall` - Small speaker
   - Click to spawn it in the center

2. **Position the Speaker**

   - Press `E` to enter Edit Mode
   - Click and drag the speaker to your desired location
   - Press `E` again to exit Edit Mode

3. **Play Music**

   - Walk close to the speaker (within 2.5 units)
   - You'll see: "Press **F** to play music on speaker"
   - Press `F` to open the Music Player

4. **Select a Song**

   - The Music Player modal will appear
   - Browse the list of available songs
   - Click on a song to start playing it
   - The music will immediately start for all players

5. **Stop Music**
   - Walk back to the speaker and press `F` again
   - Or click the **Stop** button in the Music Player modal

## Technical Details

### Synchronization

- When a song starts, the server records the exact timestamp
- All clients calculate their playback position based on this timestamp
- This ensures everyone hears the song at the exact same time
- Songs automatically loop when they reach the end

### Spatial Audio

- **Maximum hearing distance:** 50 units
- **Maximum volume:** 40% (configurable in MusicPlayerManager.js)
- **Falloff:** Squared distance falloff for natural sound attenuation
- Volume respects the master volume and sound enabled settings

### Performance

- Music files are streamed, not preloaded
- Only plays when at least one player is nearby
- Efficient memory usage with Audio API
- No impact on game performance

## Architecture

### Client-Side Components

- **MusicPlayerManager.js** - Manages music playback, sync, and spatial audio
- **InteractionManager.js** - Handles speaker interaction detection
- **Music Player UI** - Modal interface for song selection

### Server-Side Components

- **Socket Events:**

  - `startSpeakerMusic` - Start/change music on a speaker
  - `stopSpeakerMusic` - Stop music on a speaker
  - `requestMusicSync` - Get current state of all speakers
  - `speakerMusicStarted` - Broadcast music start to all clients
  - `speakerMusicStopped` - Broadcast music stop to all clients
  - `speakersStateSync` - Initial sync when player connects

- **API Endpoint:**

  - `GET /api/music/list` - Returns list of available songs

- **Database Schema:**
  ```sql
  obstacles table:
    - music_current_song VARCHAR(255)
    - music_is_playing BOOLEAN DEFAULT false
    - music_start_time BIGINT
  ```

## Customization

### Change Maximum Hearing Distance

Edit `public/js/managers/MusicPlayerManager.js`:

```javascript
this.maxHearingDistance = 50; // Change to your desired distance
```

### Change Maximum Volume

Edit `public/js/managers/MusicPlayerManager.js`:

```javascript
this.maxVolume = 0.4; // 0.0 to 1.0 (40% by default)
```

### Change Audio Falloff

Edit the spatial audio calculation in `MusicPlayerManager.js`:

```javascript
// Current: Squared falloff
volume = this.maxVolume * distanceFactor * distanceFactor;

// Linear falloff (alternative):
volume = this.maxVolume * distanceFactor;

// Cubic falloff (faster fade):
volume = this.maxVolume * Math.pow(distanceFactor, 3);
```

## Troubleshooting

### Music Not Playing

1. **Check audio permissions** - Browser may block autoplay
2. **Verify file format** - Use MP3 for best compatibility
3. **Check file location** - Files must be in `public/sounds/music/`
4. **Check console** - Look for error messages in browser console

### Music Not Synced

1. **Check server time** - Sync relies on Date.now()
2. **Network latency** - High latency may cause slight desync
3. **Refresh page** - Force a new sync with the server

### Performance Issues

1. **Use compressed MP3** - Lower bitrate files (128kbps is fine)
2. **Reduce file size** - Large files take longer to load
3. **Limit active speakers** - Each speaker uses bandwidth

## Future Enhancements

Possible improvements for the future:

- [ ] Volume control per speaker
- [ ] Playlist support (queue multiple songs)
- [ ] Pause/resume functionality
- [ ] Upload music files through UI
- [ ] Music visualization effects
- [ ] DJ permissions (restrict who can change music)
- [ ] Radio mode (shuffle through all songs)
- [ ] Crossfade between songs

## Credits

Music Player System created for LifeVerse  
Spatial audio implementation using Web Audio API  
Synchronized playback using server timestamps

---

**Have fun sharing music with your friends! 🎶**
