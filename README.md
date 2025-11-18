# Supercooked - Multiplayer Cooking Game MVP

A browser-based multiplayer cooking game inspired by Overcooked, built with Three.js and Node.js.

## 🎮 Features

- **Low-poly 3D Graphics**: Clean, performant visuals running entirely in the browser
- **Isometric Camera**: Fixed orthographic camera view for that classic Overcooked feel
- **Multiplayer**: Real-time synchronization with Socket.io
- **Server-Authoritative**: Prevents cheating with server-side physics and collision
- **AABB Collision Detection**: Players cannot walk through counters/obstacles

## 🛠️ Tech Stack

- **Frontend**: Vanilla Three.js (WebGL)
- **Backend**: Node.js + Express + Socket.io
- **3D Models**: Ready for GLTF/GLB assets
- **Architecture**: Authoritative server pattern

## 📋 Prerequisites

- Node.js 16+ installed
- Modern web browser (Chrome, Firefox, Edge, Safari)

## 🚀 Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Run the Server

```bash
npm run dev
```

### 3. Open in Browser

Navigate to `http://localhost:3000`

Open multiple browser windows/tabs to test multiplayer!

## 🎯 Technical Implementation

### Scene Setup - Orthographic Camera

The game uses an **Orthographic Camera** positioned at `(15, 15, 15)` looking at the origin. This creates the isometric/"bird's-eye" view similar to Overcooked.

```javascript
const frustumSize = 20;
const camera = new THREE.OrthographicCamera(
  (frustumSize * aspect) / -2, // left
  (frustumSize * aspect) / 2, // right
  frustumSize / 2, // top
  frustumSize / -2, // bottom
  0.1, // near
  1000 // far
);
camera.position.set(15, 15, 15);
camera.lookAt(0, 0, 0);
```

**Why Orthographic?**

- No perspective distortion (parallel lines stay parallel)
- Objects same size regardless of distance
- Perfect for top-down gameplay clarity
- Classic isometric game aesthetic

### Input to Movement - WASD to 3D Vectors

Movement is handled by translating WASD keys into 3D position changes:

1. **Client captures input** (keydown/keyup events)
2. **Client sends input state** to server via Socket.io
3. **Server processes movement**:
   - W/S keys modify **Z axis** (forward/backward)
   - A/D keys modify **X axis** (left/right)
   - **Y axis remains constant** (height/elevation)
4. **Server validates movement** (collision checks)
5. **Server broadcasts positions** to all clients
6. **Clients interpolate** for smooth visuals

```javascript
// Server-side movement calculation
if (player.input.w) deltaZ -= PLAYER_SPEED;
if (player.input.s) deltaZ += PLAYER_SPEED;
if (player.input.a) deltaX -= PLAYER_SPEED;
if (player.input.d) deltaX += PLAYER_SPEED;

// Normalize diagonal movement
if (deltaX !== 0 && deltaZ !== 0) {
  const magnitude = Math.sqrt(deltaX * deltaX + deltaZ * deltaZ);
  deltaX = (deltaX / magnitude) * PLAYER_SPEED;
  deltaZ = (deltaZ / magnitude) * PLAYER_SPEED;
}
```

### Synchronization Strategy

**Server Update Rate**: 30Hz (30 updates per second)

- Balances responsiveness with bandwidth
- Standard for multiplayer games

**Data Sent Per Update**:

```javascript
{
  players: [{ id, x, y, z, rotation, color }];
}
```

**Client-Side Interpolation**:

- Uses `lerp()` (linear interpolation) for smooth movement
- Interpolation factor: 0.3 (30% movement per frame)
- Prevents jittery movement from discrete server updates

```javascript
// Smooth position interpolation
player.mesh.position.lerp(player.targetPosition, 0.3);
```

**Optimization Notes**:

- Only position/rotation sent (no velocity/acceleration)
- Uses quaternions for rotation (more efficient than Euler angles)
- Delta compression possible for future optimization
- No need for client-side prediction in Phase 1 (low latency assumption)

### Collision Detection - AABB (Axis-Aligned Bounding Boxes)

**Server-side collision** prevents players from walking through obstacles.

**AABB Definition**:

```javascript
{
  minX,
    maxX, // X-axis bounds
    minY,
    maxY, // Y-axis bounds (height)
    minZ,
    maxZ; // Z-axis bounds
}
```

**Collision Check Algorithm**:

