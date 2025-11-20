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
  // Use actual dimensions and CENTER from client
  // The center is where the actual bounding box is, not necessarily the pivot point
  const halfWidth = obstacle.width / 2;
  const halfHeight = obstacle.height / 2;
  const halfDepth = obstacle.depth / 2;

  // Use bounding box center if available (synced from client), otherwise use position
  const centerX =
    obstacle.centerX !== undefined ? obstacle.centerX : obstacle.x;
  const centerY =
    obstacle.centerY !== undefined ? obstacle.centerY : obstacle.y;
  const centerZ =
    obstacle.centerZ !== undefined ? obstacle.centerZ : obstacle.z;

  return {
    minX: centerX - halfWidth,
    maxX: centerX + halfWidth,
    minY: centerY - halfHeight,
    maxY: centerY + halfHeight,
    minZ: centerZ - halfDepth,
    maxZ: centerZ + halfDepth,
  };
};

const validatePlayerMovement = (player, newX, newZ, debug = false) => {
  // Check world bounds
  const WORLD_BOUNDS = 20;
  if (Math.abs(newX) > WORLD_BOUNDS || Math.abs(newZ) > WORLD_BOUNDS) {
    if (debug) console.log(`   ❌ World bounds exceeded`);
    return false;
  }

  // Create player AABB at new position using actual player dimensions
  const halfWidth = (player.width || PLAYER_SIZE.width) / 2;
  const halfDepth = (player.depth || PLAYER_SIZE.depth) / 2;
  const height = player.height || PLAYER_SIZE.height;

  const playerAABB = {
    minX: newX - halfWidth,
    maxX: newX + halfWidth,
    minY: player.y,
    maxY: player.y + height,
    minZ: newZ - halfDepth,
    maxZ: newZ + halfDepth,
  };

  if (debug) {
    console.log(
      `   Player AABB: X[${playerAABB.minX.toFixed(
        2
      )}, ${playerAABB.maxX.toFixed(2)}] Z[${playerAABB.minZ.toFixed(
        2
      )}, ${playerAABB.maxZ.toFixed(2)}]`
    );
    console.log(
      `   Player dimensions: width=${player.width?.toFixed(
        2
      )}, depth=${player.depth?.toFixed(2)}, height=${player.height?.toFixed(
        2
      )}`
    );
  }

  // Check collision with all obstacles (furniture)
  for (const obstacle of gameState.obstacles) {
    // Skip passthrough objects (doorways, archways, etc.)
    if (obstacle.isPassthrough) {
      if (debug) {
        console.log(
          `   ⏭️  Skipping passthrough object: ${obstacle.id || obstacle.model}`
        );
      }
      continue;
    }

    const obstacleAABB = getObstacleAABB(obstacle);
    if (checkAABBCollision(playerAABB, obstacleAABB)) {
      if (debug) {
        console.log(
          `   ❌ Collision with obstacle: ${obstacle.id || obstacle.model}`
        );
        console.log(
          `      Obstacle AABB: X[${obstacleAABB.minX.toFixed(
            2
          )}, ${obstacleAABB.maxX.toFixed(2)}] Z[${obstacleAABB.minZ.toFixed(
            2
          )}, ${obstacleAABB.maxZ.toFixed(2)}]`
        );
        console.log(
          `      Obstacle position: (${obstacle.x.toFixed(
            2
          )}, ${obstacle.z.toFixed(2)})`
        );
      }
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
      if (debug) {
        console.log(`   ❌ Collision with food: ${foodItem.name}`);
        console.log(
          `      Food AABB: X[${foodAABB.minX.toFixed(
            2
          )}, ${foodAABB.maxX.toFixed(2)}] Z[${foodAABB.minZ.toFixed(
            2
          )}, ${foodAABB.maxZ.toFixed(2)}]`
        );
      }
      return false; // Collision detected
    }
  }

  if (debug) console.log(`   ✅ No collision, movement valid`);
  return true; // No collision, movement valid
};

