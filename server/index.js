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
const GRID_SIZE = 0.7; // Grid cell size for pathfinding (larger = safer paths)

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

// A* Pathfinding Algorithm
class AStarPathfinder {
  constructor(obstacles, gridSize = GRID_SIZE) {
    this.obstacles = obstacles;
    this.gridSize = gridSize;
  }

  // Heuristic: Manhattan distance
  heuristic(a, b) {
    return Math.abs(a.x - b.x) + Math.abs(a.z - b.z);
  }

  // Check if a grid position is walkable
  isWalkable(x, z) {
    // Check world bounds
    const WORLD_BOUNDS = 20;
    if (Math.abs(x) > WORLD_BOUNDS || Math.abs(z) > WORLD_BOUNDS) {
      return false;
    }

    // Check collision with obstacles (with bigger buffer zone)
    const SAFETY_MARGIN = 0.8; // Extra space around obstacles
    for (const obstacle of this.obstacles) {
      const halfWidth = obstacle.width / 2;
      const halfDepth = obstacle.depth / 2;

      if (
        x > obstacle.x - halfWidth - PLAYER_SIZE.width / 2 - SAFETY_MARGIN &&
        x < obstacle.x + halfWidth + PLAYER_SIZE.width / 2 + SAFETY_MARGIN &&
        z > obstacle.z - halfDepth - PLAYER_SIZE.depth / 2 - SAFETY_MARGIN &&
        z < obstacle.z + halfDepth + PLAYER_SIZE.depth / 2 + SAFETY_MARGIN
      ) {
        return false;
      }
    }

    return true;
  }

  // Get neighbors of a node
  getNeighbors(node) {
    const neighbors = [];
    const directions = [
      { x: 1, z: 0 }, // Right
      { x: -1, z: 0 }, // Left
      { x: 0, z: 1 }, // Down
      { x: 0, z: -1 }, // Up
      { x: 1, z: 1 }, // Diagonal
      { x: -1, z: 1 },
      { x: 1, z: -1 },
      { x: -1, z: -1 },
    ];

    for (const dir of directions) {
      const newX = node.x + dir.x * this.gridSize;
      const newZ = node.z + dir.z * this.gridSize;

      if (this.isWalkable(newX, newZ)) {
        const cost = dir.x !== 0 && dir.z !== 0 ? 1.414 : 1; // Diagonal cost
        neighbors.push({ x: newX, z: newZ, cost });
      }
    }

    return neighbors;
  }

  // Find path from start to goal
  findPath(start, goal) {
    // Snap to grid
    start = {
      x: Math.round(start.x / this.gridSize) * this.gridSize,
      z: Math.round(start.z / this.gridSize) * this.gridSize,
    };
    goal = {
      x: Math.round(goal.x / this.gridSize) * this.gridSize,
      z: Math.round(goal.z / this.gridSize) * this.gridSize,
    };

    const openSet = [start];
    const cameFrom = new Map();
    const gScore = new Map();
    const fScore = new Map();

    const key = (node) => `${node.x},${node.z}`;
    gScore.set(key(start), 0);
    fScore.set(key(start), this.heuristic(start, goal));

    let iterations = 0;
    const MAX_ITERATIONS = 1000;

    while (openSet.length > 0 && iterations < MAX_ITERATIONS) {
      iterations++;

      // Get node with lowest fScore
      openSet.sort((a, b) => fScore.get(key(a)) - fScore.get(key(b)));
      const current = openSet.shift();

      // Check if we reached the goal
      if (
        Math.abs(current.x - goal.x) < this.gridSize &&
        Math.abs(current.z - goal.z) < this.gridSize
      ) {
        // Reconstruct path
        const path = [goal];
        let temp = current;
        while (cameFrom.has(key(temp))) {
          path.unshift(temp);
          temp = cameFrom.get(key(temp));
        }
        return path;
      }

      // Check neighbors
      const neighbors = this.getNeighbors(current);
      for (const neighborData of neighbors) {
        const neighbor = { x: neighborData.x, z: neighborData.z };
        const tentativeGScore =
          gScore.get(key(current)) + neighborData.cost * this.gridSize;

        if (
          !gScore.has(key(neighbor)) ||
          tentativeGScore < gScore.get(key(neighbor))
        ) {
          cameFrom.set(key(neighbor), current);
          gScore.set(key(neighbor), tentativeGScore);
          fScore.set(
            key(neighbor),
            tentativeGScore + this.heuristic(neighbor, goal)
          );

          if (!openSet.some((n) => key(n) === key(neighbor))) {
            openSet.push(neighbor);
          }
        }
      }
    }

    // No path found, return direct path
    return [start, goal];
  }
}