```javascript
const checkAABBCollision = (box1, box2) => {
  return (
    box1.minX < box2.maxX &&
    box1.maxX > box2.minX &&
    box1.minY < box2.maxY &&
    box1.maxY > box2.minY &&
    box1.minZ < box2.maxZ &&
    box1.maxZ > box2.minZ
  );
};
```

**Validation Flow**:

1. Calculate new player position from input
2. Create temporary AABB at new position
3. Check collision with all obstacles
4. If collision: reject movement (player stays in place)
5. If no collision: update player position
6. Broadcast new position to clients

**Why AABB?**

- ✅ Fast computation (simple comparisons)
- ✅ Works perfectly for box-shaped objects
- ✅ Easy to implement and debug
- ✅ No complex math (unlike sphere or polygon collision)
- ❌ Less accurate for irregular shapes (acceptable for MVP)

## 🎨 Current Game Objects

### Players

- **Shape**: Capsule (cylinder body + sphere head)
- **Size**: 1×2×1 units (width×height×depth)
- **Color**: Random HSL color per player
- **Direction**: Cone "nose" indicator

### Obstacles/Counters

- **Shape**: Rectangular boxes (counters/tables)
- **Collision**: AABB bounds
- **Static**: Don't move during gameplay

### Environment

- **Floor**: 40×40 unit plane with grid
- **Bounds**: ±20 units in X/Z axes
- **Lighting**: Ambient + directional (with shadows)

## 📁 Project Structure

```
supercooked/
├── server/
│   └── index.js          # Node.js + Socket.io server
├── public/
│   ├── index.html        # Game HTML entry point
│   └── js/
│       └── game.js       # Three.js client code
├── package.json          # Dependencies
└── README.md            # This file
```

## 🔧 Configuration

### Server Settings (server/index.js)

```javascript
const SERVER_TICK_RATE = 30; // Updates per second
const PLAYER_SPEED = 0.15; // Units per tick
const PLAYER_SIZE = {
  // Player AABB dimensions
  width: 1,
  height: 2,
  depth: 1,
};
```

### Camera Settings (public/js/game.js)

```javascript
const frustumSize = 20; // Controls zoom level
camera.position.set(15, 15, 15); // Isometric angle
```

## 🚧 Next Steps (Phase 2+)

### Immediate Enhancements

- [ ] Load GLTF/GLB models for players and environment
- [ ] Add pickup/drop interaction system
- [ ] Implement cooking stations (stoves, cutting boards)
- [ ] Add ingredient system
- [ ] Create recipe completion logic

### Performance Optimizations

- [ ] Delta compression for network traffic
- [ ] Client-side prediction for lower latency feel
- [ ] Object pooling for frequent spawns
- [ ] LOD (Level of Detail) for distant objects

### Gameplay Features

- [ ] Multiple kitchen layouts/levels
- [ ] Score system and timer
- [ ] Order management UI
- [ ] Player customization
- [ ] Voice/text chat
- [ ] Spectator mode

### Technical Improvements

- [ ] Replace CDN imports with local Three.js bundle
- [ ] Add TypeScript for type safety
- [ ] Implement proper game state management
- [ ] Add reconnection logic
- [ ] Database for persistent player data
- [ ] Matchmaking system

## 🐛 Troubleshooting

### Players Not Moving

- Check browser console for errors
- Verify Socket.io connection (check "Connected" indicator)
- Ensure WASD keys are pressed (not capslock)

### High Latency

- Server tick rate may be too high for connection
- Reduce `SERVER_TICK_RATE` to 20Hz for slower connections

### Collision Issues

- Verify obstacle positions in `server/index.js`
- Check `PLAYER_SIZE` matches visual representation
- Console log collision checks for debugging

## 📚 Learning Resources

### Three.js

- [Three.js Documentation](https://threejs.org/docs/)
- [Three.js Examples](https://threejs.org/examples/)
- [Orthographic Camera Guide](https://threejs.org/docs/#api/en/cameras/OrthographicCamera)

### Multiplayer Game Development

- [Gabriel Gambetta: Fast-Paced Multiplayer](https://www.gabrielgambetta.com/client-server-game-architecture.html)
- [Valve: Source Multiplayer Networking](https://developer.valvesoftware.com/wiki/Source_Multiplayer_Networking)

### Socket.io

- [Socket.io Documentation](https://socket.io/docs/v4/)
- [Rooms and Namespaces](https://socket.io/docs/v4/rooms/)

## 📝 License

MIT License - Feel free to use this as a starting point for your own projects!

## 🤝 Contributing

This is an MVP/learning project. Feel free to fork and experiment!

---

**Happy Cooking! 🍳👨‍🍳**
