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
    // Platform is 40x40 units (from -20 to +20 on both X and Z axes)
    // Single test kitchen table on the left side
    {
      id: "leftTable1",
      x: -15, // Left side of the platform (platform goes from -20 to +20)
      y: 0, // Ground level
      z: 0, // Center
      width: 4,
      height: 2,
      depth: 3,
      model: "table", // Using simple table model
      scale: 4,
      rotation: 0, // No rotation for now
    },
  ],
};

// Server configuration
const SERVER_TICK_RATE = 20; // Reduced from 30 to 20 updates per second for bandwidth
const PLAYER_SPEED = 0.15; // Units per tick
const PLAYER_SIZE = { width: 1, height: 2, depth: 1 }; // Player AABB dimensions
const GRID_SIZE = 0.8; // Grid cell size for pathfinding (larger = safer paths)

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
    const SAFETY_MARGIN = 1.5; // Extra space around obstacles (increased for safety)
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

    // Check if start or goal is blocked
    if (!this.isWalkable(start.x, start.z)) {
      // Find nearest walkable position for start
      start = this.findNearestWalkable(start);
    }
    if (!this.isWalkable(goal.x, goal.z)) {
      // Find nearest walkable position for goal
      goal = this.findNearestWalkable(goal);
    }

    const openSet = [start];
    const closedSet = new Set();
    const cameFrom = new Map();
    const gScore = new Map();
    const fScore = new Map();

    const key = (node) => `${node.x.toFixed(2)},${node.z.toFixed(2)}`;
    gScore.set(key(start), 0);
    fScore.set(key(start), this.heuristic(start, goal));

    let iterations = 0;
    const MAX_ITERATIONS = 2000; // Increased iterations

    while (openSet.length > 0 && iterations < MAX_ITERATIONS) {
      iterations++;

      // Get node with lowest fScore
      openSet.sort((a, b) => fScore.get(key(a)) - fScore.get(key(b)));
      const current = openSet.shift();
      const currentKey = key(current);

      // Add to closed set
      closedSet.add(currentKey);

      // Check if we reached the goal
      if (
        Math.abs(current.x - goal.x) < this.gridSize * 1.5 &&
        Math.abs(current.z - goal.z) < this.gridSize * 1.5
      ) {
        // Reconstruct path
        const path = [goal];
        let temp = current;
        while (cameFrom.has(key(temp))) {
          path.unshift(temp);
          temp = cameFrom.get(key(temp));
        }

        // Simplify path (remove unnecessary waypoints)
        return this.simplifyPath(path);
      }

      // Check neighbors
      const neighbors = this.getNeighbors(current);
      for (const neighborData of neighbors) {
        const neighbor = { x: neighborData.x, z: neighborData.z };
        const neighborKey = key(neighbor);

        // Skip if in closed set
        if (closedSet.has(neighborKey)) {
          continue;
        }

        const tentativeGScore =
          gScore.get(currentKey) + neighborData.cost * this.gridSize;

        if (
          !gScore.has(neighborKey) ||
          tentativeGScore < gScore.get(neighborKey)
        ) {
          cameFrom.set(neighborKey, current);
          gScore.set(neighborKey, tentativeGScore);
          fScore.set(
            neighborKey,
            tentativeGScore + this.heuristic(neighbor, goal)
          );

          if (!openSet.some((n) => key(n) === neighborKey)) {
            openSet.push(neighbor);
          }
        }
      }
    }

    // No path found, try to find closest reachable point
    console.log(`⚠️ No path found after ${iterations} iterations`);
    return [start, goal];
  }

  // Find nearest walkable position
  findNearestWalkable(pos) {
    const searchRadius = 3; // Search within 3 units
    const step = this.gridSize;
    let bestPos = pos;
    let bestDistance = Infinity;

    for (let dx = -searchRadius; dx <= searchRadius; dx += step) {
      for (let dz = -searchRadius; dz <= searchRadius; dz += step) {
        const testX = pos.x + dx;
        const testZ = pos.z + dz;

        if (this.isWalkable(testX, testZ)) {
          const distance = Math.sqrt(dx * dx + dz * dz);
          if (distance < bestDistance) {
            bestDistance = distance;
            bestPos = { x: testX, z: testZ };
          }
        }
      }
    }

    return bestPos;
  }

  // Simplify path by removing unnecessary waypoints
  simplifyPath(path) {
    if (path.length <= 2) return path;

    const simplified = [path[0]];

    for (let i = 1; i < path.length - 1; i++) {
      const prev = path[i - 1];
      const current = path[i];
      const next = path[i + 1];

      // Check if we can skip this waypoint (line of sight check)
      if (!this.hasLineOfSight(prev, next)) {
        simplified.push(current);
      }
    }

    simplified.push(path[path.length - 1]);
    return simplified;
  }

  // Check if there's a clear line between two points
  hasLineOfSight(a, b) {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const distance = Math.sqrt(dx * dx + dz * dz);
    const steps = Math.ceil(distance / (this.gridSize * 0.5));

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = a.x + dx * t;
      const z = a.z + dz * t;

      if (!this.isWalkable(x, z)) {
        return false;
      }
    }

    return true;
  }
}

