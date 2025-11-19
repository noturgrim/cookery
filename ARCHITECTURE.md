# Supercooked - Code Architecture

## Overview

The codebase has been refactored into modular, maintainable components following the Single Responsibility Principle. Each manager handles a specific domain of the game.

## Directory Structure

```
public/js/
├── managers/
│   ├── SceneManager.js       # Scene, camera, renderer, lights, floor, food
│   ├── PlayerManager.js       # Player creation, updates, animations
│   ├── UIManager.js           # Name tags, markers, visual indicators
│   ├── InputManager.js        # Mouse, keyboard, emote wheel, edit mode
│   └── NetworkManager.js      # Socket.io, server communication
├── animationController.js     # Procedural limb animations
├── characterManager.js        # Character model loading and creation
├── soundManager.js            # Audio playback and spatial sound
└── game.js                    # Main orchestrator (connects all managers)
```

## Manager Responsibilities

### 🎬 SceneManager

**Purpose**: Manages Three.js scene, camera, renderer, and world objects

**Key Methods**:

- `setupScene()` - Initialize Three.js scene with orthographic camera
- `setupLights()` - Configure ambient and directional lighting
- `createFloor()` - Create game floor and grid
- `createObstacle(data)` - Add obstacles/counters to scene
- `spawnFoodItem(name, x, y, z)` - Load and place food models
- `handleResize()` - Handle window resize events
- `render()` - Render the scene

**Properties**:

- `scene`, `camera`, `renderer` - Three.js core objects
- `floor` - Ground plane
- `obstacles` - Array of obstacle meshes
- `foodModels`, `foodItems` - Food model cache and instances

---

### 👥 PlayerManager

**Purpose**: Manages all player-related functionality

**Key Methods**:

- `loadCharacterModels()` - Load all character GLB files
- `createPlayer(playerData)` - Create player with model and animations
- `removePlayer(id)` - Clean up player resources
- `updatePlayerTarget(id, x, y, z, rotation)` - Set movement target
- `updatePlayers(delta, soundManager)` - Update all players (interpolation + animation)
- `updateWalkingAnimation(id, isMoving, soundManager)` - Handle walking animation

**Properties**:

- `players` - Map of all players (mesh, position, rotation, state)
- `characterManager` - CharacterManager instance
- `animationController` - AnimationController instance
- `playerId` - Current player's ID

---

### 🎨 UIManager

**Purpose**: Handles all visual UI elements in 3D and 2D space

**Key Methods**:

- `createNameTag(group, text, color)` - Create 3D sprite name tag above player
- `createMoveMarker(x, z)` - Show green ring where player clicked
- `drawPathTrace(path)` - Draw cyan line showing movement path
- `showVoiceIndicator(mesh, emote, camera)` - Show emoji above player
- `updateEditModeUI(isEditMode)` - Update edit mode UI text

**Properties**:

- `moveMarker` - Current move marker mesh
- `pathLine` - Current path trace line

---

### 🎮 InputManager

**Purpose**: Handles all user input (mouse, keyboard, emote wheel)

**Key Methods**:

- `setupInput()` - Initialize all event listeners
- `handleClick(event)` - Process click-to-move
- `handleMouseMove(event)` - Update mouse position, handle dragging
- `handleMouseDown(event)` - Start obstacle dragging
- `handleMouseUp(event)` - Finish obstacle dragging
- `toggleEditMode()` - Toggle obstacle edit mode (E key)
- `setupEmoteWheel()` - Setup emote wheel (T key)

**Properties**:

- `mouse` - Mouse position in normalized coordinates
- `raycaster` - Three.js raycaster for picking
- `editMode` - Whether edit mode is active
- `selectedObstacle`, `isDraggingObstacle` - Drag state
- `emoteWheelActive`, `selectedEmote` - Emote wheel state

---

### 🌐 NetworkManager

**Purpose**: Handles all server communication via Socket.io

**Key Methods**:

- `setupSocket()` - Initialize Socket.io connection and event handlers
- `moveTo(x, z)` - Send move command to server
- `updateObstacle(id, x, y, z)` - Send obstacle update to server
- `playEmote(emoteName)` - Broadcast emote to other players
- `updatePlayerCustomization(name, skinIndex)` - Update player info on server

**Socket Events Handled**:

- `connect` - Send player customization
- `init` - Receive initial game state
- `playerJoined` - New player connected
- `playerLeft` - Player disconnected
- `gameState` - Regular position updates
- `pathUpdate` - Path trace from server
- `obstacleUpdated` - Obstacle moved by other player
- `playerEmote` - Emote from other player

**Properties**:

- `socket` - Socket.io connection
- `playerId` - Current player's server ID
- `playerName`, `playerSkin` - Player customization data

---

## Core Components

### 🎭 AnimationController

**Purpose**: Handles procedural character animations (walking, idle)

**Key Methods**:

- `initializeAnimation(playerId, model, mixer)` - Setup animation for character
- `findLimbs(model)` - Locate limbs in model hierarchy
- `updateAnimation(playerId, isMoving)` - Update walk cycle and detect footsteps
- `applyWalkingAnimation(limbs, cycle, originalTransforms)` - Apply rotations to limbs
- `detectFootstep(prevCycle, currentCycle)` - Detect when feet hit ground

---

### 👤 CharacterManager

**Purpose**: Loads and creates character models

**Key Methods**:

- `loadCharacterModels()` - Load all 18 character GLB files (a-r)
- `createCharacterModel(playerData)` - Clone model and create character group
- `fixMaterials(model)` - Fix transparency and rendering issues

---

### 🔊 SoundManager

**Purpose**: Manages all audio playback with spatial sound

**Key Methods**:

- `loadSound(name, path)` - Load audio file
- `playFootstep(footIndex, distance, isOwnPlayer)` - Play footstep with volume based on distance
- `playVoice(emoteName, distance, isOwnPlayer)` - Play voice line with spatial audio

---

## Data Flow

### Player Movement

1. **User clicks** → InputManager detects click
2. **InputManager** → Sends to NetworkManager
3. **NetworkManager** → Emits to server via Socket.io
4. **Server** → Broadcasts to all clients
5. **NetworkManager** → Receives update
6. **PlayerManager** → Updates target position
7. **Game loop** → Interpolates position smoothly

### Animation

1. **PlayerManager** → Detects player is moving
2. **AnimationController** → Updates walk cycle
3. **AnimationController** → Detects footstep
4. **PlayerManager** → Triggers footstep sound via SoundManager
5. **AnimationController** → Applies limb rotations

### Emote

1. **User holds T** → InputManager shows emote wheel
2. **User releases T** → InputManager triggers emote
3. **NetworkManager** → Plays sound locally + sends to server
4. **Server** → Broadcasts to other players
5. **NetworkManager** → Other clients receive and play sound
6. **UIManager** → Shows emoji indicator above player

---

## Main Game Loop (game.js)

```javascript
animate() {
  // 1. Get delta time
  const delta = sceneManager.getDelta();

  // 2. Update all players (interpolation + animation)
  playerManager.updatePlayers(delta, soundManager);

  // 3. Render the scene
  sceneManager.render();
}
```

---

## Benefits of This Architecture

### ✅ Separation of Concerns

Each manager has a single, well-defined responsibility

### ✅ Easy to Test

Managers can be tested independently with mock dependencies

### ✅ Easy to Extend

Want to add new features? Just add methods to the appropriate manager

### ✅ Better Organization

Related functionality is grouped together, making the code easier to navigate

### ✅ Reusability

Managers can be reused in other projects or extended for new features

---

## Next Steps

### To add a new feature:

1. **Identify the domain** - Which manager is responsible?
2. **Add the method** - Implement in the appropriate manager
3. **Wire it up** - Connect in game.js if needed
4. **Test** - Verify the feature works

### Example: Adding a jump feature

1. Add `jump()` method to **InputManager** (listens for spacebar)
2. Add `playJumpAnimation()` to **AnimationController**
3. Add `emitJump()` to **NetworkManager** (broadcast to server)
4. Wire up in **game.js** if needed

---

## File Size Comparison

**Before**:

- game.js: ~1,400 lines

**After**:

- game.js: ~400 lines (main orchestrator)
- SceneManager.js: ~250 lines
- PlayerManager.js: ~200 lines
- UIManager.js: ~150 lines
- InputManager.js: ~200 lines
- NetworkManager.js: ~180 lines

Total lines increased slightly due to better documentation and clearer structure, but each file is now focused and maintainable!
