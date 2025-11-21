# 🎵 Quick Reference - Speaker System

## Visual Features

### 1. Black Wires on Floor

- **Color:** Black (#000000)
- **Position:** On floor (y = 0.05)
- **Style:** Natural curve with wiggle
- **Real-time:** Everyone sees wires instantly

### 2. Green Pulsing Rings

- **Color:** Green (#00ff00)
- **When:** Speaker is playing music
- **Animation:** Pulses 3 times per second
- **Visible to:** All players

## Keyboard Controls

| Key      | Action                           |
| -------- | -------------------------------- |
| `B`      | Open Spawn Menu                  |
| `E`      | Toggle Edit Mode                 |
| `L`      | Toggle Connection Mode           |
| `F`      | Open Music Player (near speaker) |
| `Delete` | Delete selected object           |

## How To Use

### Connect Speakers

```
1. Press L (Connection Mode ON)
2. Click first speaker (glows green)
3. Click second speaker
   → Black wire appears
   → Everyone sees it instantly
4. Press L (Connection Mode OFF)
```

### Play Music

```
1. Walk near ANY connected speaker
2. Press F (Music Player opens)
3. Click a song
   → ALL connected speakers start playing
   → Green rings appear on all
   → Everyone hears synced music
```

### Delete Speaker

```
1. Press E (Edit Mode)
2. Click speaker to select
3. Press Delete
   → Speaker removed
   → ALL wires to it removed
   → Music stops
   → Green rings disappear
```

## Features

✅ **Unlimited Speakers** - Connect as many as you want  
✅ **Chain Connections** - A↔B↔C↔D...  
✅ **Real-time Sync** - Everyone sees/hears everything  
✅ **Auto-cleanup** - Delete speaker = remove wires  
✅ **Visual Feedback** - Wires + pulsing rings  
✅ **Spatial Audio** - Volume by distance  
✅ **Perfect Sync** - Timestamp-based synchronization

## Troubleshooting

### "Can't hear music"

- Click anywhere on page first (browser autoplay policy)
- Check you're near a speaker (10 unit radius)
- Check master volume (sound icon)

### "Wire not visible"

- Both speakers must exist
- Try toggling connection mode (L)
- Check network connection

### "Music not synced"

- Server uses timestamps for perfect sync
- Should sync within 100ms
- Try refreshing if issue persists

### "Delete doesn't work"

- Must be in Edit Mode (E key)
- Click to select first
- Then press Delete

## Technical Notes

- **Wire segments:** 30 points for smooth curve
- **Max hearing distance:** 10 units
- **Volume falloff:** Square distance (more realistic)
- **Connection algorithm:** BFS for finding all connected speakers
- **Database:** PostgreSQL with SSL
- **Socket events:** Real-time via Socket.IO

## File Structure

```
public/js/managers/
├── MusicPlayerManager.js      ← Music playback & sync
├── SpeakerConnectionManager.js ← Wires & connections
├── InputManager.js             ← Keyboard/mouse input
└── NetworkManager.js           ← Socket communication

server/
├── index.js                    ← Socket handlers
└── database.js                 ← Database functions
```

## Socket Events

| Event                       | Direction       | Purpose           |
| --------------------------- | --------------- | ----------------- |
| `connectSpeakers`           | Client → Server | Link 2 speakers   |
| `disconnectSpeakers`        | Client → Server | Unlink 2 speakers |
| `speakersConnected`         | Server → All    | Wire appeared     |
| `speakersDisconnected`      | Server → All    | Wire removed      |
| `startSpeakerMusic`         | Client → Server | Start music       |
| `stopSpeakerMusic`          | Client → Server | Stop music        |
| `speakerMusicStarted`       | Server → All    | Music playing     |
| `speakerMusicStopped`       | Server → All    | Music stopped     |
| `requestMusicSync`          | Client → Server | Get current state |
| `speakersStateSync`         | Server → Client | Current speakers  |
| `requestSpeakerConnections` | Client → Server | Get connections   |
| `speakersConnectionsSync`   | Server → Client | All wires         |

## 🎉 That's It!

Simple, powerful, and production-ready!

**Have fun creating your multiplayer sound system!** 🎵