const pathfinder = new AStarPathfinder(gameState.obstacles);

// Calculate repulsion force from obstacles
const getObstacleRepulsion = (player) => {
  let repulsionX = 0;
  let repulsionZ = 0;
  const REPULSION_RANGE = 2.0; // Distance at which repulsion starts
  const REPULSION_STRENGTH = 0.08; // Force multiplier

  for (const obstacle of gameState.obstacles) {
    const dx = player.x - obstacle.x;
    const dz = player.z - obstacle.z;
    const distance = Math.sqrt(dx * dx + dz * dz);

    // Calculate edge distance (closest point on obstacle)
    const halfWidth = obstacle.width / 2;
    const halfDepth = obstacle.depth / 2;

    // Distance from obstacle surface
    const surfaceDistance = Math.max(
      Math.abs(dx) - halfWidth,
      Math.abs(dz) - halfDepth,
      0
    );

    if (surfaceDistance < REPULSION_RANGE) {
      // Apply repulsion force (stronger when closer)
      const forceMagnitude =
        REPULSION_STRENGTH * (1 - surfaceDistance / REPULSION_RANGE);

      if (distance > 0) {
        repulsionX += (dx / distance) * forceMagnitude;
        repulsionZ += (dz / distance) * forceMagnitude;
      }
    }
  }

  return { x: repulsionX, z: repulsionZ };
};

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

    // If reached waypoint, move to next (increased tolerance)
    if (distance < 0.8) {
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
          if (player.stuckCounter > 20) {
            console.log(`Player ${player.id} stuck, recalculating path`);
            player.path = null;
            player.stuckCounter = 0;

            // Try to recalculate path from current position
            if (player.moveTarget) {
              // Move slightly away from obstacle before recalculating
              const randomOffset = {
                x: (Math.random() - 0.5) * 0.5,
                z: (Math.random() - 0.5) * 0.5,
              };

              const start = {
                x: player.x + randomOffset.x,
                z: player.z + randomOffset.z,
              };
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
  }
  // WASD controls removed - click-to-move only

  // Apply obstacle repulsion force to prevent sticking
  if (deltaX !== 0 || deltaZ !== 0) {
    const repulsion = getObstacleRepulsion(player);
    deltaX += repulsion.x;
    deltaZ += repulsion.z;
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
      name: p.name,
      skinIndex: p.skinIndex,
    })),
  };

  io.emit("gameState", stateUpdate);
};

// Start game loop
setInterval(gameLoop, 1000 / SERVER_TICK_RATE);

// Socket.io connection handling
io.on("connection", (socket) => {
  console.log(`Player connected: ${socket.id}`);

  // Initialize new player with random spawn position (without customization yet)
  const newPlayer = {
    id: socket.id,
    x: Math.random() * 4 - 2,
    y: 0,
    z: Math.random() * 4 - 2,
    rotation: 0,
    color: `hsl(${Math.random() * 360}, 70%, 60%)`,
    name: "Player",
    skinIndex: 0,
    input: { w: false, s: false, a: false, d: false },
    moveTarget: null, // Click-to-move target
    path: null, // A* pathfinding waypoints
    stuckCounter: 0, // Counter to detect if player is stuck
    lastPosition: null, // Track position to detect stuck state
  };

  gameState.players.set(socket.id, newPlayer);

  // Handle player customization
  socket.on("playerCustomization", (data) => {
    const player = gameState.players.get(socket.id);
    if (player) {
      player.name = data.name || "Player";
      player.skinIndex = data.skinIndex || 0;

      // Now send initial game state
      socket.emit("init", {
        playerId: socket.id,
        players: Array.from(gameState.players.values()),
        obstacles: gameState.obstacles,
      });

      // Notify other players
      io.emit("playerJoined", player);

      console.log(`👨‍🍳 ${player.name} (${socket.id}) joined the kitchen!`);
    }
  });

  // Handle player input updates
  socket.on("input", (inputState) => {
    const player = gameState.players.get(socket.id);
    if (player) {
      player.input = inputState;
    }
  });

  // Handle obstacle updates from clients
  socket.on("updateObstacle", (data) => {
    const { id, x, y, z } = data;

    // Find and update the obstacle
    const obstacle = gameState.obstacles.find((obs) => obs.id === id);
    if (obstacle) {
      obstacle.x = x;
      obstacle.y = y;
      obstacle.z = z;

      // Broadcast update to all clients
      io.emit("obstacleUpdated", { id, x, y, z });

      // Recreate pathfinder with updated obstacles
      pathfinder.obstacles = gameState.obstacles;

      console.log(
        `📦 Obstacle ${id} moved to (${x.toFixed(2)}, ${z.toFixed(2)})`
      );
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
        `🗺️ Player ${socket.id} pathfinding to (${target.x.toFixed(
          2
        )}, ${target.z.toFixed(2)}) - ${path.length} waypoints`
      );
    }
  });

  // Handle emote/voice from players
  socket.on("playEmote", (data) => {
    const { playerId, emote } = data;

    // Broadcast to all players (including sender for consistency)
    io.emit("playerEmote", {
      playerId: playerId,
      emote: emote,
    });

    console.log(`🎵 Player ${playerId} played emote: ${emote}`);
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
