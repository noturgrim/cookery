import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { randomUUID } from "crypto";
import pool, {
  initializeDatabase,
  loadObstacles,
  saveObstacle,
  deleteObstacle,
  loadFoodItems,
  saveFoodItem,
  deleteFoodItem,
  cleanupExpiredSessions,
  getWorldTime,
  updateWorldTime,
  getWorldSettings,
  updateWorldSettings,
  loadSpeakerConnections,
  saveSpeakerConnection,
  deleteSpeakerConnection,
} from "./database.js";
import {
  registerUser,
  loginUser,
  validateSession,
  logoutUser,
} from "./auth.js";
import {
  validatePlayerName,
  validateSkinIndex,
  validateCoordinates,
  validateObstacleData,
  validateFoodData,
  validateId,
  sanitizeString,
  RateLimiter,
  VALIDATION_RULES,
  updateWorldBounds,
} from "./validation.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const httpServer = createServer(app);

// CORS Configuration - Secure setup
const getAllowedOrigins = () => {
  const origins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(",").map((origin) => origin.trim())
    : [];

  // In development, allow localhost
  if (process.env.NODE_ENV !== "production") {
    origins.push("http://localhost:3000", "http://127.0.0.1:3000");
  }

  return origins.length > 0 ? origins : false;
};

const allowedOrigins = getAllowedOrigins();

const io = new Server(httpServer, {
  cors: {
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps, Postman, or same-origin)
      if (!origin) {
        return callback(null, true);
      }

      // If no origins configured, block all cross-origin requests in production
      if (allowedOrigins === false) {
        console.warn(
          `⚠️ CORS: No allowed origins configured. Blocking: ${origin}`
        );
        return callback(
          new Error("CORS policy: No allowed origins configured"),
          false
        );
      }

      // Check if origin is allowed
      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        console.warn(`⚠️ CORS: Origin not allowed: ${origin}`);
        callback(
          new Error(`CORS policy: Origin ${origin} is not allowed`),
          false
        );
      }
    },
    methods: ["GET", "POST"],
    credentials: true, // Allow cookies for future authentication
    allowedHeaders: ["Content-Type", "Authorization"],
  },
});

// Middleware
app.use(express.json()); // Parse JSON request bodies

// Static file serving with aggressive caching for assets
app.use(
  express.static(join(__dirname, "../public"), {
    maxAge: "1d", // Cache for 1 day by default
    setHeaders: (res, path) => {
      // Aggressive caching for audio files (1 year)
      if (
        path.endsWith(".mp3") ||
        path.endsWith(".ogg") ||
        path.endsWith(".wav")
      ) {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      }
      // Cache images for 1 week
      else if (path.match(/\.(jpg|jpeg|png|gif|svg|webp)$/)) {
        res.setHeader("Cache-Control", "public, max-age=604800");
      }
      // Cache JS/CSS for 1 day
      else if (path.match(/\.(js|css)$/)) {
        res.setHeader("Cache-Control", "public, max-age=86400");
      }
      // Accept range requests for media files
      res.setHeader("Accept-Ranges", "bytes");
    },
  })
);