// A* Pathfinding Algorithm
class AStarPathfinder {
  constructor(obstacles, gridSize = GRID_SIZE) {
    this.obstacles = obstacles;
    this.gridSize = gridSize;
    // Store player size for pathfinding (use default, will be updated per-player if needed)
    this.playerSize = { ...PLAYER_SIZE };
  }

  // Update player size for pathfinding calculations
  setPlayerSize(width, height, depth) {
    this.playerSize.width = width || PLAYER_SIZE.width;
    this.playerSize.height = height || PLAYER_SIZE.height;
    this.playerSize.depth = depth || PLAYER_SIZE.depth;
  }

  // Heuristic: Euclidean distance (pure, no penalty here since we add it to gScore)
  heuristic(a, b) {
    // Base Euclidean distance (more natural than Manhattan)
    const dx = a.x - b.x;
    const dz = a.z - b.z;
    return Math.sqrt(dx * dx + dz * dz);
  }

  // Calculate penalty for being near obstacles
  getObstacleProximityPenalty(pos) {
    let penalty = 0;
    const penaltyRadius = this.gridSize * 3; // Check 3 grid cells around (increased range)

    // Check obstacles
    for (const obstacle of this.obstacles) {
      // Skip passthrough objects (doorways, archways, etc.)
      if (obstacle.isPassthrough) continue;

      const dx = pos.x - obstacle.x;
      const dz = pos.z - obstacle.z;
      const distance = Math.sqrt(dx * dx + dz * dz);

      if (distance < penaltyRadius) {
        // Closer to obstacle = much higher penalty
        // Use quadratic falloff for stronger avoidance close to obstacles
        const normalizedDist = 1 - distance / penaltyRadius;
        penalty += normalizedDist * normalizedDist * 2.0; // Quadratic penalty, 2.0 strength
      }
    }

    // Check food items (lighter penalty)
    for (const foodItem of gameState.foodItems) {
      const dx = pos.x - foodItem.x;
      const dz = pos.z - foodItem.z;
      const distance = Math.sqrt(dx * dx + dz * dz);

      if (distance < penaltyRadius) {
        const normalizedDist = 1 - distance / penaltyRadius;
        penalty += normalizedDist * normalizedDist * 0.5; // Lighter for food
      }
    }

    return penalty;
  }

