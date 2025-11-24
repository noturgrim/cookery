# Spawn Location Update

## Change Description
Updated the spawn location for furniture and food items to spawn near the player's character instead of at the center of the main platform.

## Previous Behavior
- All spawned items (furniture and food) appeared at coordinates `(0, 0, 0)` - the center of the main platform
- This made spawning items inconvenient, especially when the player was far from the center
- Players had to drag items from the center to their desired location every time

## New Behavior
- Items now spawn **3 units in front of the player's current position**
- The spawn position is calculated based on:
  - Player's current X, Z coordinates
  - Player's rotation (facing direction)
  - A fixed distance of 3 units in front
- Items spawn at ground level (Y = 0 for furniture, Y = 1.5 for food)

## Implementation Details

### File: `public/js/managers/InputManager.js`

#### 1. New Helper Method: `getPlayerSpawnPosition()`
```javascript
getPlayerSpawnPosition() {
  // Get current player from network manager
  const player = this.networkManager.playerManager.players.get(
    this.networkManager.playerId
  );

  if (player && player.mesh) {
    // Calculate position 3 units in front of player
    const playerPos = player.mesh.position;
    const playerRotation = player.mesh.rotation.y;
    const distance = 3;
    
    const spawnX = playerPos.x + Math.sin(playerRotation) * distance;
    const spawnZ = playerPos.z + Math.cos(playerRotation) * distance;

    return { x: spawnX, y: 0, z: spawnZ };
  }

  // Fallback to center if player not found
  return { x: 0, y: 0, z: 0 };
}
```

#### 2. Updated `spawnFurniture()` Method
- Changed from: `furniture.position.set(0, 0, 0);`
- Changed to: Uses `this.getPlayerSpawnPosition()` to get dynamic position
- Added console log showing spawn coordinates

#### 3. Updated `spawnFood()` Method
- Changed from: `spawnFoodItem(foodName, 0, 1.5, 0, 1.5)`
- Changed to: Uses `this.getPlayerSpawnPosition()` for X and Z coordinates
- Added console log showing spawn coordinates

## Benefits
✅ **Convenience**: Items spawn right in front of the player  
✅ **Better UX**: No need to search for items at platform center  
✅ **Intuitive**: Items appear where you're looking/standing  
✅ **Less dragging**: Items spawn closer to where they'll be placed  

## Fallback Behavior
If the player position cannot be determined (edge case):
- Falls back to center position `(0, 0, 0)`
- Logs a warning to console: `⚠️ Player not found, spawning at center`

## Testing Steps
1. Load the game and move your character to any location
2. Press **B** to open spawn menu
3. Select a furniture item or food item to spawn
4. **Expected**: Item should appear 3 units in front of your character
5. Turn your character to face a different direction
6. Spawn another item
7. **Expected**: Item should spawn in front of the new direction you're facing

## Technical Notes
- Spawn distance: 3 units (configurable in `getPlayerSpawnPosition()`)
- Direction calculation uses `Math.sin()` and `Math.cos()` with player's Y-axis rotation
- Works on all platforms (main platform and custom platforms)
- Network synchronized - spawned items are sent to server with correct coordinates