// Authentication API endpoints
app.post("/api/auth/register", async (req, res) => {
  try {
    const { username, password, displayName, skinIndex } = req.body;

    const result = await registerUser(
      username,
      password,
      displayName,
      skinIndex
    );

    if (result.success) {
      res.json({
        success: true,
        user: result.user,
        sessionToken: result.sessionToken,
      });
    } else {
      res.status(400).json({ success: false, error: result.error });
    }
  } catch (error) {
    console.error("❌ Registration endpoint error:", error);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    const result = await loginUser(username, password);

    if (result.success) {
      res.json({
        success: true,
        user: result.user,
        sessionToken: result.sessionToken,
      });
    } else {
      res.status(401).json({ success: false, error: result.error });
    }
  } catch (error) {
    console.error("❌ Login endpoint error:", error);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

app.post("/api/auth/validate", async (req, res) => {
  try {
    const { sessionToken } = req.body;

    const result = await validateSession(sessionToken);

    if (result.valid) {
      res.json({ valid: true, user: result.user });
    } else {
      res.status(401).json({ valid: false, error: result.error });
    }
  } catch (error) {
    console.error("❌ Validation endpoint error:", error);
    res.status(500).json({ valid: false, error: "Server error" });
  }
});

app.post("/api/auth/logout", async (req, res) => {
  try {
    const { sessionToken } = req.body;

    const result = await logoutUser(sessionToken);

    if (result.success) {
      res.json({ success: true });
    } else {
      res.status(400).json({ success: false, error: result.error });
    }
  } catch (error) {
    console.error("❌ Logout endpoint error:", error);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

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

// API endpoint to list available music files
app.get("/api/music/list", async (req, res) => {
  try {
    const musicDir = join(__dirname, "../public/sounds/music");
    const files = await readdir(musicDir);
    const songs = files
      .filter(
        (file) =>
          file.endsWith(".mp3") ||
          file.endsWith(".wav") ||
          file.endsWith(".ogg")
      )
      .map((file) => ({
        filename: file,
        name: file
          .replace(/\.(mp3|wav|ogg)$/, "")
          .replace(/-/g, " ")
          .replace(/_/g, " "),
      }));
    res.json(songs);
  } catch (error) {
    console.error("Error reading music directory:", error);
    res.status(500).json({ error: "Failed to load music files" });
  }
});

// World Time API endpoints
app.get("/api/world-time", async (req, res) => {
  try {
    const worldTime = await getWorldTime();
    res.json(worldTime);
  } catch (error) {
    console.error("❌ Error getting world time:", error);
    res.status(500).json({ error: "Failed to get world time" });
  }
});

app.post("/api/world-time", async (req, res) => {
  try {
    const { currentTime, timeSpeed, isPaused } = req.body;

    // Validate inputs
    if (typeof currentTime !== "number" || !isFinite(currentTime)) {
      return res.status(400).json({ error: "Invalid currentTime" });
    }
    if (typeof timeSpeed !== "number" || !isFinite(timeSpeed)) {
      return res.status(400).json({ error: "Invalid timeSpeed" });
    }
    if (typeof isPaused !== "boolean") {
      return res.status(400).json({ error: "Invalid isPaused" });
    }

    const success = await updateWorldTime(currentTime, timeSpeed, isPaused);

    if (success) {
      // Broadcast time update to all connected clients
      io.emit("worldTimeUpdate", { currentTime, timeSpeed, isPaused });
      res.json({ success: true });
    } else {
      res.status(500).json({ error: "Failed to update world time" });
    }
  } catch (error) {
    console.error("❌ Error updating world time:", error);
    res.status(500).json({ error: "Failed to update world time" });
  }
});

// Game state - Authoritative server
const gameState = {
  players: new Map(),
  obstacles: [], // Will be loaded from database
  foodItems: [], // Will be loaded from database
  cats: [], // Shared cat positions across all clients
};

// Rate limiter instance
const rateLimiter = new RateLimiter();

// Cleanup rate limiter every 60 seconds
setInterval(() => {
  rateLimiter.cleanup();
}, 60000);

// 🔒 Mutex for spawn operations to prevent race conditions with multiple players
const spawnLocks = {
  obstacle: false,
  food: false,
};

// Cleanup expired sessions every 30 minutes
setInterval(async () => {
  await cleanupExpiredSessions();
}, 30 * 60 * 1000);

// Server configuration
const SERVER_TICK_RATE = 20; // Reduced from 30 to 20 updates per second for bandwidth
const PLAYER_SPEED = 0.22; // Units per tick (increased from 0.15 for faster movement)
const PLAYER_SIZE = { width: 0.6, height: 2, depth: 0.6 }; // Player AABB dimensions (smaller for better navigation)
const GRID_SIZE = 0.25; // Fine grid for precise obstacle avoidance
const COARSE_GRID_SIZE = 0.5; // Coarse grid for long-distance pathfinding (faster)

// Helper to get all connected speakers (recursively follows connections)
const getConnectedSpeakers = (speakerId, connections) => {
  const visited = new Set();
  const queue = [speakerId];

  while (queue.length > 0) {
    const current = queue.shift();
    if (visited.has(current)) continue;
    visited.add(current);

    // Find all speakers connected to current
    connections.forEach((conn) => {
      if (conn.speaker1 === current && !visited.has(conn.speaker2)) {
        queue.push(conn.speaker2);
      } else if (conn.speaker2 === current && !visited.has(conn.speaker1)) {
        queue.push(conn.speaker1);
      }
    });
  }

  return Array.from(visited);
};

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
  // Check world bounds (use dynamic validation rules)
  if (
    Math.abs(newX) > VALIDATION_RULES.WORLD_BOUNDS ||
    Math.abs(newZ) > VALIDATION_RULES.WORLD_BOUNDS
  ) {
    if (debug)
      console.log(
        `   ❌ World bounds exceeded (bounds: ±${VALIDATION_RULES.WORLD_BOUNDS})`
      );
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
    this.coarseGridSize = COARSE_GRID_SIZE;
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

  // Determine optimal grid size based on distance and nearby obstacles
  getAdaptiveGridSize(start, goal) {
    const distance = this.heuristic(start, goal);
    
    // For very short distances (< 5 units), always use fine grid
    if (distance < 5) {
      return this.gridSize;
    }
    
    // For medium distances (5-15 units), check if there are nearby obstacles
    if (distance < 15) {
      // Quick check for obstacles in the general path area
      const hasNearbyObstacles = this.checkObstaclesInPath(start, goal, 3);
      return hasNearbyObstacles ? this.gridSize : this.coarseGridSize;
    }
    
    // For long distances (> 15 units), use coarse grid for speed
    return this.coarseGridSize;
  }

  // Quick check if there are obstacles in the general path area
  checkObstaclesInPath(start, goal, checkRadius) {
    const midX = (start.x + goal.x) / 2;
    const midZ = (start.z + goal.z) / 2;
    
    for (const obstacle of this.obstacles) {
      if (obstacle.isPassthrough) continue;
      
      const dx = obstacle.x - midX;
      const dz = obstacle.z - midZ;
      const distanceToPath = Math.sqrt(dx * dx + dz * dz);
      
      if (distanceToPath < checkRadius) {
        return true;
      }
    }
    return false;
  }

  // Calculate penalty for being near obstacles
  getObstacleProximityPenalty(pos) {
    let penalty = 0;
    const penaltyRadius = this.gridSize * 4; // Check 4 grid cells around (wider detection)

    // Check obstacles
    for (const obstacle of this.obstacles) {
      // Skip passthrough objects (doorways, archways, etc.)
      if (obstacle.isPassthrough) continue;

      const dx = pos.x - obstacle.x;
      const dz = pos.z - obstacle.z;
      const distance = Math.sqrt(dx * dx + dz * dz);

      if (distance < penaltyRadius) {
        // Closer to obstacle = much higher penalty
        // Use exponential falloff for even stronger avoidance
        const normalizedDist = 1 - distance / penaltyRadius;
        penalty += Math.pow(normalizedDist, 3) * 3.0; // Cubic penalty, 3.0 strength
      }
    }

    // Check food items (lighter penalty)
    for (const foodItem of gameState.foodItems) {
      const dx = pos.x - foodItem.x;
      const dz = pos.z - foodItem.z;
      const distance = Math.sqrt(dx * dx + dz * dz);

      if (distance < penaltyRadius) {
        const normalizedDist = 1 - distance / penaltyRadius;
        penalty += normalizedDist * normalizedDist * 0.8; // Slightly stronger for food
      }
    }

    return penalty;
  }

  // Check if a grid position is walkable (with caching)
  isWalkable(x, z) {
    // Simple cache key based on grid position
    const cacheKey = `${x.toFixed(2)},${z.toFixed(2)}`;
    
    // Check cache first (cache is reset when obstacles change)
    if (this.walkableCache && this.walkableCache.has(cacheKey)) {
      return this.walkableCache.get(cacheKey);
    }

    // Check world bounds (use dynamic validation rules)
    if (
      Math.abs(x) > VALIDATION_RULES.WORLD_BOUNDS ||
      Math.abs(z) > VALIDATION_RULES.WORLD_BOUNDS
    ) {
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
        // Cache the result
        if (!this.walkableCache) this.walkableCache = new Map();
        this.walkableCache.set(cacheKey, false);
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
        // Cache the result
        if (!this.walkableCache) this.walkableCache = new Map();
        this.walkableCache.set(cacheKey, false);
        return false; // Not walkable
      }
    }

    // Cache the walkable result
    if (!this.walkableCache) this.walkableCache = new Map();
    this.walkableCache.set(cacheKey, true);

    return true; // Walkable
  }

  // Clear walkable cache (call when obstacles change)
  clearCache() {
    if (this.walkableCache) {
      this.walkableCache.clear();
    }
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
    // Determine optimal grid size based on distance
    const adaptiveGridSize = this.getAdaptiveGridSize(start, goal);
    const originalGridSize = this.gridSize;
    this.gridSize = adaptiveGridSize; // Temporarily use adaptive grid
    
    // Snap to grid
    start = {
      x: Math.round(start.x / this.gridSize) * this.gridSize,
      z: Math.round(start.z / this.gridSize) * this.gridSize,
    };
    goal = {
      x: Math.round(goal.x / this.gridSize) * this.gridSize,
      z: Math.round(goal.z / this.gridSize) * this.gridSize,
    };

    // Quick check: if we have direct line of sight, return straight path
    if (this.hasLineOfSight(start, goal)) {
      return [start, goal];
    }

    // Check if start or goal is blocked
    if (!this.isWalkable(start.x, start.z)) {
      // Find nearest walkable position for start
      start = this.findNearestWalkable(start);
    }
    if (!this.isWalkable(goal.x, goal.z)) {
      // Find nearest walkable position for goal
      goal = this.findNearestWalkable(goal);
    }

    // Calculate distance to determine iteration limit
    const distance = this.heuristic(start, goal);
    const estimatedCells = Math.ceil(distance / this.gridSize);
    const MAX_ITERATIONS = Math.min(10000, estimatedCells * 50); // Dynamic limit based on distance

    // 🧹 MEMORY LEAK FIX: These are local variables that will be garbage collected
    // after the function completes, preventing memory buildup
    const openSet = [start];
    const closedSet = new Set();
    const cameFrom = new Map();
    const gScore = new Map();
    const fScore = new Map();

    const key = (node) => `${node.x.toFixed(2)},${node.z.toFixed(2)}`;
    gScore.set(key(start), 0);
    fScore.set(key(start), this.heuristic(start, goal));

    let iterations = 0;

    while (openSet.length > 0 && iterations < MAX_ITERATIONS) {
      iterations++;

      // Get node with lowest fScore (optimized: find min instead of sorting)
      let minIndex = 0;
      let minScore = fScore.get(key(openSet[0]));
      for (let i = 1; i < openSet.length; i++) {
        const score = fScore.get(key(openSet[i]));
        if (score < minScore) {
          minScore = score;
          minIndex = i;
        }
      }
      const current = openSet.splice(minIndex, 1)[0];
      const currentKey = key(current);

      // Add to closed set
      closedSet.add(currentKey);

      // Check if we reached the goal (adjusted tolerance for smaller grid)
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

        // 🧹 MEMORY LEAK FIX: Explicitly clear data structures before return
        cameFrom.clear();
        gScore.clear();
        fScore.clear();
        closedSet.clear();
        openSet.length = 0;

        // Restore original grid size
        this.gridSize = originalGridSize;

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
        // Only calculate every 3rd iteration to improve performance
        const proximityCost = iterations % 3 === 0 
          ? this.getObstacleProximityPenalty(neighbor) 
          : 0;
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
    const distanceToGoal = this.heuristic(start, goal);
    console.log(
      `⚠️ Pathfinding incomplete after ${iterations} iterations - Distance to goal: ${distanceToGoal.toFixed(
        2
      )} units, Nodes explored: ${closedSet.size}`
    );

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

      // 🧹 MEMORY LEAK FIX: Explicitly clear data structures before return
      cameFrom.clear();
      gScore.clear();
      fScore.clear();
      closedSet.clear();
      openSet.length = 0;

      // Restore original grid size
      this.gridSize = originalGridSize;

      return this.simplifyPath(path);
    }

    // 🧹 MEMORY LEAK FIX: Explicitly clear data structures before return
    cameFrom.clear();
    gScore.clear();
    fScore.clear();
    closedSet.clear();
    openSet.length = 0;

    // Restore original grid size
    this.gridSize = originalGridSize;

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

  // Player must authenticate before playing
  let isAuthenticated = false;
  let userId = null;

  // Handle authentication
  socket.on("authenticate", async (data) => {
    try {
      const { sessionToken } = data;

      if (!sessionToken) {
        socket.emit("authError", { error: "No session token provided" });
        return;
      }

      // Validate session
      const result = await validateSession(sessionToken);

      if (!result.valid) {
        socket.emit("authError", { error: "Invalid or expired session" });
        return;
      }

      // Authentication successful
      isAuthenticated = true;
      userId = result.user.id;

      // Initialize new player with authenticated user data
      const newPlayer = {
        id: socket.id,
        userId: result.user.id,
        username: result.user.username,
        name: result.user.displayName,
        skinIndex: result.user.skinIndex,
        x: Math.random() * 4 - 2,
        y: 0,
        z: Math.random() * 4 - 2,
        rotation: 0,
        color: `hsl(${Math.random() * 360}, 70%, 60%)`,
        input: { w: false, s: false, a: false, d: false },
        moveTarget: null,
        path: null,
        stuckCounter: 0,
        lastPosition: null,
        replanCooldown: 0,
        collisionCounter: 0,
        width: PLAYER_SIZE.width,
        height: PLAYER_SIZE.height,
        depth: PLAYER_SIZE.depth,
        isSitting: false,
        sittingOn: null,
        seatIndex: undefined,
        isLying: false,
        lyingOn: null,
        lyingIndex: undefined,
      };

      gameState.players.set(socket.id, newPlayer);

      // Send initial game state
      socket.emit("authenticated", {
        playerId: socket.id,
        user: result.user,
      });

      // Get current world time from database (with fallback)
      let worldTime;
      try {
        worldTime = await getWorldTime();
      } catch (error) {
        console.warn(
          "⚠️ Failed to get world time, using defaults:",
          error.message
        );
        worldTime = {
          currentTime: 12.0,
          timeSpeed: 0.1,
          isPaused: false,
        };
      }

      // Get world settings (platform size)
      let worldSettings;
      try {
        worldSettings = await getWorldSettings();
      } catch (error) {
        console.error(
          "⚠️ Failed to get world settings, using defaults:",
          error.message
        );
        worldSettings = {
          platformSize: 40,
        };
      }

      socket.emit("init", {
        playerId: socket.id,
        players: Array.from(gameState.players.values()),
        cats: gameState.cats, // Send cat positions
        obstacles: gameState.obstacles,
        foodItems: gameState.foodItems,
        worldTime: worldTime, // Send world time to new player
        worldSettings: worldSettings, // Send world settings to new player
      });

      // Notify other players
      io.emit("playerJoined", newPlayer);

      console.log(
        `✅ ${result.user.displayName} (@${result.user.username}) authenticated and joined`
      );
    } catch (error) {
      console.error("❌ Authentication error:", error);
      socket.emit("authError", { error: "Authentication failed" });
    }
  });

  // Helper function to check authentication
  const requireAuth = (callback) => {
    return (...args) => {
      if (!isAuthenticated) {
        socket.emit("authError", { error: "Not authenticated" });
        return;
      }
      callback(...args);
    };
  };

  // Handle player customization updates (name/skin)
  socket.on(
    "playerCustomization",
    requireAuth(async (data) => {
      const player = gameState.players.get(socket.id);
      if (!player) return;

      let updated = false;
      const updates = {};

      // Validate and update name
      if (data.name && typeof data.name === "string") {
        const sanitizedName = data.name.trim().substring(0, 20);
        if (sanitizedName.length > 0) {
          player.name = sanitizedName;
          updates.displayName = sanitizedName;
          updated = true;
          console.log(
            `✏️ ${player.username} (@${player.username}) changed name to: ${sanitizedName}`
          );
        }
      }

      // Validate and update skin
      if (typeof data.skinIndex === "number") {
        if (data.skinIndex >= 0 && data.skinIndex <= 17) {
          player.skinIndex = data.skinIndex;
          updates.skinIndex = data.skinIndex;
          updated = true;
          console.log(
            `👤 ${player.name} (@${player.username}) changed skin to: ${data.skinIndex}`
          );
        }
      }

      // Update database if changes were made
      if (updated && userId) {
        try {
          const updateFields = [];
          const values = [];
          let paramCount = 1;

          if (updates.displayName) {
            updateFields.push(`display_name = $${paramCount++}`);
            values.push(updates.displayName);
          }
          if (updates.skinIndex !== undefined) {
            updateFields.push(`skin_index = $${paramCount++}`);
            values.push(updates.skinIndex);
          }

          values.push(userId); // Last parameter for WHERE clause

          const query = `
            UPDATE users 
            SET ${updateFields.join(", ")}
            WHERE id = $${paramCount}
          `;

          await pool.query(query, values);
          console.log(`💾 Updated user ${player.username} in database`);
        } catch (error) {
          console.error(`❌ Failed to update user in database:`, error);
        }
      }

      // Broadcast update to all players
      io.emit("playerCustomizationUpdated", {
        playerId: socket.id,
        name: player.name,
        skinIndex: player.skinIndex,
      });
    })
  );

  // Handle player dimensions update from client
  socket.on(
    "updatePlayerDimensions",
    requireAuth((data) => {
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
    })
  );

  // Handle player input updates
  socket.on("input", (inputState) => {
    const player = gameState.players.get(socket.id);
    if (player) {
      player.input = inputState;
    }
  });

  // Handle obstacle updates from clients
  socket.on("updateObstacle", async (data) => {
    try {
      // Rate limiting
      if (!rateLimiter.checkLimit(socket.id, "UPDATE_OBSTACLE")) {
        const status = rateLimiter.getStatus(socket.id, "UPDATE_OBSTACLE");
        console.warn(
          `⚠️ Rate limit exceeded for ${socket.id}: UPDATE_OBSTACLE (${status.current}/${status.max})`
        );
        socket.emit("rateLimitError", {
          action: "updateObstacle",
          message: "Too many update requests. Please slow down.",
        });
        return;
      }

      // Validate ID
      const idValidation = validateId(data.id);
      if (!idValidation.valid) {
        console.warn(`⚠️ Invalid obstacle ID: ${data.id}`);
        return;
      }

      // Find the obstacle
      const obstacle = gameState.obstacles.find(
        (obs) => obs.id === idValidation.sanitized
      );
      if (!obstacle) {
        console.warn(`⚠️ Obstacle not found: ${data.id}`);
        return;
      }

      // Validate coordinates
      const coordsValidation = validateCoordinates(data.x, data.y, data.z);
      if (!coordsValidation.valid) {
        console.warn(`⚠️ Invalid coordinates for obstacle ${data.id}`);
        socket.emit("validationError", {
          action: "updateObstacle",
          errors: [coordsValidation.error],
        });
        return;
      }

      // Update obstacle
      obstacle.x = coordsValidation.sanitized.x;
      obstacle.y = coordsValidation.sanitized.y;
      obstacle.z = coordsValidation.sanitized.z;

      if (data.rotation !== undefined) {
        const rotationValidation = validateCoordinates(data.rotation, 0, 0);
        obstacle.rotation = rotationValidation.sanitized.x;
      }

      if (data.isPassthrough !== undefined) {
        obstacle.isPassthrough = Boolean(data.isPassthrough);
      }

      if (data.opacity !== undefined) {
        const opacity = parseFloat(data.opacity);
        if (!isNaN(opacity) && opacity >= 0.1 && opacity <= 1.0) {
          obstacle.opacity = opacity;
        }
      }

      // Save to database
      await saveObstacle(obstacle);

      // Broadcast update to all clients
      io.emit("obstacleUpdated", {
        id: obstacle.id,
        x: obstacle.x,
        y: obstacle.y,
        z: obstacle.z,
        rotation: obstacle.rotation,
        isPassthrough: obstacle.isPassthrough,
        opacity: obstacle.opacity,
      });

      // Recreate pathfinder with updated obstacles and clear cache
      pathfinder.obstacles = gameState.obstacles;
      pathfinder.clearCache();

      console.log(
        `📦 Obstacle ${obstacle.id} moved to (${obstacle.x.toFixed(
          2
        )}, ${obstacle.z.toFixed(2)}) ${
          obstacle.isPassthrough ? "[PASSTHROUGH]" : ""
        }`
      );
    } catch (error) {
      console.error(`❌ Error updating obstacle:`, error);
    }
  });

  // Handle obstacle opacity updates (lightweight update for walls/transparency)
  socket.on("updateObstacleOpacity", async (data) => {
    try {
      // Rate limiting (use UPDATE_OBSTACLE limit)
      if (!rateLimiter.checkLimit(socket.id, "UPDATE_OBSTACLE")) {
        return;
      }

      // Validate ID
      const idValidation = validateId(data.id);
      if (!idValidation.valid) return;

      // Find the obstacle
      const obstacle = gameState.obstacles.find(
        (obs) => obs.id === idValidation.sanitized
      );
      if (!obstacle) return;

      // Validate and set opacity
      const opacity = parseFloat(data.opacity);
      if (!isNaN(opacity) && opacity >= 0.1 && opacity <= 1.0) {
        obstacle.opacity = opacity;

        // Save to database
        await saveObstacle(obstacle);

        // Broadcast opacity update to all clients
        io.emit("obstacleOpacityUpdated", {
          id: obstacle.id,
          opacity: obstacle.opacity,
        });

        console.log(
          `👁️ Obstacle ${obstacle.id} opacity: ${(opacity * 100).toFixed(0)}%`
        );
      }
    } catch (error) {
      console.error(`❌ Error updating obstacle opacity:`, error);
    }
  });

  // Handle spawning new obstacles
  socket.on("spawnObstacle", async (data) => {
    try {
      // Rate limiting
      if (!rateLimiter.checkLimit(socket.id, "SPAWN_OBSTACLE")) {
        const status = rateLimiter.getStatus(socket.id, "SPAWN_OBSTACLE");
        console.warn(
          `⚠️ Rate limit exceeded for ${socket.id}: SPAWN_OBSTACLE (${status.current}/${status.max})`
        );
        socket.emit("rateLimitError", {
          action: "spawnObstacle",
          message: "Too many spawn requests. Please slow down.",
          retryAfter: 1000,
        });
        return;
      }

      // 🔒 MULTI-PLAYER RACE CONDITION FIX: Wait for lock to prevent simultaneous spawns
      while (spawnLocks.obstacle) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      spawnLocks.obstacle = true;

      try {
        // Check obstacle limit (now atomic with lock)
        if (gameState.obstacles.length >= VALIDATION_RULES.MAX_OBSTACLES) {
          console.warn(
            `⚠️ Maximum obstacles reached (${VALIDATION_RULES.MAX_OBSTACLES})`
          );
          socket.emit("spawnError", {
            id: data.id,
            error: `Maximum obstacles limit reached (${VALIDATION_RULES.MAX_OBSTACLES})`,
          });
          return;
        }

        // Validate obstacle data
        const validation = validateObstacleData(data);
        if (!validation.valid) {
          console.warn(
            `⚠️ Obstacle validation failed for ${socket.id}:`,
            validation.errors
          );
          socket.emit("validationError", {
            action: "spawnObstacle",
            errors: validation.errors,
          });
          return;
        }

        const newObstacle = validation.sanitized;

        // 🔒 RACE CONDITION FIX: Generate server-side UUID to prevent duplicates
        const serverGeneratedId = randomUUID();
        const clientRequestedId = newObstacle.id; // Keep client's ID for reference
        newObstacle.id = serverGeneratedId;

        // Check if obstacle already exists (shouldn't happen with UUIDs, but defensive)
        const existingIndex = gameState.obstacles.findIndex(
          (obs) => obs.id === newObstacle.id
        );
        if (existingIndex !== -1) {
          console.warn(
            `⚠️ Obstacle ${newObstacle.id} already exists (UUID collision!), updating instead`
          );
          // Update existing obstacle
          gameState.obstacles[existingIndex] = newObstacle;
        } else {
          // Add to game state (now atomic with lock)
          gameState.obstacles.push(newObstacle);
        }

        // Save to database (async but don't block)
        const saveSuccess = await saveObstacle(newObstacle);

        // Recreate pathfinder with new obstacles and clear cache
        pathfinder.obstacles = gameState.obstacles;
        pathfinder.clearCache();

        // Broadcast to all OTHER clients (spawner already has it)
        socket.broadcast.emit("obstacleSpawned", newObstacle);

        // Send confirmation to spawner with NEW server-generated ID
        socket.emit("spawnConfirmed", {
          clientId: clientRequestedId, // Original client ID for matching
          serverId: serverGeneratedId, // New authoritative server ID
          obstacle: newObstacle, // Full obstacle data with server ID
          success: saveSuccess,
        });

        console.log(
          `✨ Spawned obstacle: ${newObstacle.id} ${
            newObstacle.isPassthrough ? "[PASSTHROUGH]" : ""
          } - DB: ${saveSuccess ? "✅" : "❌"}`
        );
      } finally {
        // 🔓 Always release the lock
        spawnLocks.obstacle = false;
      }
    } catch (error) {
      console.error(`❌ Error spawning obstacle:`, error);
      socket.emit("spawnError", { id: data?.id, error: error.message });
      spawnLocks.obstacle = false; // Release lock on error
    }
  });

  // Handle deleting obstacles
  socket.on("deleteObstacle", async (data) => {
    try {
      // Rate limiting
      if (!rateLimiter.checkLimit(socket.id, "DELETE_ACTIONS")) {
        console.warn(`⚠️ Rate limit exceeded for ${socket.id}: DELETE_ACTIONS`);
        socket.emit("rateLimitError", {
          action: "deleteObstacle",
          message: "Too many delete requests. Please slow down.",
        });
        return;
      }

      // Validate ID
      const idValidation = validateId(data?.id);
      if (!idValidation.valid) {
        console.warn(`⚠️ Invalid obstacle ID for deletion: ${data?.id}`);
        return;
      }

      const id = idValidation.sanitized;

      // Remove from game state
      const index = gameState.obstacles.findIndex((obs) => obs.id === id);
      if (index > -1) {
        const deletedObstacle = gameState.obstacles[index];

        // Check if this was a speaker playing music
        const wasSpeaker =
          deletedObstacle.musicIsPlaying && deletedObstacle.musicCurrentSong;

        gameState.obstacles.splice(index, 1);

        // Delete from database
        await deleteObstacle(id);

        // Recreate pathfinder and clear cache
        pathfinder.obstacles = gameState.obstacles;
        pathfinder.clearCache();

        // Broadcast to all OTHER clients (deleter already removed it)
        socket.broadcast.emit("obstacleDeleted", { id });

        // If it was a speaker playing music, notify all clients to stop music
        if (wasSpeaker) {
          console.log(
            `🔇 Deleted speaker was playing music, stopping for all clients`
          );
          io.emit("speakerMusicStopped", { speakerId: id });
        }

        console.log(
          `🗑️ Deleted obstacle: ${id}${
            wasSpeaker ? " (was playing music)" : ""
          }`
        );
      } else {
        console.warn(`⚠️ Obstacle not found for deletion: ${id}`);
      }
    } catch (error) {
      console.error(`❌ Error deleting obstacle:`, error);
    }
  });

  // Handle spawning food items
  socket.on("spawnFood", async (data) => {
    try {
      // Rate limiting
      if (!rateLimiter.checkLimit(socket.id, "SPAWN_FOOD")) {
        const status = rateLimiter.getStatus(socket.id, "SPAWN_FOOD");
        console.warn(
          `⚠️ Rate limit exceeded for ${socket.id}: SPAWN_FOOD (${status.current}/${status.max})`
        );
        socket.emit("rateLimitError", {
          action: "spawnFood",
          message: "Too many spawn requests. Please slow down.",
          retryAfter: 1000,
        });
        return;
      }

      // 🔒 MULTI-PLAYER RACE CONDITION FIX: Wait for lock to prevent simultaneous spawns
      while (spawnLocks.food) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      spawnLocks.food = true;

      try {
        // Check food item limit (now atomic with lock)
        if (gameState.foodItems.length >= VALIDATION_RULES.MAX_FOOD_ITEMS) {
          console.warn(
            `⚠️ Maximum food items reached (${VALIDATION_RULES.MAX_FOOD_ITEMS})`
          );
          socket.emit("spawnError", {
            id: data.id,
            error: `Maximum food items limit reached (${VALIDATION_RULES.MAX_FOOD_ITEMS})`,
          });
          return;
        }

        // Validate food data
        const validation = validateFoodData(data);
        if (!validation.valid) {
          console.warn(
            `⚠️ Food validation failed for ${socket.id}:`,
            validation.errors
          );
          socket.emit("validationError", {
            action: "spawnFood",
            errors: validation.errors,
          });
          return;
        }

        const newFood = validation.sanitized;

        // 🔒 RACE CONDITION FIX: Generate server-side UUID to prevent duplicates
        const serverGeneratedId = randomUUID();
        const clientRequestedId = newFood.id; // Keep client's ID for reference
        newFood.id = serverGeneratedId;

        // Check if food item already exists (shouldn't happen with UUIDs, but defensive)
        const existingIndex = gameState.foodItems.findIndex(
          (food) => food.id === newFood.id
        );
        if (existingIndex !== -1) {
          console.warn(
            `⚠️ Food ${newFood.id} already exists (UUID collision!), updating instead`
          );
          // Update existing food item
          gameState.foodItems[existingIndex] = newFood;
        } else {
          // Add to game state (now atomic with lock)
          gameState.foodItems.push(newFood);
        }

        // Save to database (async but don't block)
        const saveSuccess = await saveFoodItem(newFood);

        // Broadcast to all OTHER clients (spawner already has it)
        socket.broadcast.emit("foodSpawned", newFood);

        // Send confirmation to spawner with NEW server-generated ID
        socket.emit("spawnConfirmed", {
          clientId: clientRequestedId, // Original client ID for matching
          serverId: serverGeneratedId, // New authoritative server ID
          food: newFood, // Full food data with server ID
          success: saveSuccess,
        });

        console.log(
          `✨ Spawned food: ${newFood.id} (${newFood.width.toFixed(
            2
          )}x${newFood.height.toFixed(2)}x${newFood.depth.toFixed(2)}) - DB: ${
            saveSuccess ? "✅" : "❌"
          }`
        );
      } finally {
        // 🔓 Always release the lock
        spawnLocks.food = false;
      }
    } catch (error) {
      console.error(`❌ Error spawning food:`, error);
      socket.emit("spawnError", { id: data?.id, error: error.message });
      spawnLocks.food = false; // Release lock on error
    }
  });

  // Handle updating food items
  socket.on("updateFood", async (data) => {
    try {
      // Rate limiting
      if (!rateLimiter.checkLimit(socket.id, "UPDATE_FOOD")) {
        console.warn(`⚠️ Rate limit exceeded for ${socket.id}: UPDATE_FOOD`);
        socket.emit("rateLimitError", {
          action: "updateFood",
          message: "Too many update requests. Please slow down.",
        });
        return;
      }

      // Validate ID
      const idValidation = validateId(data?.id);
      if (!idValidation.valid) {
        console.warn(`⚠️ Invalid food ID: ${data?.id}`);
        return;
      }

      // Find and update the food item
      const foodItem = gameState.foodItems.find(
        (food) => food.id === idValidation.sanitized
      );
      if (!foodItem) {
        console.warn(`⚠️ Food ${data.id} not found in game state`);
        return;
      }

      // Validate coordinates
      const coordsValidation = validateCoordinates(data.x, data.y, data.z);
      if (!coordsValidation.valid) {
        console.warn(`⚠️ Invalid coordinates for food ${data.id}`);
        socket.emit("validationError", {
          action: "updateFood",
          errors: [coordsValidation.error],
        });
        return;
      }

      foodItem.x = coordsValidation.sanitized.x;
      foodItem.y = coordsValidation.sanitized.y;
      foodItem.z = coordsValidation.sanitized.z;

      // Save to database
      const saveSuccess = await saveFoodItem(foodItem);

      if (!saveSuccess) {
        console.error(`❌ Failed to save food update for ${foodItem.id}`);
      }

      // Broadcast update to all clients
      io.emit("foodUpdated", {
        id: foodItem.id,
        x: foodItem.x,
        y: foodItem.y,
        z: foodItem.z,
      });

      console.log(
        `🍔 Food ${foodItem.id} moved to (${foodItem.x.toFixed(
          2
        )}, ${foodItem.z.toFixed(2)}) - DB: ${saveSuccess ? "✅" : "❌"}`
      );
    } catch (error) {
      console.error(`❌ Error updating food:`, error);
    }
  });

  // Handle deleting food items
  socket.on("deleteFood", async (data) => {
    try {
      // Rate limiting
      if (!rateLimiter.checkLimit(socket.id, "DELETE_ACTIONS")) {
        console.warn(`⚠️ Rate limit exceeded for ${socket.id}: DELETE_ACTIONS`);
        socket.emit("rateLimitError", {
          action: "deleteFood",
          message: "Too many delete requests. Please slow down.",
        });
        return;
      }

      // Validate ID
      const idValidation = validateId(data?.id);
      if (!idValidation.valid) {
        console.warn(`⚠️ Invalid food ID for deletion: ${data?.id}`);
        return;
      }

      const id = idValidation.sanitized;

      // Remove from game state
      const index = gameState.foodItems.findIndex((food) => food.id === id);
      if (index > -1) {
        gameState.foodItems.splice(index, 1);

        // Delete from database
        const deleteSuccess = await deleteFoodItem(id);

        if (!deleteSuccess) {
          console.error(`❌ Failed to delete food ${id} from database`);
        }

        // Broadcast to all OTHER clients (deleter already removed it)
        socket.broadcast.emit("foodDeleted", { id });

        console.log(
          `🗑️ Deleted food: ${id} - DB: ${deleteSuccess ? "✅" : "❌"}`
        );
      } else {
        console.warn(`⚠️ Food ${id} not found in game state`);
      }
    } catch (error) {
      console.error(`❌ Error deleting food:`, error);
    }
  });

  // Handle click-to-move with pathfinding
  socket.on("moveTo", (target) => {
    try {
      // Rate limiting
      if (!rateLimiter.checkLimit(socket.id, "MOVE_COMMANDS")) {
        // Don't spam console for move commands, just silently reject
        return;
      }

      const player = gameState.players.get(socket.id);
      if (!player) return;

      // Validate target coordinates
      if (
        target?.x === undefined ||
        target?.z === undefined ||
        typeof target.x !== "number" ||
        typeof target.z !== "number"
      ) {
        console.warn(`⚠️ Invalid move target from ${socket.id}`);
        return;
      }

      // Validate coordinates are within bounds
      const coordsValidation = validateCoordinates(
        target.x,
        0,
        target.z,
        VALIDATION_RULES.WORLD_BOUNDS
      );
      if (!coordsValidation.valid) {
        console.warn(
          `⚠️ Move target out of bounds for ${socket.id}: (${target.x.toFixed(
            2
          )}, ${target.z.toFixed(2)}) - Current bounds: ±${
            VALIDATION_RULES.WORLD_BOUNDS
          }`
        );
        return;
      }

      // Don't allow movement if player is sitting or lying
      if (player.isSitting || player.isLying) {
        return;
      }

      // Update pathfinder with player's actual dimensions
      pathfinder.setPlayerSize(player.width, player.height, player.depth);

      // Calculate path using A*
      const start = { x: player.x, z: player.z };
      let goal = {
        x: coordsValidation.sanitized.x,
        z: coordsValidation.sanitized.z,
      };

      if (player.debugPath) {
        console.log(`\n🐛 PATHFINDING DEBUG for ${socket.id}:`);
        console.log(`   Start: (${start.x.toFixed(2)}, ${start.z.toFixed(2)})`);
        console.log(`   Goal: (${goal.x.toFixed(2)}, ${goal.z.toFixed(2)})`);
        console.log(`   Distance: ${Math.sqrt((goal.x - start.x) ** 2 + (goal.z - start.z) ** 2).toFixed(2)} units`);
        console.log(`   Grid size: ${pathfinder.gridSize}`);
        console.log(`   Player size: ${player.width}x${player.height}x${player.depth}`);
      }

      // If clicking on an obstacle, find the best interaction point
      const originalGoal = { ...goal };
      goal = pathfinder.findInteractionPoint(goal);

      if (player.debugPath && (goal.x !== originalGoal.x || goal.z !== originalGoal.z)) {
        console.log(`   🎯 Adjusted goal for interaction: (${goal.x.toFixed(2)}, ${goal.z.toFixed(2)})`);
      }

      const path = pathfinder.findPath(start, goal);

      if (player.debugPath) {
        console.log(`   ✅ Path found with ${path.length} waypoints`);
        if (path.length > 0) {
          console.log(`   📍 First waypoint: (${path[0].x.toFixed(2)}, ${path[0].z.toFixed(2)})`);
          console.log(`   📍 Last waypoint: (${path[path.length - 1].x.toFixed(2)}, ${path[path.length - 1].z.toFixed(2)})`);
        }
      }

      player.path = path;
      player.moveTarget = goal;

      // Send path to client for visualization
      io.to(socket.id).emit("pathUpdate", {
        playerId: socket.id,
        path: path,
      });
    } catch (error) {
      console.error(`❌ Error processing moveTo for ${socket.id}:`, error);
    }
  });

  // Handle emote/voice from players
  socket.on("playEmote", (data) => {
    try {
      // Rate limiting
      if (!rateLimiter.checkLimit(socket.id, "EMOTES")) {
        console.warn(`⚠️ Rate limit exceeded for ${socket.id}: EMOTES`);
        socket.emit("rateLimitError", {
          action: "playEmote",
          message: "Too many emotes. Please slow down.",
        });
        return;
      }

      // Validate playerId matches socket
      if (data?.playerId !== socket.id) {
        console.warn(
          `⚠️ Player ${socket.id} tried to send emote as ${data?.playerId}`
        );
        return;
      }

      // Validate emote string
      const emote = sanitizeString(data?.emote, 50);
      if (!emote) {
        console.warn(`⚠️ Invalid emote from ${socket.id}`);
        return;
      }

      // Broadcast to all players (including sender for consistency)
      io.emit("playerEmote", {
        playerId: socket.id,
        emote: emote,
      });

      console.log(`🎵 Player ${socket.id} played emote: ${emote}`);
    } catch (error) {
      console.error(`❌ Error processing emote for ${socket.id}:`, error);
    }
  });

  // Handle player actions
  socket.on("playerAction", (data) => {
    try {
      // Rate limiting
      if (!rateLimiter.checkLimit(socket.id, "ACTIONS")) {
        console.warn(`⚠️ Rate limit exceeded for ${socket.id}: ACTIONS`);
        socket.emit("rateLimitError", {
          action: "playerAction",
          message: "Too many actions. Please slow down.",
        });
        return;
      }

      // Validate playerId matches socket
      if (data?.playerId !== socket.id) {
        console.warn(
          `⚠️ Player ${socket.id} tried to perform action as ${data?.playerId}`
        );
        return;
      }

      // Validate action string
      const action = sanitizeString(data?.action, 50);
      if (!action) {
        console.warn(`⚠️ Invalid action from ${socket.id}`);
        return;
      }

      // Broadcast to all players (including sender for consistency)
      io.emit("playerAction", {
        playerId: socket.id,
        action: action,
      });

      console.log(`🎬 Player ${socket.id} performed action: ${action}`);
    } catch (error) {
      console.error(`❌ Error processing action for ${socket.id}:`, error);
    }
  });

  // Handle player sitting on furniture
  socket.on("playerSit", (data) => {
    try {
      // Rate limiting
      if (!rateLimiter.checkLimit(socket.id, "SIT_ACTIONS")) {
        console.warn(`⚠️ Rate limit exceeded for ${socket.id}: SIT_ACTIONS`);
        return;
      }

      // Validate playerId matches socket
      if (data?.playerId !== socket.id) {
        console.warn(
          `⚠️ Player ${socket.id} tried to sit as ${data?.playerId}`
        );
        return;
      }

      const player = gameState.players.get(socket.id);
      if (!player) return;

      // Validate furniture ID
      const furnitureIdValidation = validateId(data?.furnitureId);
      if (!furnitureIdValidation.valid) {
        console.warn(`⚠️ Invalid furniture ID from ${socket.id}`);
        return;
      }

      // Validate position
      const posValidation = validateCoordinates(
        data?.position?.x,
        data?.position?.y,
        data?.position?.z
      );
      if (!posValidation.valid) {
        console.warn(`⚠️ Invalid sit position from ${socket.id}`);
        return;
      }

      // Validate seat index
      const seatIndex =
        data?.seatIndex !== undefined ? parseInt(data.seatIndex, 10) : 0;
      if (isNaN(seatIndex) || seatIndex < 0 || seatIndex > 100) {
        console.warn(`⚠️ Invalid seat index from ${socket.id}`);
        return;
      }
      // Mark player as sitting
      player.isSitting = true;
      player.sittingOn = furnitureIdValidation.sanitized;
      player.seatIndex = seatIndex;
      player.moveTarget = null; // Clear any movement target
      player.path = null; // Clear path

      // Update position to sitting position
      player.x = posValidation.sanitized.x;
      player.y = posValidation.sanitized.y;
      player.z = posValidation.sanitized.z;
      player.rotation = parseFloat(data?.rotation) || 0;

      // Sync furniture dimensions AND center from client (ensures exact collision match)
      if (data?.furnitureDimensions) {
        const furniture = gameState.obstacles.find(
          (obs) => obs.id === player.sittingOn
        );
        if (furniture) {
          const dims = data.furnitureDimensions;
          furniture.width = parseFloat(dims.width) || furniture.width;
          furniture.height = parseFloat(dims.height) || furniture.height;
          furniture.depth = parseFloat(dims.depth) || furniture.depth;
          furniture.centerX = parseFloat(dims.centerX) || furniture.centerX;
          furniture.centerY = parseFloat(dims.centerY) || furniture.centerY;
          furniture.centerZ = parseFloat(dims.centerZ) || furniture.centerZ;
        }
      }

      // Broadcast to all players
      io.emit("playerSit", {
        playerId: socket.id,
        furnitureId: player.sittingOn,
        seatIndex: player.seatIndex,
        position: {
          x: player.x,
          y: player.y,
          z: player.z,
        },
        rotation: player.rotation,
        furnitureDimensions: data?.furnitureDimensions,
      });

      console.log(
        `🪑 Player ${socket.id} sat on furniture ${player.sittingOn} (seat ${
          player.seatIndex + 1
        })`
      );
    } catch (error) {
      console.error(`❌ Error processing playerSit for ${socket.id}:`, error);
    }
  });

  // Handle player standing up
  socket.on("playerStandUp", (data) => {
    try {
      // Rate limiting
      if (!rateLimiter.checkLimit(socket.id, "SIT_ACTIONS")) {
        console.warn(`⚠️ Rate limit exceeded for ${socket.id}: SIT_ACTIONS`);
        return;
      }

      // Validate playerId matches socket
      if (data?.playerId !== socket.id) {
        console.warn(
          `⚠️ Player ${socket.id} tried to stand up as ${data?.playerId}`
        );
        return;
      }

      const player = gameState.players.get(socket.id);
      if (!player) return;

      // Validate position
      const posValidation = validateCoordinates(
        data?.position?.x,
        data?.position?.y,
        data?.position?.z
      );
      if (!posValidation.valid) {
        console.warn(`⚠️ Invalid stand up position from ${socket.id}`);
        return;
      }

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
      player.x = posValidation.sanitized.x;
      player.y = posValidation.sanitized.y;
      player.z = posValidation.sanitized.z;

      console.log(
        `🚶 Player ${socket.id} stood up at (${player.x.toFixed(
          2
        )}, ${player.z.toFixed(2)})`
      );

      // Broadcast to all players
      io.emit("playerStandUp", {
        playerId: socket.id,
        position: {
          x: player.x,
          y: player.y,
          z: player.z,
        },
      });
    } catch (error) {
      console.error(
        `❌ Error processing playerStandUp for ${socket.id}:`,
        error
      );
    }
  });

  // Handle player lying down on bed
  socket.on("playerLie", (data) => {
    try {
      // Rate limiting
      if (!rateLimiter.checkLimit(socket.id, "SIT_ACTIONS")) {
        console.warn(`⚠️ Rate limit exceeded for ${socket.id}: SIT_ACTIONS`);
        return;
      }

      // Validate playerId matches socket
      if (data?.playerId !== socket.id) {
        console.warn(
          `⚠️ Player ${socket.id} tried to lie as ${data?.playerId}`
        );
        return;
      }

      const player = gameState.players.get(socket.id);
      if (!player) return;

      // Validate furniture ID
      const furnitureIdValidation = validateId(data?.furnitureId);
      if (!furnitureIdValidation.valid) {
        console.warn(`⚠️ Invalid furniture ID from ${socket.id}`);
        return;
      }

      // Validate position
      const posValidation = validateCoordinates(
        data?.position?.x,
        data?.position?.y,
        data?.position?.z
      );
      if (!posValidation.valid) {
        console.warn(`⚠️ Invalid lying position from ${socket.id}`);
        return;
      }

      // Validate lying index
      const lyingIndex =
        data?.lyingIndex !== undefined ? parseInt(data.lyingIndex, 10) : 0;
      if (isNaN(lyingIndex) || lyingIndex < 0 || lyingIndex > 100) {
        console.warn(`⚠️ Invalid lying index from ${socket.id}`);
        return;
      }
      // Mark player as lying
      player.isLying = true;
      player.lyingOn = furnitureIdValidation.sanitized;
      player.lyingIndex = lyingIndex;
      player.moveTarget = null;
      player.path = null;

      // Update position to lying position
      player.x = posValidation.sanitized.x;
      player.y = posValidation.sanitized.y;
      player.z = posValidation.sanitized.z;
      player.rotation = parseFloat(data?.rotation) || 0;

      // Sync furniture dimensions AND center from client (ensures exact collision match)
      if (data?.furnitureDimensions) {
        const furniture = gameState.obstacles.find(
          (obs) => obs.id === player.lyingOn
        );
        if (furniture) {
          const dims = data.furnitureDimensions;
          furniture.width = parseFloat(dims.width) || furniture.width;
          furniture.height = parseFloat(dims.height) || furniture.height;
          furniture.depth = parseFloat(dims.depth) || furniture.depth;
          furniture.centerX = parseFloat(dims.centerX) || furniture.centerX;
          furniture.centerY = parseFloat(dims.centerY) || furniture.centerY;
          furniture.centerZ = parseFloat(dims.centerZ) || furniture.centerZ;
        }
      }

      // Broadcast to all players
      io.emit("playerLie", {
        playerId: socket.id,
        furnitureId: player.lyingOn,
        lyingIndex: player.lyingIndex,
        position: {
          x: player.x,
          y: player.y,
          z: player.z,
        },
        rotation: player.rotation,
        furnitureDimensions: data?.furnitureDimensions,
      });

      console.log(
        `🛏️ Player ${socket.id} lying on furniture ${
          player.lyingOn
        } (position ${player.lyingIndex + 1})`
      );
    } catch (error) {
      console.error(`❌ Error processing playerLie for ${socket.id}:`, error);
    }
  });

  // Handle player getting up from lying
  socket.on("playerGetUp", (data) => {
    try {
      // Rate limiting
      if (!rateLimiter.checkLimit(socket.id, "SIT_ACTIONS")) {
        console.warn(`⚠️ Rate limit exceeded for ${socket.id}: SIT_ACTIONS`);
        return;
      }

      // Validate playerId matches socket
      if (data?.playerId !== socket.id) {
        console.warn(
          `⚠️ Player ${socket.id} tried to get up as ${data?.playerId}`
        );
        return;
      }

      const player = gameState.players.get(socket.id);
      if (!player) return;

      // Validate position
      const posValidation = validateCoordinates(
        data?.position?.x,
        data?.position?.y,
        data?.position?.z
      );
      if (!posValidation.valid) {
        console.warn(`⚠️ Invalid get up position from ${socket.id}`);
        return;
      }

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
      player.x = posValidation.sanitized.x;
      player.y = posValidation.sanitized.y;
      player.z = posValidation.sanitized.z;

      console.log(
        `🚶 Player ${socket.id} got up at (${player.x.toFixed(
          2
        )}, ${player.z.toFixed(2)})`
      );

      // Broadcast to all players
      io.emit("playerGetUp", {
        playerId: socket.id,
        position: {
          x: player.x,
          y: player.y,
          z: player.z,
        },
      });
    } catch (error) {
      console.error(`❌ Error processing playerGetUp for ${socket.id}:`, error);
    }
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

  // Handle world time updates from admin/any player
  socket.on(
    "updateWorldTime",
    requireAuth(async (data) => {
      try {
        const { currentTime, timeSpeed, isPaused } = data;

        // Validate inputs
        if (typeof currentTime !== "number" || !isFinite(currentTime)) {
          return;
        }
        if (typeof timeSpeed !== "number" || !isFinite(timeSpeed)) {
          return;
        }
        if (typeof isPaused !== "boolean") {
          return;
        }

        // Update in database
        const success = await updateWorldTime(currentTime, timeSpeed, isPaused);

        if (success) {
          // Broadcast to all clients (including sender for confirmation)
          io.emit("worldTimeUpdate", { currentTime, timeSpeed, isPaused });
          console.log(
            `🕒 World time updated: ${currentTime.toFixed(
              2
            )}h speed:${timeSpeed}x paused:${isPaused}`
          );
        }
      } catch (error) {
        console.error("❌ Error handling world time update:", error);
      }
    })
  );

  // Handle platform size update
  socket.on("updatePlatformSize", async (data) => {
    try {
      // Rate limiting
      if (!rateLimiter.checkLimit(socket.id, "ACTIONS")) {
        const status = rateLimiter.getStatus(socket.id, "ACTIONS");
        console.warn(
          `⚠️ Rate limit exceeded for ${socket.id}: ACTIONS (${status.current}/${status.max})`
        );
        socket.emit("rateLimitError", {
          action: "updatePlatformSize",
          message: "Too many actions. Please slow down.",
          retryAfter: 1000,
        });
        return;
      }

      const { platformSize } = data;

      if (
        !platformSize ||
        typeof platformSize !== "number" ||
        !Number.isInteger(platformSize)
      ) {
        console.error("❌ Invalid platform size data");
        return;
      }

      // Validate platform size range (20-200)
      if (platformSize < 20 || platformSize > 200) {
        console.error(`❌ Platform size ${platformSize} out of range (20-200)`);
        return;
      }

      console.log(`📥 Received platform size update request: ${platformSize}`);

      // Update in database
      const success = await updateWorldSettings(platformSize);

      if (success) {
        // Update validation bounds based on new platform size
        const boundsUpdated = updateWorldBounds(platformSize);
        console.log(`✅ Bounds update result: ${boundsUpdated}`);
        console.log(
          `📏 Current WORLD_BOUNDS: ±${VALIDATION_RULES.WORLD_BOUNDS}`
        );

        // Broadcast to all clients (including sender for confirmation)
        io.emit("platformSizeUpdate", { platformSize });
        console.log(
          `🟦 Platform size updated: ${platformSize}x${platformSize}`
        );
        console.log(`🌍 Broadcasting to all clients...`);
      } else {
        console.error(`❌ Failed to save platform size to database`);
      }
    } catch (error) {
      console.error("❌ Error handling platform size update:", error);
    }
  });

  // ============================================
  // MUSIC PLAYER SYNC (for speakers)
  // ============================================

  // Handle starting music on a speaker
  socket.on("startSpeakerMusic", async (data) => {
    try {
      // Rate limiting (use ACTION limit)
      if (!rateLimiter.checkLimit(socket.id, "ACTIONS")) {
        return;
      }

      // Validate speaker ID
      const idValidation = validateId(data.speakerId);
      if (!idValidation.valid) return;

      // Find the speaker obstacle
      const speaker = gameState.obstacles.find(
        (obs) => obs.id === idValidation.sanitized
      );

      if (!speaker) {
        console.warn(`Speaker ${data.speakerId} not found`);
        return;
      }

      // Validate song name
      const songName = sanitizeString(data.songName, 255);
      const serverTime = Date.now();

      // Update speaker state
      speaker.musicCurrentSong = songName;
      speaker.musicIsPlaying = true;
      speaker.musicStartTime = serverTime;

      // Save to database
      await saveObstacle(speaker);

      // Broadcast to OTHER clients (sender already has it playing)
      socket.broadcast.emit("speakerMusicStarted", {
        speakerId: speaker.id,
        songName,
        serverTime,
      });

      console.log(`🎵 Speaker ${speaker.id} started playing: ${songName}`);
    } catch (error) {
      console.error("❌ Error starting speaker music:", error);
    }
  });

  // Handle stopping music on a speaker
  socket.on("stopSpeakerMusic", async (data) => {
    try {
      // Rate limiting (use ACTION limit)
      if (!rateLimiter.checkLimit(socket.id, "ACTIONS")) {
        return;
      }

      // Validate speaker ID
      const idValidation = validateId(data.speakerId);
      if (!idValidation.valid) return;

      // Find the speaker obstacle
      const speaker = gameState.obstacles.find(
        (obs) => obs.id === idValidation.sanitized
      );

      if (!speaker) {
        console.warn(`Speaker ${data.speakerId} not found`);
        return;
      }

      // Get all connected speakers
      const connections = await loadSpeakerConnections();
      const connectedSpeakers = getConnectedSpeakers(speaker.id, connections);

      // Stop all speakers in the connected group
      const speakersToStop = [
        speaker.id,
        ...connectedSpeakers.filter((id) => id !== speaker.id),
      ];

      for (const speakerId of speakersToStop) {
        const speakerToStop = gameState.obstacles.find(
          (obs) => obs.id === speakerId
        );
        if (speakerToStop) {
          // Update speaker state
          speakerToStop.musicCurrentSong = null;
          speakerToStop.musicIsPlaying = false;
          speakerToStop.musicStartTime = null;

          // Save to database
          await saveObstacle(speakerToStop);

          // Broadcast to OTHER clients (sender already stopped it)
          socket.broadcast.emit("speakerMusicStopped", {
            speakerId: speakerToStop.id,
          });
        }
      }

      console.log(
        `🔇 Stopped ${speakersToStop.length} connected speaker(s):`,
        speakersToStop
      );
    } catch (error) {
      console.error("❌ Error stopping speaker music:", error);
    }
  });

  // Send current music state when player connects
  socket.on("requestMusicSync", () => {
    try {
      // Find all speakers that are currently playing
      const activeSpeakers = gameState.obstacles
        .filter((obs) => obs.musicIsPlaying && obs.musicCurrentSong)
        .map((speaker) => ({
          id: speaker.id,
          currentSong: speaker.musicCurrentSong,
          isPlaying: speaker.musicIsPlaying,
          isPaused: speaker.musicIsPaused || false,
          volume: speaker.musicVolume || 70,
          serverTime: speaker.musicStartTime,
        }));

      socket.emit("speakersStateSync", activeSpeakers);
      console.log(
        `🎵 Sent music sync to ${socket.id}: ${activeSpeakers.length} active speakers`
      );
    } catch (error) {
      console.error("❌ Error sending music sync:", error);
    }
  });

  // Pause speaker music
  socket.on("pauseSpeakerMusic", async (data) => {
    try {
      // Rate limiting
      if (!rateLimiter.checkLimit(socket.id, "ACTIONS")) {
        return;
      }

      // Validate speaker ID
      const idValidation = validateId(data.speakerId);
      if (!idValidation.valid) return;

      // Find the speaker and update pause state
      const speaker = gameState.obstacles.find(
        (obs) => obs.id === idValidation.sanitized
      );

      if (speaker) {
        speaker.musicIsPaused = true;
        speaker.musicPausedTime = Date.now();
        // Save to database
        await saveObstacle(speaker);
      }

      // Broadcast to ALL clients (including sender for confirmation)
      io.emit("speakerMusicPaused", {
        speakerId: idValidation.sanitized,
      });

      console.log(`⏸️ Speaker ${idValidation.sanitized} paused`);
    } catch (error) {
      console.error("❌ Error pausing speaker music:", error);
    }
  });

  // Resume speaker music
  socket.on("resumeSpeakerMusic", async (data) => {
    try {
      // Rate limiting
      if (!rateLimiter.checkLimit(socket.id, "ACTIONS")) {
        return;
      }

      // Validate speaker ID
      const idValidation = validateId(data.speakerId);
      if (!idValidation.valid) return;

      // Find the speaker and update pause state
      const speaker = gameState.obstacles.find(
        (obs) => obs.id === idValidation.sanitized
      );

      if (speaker) {
        speaker.musicIsPaused = false;
        speaker.musicPausedTime = null;
        // Save to database
        await saveObstacle(speaker);
      }

      // Broadcast to ALL clients (including sender for confirmation)
      io.emit("speakerMusicResumed", {
        speakerId: idValidation.sanitized,
      });

      console.log(`▶️ Speaker ${idValidation.sanitized} resumed`);
    } catch (error) {
      console.error("❌ Error resuming speaker music:", error);
    }
  });

  // Change speaker volume
  socket.on("changeSpeakerVolume", async (data) => {
    try {
      // Rate limiting
      if (!rateLimiter.checkLimit(socket.id, "ACTIONS")) {
        return;
      }

      // Validate speaker ID
      const idValidation = validateId(data.speakerId);
      if (!idValidation.valid) return;

      // Validate volume (0-100)
      const volume = Math.max(0, Math.min(100, parseInt(data.volume) || 70));

      // Find the speaker and update volume
      const speaker = gameState.obstacles.find(
        (obs) => obs.id === idValidation.sanitized
      );

      if (speaker) {
        speaker.musicVolume = volume;
        // Save to database
        await saveObstacle(speaker);
      }

      // Broadcast to ALL clients (including sender for confirmation)
      io.emit("speakerVolumeChanged", {
        speakerId: idValidation.sanitized,
        volume: volume,
      });

      console.log(`🔊 Speaker ${idValidation.sanitized} volume: ${volume}%`);
    } catch (error) {
      console.error("❌ Error changing speaker volume:", error);
    }
  });

  // ============================================
  // SPEAKER CONNECTIONS
  // ============================================

  // Handle connecting two speakers
  socket.on("connectSpeakers", async (data) => {
    try {
      // Rate limiting (use ACTION limit)
      if (!rateLimiter.checkLimit(socket.id, "ACTIONS")) {
        return;
      }

      const { speaker1, speaker2 } = data;

      // Validate IDs
      const id1Validation = validateId(speaker1);
      const id2Validation = validateId(speaker2);
      if (!id1Validation.valid || !id2Validation.valid) return;

      // Save to database
      await saveSpeakerConnection(speaker1, speaker2);

      // Find the speakers
      const speakerObj1 = gameState.obstacles.find(
        (obs) => obs.id === speaker1
      );
      const speakerObj2 = gameState.obstacles.find(
        (obs) => obs.id === speaker2
      );

      // If one speaker is playing music, sync to the other
      if (speakerObj1 && speakerObj2) {
        if (speakerObj1.musicIsPlaying && speakerObj1.musicCurrentSong) {
          // Sync speaker1's music to speaker2
          speakerObj2.musicCurrentSong = speakerObj1.musicCurrentSong;
          speakerObj2.musicIsPlaying = speakerObj1.musicIsPlaying;
          speakerObj2.musicStartTime = speakerObj1.musicStartTime;
          speakerObj2.musicIsPaused = speakerObj1.musicIsPaused;
          speakerObj2.musicPausedTime = speakerObj1.musicPausedTime;
          speakerObj2.musicVolume = speakerObj1.musicVolume;
          await saveObstacle(speakerObj2);
          console.log(`🎵 Synced music from ${speaker1} to ${speaker2}`);
        } else if (speakerObj2.musicIsPlaying && speakerObj2.musicCurrentSong) {
          // Sync speaker2's music to speaker1
          speakerObj1.musicCurrentSong = speakerObj2.musicCurrentSong;
          speakerObj1.musicIsPlaying = speakerObj2.musicIsPlaying;
          speakerObj1.musicStartTime = speakerObj2.musicStartTime;
          speakerObj1.musicIsPaused = speakerObj2.musicIsPaused;
          speakerObj1.musicPausedTime = speakerObj2.musicPausedTime;
          speakerObj1.musicVolume = speakerObj2.musicVolume;
          await saveObstacle(speakerObj1);
          console.log(`🎵 Synced music from ${speaker2} to ${speaker1}`);
        }
      }

      // Broadcast to OTHER clients
      socket.broadcast.emit("speakersConnected", { speaker1, speaker2 });

      console.log(`🔌 Connected speakers: ${speaker1} ↔ ${speaker2}`);
    } catch (error) {
      console.error("❌ Error connecting speakers:", error);
    }
  });

  // Handle disconnecting two speakers
  socket.on("disconnectSpeakers", async (data) => {
    try {
      // Rate limiting (use ACTION limit)
      if (!rateLimiter.checkLimit(socket.id, "ACTIONS")) {
        return;
      }

      const { speaker1, speaker2 } = data;

      // Validate IDs
      const id1Validation = validateId(speaker1);
      const id2Validation = validateId(speaker2);
      if (!id1Validation.valid || !id2Validation.valid) return;

      // Delete from database
      await deleteSpeakerConnection(speaker1, speaker2);

      // Broadcast to OTHER clients
      socket.broadcast.emit("speakersDisconnected", { speaker1, speaker2 });

      console.log(`🔌 Disconnected speakers: ${speaker1} ↔ ${speaker2}`);
    } catch (error) {
      console.error("❌ Error disconnecting speakers:", error);
    }
  });

  // Send speaker connections when player connects
  socket.on("requestConnectionsSync", async () => {
    try {
      const connections = await loadSpeakerConnections();
      socket.emit("connectionsStateSync", connections);
      console.log(
        `🔌 Sent connections sync to ${socket.id}: ${connections.length} connections`
      );
    } catch (error) {
      console.error("❌ Error sending connections sync:", error);
    }
  });

  // Handle host status request
  socket.on("requestHostStatus", () => {
    if (!isAuthenticated) return;

    const players = Array.from(gameState.players.keys());
    const hostPlayerId = players[0];
    const isHost = socket.id === hostPlayerId;

    socket.emit("hostStatus", { isHost });

    if (isHost) {
      console.log(`👑 Player ${socket.id} is the HOST (controls cats)`);
    }
  });

  // Handle cat position updates
  socket.on("updateCatPositions", (cats) => {
    if (!isAuthenticated) return;

    // Only update if we received valid cat data
    if (!cats || !Array.isArray(cats)) return;

    // Only allow the first connected player (host) to update cat positions
    const players = Array.from(gameState.players.keys());
    const hostPlayerId = players[0];

    if (socket.id !== hostPlayerId) {
      // Not the host, ignore update
      return;
    }

    // Update server cat state (this becomes the source of truth)
    gameState.cats = cats;

    // Broadcast to all OTHER clients (not the sender) so they stay in sync
    socket.broadcast.emit("catPositionsUpdated", {
      cats: cats,
    });

    // Log occasionally to avoid spam
    if (Math.random() < 0.05) {
      console.log(`🐱 Updated cat positions: ${cats.length} cats`);
    }
  });

  // Debug toggle for pathfinding
  socket.on("togglePathDebug", () => {
    if (!isAuthenticated) return;
    
    const player = gameState.players.get(socket.id);
    if (!player) return;
    
    player.debugPath = !player.debugPath;
    console.log(`🐛 Pathfinding debug ${player.debugPath ? 'ENABLED' : 'DISABLED'} for ${socket.id}`);
    
    io.to(socket.id).emit("pathDebugToggled", { enabled: player.debugPath });
  });

  socket.on("disconnect", () => {
    console.log(`Player disconnected: ${socket.id}`);
    gameState.players.delete(socket.id);
    rateLimiter.clearPlayer(socket.id); // Clean up rate limiter data
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

    // Load world settings and update validation bounds
    const worldSettings = await getWorldSettings();
    updateWorldBounds(worldSettings.platformSize);

    // Recreate pathfinder with loaded obstacles
    pathfinder.obstacles = gameState.obstacles;

    // Start HTTP server
    httpServer.listen(PORT, () => {
      console.log(`🎮 Game server running on http://localhost:${PORT}`);
      console.log(`📡 WebSocket server ready for connections`);
      console.log(`💾 Database persistence enabled`);
      console.log(`🔒 CORS Configuration:`);
      console.log(`   Environment: ${process.env.NODE_ENV || "development"}`);
      if (allowedOrigins === false) {
        console.log(`   ⚠️  WARNING: No allowed origins configured!`);
      } else {
        console.log(`   Allowed origins: ${allowedOrigins.join(", ")}`);
      }
    });
  } catch (error) {
    console.error("❌ Failed to start server:", error);
    process.exit(1);
  }
}

startServer();
