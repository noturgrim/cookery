# 🔌 Speaker Connections Feature

## Overview

Connect multiple speakers together so they all play the same music in perfect sync! Visual black wires show which speakers are connected.

## How to Use

### Step 1: Enter Connection Mode

- Press **`L`** key (for "Link") to toggle Connection Mode
- You'll see a green indicator: "🔌 CONNECTION MODE"

### Step 2: Connect Two Speakers

1. **Click the first speaker** - it will glow green
2. **Click the second speaker** - connection created!
3. A **black wire/cable** appears on the floor between them
4. Both speakers are now linked

### Step 3: Play Music

- Walk to **ANY** connected speaker
- Press **`F`** to open music player
- Select a song
- **ALL connected speakers** play the same music in sync! 🎵

### Disconnect Speakers

- Enter Connection Mode (**`L`** key)
- Click two connected speakers again
- Wire disappears, speakers unlinked

### Chain Connections

You can create chains:

- Speaker A ↔ Speaker B
- Speaker B ↔ Speaker C
- Result: A, B, and C all play together!

## Features

✅ **Visual Wires** - Black cables show connections on the floor  
✅ **Perfect Sync** - All connected speakers play at exact same time  
✅ **Chain Support** - Connect multiple speakers in series  
✅ **Multiplayer** - All players see wires and hear synced music  
✅ **Persistent** - Connections save to database  
✅ **Auto-cleanup** - Deleting speaker removes its connections

## Keyboard Shortcuts

| Key   | Action                    |
| ----- | ------------------------- |
| **L** | Toggle Connection Mode    |
| **E** | Edit Mode (move speakers) |
| **B** | Spawn Menu                |
| **F** | Interact / Play Music     |

## Technical Details

### Wire Appearance

- **Color**: Black (realistic audio cable)
- **Style**: Catenary curve (realistic sag/hang)
- **Height**: 0.1 units above floor
- **Updates**: Wires follow speakers when moved

### Sync Mechanism

- When music starts on one speaker, automatically starts on all connected
- Uses same server timestamp for perfect sync
- Works across all players in real-time

### Database

- Connections stored in `speaker_connections` table
- Auto-deleted when speaker is deleted (CASCADE)
- Loaded on server start and player join

## Use Cases

### Multi-Room Audio

```
Kitchen Speaker ↔ Dining Room Speaker ↔ Living Room Speaker
```

Play music that fills the entire restaurant!

### Stereo Setup

```
Left Speaker ↔ Right Speaker
```

Create a stereo sound system!

### Party Mode

```
Speaker 1 ↔ Speaker 2 ↔ Speaker 3 ↔ Speaker 4
```

Connect all speakers for a party atmosphere!

## Notes

- Speakers must be spawned first (use **B** key → Furniture → speaker)
- Can connect/disconnect while music is playing
- Wires update position when speakers are moved in Edit Mode
- Each speaker can have multiple connections

---

**Have fun creating your sound system! 🎵🔗**
