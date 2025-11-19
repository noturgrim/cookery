import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import {
  initializeDatabase,
  loadObstacles,
  saveObstacle,
  deleteObstacle,
  loadFoodItems,
  saveFoodItem,
  deleteFoodItem,
} from "./database.js";

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

// API endpoint to list available models
import { readdir } from "fs/promises";

app.get("/api/models/furniture", async (req, res) => {
  try {
    const furnitureDir = join(__dirname, "../public/furniture/glb");
    const files = await readdir(furnitureDir);
    const models = files
      .filter((file) => file.endsWith(".glb"))
      .map((file) => file.replace(".glb", ""));
    res.json(models);
  } catch (error) {
    console.error("Error reading furniture directory:", error);
    res.status(500).json({ error: "Failed to load furniture models" });
  }
});

app.get("/api/models/food", async (req, res) => {
  try {
    const foodDir = join(__dirname, "../public/food/glb");
    const files = await readdir(foodDir);
    const models = files
      .filter((file) => file.endsWith(".glb"))
      .map((file) => file.replace(".glb", ""));
    res.json(models);
  } catch (error) {
    console.error("Error reading food directory:", error);
    res.status(500).json({ error: "Failed to load food models" });
  }
});

// Game state - Authoritative server
const gameState = {
  players: new Map(),
  obstacles: [], // Will be loaded from database
  foodItems: [], // Will be loaded from database
};

// Server configuration
const SERVER_TICK_RATE = 20; // Reduced from 30 to 20 updates per second for bandwidth
const PLAYER_SPEED = 0.15; // Units per tick
const PLAYER_SIZE = { width: 0.6, height: 2, depth: 0.6 }; // Player AABB dimensions (smaller for better navigation)
const GRID_SIZE = 0.4; // Grid cell size for pathfinding (smaller = more precise paths)

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
  // Use player's actual dimensions (from character model)
  const halfWidth = (player.width || PLAYER_SIZE.width) / 2;
  const halfDepth = (player.depth || PLAYER_SIZE.depth) / 2;
  const height = player.height || PLAYER_SIZE.height;

  return {
    minX: player.x - halfWidth,
    maxX: player.x + halfWidth,
    minY: player.y,
    maxY: player.y + height,
    minZ: player.z - halfDepth,
    maxZ: player.z + halfDepth,
  };
};

