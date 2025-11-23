# Platform Creation Guide 🏗️

## Overview

You can now create multiple platforms in the game! Each platform is player-owned, named, and automatically connected with bridges.

---

## How to Create a Platform

### Step 1: Click the "Create Platform" Button

- **Location**: Top-right corner of the screen (blue button with a "+" icon)
- **Shortcut**: Click this button to start the platform creation process

### Step 2: Enter Platform Size

- A prompt will ask you to enter the platform size
- **Valid range**: 20 to 200 units
- **Recommended**:
  - Small platform: 30-40 units
  - Medium platform: 50-70 units
  - Large platform: 80-120 units
- **Default**: 40 units

### Step 3: Position the Ghost Platform

- After entering the size, a **semi-transparent ghost platform** will appear
- **Move your mouse** to drag the ghost platform around the world
- The platform will **snap to a 5-unit grid** for alignment

#### Visual Feedback:

- **Green ghost** = Valid placement (away from other platforms)
- **Red ghost** = Invalid placement (too close to another platform)

### Step 4: Confirm Placement

- **Click anywhere** to place the platform
- A prompt will ask for the **platform name**
  - Default: `[Your Username]'s Platform`
  - You can customize this name
- **Press ESC** to cancel placement at any time

### Step 5: Wait for Server Confirmation

- The platform will be created and **saved to the database**
- A **bridge** will automatically connect your new platform to the nearest existing platform
- All players will see the new platform and bridge in real-time!

---

## Placement Rules

### Minimum Distance

- New platforms must be at least **10 units + (platform1_size + platform2_size)/2** away from existing platforms
- This ensures platforms don't overlap and bridges have space

### Auto-Bridge Generation

- **Automatically created** between new platform and nearest existing platform
- **Edge-to-edge connection**: Bridge connects from the closest edges, not centers
- **Width**: 2 units (walkable)
- **Real-time sync**: All players see the bridge immediately

---

## Visual Indicators

### Platform Display

- **Floor texture**: Same as main platform (customizable)
- **Grid lines**: Helper lines for alignment
- **Name label**: Displays platform owner and name
- **Elevation**: Flat at Y=0

### Ghost Platform (During Placement)

- **Semi-transparent** mesh
- **Color-coded**:
  - ✅ Green = Valid position
  - ❌ Red = Invalid (too close to another platform)
- **Grid-snapped**: Automatically aligns to 5-unit grid
- **Real-time preview**: Shows exactly where the platform will be placed

---

## Keyboard Controls

| Key     | Action                           |
| ------- | -------------------------------- |
| **ESC** | Cancel platform placement        |
| **E**   | Toggle edit mode (for objects)   |
| **B**   | Open spawn menu (furniture/food) |

---

## Console Testing Commands

### Check All Platforms

```javascript
game.platformManager.getAllPlatforms();
```

Returns an array of all loaded platforms with their properties:

- `id`: Unique platform identifier
- `name`: Platform display name
- `x`, `z`: World coordinates
- `size`: Platform dimensions
- `owner_username`: Who created it

### Start Placement Mode (Manual)

```javascript
game.platformManager.startPlacementMode(40);
game.inputManager.platformPlacementMode = true;
```

Starts ghost platform placement with size 40

### Cancel Placement (Manual)

```javascript
game.platformManager.cancelPlacement();
game.inputManager.platformPlacementMode = false;
```

### Check Placement Validity

```javascript
game.platformManager.isPlacementValid(x, z, size);
```

Returns `true` if a platform can be placed at (x, z) with given size

---

## Technical Details

### Database Tables

- **`platforms`**: Stores all platform data
  - `id`, `owner_username`, `name`, `x`, `y`, `z`, `size`, `floor_texture`, `is_main`
- **`bridges`**: Stores all bridge connections
  - `id`, `platform1_id`, `platform2_id`, start/end coordinates, `width`

### Real-Time Sync (Socket.IO Events)

