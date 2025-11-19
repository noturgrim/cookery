# Architecture Diagram

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                           GAME.JS                                │
│                    (Main Orchestrator)                           │
│                                                                   │
│  - Initializes all managers                                      │
│  - Runs game loop (animate)                                      │
│  - Handles welcome screen                                        │
│  - Loads sounds and models                                       │
└───────────┬─────────────────────────────────────────────────────┘
            │
            │ Creates & Coordinates
            │
    ┌───────┴──────────┬──────────┬──────────┬──────────┐
    │                  │          │          │          │
    ▼                  ▼          ▼          ▼          ▼
┌─────────┐     ┌──────────┐ ┌────────┐ ┌─────────┐ ┌──────────┐
│ Scene   │     │ Player   │ │   UI   │ │  Input  │ │ Network  │
│ Manager │     │ Manager  │ │ Manager│ │ Manager │ │ Manager  │
└────┬────┘     └────┬─────┘ └───┬────┘ └────┬────┘ └────┬─────┘
     │               │            │           │           │
     │Uses           │Uses        │Uses       │Uses       │Uses
     │               │            │           │           │
     ▼               ▼            ▼           ▼           ▼
┌─────────────────────────────────────────────────────────────────┐
│                     CORE COMPONENTS                              │
│                                                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐           │
│  │ Animation    │  │  Character   │  │   Sound     │           │
│  │ Controller   │  │   Manager    │  │  Manager    │           │
│  └──────────────┘  └──────────────┘  └─────────────┘           │
└─────────────────────────────────────────────────────────────────┘
```

---

## Manager Dependencies

```
┌──────────────────┐
│   SceneManager   │ ← Core Three.js scene management
└───────┬──────────┘
        │
        │ Passed to ↓
        │
        ├─→ ┌────────────────┐
        │   │  UIManager     │ ← Needs scene to add sprites
        │   └───────┬────────┘
        │           │
        │           │ Passed to ↓
        │           │
        ├─→ ┌───────┴────────┐
        │   │ PlayerManager  │ ← Needs scene + UI for players
        │   └───────┬────────┘
        │           │
        │           │ Passed to ↓
        │           │
        ├─→ ┌───────┴────────┐
        │   │ NetworkManager │ ← Needs all managers
        │   └───────┬────────┘
        │           │
        │           │ Passed to ↓
        │           │
        └─→ ┌───────┴────────┐
            │ InputManager   │ ← Needs scene, UI, network
            └────────────────┘
```

---

## Data Flow: Player Movement

```
1. USER CLICKS FLOOR
        │
        ▼
   ┌────────────┐
   │   Input    │  detects click
   │  Manager   │  calculates position
   └─────┬──────┘
         │ sends position
         ▼
   ┌────────────┐
   │  Network   │  emits to server
   │  Manager   │  via Socket.io
   └─────┬──────┘
         │
         ▼
   ┌────────────┐
   │   SERVER   │  broadcasts to all
   └─────┬──────┘
         │
         ▼
   ┌────────────┐
   │  Network   │  receives update
   │  Manager   │  for all players
   └─────┬──────┘
         │ updates target
         ▼
   ┌────────────┐
   │   Player   │  sets targetPosition
   │  Manager   │  for player
   └─────┬──────┘
         │
         ▼ (in game loop)
   ┌────────────┐
   │   Player   │  interpolates position
   │  Manager   │  updates animation
   └─────┬──────┘
         │
         ▼
   ┌────────────┐
   │ Animation  │  rotates limbs
   │ Controller │  detects footsteps
   └─────┬──────┘
         │ triggers sound
         ▼
   ┌────────────┐
   │   Sound    │  plays footstep
   │  Manager   │  with spatial audio
   └────────────┘
```

---

## Data Flow: Emote System

```
1. USER HOLDS T KEY
        │
        ▼
   ┌────────────┐
   │   Input    │  shows emote wheel
   │  Manager   │  tracks selection
   └─────┬──────┘
         │
2. USER RELEASES T
         │
         ▼
   ┌────────────┐
   │   Input    │  sends selected emote
   │  Manager   │
   └─────┬──────┘
         │
         ▼
   ┌────────────┐
   │  Network   │  playEmote(name)
   │  Manager   │
   └─────┬──────┴───────────┬──────────┐
         │                  │          │
         │ local play       │ emit     │
         ▼                  ▼          │
   ┌────────────┐     ┌─────────┐     │
   │   Sound    │     │ SERVER  │     │
   │  Manager   │     └────┬────┘     │
   └────────────┘          │          │
                           │ broadcast│
                           ▼          │
                     ┌────────────┐   │
                     │  Network   │   │
                     │  Manager   │   │
                     │ (others)   │   │
                     └─────┬──────┘   │
                           │ receive  │ show indicator
                           ▼          ▼
                     ┌──────────┐ ┌────────┐
                     │  Sound   │ │   UI   │
                     │ Manager  │ │ Manager│
                     └──────────┘ └────────┘