const getObstacleAABB = (obstacle) => {
  // Use actual dimensions from database - NO PADDING
  // Exact collision matching the green visualization boxes
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
  // Check world bounds
  const WORLD_BOUNDS = 20;
  if (Math.abs(newX) > WORLD_BOUNDS || Math.abs(newZ) > WORLD_BOUNDS) {
    return false;
  }

  // Create player AABB at new position
  const playerAABB = {
    minX: newX - PLAYER_SIZE.width / 2,
    maxX: newX + PLAYER_SIZE.width / 2,
    minY: player.y,
    maxY: player.y + PLAYER_SIZE.height,
    minZ: newZ - PLAYER_SIZE.depth / 2,
    maxZ: newZ + PLAYER_SIZE.depth / 2,
  };

  // Check collision with all obstacles (furniture)
  for (const obstacle of gameState.obstacles) {
    const obstacleAABB = getObstacleAABB(obstacle);
    if (checkAABBCollision(playerAABB, obstacleAABB)) {
      return false; // Collision detected
    }
  }

  // Check collision with all food items
  for (const foodItem of gameState.foodItems) {
    // Create AABB for food item (smaller collision, food is more passable)
    const collisionReduction = 0.3; // 30% of original size for food (very small hitbox)
    const halfWidth = ((foodItem.width || 1) / 2) * collisionReduction;
    const halfHeight = ((foodItem.height || 1) / 2) * collisionReduction;
    const halfDepth = ((foodItem.depth || 1) / 2) * collisionReduction;

    const foodAABB = {
      minX: foodItem.x - halfWidth,
      maxX: foodItem.x + halfWidth,
      minY: foodItem.y - halfHeight,
      maxY: foodItem.y + halfHeight,
      minZ: foodItem.z - halfDepth,
      maxZ: foodItem.z + halfDepth,
    };

    if (checkAABBCollision(playerAABB, foodAABB)) {
      return false; // Collision detected
    }
  }

  return true; // No collision, movement valid
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

    // Create a test AABB for the pathfinding grid cell
    // Use exact player size for accurate pathfinding
    const testAABB = {
      minX: x - PLAYER_SIZE.width / 2,
      maxX: x + PLAYER_SIZE.width / 2,
      minY: 0,
      maxY: PLAYER_SIZE.height,
      minZ: z - PLAYER_SIZE.depth / 2,
      maxZ: z + PLAYER_SIZE.depth / 2,
    };

    // Check collision with all obstacles
    for (const obstacle of this.obstacles) {
      const obstacleAABB = getObstacleAABB(obstacle);
      if (checkAABBCollision(testAABB, obstacleAABB)) {
        return false; // Not walkable
      }
    }

    // Check collision with all food items
    for (const foodItem of gameState.foodItems) {
      // Food has smaller collision for pathfinding (30% to match movement collision)
      const collisionReduction = 0.3; // 30% of original size
      const halfWidth = ((foodItem.width || 1) / 2) * collisionReduction;
      const halfHeight = ((foodItem.height || 1) / 2) * collisionReduction;
      const halfDepth = ((foodItem.depth || 1) / 2) * collisionReduction;

      const foodAABB = {
        minX: foodItem.x - halfWidth,
        maxX: foodItem.x + halfWidth,
        minY: foodItem.y - halfHeight,
        maxY: foodItem.y + halfHeight,
        minZ: foodItem.z - halfDepth,
        maxZ: foodItem.z + halfDepth,
      };

      if (checkAABBCollision(testAABB, foodAABB)) {
        return false; // Not walkable
      }
    }

    return true; // Walkable
  }

  // Get neighbors of a node
  getNeighbors(node) {
    const neighbors = [];
    const directions = [
      { x: 1, z: 0 }, // Right
      { x: -1, z: 0 }, // Left
      { x: 0, z: 1 }, // Down
      { x: 0, z: -1 }, // Up
      { x: 1, z: 1 }, // Diagonal NE
      { x: -1, z: 1 }, // Diagonal SE
      { x: 1, z: -1 }, // Diagonal NW
      { x: -1, z: -1 }, // Diagonal SW
    ];

    for (const dir of directions) {
      const newX = node.x + dir.x * this.gridSize;
      const newZ = node.z + dir.z * this.gridSize;

      // For diagonal movement, check if both adjacent cells are walkable
      if (dir.x !== 0 && dir.z !== 0) {
        const checkX = node.x + dir.x * this.gridSize;
        const checkZ = node.z + dir.z * this.gridSize;
        const adjacentX = node.x + dir.x * this.gridSize;
        const adjacentZ = node.z;
        const adjacentZ2 = node.z + dir.z * this.gridSize;
        const adjacentX2 = node.x;

        // Only allow diagonal if both adjacent cells are walkable (prevent corner cutting)
        if (
          this.isWalkable(newX, newZ) &&
          this.isWalkable(adjacentX, adjacentZ) &&
          this.isWalkable(adjacentX2, adjacentZ2)
        ) {
          neighbors.push({ x: newX, z: newZ, cost: 1.414 });
        }
      } else {
        // Straight movement
        if (this.isWalkable(newX, newZ)) {
          neighbors.push({ x: newX, z: newZ, cost: 1.0 });
        }
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
    const MAX_ITERATIONS = 5000; // Increased iterations for smaller grid

    while (openSet.length > 0 && iterations < MAX_ITERATIONS) {
      iterations++;

      // Get node with lowest fScore
      openSet.sort((a, b) => fScore.get(key(a)) - fScore.get(key(b)));
      const current = openSet.shift();
      const currentKey = key(current);

      // Add to closed set
      closedSet.add(currentKey);

      // Check if we reached the goal (tighter tolerance for precision)
      if (
        Math.abs(current.x - goal.x) < this.gridSize * 2.0 &&
        Math.abs(current.z - goal.z) < this.gridSize * 2.0
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

    // No path found, return closest point we could reach
    console.log(`⚠️ No complete path found after ${iterations} iterations`);

    // Find the closest reachable position to the goal
    let closestNode = start;
    let closestDistance = this.heuristic(start, goal);

    closedSet.forEach((nodeKey) => {
      const [x, z] = nodeKey.split(",").map(Number);
      const node = { x, z };
      const dist = this.heuristic(node, goal);
      if (dist < closestDistance) {
        closestDistance = dist;
        closestNode = node;
      }
    });

    // Reconstruct path to closest reachable point
    if (closestNode !== start) {
      const path = [closestNode];
      let temp = closestNode;
      while (cameFrom.has(key(temp))) {
        path.unshift(temp);
        temp = cameFrom.get(key(temp));
      }
      return this.simplifyPath(path);
    }

    return [start]; // Just stay in place if no path at all
  }

  // Find nearest walkable position
  findNearestWalkable(pos) {
    const searchRadius = 5; // Increased search radius
    const step = this.gridSize;
    let bestPos = pos;
    let bestDistance = Infinity;

    // Try current position first
    if (this.isWalkable(pos.x, pos.z)) {
      return pos;
    }

    // Search in expanding circles for nearest walkable spot
    for (let radius = step; radius <= searchRadius; radius += step) {
      for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 8) {
        const testX = pos.x + Math.cos(angle) * radius;
        const testZ = pos.z + Math.sin(angle) * radius;

        if (this.isWalkable(testX, testZ)) {
          const distance = Math.sqrt(
            (testX - pos.x) ** 2 + (testZ - pos.z) ** 2
          );
          if (distance < bestDistance) {
            bestDistance = distance;
            bestPos = { x: testX, z: testZ };
          }
        }
      }
      // If we found a walkable position in this radius, use it
      if (bestDistance < Infinity) {
        break;
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

  // Find the best position around an obstacle to interact with it
  findInteractionPoint(goal) {
    // If goal is already walkable, use it
    if (this.isWalkable(goal.x, goal.z)) {
      return goal;
    }

    // Check if goal is inside an obstacle or food item
    let targetObject = null;
    let objectType = null;

    // Check obstacles
    for (const obstacle of this.obstacles) {
      const halfWidth = obstacle.width / 2;
      const halfDepth = obstacle.depth / 2;

      if (
        goal.x >= obstacle.x - halfWidth &&
        goal.x <= obstacle.x + halfWidth &&
        goal.z >= obstacle.z - halfDepth &&
        goal.z <= obstacle.z + halfDepth
      ) {
        targetObject = obstacle;
        objectType = "obstacle";
        break;
      }
    }

    // Check food items if no obstacle found
    if (!targetObject) {
      for (const foodItem of gameState.foodItems) {
        const halfWidth = (foodItem.width || 1) / 2;
        const halfDepth = (foodItem.depth || 1) / 2;

        if (
          goal.x >= foodItem.x - halfWidth &&
          goal.x <= foodItem.x + halfWidth &&
          goal.z >= foodItem.z - halfDepth &&
          goal.z <= foodItem.z + halfDepth
        ) {
          targetObject = foodItem;
          objectType = "food";
          break;
        }
      }
    }

    if (targetObject) {
      // Find closest accessible point around this object
      const interactionDistance = 0.5; // Distance from object for interaction
      const angles = 16; // Check 16 positions around the object
      let bestPoint = goal;
      let bestDistance = Infinity;

      for (let i = 0; i < angles; i++) {
        const angle = (i * Math.PI * 2) / angles;
        const objWidth = targetObject.width || 1;
        const objDepth = targetObject.depth || 1;

        const testX =
          targetObject.x +
          Math.cos(angle) * (objWidth / 2 + interactionDistance);
        const testZ =
          targetObject.z +
          Math.sin(angle) * (objDepth / 2 + interactionDistance);

        if (this.isWalkable(testX, testZ)) {
          // Calculate distance from original goal
          const dist = Math.sqrt((testX - goal.x) ** 2 + (testZ - goal.z) ** 2);
          if (dist < bestDistance) {
            bestDistance = dist;
            bestPoint = { x: testX, z: testZ };
          }
        }
      }

      return bestPoint;
    }

    // Fallback to nearest walkable
    return this.findNearestWalkable(goal);
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
  const repulsionRadius = 1.5; // Distance at which repulsion starts
  const repulsionStrength = 0.08; // How strong the push is

  const playerAABB = getPlayerAABB(player);

  // Check each obstacle
  for (const obstacle of gameState.obstacles) {
    const dx = player.x - obstacle.x;
    const dz = player.z - obstacle.z;
    const distance = Math.sqrt(dx * dx + dz * dz);

    // Only apply repulsion if close enough
    if (distance < repulsionRadius && distance > 0.1) {
      const obstacleAABB = getObstacleAABB(obstacle);

      // Check if we're very close or colliding
      if (checkAABBCollision(playerAABB, obstacleAABB)) {
        // Strong push away from obstacle center
        const force = repulsionStrength * (1 - distance / repulsionRadius);
        repulsionX += (dx / distance) * force;
        repulsionZ += (dz / distance) * force;
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

    // If reached waypoint, move to next (tighter tolerance for precision)
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
    // Default dimensions (will be updated by client after mesh loads)
    width: PLAYER_SIZE.width,
    height: PLAYER_SIZE.height,
    depth: PLAYER_SIZE.depth,
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
        foodItems: gameState.foodItems,
      });

      // Notify other players
      io.emit("playerJoined", player);

      console.log(`👨‍🍳 ${player.name} (${socket.id}) joined the kitchen!`);
    }
  });

  // Handle player dimensions update from client
  socket.on("updatePlayerDimensions", (data) => {
    const player = gameState.players.get(socket.id);
    if (player && data) {
      player.width = data.width || PLAYER_SIZE.width;
      player.height = data.height || PLAYER_SIZE.height;
      player.depth = data.depth || PLAYER_SIZE.depth;
      console.log(
        `📦 Updated player ${socket.id} dimensions: ${player.width.toFixed(
          2
        )}×${player.height.toFixed(2)}×${player.depth.toFixed(2)}`
      );
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
  socket.on("updateObstacle", async (data) => {
    const { id, x, y, z, rotation } = data;

    // Find and update the obstacle
    const obstacle = gameState.obstacles.find((obs) => obs.id === id);
    if (obstacle) {
      obstacle.x = x;
      obstacle.y = y;
      obstacle.z = z;
      if (rotation !== undefined) {
        obstacle.rotation = rotation;
      }

      // Save to database
      await saveObstacle(obstacle);

      // Broadcast update to all clients
      io.emit("obstacleUpdated", { id, x, y, z, rotation });

      // Recreate pathfinder with updated obstacles
      pathfinder.obstacles = gameState.obstacles;

      console.log(
        `📦 Obstacle ${id} moved to (${x.toFixed(2)}, ${z.toFixed(2)})`
      );
    }
  });

  // Handle spawning new obstacles
  socket.on("spawnObstacle", async (data) => {
    const newObstacle = {
      id: data.id,
      name: data.name,
      type: data.type || "furniture",
      x: data.x,
      y: data.y,
      z: data.z,
      width: data.width,
      height: data.height,
      depth: data.depth,
      model: data.model || null,
      scale: data.scale || 1.0,
      rotation: data.rotation || 0.0,
    };

    // Add to game state
    gameState.obstacles.push(newObstacle);

    // Save to database
    await saveObstacle(newObstacle);

    // Recreate pathfinder with new obstacles
    pathfinder.obstacles = gameState.obstacles;

    // Broadcast to all OTHER clients (spawner already has it)
    socket.broadcast.emit("obstacleSpawned", newObstacle);

    console.log(`✨ Spawned obstacle: ${newObstacle.id}`);
  });

  // Handle deleting obstacles
  socket.on("deleteObstacle", async (data) => {
    const { id } = data;

    // Remove from game state
    const index = gameState.obstacles.findIndex((obs) => obs.id === id);
    if (index > -1) {
      gameState.obstacles.splice(index, 1);

      // Delete from database
      await deleteObstacle(id);

      // Recreate pathfinder
      pathfinder.obstacles = gameState.obstacles;

      // Broadcast to all OTHER clients (deleter already removed it)
      socket.broadcast.emit("obstacleDeleted", { id });

      console.log(`🗑️ Deleted obstacle: ${id}`);
    }
  });

  // Handle spawning food items
  socket.on("spawnFood", async (data) => {
    const newFood = {
      id: data.id,
      name: data.name,
      x: data.x,
      y: data.y,
      z: data.z,
      scale: data.scale || 1.0,
      width: data.width || 1.0,
      height: data.height || 1.0,
      depth: data.depth || 1.0,
    };

    // Add to game state
    gameState.foodItems.push(newFood);

    // Save to database
    await saveFoodItem(newFood);

    // Broadcast to all OTHER clients (spawner already has it)
    socket.broadcast.emit("foodSpawned", newFood);

    console.log(
      `✨ Spawned food: ${newFood.id} (${newFood.width.toFixed(
        2
      )}x${newFood.height.toFixed(2)}x${newFood.depth.toFixed(2)})`
    );
  });

  // Handle updating food items
  socket.on("updateFood", async (data) => {
    const { id, x, y, z } = data;

    // Find and update the food item
    const foodItem = gameState.foodItems.find((food) => food.id === id);
    if (foodItem) {
      foodItem.x = x;
      foodItem.y = y;
      foodItem.z = z;

      // Save to database
      await saveFoodItem(foodItem);

      // Broadcast update to all clients
      io.emit("foodUpdated", { id, x, y, z });

      console.log(`🍔 Food ${id} moved to (${x.toFixed(2)}, ${z.toFixed(2)})`);
    }
  });

  // Handle deleting food items
  socket.on("deleteFood", async (data) => {
    const { id } = data;

    // Remove from game state
    const index = gameState.foodItems.findIndex((food) => food.id === id);
    if (index > -1) {
      gameState.foodItems.splice(index, 1);

      // Delete from database
      await deleteFoodItem(id);

      // Broadcast to all OTHER clients (deleter already removed it)
      socket.broadcast.emit("foodDeleted", { id });

      console.log(`🗑️ Deleted food: ${id}`);
    }
  });

  // Handle click-to-move with pathfinding
  socket.on("moveTo", (target) => {
    const player = gameState.players.get(socket.id);
    if (player && target.x !== undefined && target.z !== undefined) {
      // Calculate path using A*
      const start = { x: player.x, z: player.z };
      let goal = { x: target.x, z: target.z };

      // If clicking on an obstacle, find the best interaction point
      goal = pathfinder.findInteractionPoint(goal);

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
        )}, ${target.z.toFixed(2)}) → (${goal.x.toFixed(2)}, ${goal.z.toFixed(
          2
        )}) - ${path.length} waypoints`
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

// Initialize database and start server
async function startServer() {
  try {
    // Initialize database tables
    await initializeDatabase();

    // Load obstacles from database
    const loadedObstacles = await loadObstacles();
    gameState.obstacles = loadedObstacles;
    console.log(`📦 Loaded ${loadedObstacles.length} obstacles from database`);

    // Load food items from database
    const loadedFoodItems = await loadFoodItems();
    gameState.foodItems = loadedFoodItems;
    console.log(`🍔 Loaded ${loadedFoodItems.length} food items from database`);

    // Recreate pathfinder with loaded obstacles
    pathfinder.obstacles = gameState.obstacles;

    // Start HTTP server
    httpServer.listen(PORT, () => {
      console.log(`🎮 Game server running on http://localhost:${PORT}`);
      console.log(`📡 WebSocket server ready for connections`);
      console.log(`💾 Database persistence enabled`);
    });
  } catch (error) {
    console.error("❌ Failed to start server:", error);
    process.exit(1);
  }
}

startServer();