- **`createPlatform`**: Client → Server (create request)
- **`platformCreated`**: Server → All Clients (new platform added)
- **`bridgeCreated`**: Server → All Clients (new bridge added)
- **`platformError`**: Server → Client (validation failed)

### Client-Side Managers

- **`PlatformManager`**: Handles rendering, ghost placement, platform lifecycle
- **`InputManager`**: Handles mouse/keyboard input for placement
- **`NetworkManager`**: Syncs platform data with server

### Server-Side Logic

- **Validation**: Checks distance, size range, database constraints
- **Bridge Generation**: Calculates closest edges and creates walkway
- **Real-time Broadcast**: Notifies all connected clients of changes

---

## Troubleshooting

### Ghost Platform Not Moving

- **Issue**: Mouse movement doesn't update ghost position
- **Fix**: Make sure you're not in edit mode (press `E` to toggle off)
- **Fix**: Make sure no menus are open (close settings, spawn menu, etc.)

### Can't Place Platform (Always Red)

- **Issue**: All positions show as invalid
- **Cause**: Too close to existing platforms
- **Fix**: Move further away from other platforms
- **Fix**: Try a smaller platform size

### Platform Button Not Visible

- **Issue**: "Create Platform" button doesn't appear
- **Check**: Button should be at `top: 20px; right: 420px`
- **Check**: Make sure JavaScript loaded (check console for errors)
- **Refresh**: Hard refresh the page (Ctrl+F5 or Cmd+Shift+R)

### Platform Not Saving

- **Issue**: Platform disappears after refresh
- **Check**: Server logs for database errors
- **Check**: Network tab for `createPlatform` Socket.IO event
- **Check**: Database connection (server should show "✅ Connected to PostgreSQL")

---

## Future Enhancements (Coming Soon)

### Not Yet Implemented

1. ⏳ **Collision system update**: Walking between platforms via bridges
2. ⏳ **Spatial loading/culling**: Only load nearby platforms for performance
3. ⏳ **Platform permissions UI**: Grant edit rights to other players
4. ⏳ **Platform customization**: Change floor texture, size, etc.
5. ⏳ **Platform deletion**: Remove platforms you own
6. ⏳ **Platform menu**: Right-click platform for options

### Currently Working

- ✅ **Ghost placement UI**: COMPLETE!
- ✅ **Database persistence**: COMPLETE!
- ✅ **Real-time sync**: COMPLETE!
- ✅ **Auto-bridge generation**: COMPLETE!

---

## Quick Test Checklist

1. ✅ Click "Create Platform" button (top-right, blue)
2. ✅ Enter size: 40
3. ✅ Move mouse around - ghost follows
4. ✅ Ghost turns green in valid spots, red in invalid spots
5. ✅ Click to place
6. ✅ Enter name (or use default)
7. ✅ Platform appears with name label
8. ✅ Bridge automatically connects to nearest platform
9. ✅ Refresh page - platform and bridge persist
10. ✅ Other players see the platform immediately

---

## Example Workflow

```javascript
// 1. Start placement
Click "Create Platform" button

// 2. Enter size
Type: 50 → Click OK

// 3. Position ghost (green = valid)
Move mouse to desired location

// 4. Place platform
Click to confirm

// 5. Name platform
Type: "My Awesome Island" → Click OK

// 6. Done! Platform created
✅ Platform rendered
✅ Bridge auto-generated
✅ Saved to database
✅ Synced to all players
```

---

## Need Help?

**Check Console Logs**:

```javascript
// Enable debug mode
localStorage.setItem("debug", "true");

// Check platform count
console.log(game.platformManager.getAllPlatforms().length);

// Check connection
console.log(game.networkManager.isConnected());
```

**Server Logs**:

- Look for `🏗️ Loaded X platforms from database`
- Look for `✅ Platform created: [platform_id]`
- Look for `❌ Error creating platform: [error]`

---

**Happy building! 🏗️✨**