const pathfinder = new AStarPathfinder(gameState.obstacles);

// Process player input and update position
const processPlayerInput = (player) => {
  let deltaX = 0;
  let deltaZ = 0;

  // Check if player has a path to follow
  if (player.path && player.path.length > 0) {
    const nextWaypoint = player.path[0];
    const dx = nextWaypoint.x - player.x;
    const dz = nextWaypoint.z - player.z;
    const distance = Math.sqrt(dx * dx + dz * dz);

    // If reached waypoint, move to next
    if (distance < 0.5) {
      player.path.shift();
      if (player.path.length === 0) {
        player.moveTarget = null;
        player.stuckCounter = 0;
      }
    } else {
      // Move towards waypoint
      deltaX = (dx / distance) * PLAYER_SPEED;
      deltaZ = (dz / distance) * PLAYER_SPEED;

      // Check if stuck (not moving much)
      if (!player.lastPosition) {
        player.lastPosition = { x: player.x, z: player.z };
        player.stuckCounter = 0;
      } else {
        const movedDistance = Math.sqrt(
          Math.pow(player.x - player.lastPosition.x, 2) +
            Math.pow(player.z - player.lastPosition.z, 2)
        );

        if (movedDistance < 0.01) {
          player.stuckCounter = (player.stuckCounter || 0) + 1;

          // If stuck for too long, recalculate path
          if (player.stuckCounter > 30) {
            console.log(`Player ${player.id} stuck, recalculating path`);
            player.path = null;
            player.stuckCounter = 0;

            // Try to recalculate path
            if (player.moveTarget) {
              const start = { x: player.x, z: player.z };
              const path = pathfinder.findPath(start, player.moveTarget);
              if (path.length > 1) {
                player.path = path;
              } else {
                player.moveTarget = null;
              }
            }
          }
        } else {
          player.stuckCounter = 0;
          player.lastPosition = { x: player.x, z: player.z };
        }
      }
    }
  } else if (player.moveTarget) {
    // Direct movement (fallback if no path)
    const dx = player.moveTarget.x - player.x;
    const dz = player.moveTarget.z - player.z;
    const distance = Math.sqrt(dx * dx + dz * dz);

    if (distance < 0.2) {
      player.moveTarget = null;
    } else {
      deltaX = (dx / distance) * PLAYER_SPEED;
      deltaZ = (dz / distance) * PLAYER_SPEED;
    }
  } else if (player.input) {
    // Fallback to WASD input
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
    } else {
      // If collision detected during movement
      if (player.path && player.path.length > 0) {
        // Skip current waypoint if we can't reach it
        player.path.shift();
        if (player.path.length === 0) {
          player.moveTarget = null;
        }
      } else if (player.moveTarget) {
        // Try to recalculate path
        const start = { x: player.x, z: player.z };
        const path = pathfinder.findPath(start, player.moveTarget);
        if (path.length > 1) {
          player.path = path;
        } else {
          player.moveTarget = null;
        }
      }
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
    moveTarget: null, // Click-to-move target
    path: null, // A* pathfinding waypoints
    stuckCounter: 0, // Counter to detect if player is stuck
    lastPosition: null, // Track position to detect stuck state
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

  // Handle click-to-move with pathfinding
  socket.on("moveTo", (target) => {
    const player = gameState.players.get(socket.id);
    if (player && target.x !== undefined && target.z !== undefined) {
      // Calculate path using A*
      const start = { x: player.x, z: player.z };
      const goal = { x: target.x, z: target.z };
      const path = pathfinder.findPath(start, goal);

      player.path = path;
      player.moveTarget = goal;

      // Send path to client for visualization
      io.to(socket.id).emit("pathUpdate", {
        playerId: socket.id,
        path: path,
      });

      console.log(
        `Player ${socket.id} pathfinding to (${target.x.toFixed(
          2
        )}, ${target.z.toFixed(2)}) - ${path.length} waypoints`
      );
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