```

---

## Component Interactions

### SceneManager

```
┌──────────────────┐
│  SceneManager    │
├──────────────────┤
│ Properties:      │
│ - scene          │
│ - camera         │
│ - renderer       │
│ - floor          │
│ - obstacles[]    │
│ - foodItems      │
├──────────────────┤
│ Methods:         │
│ + setupScene()   │
│ + setupLights()  │
│ + createFloor()  │
│ + render()       │
│ + add(object)    │
│ + remove(object) │
└──────────────────┘
```

### PlayerManager

```
┌──────────────────┐
│  PlayerManager   │
├──────────────────┤
│ Dependencies:    │
│ - SceneManager   │
│ - UIManager      │
│ - CharacterMgr   │
│ - AnimationCtrl  │
├──────────────────┤
│ Properties:      │
│ - players Map    │
│ - playerId       │
├──────────────────┤
│ Methods:         │
│ + createPlayer() │
│ + removePlayer() │
│ + updatePlayers()│
└──────────────────┘
```

### UIManager

```
┌──────────────────┐
│    UIManager     │
├──────────────────┤
│ Dependencies:    │
│ - SceneManager   │
├──────────────────┤
│ Properties:      │
│ - moveMarker     │
│ - pathLine       │
├──────────────────┤
│ Methods:         │
│ + createNameTag()│
│ + createMarker() │
│ + drawPath()     │
│ + showIndicator()│
└──────────────────┘
```

### InputManager

```
┌──────────────────┐
│  InputManager    │
├──────────────────┤
│ Dependencies:    │
│ - SceneManager   │
│ - UIManager      │
│ - NetworkManager │
├──────────────────┤
│ Properties:      │
│ - mouse          │
│ - raycaster      │
│ - editMode       │
│ - emoteWheel     │
├──────────────────┤
│ Methods:         │
│ + setupInput()   │
│ + handleClick()  │
│ + toggleEditMode()│
└──────────────────┘
```

### NetworkManager

```
┌──────────────────┐
│ NetworkManager   │
├──────────────────┤
│ Dependencies:    │
│ - PlayerManager  │
│ - SceneManager   │
│ - UIManager      │
│ - SoundManager   │
├──────────────────┤
│ Properties:      │
│ - socket         │
│ - playerId       │
│ - playerName     │
│ - playerSkin     │
├──────────────────┤
│ Methods:         │
│ + setupSocket()  │
│ + moveTo()       │
│ + playEmote()    │
└──────────────────┘
```

---

## Game Loop Flow

```
┌─────────────────────────────────────────────────────┐
│              ANIMATION LOOP (60 FPS)                 │
└───────────────────┬─────────────────────────────────┘
                    │
        ┌───────────▼────────────┐
        │   game.animate()       │
        └───────────┬────────────┘
                    │
        ┌───────────▼────────────┐
        │ Get delta time         │
        │ (SceneManager)         │
        └───────────┬────────────┘
                    │
        ┌───────────▼────────────┐
        │ Update all players     │
        │ (PlayerManager)        │
        │  ├─ Interpolate pos    │
        │  ├─ Interpolate rot    │
        │  ├─ Update animation   │
        │  └─ Play footsteps     │
        └───────────┬────────────┘
                    │
        ┌───────────▼────────────┐
        │ Render scene           │
        │ (SceneManager)         │
        └───────────┬────────────┘
                    │
                    │ Loop back
                    └─────────────────► requestAnimationFrame
```

---

## Module Load Order

```
1. game.js loads
   │
   ├─→ imports SoundManager
   ├─→ imports SceneManager
   │   └─→ SceneManager imports THREE.js
   │
   ├─→ imports PlayerManager
   │   ├─→ PlayerManager imports CharacterManager
   │   └─→ PlayerManager imports AnimationController
   │
   ├─→ imports UIManager
   │   └─→ UIManager imports THREE.js
   │
   ├─→ imports InputManager
   │   └─→ InputManager imports THREE.js
   │
   └─→ imports NetworkManager
       └─→ NetworkManager imports Socket.io

2. Game instance created
   │
   ├─→ SoundManager instantiated
   ├─→ Welcome screen shown
   │
   └─→ User enters name/selects skin
       │
       ├─→ SceneManager created
       ├─→ UIManager created
       ├─→ PlayerManager created
       │   ├─→ CharacterManager created
       │   └─→ AnimationController created
       │
       ├─→ NetworkManager created
       │   └─→ Socket.io connection established
       │
       └─→ InputManager created
           └─→ Event listeners attached

3. Game loop starts
   └─→ animate() runs at 60 FPS
```

---

## Event Flow Summary

### Input Events

```
User Action → InputManager → NetworkManager → Server → All Clients
```

### Network Events

```
Server → NetworkManager → (PlayerManager | SceneManager | UIManager)
```

### Animation Updates

```
Game Loop → PlayerManager → AnimationController → Sound/Visual Output
```

### UI Updates

```
Game State → UIManager → DOM/Three.js Scene
```

---

This architecture provides:

- ✅ **Clear separation of concerns**
- ✅ **Predictable data flow**
- ✅ **Easy to debug** (follow the arrows!)
- ✅ **Simple to extend** (add to appropriate manager)
- ✅ **Maintainable** (each file has one job)
