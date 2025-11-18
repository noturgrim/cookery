import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

// Serve static files from public directory
app.use(express.static(join(__dirname, "../public")));

// Game state - Authoritative server
const gameState = {
  players: new Map(),
  obstacles: [
    // Static counters/obstacles with AABB bounds
    { id: "counter1", x: 5, y: 0.5, z: 0, width: 2, height: 1, depth: 4 },
    { id: "counter2", x: -5, y: 0.5, z: 5, width: 4, height: 1, depth: 2 },
    { id: "counter3", x: 0, y: 0.5, z: -8, width: 3, height: 1, depth: 2 },
  ],
};

// Server configuration
const SERVER_TICK_RATE = 30; // 30 updates per second
const PLAYER_SPEED = 0.15; // Units per tick
const PLAYER_SIZE = { width: 1, height: 2, depth: 1 }; // Player AABB dimensions

// AABB Collision Detection
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

const getPlayerAABB = (player) => {
  const halfWidth = PLAYER_SIZE.width / 2;
  const halfDepth = PLAYER_SIZE.depth / 2;

  return {
    minX: player.x - halfWidth,
    maxX: player.x + halfWidth,
    minY: player.y,
    maxY: player.y + PLAYER_SIZE.height,
    minZ: player.z - halfDepth,
    maxZ: player.z + halfDepth,
  };
};

const getObstacleAABB = (obstacle) => {
  const halfWidth = obstacle.width / 2;
  const halfHeight = obstacle.height / 2;
  const halfDepth = obstacle.depth / 2;

  return {
    minX: obstacle.x - halfWidth,
    maxX: obstacle.x + halfWidth,
    minY: obstacle.y - halfHeight,
    maxY: obstacle.y + halfHeight,
    minZ: obstacle.z - halfDepth,
    maxZ: obstacle.z + halfDepth,
  };
};

const validatePlayerMovement = (player, newX, newZ) => {
  // Create temporary player at new position
  const tempPlayer = { ...player, x: newX, z: newZ };
  const playerAABB = getPlayerAABB(tempPlayer);

  // Check collision with all obstacles
  for (const obstacle of gameState.obstacles) {
    const obstacleAABB = getObstacleAABB(obstacle);
    if (checkAABBCollision(playerAABB, obstacleAABB)) {
      return false; // Collision detected
    }
  }

  // Keep players within bounds
  const WORLD_BOUNDS = 20;
  if (Math.abs(newX) > WORLD_BOUNDS || Math.abs(newZ) > WORLD_BOUNDS) {
    return false;
  }

  return true; // Valid movement
};

// Process player input and update position
const processPlayerInput = (player) => {
  if (!player.input) return;

  let deltaX = 0;
  let deltaZ = 0;

  // Calculate movement vector from input
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

  // Validate and apply movement
  if (deltaX !== 0 || deltaZ !== 0) {
    const newX = player.x + deltaX;
    const newZ = player.z + deltaZ;

    if (validatePlayerMovement(player, newX, newZ)) {
      player.x = newX;
      player.z = newZ;

      // Calculate rotation based on movement direction
      player.rotation = Math.atan2(deltaX, deltaZ);
    }
  }
};

// Main game loop - Authoritative server tick
const gameLoop = () => {
  // Process all player inputs
  gameState.players.forEach((player) => {
    processPlayerInput(player);
  });

  // Broadcast game state to all clients
  const stateUpdate = {
    players: Array.from(gameState.players.values()).map((p) => ({
      id: p.id,
      x: p.x,
      y: p.y,
      z: p.z,
      rotation: p.rotation,
      color: p.color,
    })),
  };

  io.emit("gameState", stateUpdate);
};

// Start game loop
setInterval(gameLoop, 1000 / SERVER_TICK_RATE);

// Socket.io connection handling
io.on("connection", (socket) => {
  console.log(`Player connected: ${socket.id}`);

  // Initialize new player with random spawn position
  const newPlayer = {
    id: socket.id,
    x: Math.random() * 4 - 2,
    y: 0,
    z: Math.random() * 4 - 2,
    rotation: 0,
    color: `hsl(${Math.random() * 360}, 70%, 60%)`,
    input: { w: false, s: false, a: false, d: false },
  };

  gameState.players.set(socket.id, newPlayer);

  // Send initial game state to new player
  socket.emit("init", {
    playerId: socket.id,
    players: Array.from(gameState.players.values()),
    obstacles: gameState.obstacles,
  });

  // Notify other players
  socket.broadcast.emit("playerJoined", newPlayer);

  // Handle player input updates
  socket.on("input", (inputState) => {
    const player = gameState.players.get(socket.id);
    if (player) {
      player.input = inputState;
    }
  });

  // Handle disconnection
  socket.on("disconnect", () => {
    console.log(`Player disconnected: ${socket.id}`);
    gameState.players.delete(socket.id);
    io.emit("playerLeft", socket.id);
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`🎮 Game server running on http://localhost:${PORT}`);
  console.log(`📡 WebSocket server ready for connections`);
});