  // Check if a grid position is walkable
  isWalkable(x, z) {
    // Check world bounds
    const WORLD_BOUNDS = 20;
    if (Math.abs(x) > WORLD_BOUNDS || Math.abs(z) > WORLD_BOUNDS) {
      return false;
    }

    // Create a test AABB for the pathfinding grid cell
    // Use actual player size for accurate pathfinding
    const testAABB = {
      minX: x - this.playerSize.width / 2,
      maxX: x + this.playerSize.width / 2,
      minY: 0,
      maxY: this.playerSize.height,
      minZ: z - this.playerSize.depth / 2,
      maxZ: z + this.playerSize.depth / 2,
    };

    // Check collision with all obstacles
    for (const obstacle of this.obstacles) {
      // Skip passthrough objects (doorways, archways, etc.)
      if (obstacle.isPassthrough) continue;

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

  // Get neighbors of a node with intelligent pruning
  getNeighbors(node, parent = null) {
    const neighbors = [];
    const directions = [
      { x: 1, z: 0, cost: 1.0 }, // Right
      { x: -1, z: 0, cost: 1.0 }, // Left
      { x: 0, z: 1, cost: 1.0 }, // Down
      { x: 0, z: -1, cost: 1.0 }, // Up
      { x: 1, z: 1, cost: 1.414 }, // Diagonal NE
      { x: -1, z: 1, cost: 1.414 }, // Diagonal SE
      { x: 1, z: -1, cost: 1.414 }, // Diagonal NW
      { x: -1, z: -1, cost: 1.414 }, // Diagonal SW
    ];

    // If we have a parent, prioritize continuing in the same direction
    let priorityDirections = directions;
    if (parent) {
      const dx = Math.sign(node.x - parent.x);
      const dz = Math.sign(node.z - parent.z);

      // Sort directions to prefer continuing in same direction
      priorityDirections = [...directions].sort((a, b) => {
        const aSimilarity = Math.abs(a.x - dx) + Math.abs(a.z - dz);
        const bSimilarity = Math.abs(b.x - dx) + Math.abs(b.z - dz);
        return aSimilarity - bSimilarity;
      });
    }

    for (const dir of priorityDirections) {
      const newX = node.x + dir.x * this.gridSize;
      const newZ = node.z + dir.z * this.gridSize;

      // For diagonal movement, check if both adjacent cells are walkable
      if (dir.x !== 0 && dir.z !== 0) {
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
          neighbors.push({ x: newX, z: newZ, cost: dir.cost });
        }
      } else {
        // Straight movement
        if (this.isWalkable(newX, newZ)) {
          neighbors.push({ x: newX, z: newZ, cost: dir.cost });
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

      // Check neighbors (pass parent for intelligent direction pruning)
      const parent = cameFrom.has(currentKey) ? cameFrom.get(currentKey) : null;
      const neighbors = this.getNeighbors(current, parent);
      for (const neighborData of neighbors) {
        const neighbor = { x: neighborData.x, z: neighborData.z };
        const neighborKey = key(neighbor);

        // Skip if in closed set
        if (closedSet.has(neighborKey)) {
          continue;
        }

        // Add obstacle proximity cost to the actual path cost (not just heuristic)
        const proximityCost = this.getObstacleProximityPenalty(neighbor);
        const tentativeGScore =
          gScore.get(currentKey) +
          neighborData.cost * this.gridSize +
          proximityCost;

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
    let i = 0;

    while (i < path.length - 1) {
      let farthest = i + 1;

      // Find the farthest point we can reach with line of sight
      for (let j = i + 2; j < path.length; j++) {
        if (this.hasLineOfSight(path[i], path[j])) {
          farthest = j;
        } else {
          break; // Stop checking once we lose line of sight
        }
      }

      // Add the farthest reachable point
      if (farthest < path.length - 1) {
        simplified.push(path[farthest]);
      }
      i = farthest;
    }

    // Always add the final destination
    if (simplified[simplified.length - 1] !== path[path.length - 1]) {
      simplified.push(path[path.length - 1]);
    }

    // Apply path smoothing for more natural movement
    return this.smoothPath(simplified);
  }

  // Smooth path using moving average for more natural curves
  smoothPath(path) {
    if (path.length <= 2) return path;

    const smoothed = [path[0]]; // Keep start point

    // Apply simple smoothing to intermediate points
    for (let i = 1; i < path.length - 1; i++) {
      const prev = path[i - 1];
      const current = path[i];
      const next = path[i + 1];

      // Weighted average: favor current position but smooth towards neighbors
      const smoothX = current.x * 0.5 + (prev.x + next.x) * 0.25;
      const smoothZ = current.z * 0.5 + (prev.z + next.z) * 0.25;

      // Only use smoothed point if it's still walkable
      if (this.isWalkable(smoothX, smoothZ)) {
        smoothed.push({ x: smoothX, z: smoothZ });
      } else {
        smoothed.push(current); // Keep original if smoothed isn't walkable
      }
    }

    smoothed.push(path[path.length - 1]); // Keep end point
    return smoothed;
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
  // Skip movement if player is sitting or lying
  if (player.isSitting || player.isLying) {
    return;
  }

  let deltaX = 0;
  let deltaZ = 0;

  // Update pathfinder with this player's dimensions for any replanning
  pathfinder.setPlayerSize(player.width, player.height, player.depth);

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
      // Check if the actual waypoint is blocked (not just look-ahead)
      if (!pathfinder.isWalkable(nextWaypoint.x, nextWaypoint.z)) {
        // Waypoint itself is now blocked (dynamic obstacle), skip to next or replan
        console.log(`🚧 Player ${player.id} waypoint blocked, skipping...`);
        player.path.shift(); // Remove blocked waypoint

        // If no more waypoints, replan with cooldown
        if (player.path.length === 0) {
          player.replanCooldown = player.replanCooldown || 0;
          if (player.replanCooldown === 0) {
            console.log(`🔄 Replanning from scratch...`);
            const path = pathfinder.findPath(
              { x: player.x, z: player.z },
              player.moveTarget
            );
            if (path.length > 1) {
              player.path = path;
              player.replanCooldown = 10; // Wait 10 ticks before replanning again
            } else {
              player.moveTarget = null; // Can't reach target
            }
          }
        }
        return { x: 0, z: 0 }; // Don't move this tick
      }

      // Decrease replan cooldown
      if (player.replanCooldown > 0) {
        player.replanCooldown--;
      }

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

          // If stuck for too long, recalculate path with offset
          if (player.stuckCounter > 15) {
            console.log(`⚠️ Player ${player.id} stuck, force replanning...`);
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

      // Reset collision counter on successful movement
      player.collisionCounter = 0;
    } else {
      // If collision detected during movement
      // Run validation again with debug mode to see what's blocking
      const isFirstCollision =
        !player.collisionCounter || player.collisionCounter === 0;
      if (isFirstCollision) {
        console.log(
          `⚠️ Movement blocked for player ${player.id} at (${player.x.toFixed(
            2
          )}, ${player.z.toFixed(2)}) trying to move to (${newX.toFixed(
            2
          )}, ${newZ.toFixed(2)})`
        );
        console.log(`   🔍 Running collision debug:`);
        validatePlayerMovement(player, newX, newZ, true); // Debug mode
      }

      if (player.moveTarget) {
        // Initialize or check collision counter
        player.collisionCounter = (player.collisionCounter || 0) + 1;

        // If stuck in same spot for too long, give up
        if (player.collisionCounter > 30) {
          console.log(
            `❌ Player ${player.id} stuck after ${player.collisionCounter} collision attempts, giving up`
          );
          player.moveTarget = null;
          player.path = null;
          player.collisionCounter = 0;
          player.replanCooldown = 0;
          return { x: 0, z: 0 };
        }

        // Replan with cooldown
        player.replanCooldown = player.replanCooldown || 0;
        if (player.replanCooldown === 0) {
          console.log(
            `🚫 Player ${player.id} collision #${
              player.collisionCounter
            } at (${player.x.toFixed(2)}, ${player.z.toFixed(
              2
            )}), replanning...`
          );

          let start = { x: player.x, z: player.z };

          // If multiple collisions, try to nudge player to a better position
          if (player.collisionCounter > 5) {
            console.log(`🔄 Attempting to move away from collision...`);

            // Try multiple directions to find walkable space
            const nudgeDistance = 0.3;
            const directions = [
              { x: nudgeDistance, z: 0 }, // Right
              { x: -nudgeDistance, z: 0 }, // Left
              { x: 0, z: nudgeDistance }, // Forward
              { x: 0, z: -nudgeDistance }, // Back
              { x: nudgeDistance, z: nudgeDistance }, // Diagonal
              { x: -nudgeDistance, z: -nudgeDistance },
              { x: nudgeDistance, z: -nudgeDistance },
              { x: -nudgeDistance, z: nudgeDistance },
            ];

            for (const dir of directions) {
              const testX = player.x + dir.x;
              const testZ = player.z + dir.z;

              if (validatePlayerMovement(player, testX, testZ)) {
                // Found a walkable position, move there
                player.x = testX;
                player.z = testZ;
                start = { x: testX, z: testZ };
                console.log(
                  `✨ Moved to (${testX.toFixed(2)}, ${testZ.toFixed(2)})`
                );
                player.collisionCounter = 0; // Reset after successful nudge
                break;
              }
            }
          }

          const path = pathfinder.findPath(start, player.moveTarget);

          if (path.length > 1) {
            player.path = path;
            player.replanCooldown = 10; // Longer cooldown to prevent spam
            console.log(`✅ Replanned: ${path.length} waypoints`);
          } else {
            console.log(`❌ No path found from current position`);

            // Try finding nearest walkable position as last resort
            if (player.collisionCounter > 15) {
              const nearestWalkable = pathfinder.findNearestWalkable({
                x: player.x,
                z: player.z,
              });
              if (
                nearestWalkable &&
                (nearestWalkable.x !== player.x ||
                  nearestWalkable.z !== player.z)
              ) {
                console.log(
                  `🚁 Teleporting to nearest walkable: (${nearestWalkable.x.toFixed(
                    2
                  )}, ${nearestWalkable.z.toFixed(2)})`
                );
                player.x = nearestWalkable.x;
                player.z = nearestWalkable.z;
                player.collisionCounter = 0;
                // Try pathfinding again from new position
                const newPath = pathfinder.findPath(
                  nearestWalkable,
                  player.moveTarget
                );
                if (newPath.length > 1) {
                  player.path = newPath;
                  player.replanCooldown = 10;
                  console.log(
                    `✅ Found path from teleport position: ${newPath.length} waypoints`
                  );
                } else {
                  player.moveTarget = null;
                  player.path = null;
                }
              } else {
                player.moveTarget = null;
                player.path = null;
                player.collisionCounter = 0;
              }
            }
          }
        }
        // During cooldown, don't spam logs, just wait
      } else {
        player.path = null;
        player.collisionCounter = 0;
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
      isSitting: p.isSitting || false, // Include sitting state
      isLying: p.isLying || false, // Include lying state
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
    replanCooldown: 0, // Cooldown to prevent infinite replanning
    collisionCounter: 0, // Counter for consecutive collision detections
    // Default dimensions (will be updated by client after mesh loads)
    width: PLAYER_SIZE.width,
    height: PLAYER_SIZE.height,
    depth: PLAYER_SIZE.depth,
    // Interaction states
    isSitting: false,
    sittingOn: null,
    seatIndex: undefined,
    isLying: false,
    lyingOn: null,
    lyingIndex: undefined,
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
    const { id, x, y, z, rotation, isPassthrough } = data;

    // Find and update the obstacle
    const obstacle = gameState.obstacles.find((obs) => obs.id === id);
    if (obstacle) {
      obstacle.x = x;
      obstacle.y = y;
      obstacle.z = z;
      if (rotation !== undefined) {
        obstacle.rotation = rotation;
      }
      if (isPassthrough !== undefined) {
        obstacle.isPassthrough = isPassthrough;
      }

      // Save to database
      await saveObstacle(obstacle);

      // Broadcast update to all clients
      io.emit("obstacleUpdated", { id, x, y, z, rotation, isPassthrough });

      // Recreate pathfinder with updated obstacles
      pathfinder.obstacles = gameState.obstacles;

      console.log(
        `📦 Obstacle ${id} moved to (${x.toFixed(2)}, ${z.toFixed(2)}) ${
          isPassthrough ? "[PASSTHROUGH]" : ""
        }`
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
      isPassthrough: data.isPassthrough || false,
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
      // Don't allow movement if player is sitting or lying
      if (player.isSitting || player.isLying) {
        console.log(
          `⚠️ Player ${socket.id} is ${
            player.isSitting ? "sitting" : "lying"
          }, ignoring move command`
        );
        return;
      }

      // Update pathfinder with player's actual dimensions
      pathfinder.setPlayerSize(player.width, player.height, player.depth);

      // Calculate path using A*
      const start = { x: player.x, z: player.z };
      let goal = { x: target.x, z: target.z };

      // If clicking on an obstacle, find the best interaction point
      goal = pathfinder.findInteractionPoint(goal);

      const path = pathfinder.findPath(start, goal);

      // Validate path doesn't go through obstacles
      let pathValid = true;
      for (let i = 0; i < path.length; i++) {
        if (!pathfinder.isWalkable(path[i].x, path[i].z)) {
          console.log(
            `⚠️ WARNING: Waypoint ${i} at (${path[i].x.toFixed(2)}, ${path[
              i
            ].z.toFixed(2)}) is NOT walkable!`
          );
          pathValid = false;
        }
      }

      player.path = path;
      player.moveTarget = goal;

      // Send path to client for visualization
      io.to(socket.id).emit("pathUpdate", {
        playerId: socket.id,
        path: path,
      });

      console.log(
        `🗺️ Player ${socket.id} pathfinding: (${start.x.toFixed(
          2
        )}, ${start.z.toFixed(2)}) → (${goal.x.toFixed(2)}, ${goal.z.toFixed(
          2
        )}) - ${path.length} waypoints, ${
          gameState.obstacles.length
        } obstacles${pathValid ? " ✓" : " ✗ INVALID PATH"}`
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

  // Handle player actions
  socket.on("playerAction", (data) => {
    const { playerId, action } = data;

    // Broadcast to all players (including sender for consistency)
    io.emit("playerAction", {
      playerId: playerId,
      action: action,
    });

    console.log(`🎬 Player ${playerId} performed action: ${action}`);
  });

  // Handle player sitting on furniture
  socket.on("playerSit", (data) => {
    const player = gameState.players.get(data.playerId);
    if (player) {
      // Mark player as sitting
      player.isSitting = true;
      player.sittingOn = data.furnitureId;
      player.seatIndex = data.seatIndex !== undefined ? data.seatIndex : 0;
      player.moveTarget = null; // Clear any movement target
      player.path = null; // Clear path

      // Update position to sitting position
      player.x = data.position.x;
      player.y = data.position.y;
      player.z = data.position.z;
      player.rotation = data.rotation;

      // Sync furniture dimensions AND center from client (ensures exact collision match)
      if (data.furnitureDimensions) {
        const furniture = gameState.obstacles.find(
          (obs) => obs.id === data.furnitureId
        );
        if (furniture) {
          furniture.width = data.furnitureDimensions.width;
          furniture.height = data.furnitureDimensions.height;
          furniture.depth = data.furnitureDimensions.depth;
          furniture.centerX = data.furnitureDimensions.centerX;
          furniture.centerY = data.furnitureDimensions.centerY;
          furniture.centerZ = data.furnitureDimensions.centerZ;
          console.log(
            `📦 Synced furniture ${
              data.furnitureId
            }: size=${furniture.width.toFixed(2)}x${furniture.height.toFixed(
              2
            )}x${furniture.depth.toFixed(
              2
            )}, center=(${furniture.centerX.toFixed(
              2
            )}, ${furniture.centerY.toFixed(2)}, ${furniture.centerZ.toFixed(
              2
            )})`
          );
        }
      }
    }

    // Broadcast to all players
    io.emit("playerSit", data);
    console.log(
      `🪑 Player ${data.playerId} sat on furniture ${data.furnitureId} (seat ${
        data.seatIndex !== undefined ? data.seatIndex + 1 : 1
      })`
    );
  });

  // Handle player standing up
  socket.on("playerStandUp", (data) => {
    const player = gameState.players.get(data.playerId);
    if (player) {
      // Mark player as no longer sitting
      player.isSitting = false;
      player.sittingOn = null;
      player.seatIndex = undefined;

      // Clear any existing paths or movement targets
      player.moveTarget = null;
      player.path = null;
      player.collisionCounter = 0;
      player.stuckCounter = 0;

      // Update position to standing position
      player.x = data.position.x;
      player.y = data.position.y;
      player.z = data.position.z;

      console.log(
        `🚶 Player ${data.playerId} stood up at (${data.position.x.toFixed(
          2
        )}, ${data.position.z.toFixed(2)})`
      );
    }

    // Broadcast to all players
    io.emit("playerStandUp", data);
  });

  // Handle player lying down on bed
  socket.on("playerLie", (data) => {
    const player = gameState.players.get(data.playerId);
    if (player) {
      // Mark player as lying
      player.isLying = true;
      player.lyingOn = data.furnitureId;
      player.lyingIndex = data.lyingIndex !== undefined ? data.lyingIndex : 0;
      player.moveTarget = null;
      player.path = null;

      // Update position to lying position
      player.x = data.position.x;
      player.y = data.position.y;
      player.z = data.position.z;
      player.rotation = data.rotation;

      // Sync furniture dimensions AND center from client (ensures exact collision match)
      if (data.furnitureDimensions) {
        const furniture = gameState.obstacles.find(
          (obs) => obs.id === data.furnitureId
        );
        if (furniture) {
          furniture.width = data.furnitureDimensions.width;
          furniture.height = data.furnitureDimensions.height;
          furniture.depth = data.furnitureDimensions.depth;
          furniture.centerX = data.furnitureDimensions.centerX;
          furniture.centerY = data.furnitureDimensions.centerY;
          furniture.centerZ = data.furnitureDimensions.centerZ;
          console.log(
            `📦 Synced furniture ${
              data.furnitureId
            }: size=${furniture.width.toFixed(2)}x${furniture.height.toFixed(
              2
            )}x${furniture.depth.toFixed(
              2
            )}, center=(${furniture.centerX.toFixed(
              2
            )}, ${furniture.centerY.toFixed(2)}, ${furniture.centerZ.toFixed(
              2
            )})`
          );
        }
      }
    }

    // Broadcast to all players
    io.emit("playerLie", data);
    console.log(
      `🛏️ Player ${data.playerId} lying on furniture ${
        data.furnitureId
      } (position ${data.lyingIndex !== undefined ? data.lyingIndex + 1 : 1})`
    );
  });

  // Handle player getting up from lying
  socket.on("playerGetUp", (data) => {
    const player = gameState.players.get(data.playerId);
    if (player) {
      // Mark player as no longer lying
      player.isLying = false;
      player.lyingOn = null;
      player.lyingIndex = undefined;

      // Clear any existing paths or movement targets
      player.moveTarget = null;
      player.path = null;
      player.collisionCounter = 0;
      player.stuckCounter = 0;

      // Update position to standing position
      player.x = data.position.x;
      player.y = data.position.y;
      player.z = data.position.z;

      console.log(
        `🚶 Player ${data.playerId} got up at (${data.position.x.toFixed(
          2
        )}, ${data.position.z.toFixed(2)})`
      );
    }

    // Broadcast to all players
    io.emit("playerGetUp", data);
  });

  // Handle furniture collision sync from client
  socket.on("syncFurnitureCollisions", (furnitureDataArray) => {
    let syncedCount = 0;
    furnitureDataArray.forEach((furnitureData) => {
      const furniture = gameState.obstacles.find(
        (obs) => obs.id === furnitureData.id
      );
      if (furniture) {
        furniture.width = furnitureData.width;
        furniture.height = furnitureData.height;
        furniture.depth = furnitureData.depth;
        furniture.centerX = furnitureData.centerX;
        furniture.centerY = furnitureData.centerY;
        furniture.centerZ = furnitureData.centerZ;
        syncedCount++;
      }
    });
    console.log(
      `📦 Synced ${syncedCount} furniture collision boxes from client ${socket.id}`
    );
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
