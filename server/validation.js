/**
 * Input Validation and Sanitization Module
 * Protects against malicious input, cheating, and data corruption
 */

// Configuration constants
export const VALIDATION_RULES = {
  // World boundaries
  WORLD_BOUNDS: 20,
  MAX_WORLD_BOUNDS: 50,

  // Player constraints
  PLAYER_NAME_MIN_LENGTH: 1,
  PLAYER_NAME_MAX_LENGTH: 20,
  PLAYER_SKIN_MIN: 0,
  PLAYER_SKIN_MAX: 17, // 18 character models (a-r)
  PLAYER_MAX_SPEED: 0.5, // Maximum movement per update to prevent teleporting
  PLAYER_MIN_DIMENSION: 0.1,
  PLAYER_MAX_DIMENSION: 5.0,

  // Object constraints
  OBSTACLE_NAME_MAX_LENGTH: 50,
  OBSTACLE_MIN_DIMENSION: 0.001, // Lowered to allow thin objects like rugs
  OBSTACLE_MAX_DIMENSION: 50.0, // Increased for large furniture models
  OBSTACLE_MIN_SCALE: 0.1,
  OBSTACLE_MAX_SCALE: 10.0,
  MAX_OBSTACLES: parseInt(process.env.MAX_OBSTACLES) || 2000, // Increased for detailed restaurants

  FOOD_NAME_MAX_LENGTH: 50,
  FOOD_MIN_DIMENSION: 0.1,
  FOOD_MAX_DIMENSION: 20.0, // Increased for large food models
  FOOD_MIN_SCALE: 0.1,
  FOOD_MAX_SCALE: 5.0,
  MAX_FOOD_ITEMS: parseInt(process.env.MAX_FOOD_ITEMS) || 3000, // Increased for active kitchens

  // Rate limiting (per player, per timeframe)
  RATE_LIMITS: {
    MOVE_COMMANDS: { max: 30, window: 1000 }, // 30 moves per second
    SPAWN_OBSTACLE: { max: 5, window: 1000 }, // 5 spawns per second
    SPAWN_FOOD: { max: 10, window: 1000 }, // 10 food spawns per second
    UPDATE_OBSTACLE: { max: 20, window: 1000 }, // 20 updates per second
    UPDATE_FOOD: { max: 30, window: 1000 }, // 30 food updates per second
    DELETE_ACTIONS: { max: 10, window: 1000 }, // 10 deletes per second
    EMOTES: { max: 5, window: 2000 }, // 5 emotes per 2 seconds
    ACTIONS: { max: 10, window: 1000 }, // 10 actions per second
    SIT_ACTIONS: { max: 5, window: 1000 }, // 5 sit/stand per second
  },
};

/**
 * Sanitize string input - removes dangerous characters
 */
export const sanitizeString = (input, maxLength = 100) => {
  if (typeof input !== "string") {
    return "";
  }

  // Remove any HTML tags, scripts, and dangerous characters
  let sanitized = input
    .replace(/<[^>]*>/g, "") // Remove HTML tags
    .replace(/[<>\"'`]/g, "") // Remove dangerous characters
    .replace(/\\/g, "") // Remove backslashes
    .replace(/\n|\r/g, "") // Remove newlines
    .trim();

  // Truncate to max length
  if (sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength);
  }

  return sanitized;
};

/**
 * Validate and sanitize player name
 */
export const validatePlayerName = (name) => {
  if (!name || typeof name !== "string") {
    return {
      valid: false,
      error: "Player name is required",
      sanitized: "Player",
    };
  }

  const sanitized = sanitizeString(
    name,
    VALIDATION_RULES.PLAYER_NAME_MAX_LENGTH
  );

  if (sanitized.length < VALIDATION_RULES.PLAYER_NAME_MIN_LENGTH) {
    return {
      valid: false,
      error: "Player name too short",
      sanitized: "Player",
    };
  }

  return { valid: true, sanitized };
};

/**
 * Validate skin index
 */
export const validateSkinIndex = (skinIndex) => {
  const index = parseInt(skinIndex, 10);

  if (
    isNaN(index) ||
    index < VALIDATION_RULES.PLAYER_SKIN_MIN ||
    index > VALIDATION_RULES.PLAYER_SKIN_MAX
  ) {
    return {
      valid: false,
      error: `Skin index must be between ${VALIDATION_RULES.PLAYER_SKIN_MIN} and ${VALIDATION_RULES.PLAYER_SKIN_MAX}`,
      sanitized: 0,
    };
  }

  return { valid: true, sanitized: index };
};

/**
 * Validate coordinates (x, y, z)
 */
export const validateCoordinates = (
  x,
  y,
  z,
  bounds = VALIDATION_RULES.WORLD_BOUNDS
) => {
  const coords = {
    x: parseFloat(x),
    y: parseFloat(y),
    z: parseFloat(z),
  };

  // Check if values are valid numbers
  if (isNaN(coords.x) || isNaN(coords.y) || isNaN(coords.z)) {
    return {
      valid: false,
      error: "Invalid coordinates: not a number",
      sanitized: { x: 0, y: 0, z: 0 },
    };
  }

  // Check for Infinity or extreme values
  if (
    !isFinite(coords.x) ||
    !isFinite(coords.y) ||
    !isFinite(coords.z) ||
    Math.abs(coords.x) > VALIDATION_RULES.MAX_WORLD_BOUNDS ||
    Math.abs(coords.y) > VALIDATION_RULES.MAX_WORLD_BOUNDS ||
    Math.abs(coords.z) > VALIDATION_RULES.MAX_WORLD_BOUNDS
  ) {
    return {
      valid: false,
      error: "Coordinates out of world bounds",
      sanitized: { x: 0, y: 0, z: 0 },
    };
  }

  // Clamp to world bounds
  coords.x = Math.max(-bounds, Math.min(bounds, coords.x));
  coords.y = Math.max(-bounds, Math.min(bounds, coords.y));
  coords.z = Math.max(-bounds, Math.min(bounds, coords.z));

  return { valid: true, sanitized: coords };
};

/**
 * Validate player movement (prevent teleporting)
 */
export const validatePlayerMovement = (
  currentPos,
  targetPos,
  maxSpeed = VALIDATION_RULES.PLAYER_MAX_SPEED
) => {
  const distance = Math.sqrt(
    Math.pow(targetPos.x - currentPos.x, 2) +
      Math.pow(targetPos.y - currentPos.y, 2) +
      Math.pow(targetPos.z - currentPos.z, 2)
  );

  if (distance > maxSpeed) {
    return {
      valid: false,
      error: `Movement too fast: ${distance.toFixed(2)} > ${maxSpeed}`,
      distance,
    };
  }

  return { valid: true, distance };
};

/**
 * Validate dimensions (width, height, depth)
 */
export const validateDimensions = (width, height, depth, minSize, maxSize) => {
  const dims = {
    width: parseFloat(width),
    height: parseFloat(height),
    depth: parseFloat(depth),
  };

  if (isNaN(dims.width) || isNaN(dims.height) || isNaN(dims.depth)) {
    return {
      valid: false,
      error: "Invalid dimensions: not a number",
      sanitized: { width: 1, height: 1, depth: 1 },
    };
  }

  if (
    dims.width < minSize ||
    dims.height < minSize ||
    dims.depth < minSize ||
    dims.width > maxSize ||
    dims.height > maxSize ||
    dims.depth > maxSize
  ) {
    return {
      valid: false,
      error: `Dimensions must be between ${minSize} and ${maxSize}`,
      sanitized: {
        width: Math.max(minSize, Math.min(maxSize, dims.width)),
        height: Math.max(minSize, Math.min(maxSize, dims.height)),
        depth: Math.max(minSize, Math.min(maxSize, dims.depth)),
      },
    };
  }

  return { valid: true, sanitized: dims };
};

/**
 * Validate scale
 */
export const validateScale = (scale, minScale, maxScale) => {
  const s = parseFloat(scale);

  if (isNaN(s) || s < minScale || s > maxScale) {
    return {
      valid: false,
      error: `Scale must be between ${minScale} and ${maxScale}`,
      sanitized: Math.max(minScale, Math.min(maxScale, s || 1)),
    };
  }

  return { valid: true, sanitized: s };
};

/**
 * Validate rotation
 */
export const validateRotation = (rotation) => {
  const r = parseFloat(rotation);

  if (isNaN(r) || !isFinite(r)) {
    return { valid: false, error: "Invalid rotation", sanitized: 0 };
  }

  // Normalize rotation to 0-2π range
  const normalized = ((r % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

  return { valid: true, sanitized: normalized };
};

/**
 * Validate ID format
 */
export const validateId = (id, prefix = "") => {
  if (!id || typeof id !== "string") {
    return { valid: false, error: "Invalid ID format" };
  }

  // Sanitize ID - only allow alphanumeric, hyphens, and underscores
  const sanitized = id.replace(/[^a-zA-Z0-9\-_]/g, "");

  if (sanitized.length === 0 || sanitized.length > 100) {
    return { valid: false, error: "Invalid ID length", sanitized: "" };
  }

  if (prefix && !sanitized.startsWith(prefix)) {
    return { valid: false, error: `ID must start with ${prefix}`, sanitized };
  }

  return { valid: true, sanitized };
};

/**
 * Validate obstacle data
 */
export const validateObstacleData = (data) => {
  const errors = [];
  const sanitized = {};

  // Validate ID
  const idValidation = validateId(data.id);
  if (!idValidation.valid) {
    errors.push(`ID: ${idValidation.error}`);
    return { valid: false, errors, sanitized: null };
  }
  sanitized.id = idValidation.sanitized;

  // Validate name
  sanitized.name = sanitizeString(
    data.name || data.id,
    VALIDATION_RULES.OBSTACLE_NAME_MAX_LENGTH
  );

  // Validate type
  sanitized.type = sanitizeString(data.type || "furniture", 50);

  // Validate coordinates
  const coordsValidation = validateCoordinates(data.x, data.y, data.z);
  if (!coordsValidation.valid) {
    errors.push(`Coordinates: ${coordsValidation.error}`);
  }
  Object.assign(sanitized, coordsValidation.sanitized);

  // Validate dimensions
  const dimsValidation = validateDimensions(
    data.width,
    data.height,
    data.depth,
    VALIDATION_RULES.OBSTACLE_MIN_DIMENSION,
    VALIDATION_RULES.OBSTACLE_MAX_DIMENSION
  );
  if (!dimsValidation.valid) {
    errors.push(`Dimensions: ${dimsValidation.error}`);
  }
  Object.assign(sanitized, dimsValidation.sanitized);

  // Validate scale
  const scaleValidation = validateScale(
    data.scale || 1.0,
    VALIDATION_RULES.OBSTACLE_MIN_SCALE,
    VALIDATION_RULES.OBSTACLE_MAX_SCALE
  );
  if (!scaleValidation.valid) {
    errors.push(`Scale: ${scaleValidation.error}`);
  }
  sanitized.scale = scaleValidation.sanitized;

  // Validate rotation
  const rotationValidation = validateRotation(data.rotation || 0);
  if (!rotationValidation.valid) {
    errors.push(`Rotation: ${rotationValidation.error}`);
  }
  sanitized.rotation = rotationValidation.sanitized;

  // Validate model name
  sanitized.model = data.model ? sanitizeString(data.model, 100) : null;

  // Validate isPassthrough
  sanitized.isPassthrough = Boolean(data.isPassthrough);

  return { valid: errors.length === 0, errors, sanitized };
};

/**
 * Validate food item data
 */
export const validateFoodData = (data) => {
  const errors = [];
  const sanitized = {};

  // Validate ID
  const idValidation = validateId(data.id);
  if (!idValidation.valid) {
    errors.push(`ID: ${idValidation.error}`);
    return { valid: false, errors, sanitized: null };
  }
  sanitized.id = idValidation.sanitized;

  // Validate name
  sanitized.name = sanitizeString(
    data.name || data.id,
    VALIDATION_RULES.FOOD_NAME_MAX_LENGTH
  );

  // Validate coordinates
  const coordsValidation = validateCoordinates(data.x, data.y, data.z);
  if (!coordsValidation.valid) {
    errors.push(`Coordinates: ${coordsValidation.error}`);
  }
  Object.assign(sanitized, coordsValidation.sanitized);

  // Validate dimensions
  const dimsValidation = validateDimensions(
    data.width || 1.0,
    data.height || 1.0,
    data.depth || 1.0,
    VALIDATION_RULES.FOOD_MIN_DIMENSION,
    VALIDATION_RULES.FOOD_MAX_DIMENSION
  );
  if (!dimsValidation.valid) {
    errors.push(`Dimensions: ${dimsValidation.error}`);
  }
  Object.assign(sanitized, dimsValidation.sanitized);

  // Validate scale
  const scaleValidation = validateScale(
    data.scale || 1.0,
    VALIDATION_RULES.FOOD_MIN_SCALE,
    VALIDATION_RULES.FOOD_MAX_SCALE
  );
  if (!scaleValidation.valid) {
    errors.push(`Scale: ${scaleValidation.error}`);
  }
  sanitized.scale = scaleValidation.sanitized;

  return { valid: errors.length === 0, errors, sanitized };
};

/**
 * Rate Limiter Class
 * Tracks actions per player and enforces limits
 */
export class RateLimiter {
  constructor() {
    // Map of playerId -> action -> timestamps array
    this.actions = new Map();
  }

  /**
   * Check if action is allowed for player
   * @param {string} playerId - Player's socket ID
   * @param {string} actionType - Type of action (e.g., 'MOVE_COMMANDS', 'SPAWN_OBSTACLE')
   * @returns {boolean} - Whether action is allowed
   */
  checkLimit(playerId, actionType) {
    const limit = VALIDATION_RULES.RATE_LIMITS[actionType];
    if (!limit) {
      console.warn(`⚠️ No rate limit defined for action: ${actionType}`);
      return true;
    }

    const now = Date.now();

    // Initialize player tracking if needed
    if (!this.actions.has(playerId)) {
      this.actions.set(playerId, new Map());
    }

    const playerActions = this.actions.get(playerId);

    // Initialize action tracking if needed
    if (!playerActions.has(actionType)) {
      playerActions.set(actionType, []);
    }

    const timestamps = playerActions.get(actionType);

    // Remove old timestamps outside the window
    const cutoff = now - limit.window;
    while (timestamps.length > 0 && timestamps[0] < cutoff) {
      timestamps.shift();
    }

    // Check if limit exceeded
    if (timestamps.length >= limit.max) {
      return false;
    }

    // Add new timestamp
    timestamps.push(now);
    return true;
  }

  /**
   * Get current rate limit status for player
   */
  getStatus(playerId, actionType) {
    const limit = VALIDATION_RULES.RATE_LIMITS[actionType];
    if (!limit) return { current: 0, max: 0, remaining: 0 };

    const playerActions = this.actions.get(playerId);
    if (!playerActions || !playerActions.has(actionType)) {
      return { current: 0, max: limit.max, remaining: limit.max };
    }

    const timestamps = playerActions.get(actionType);
    const now = Date.now();
    const cutoff = now - limit.window;

    // Count valid timestamps
    const current = timestamps.filter((t) => t >= cutoff).length;

    return {
      current,
      max: limit.max,
      remaining: Math.max(0, limit.max - current),
    };
  }

  /**
   * Clear rate limits for a player (e.g., on disconnect)
   */
  clearPlayer(playerId) {
    this.actions.delete(playerId);
  }

  /**
   * Clean up old entries periodically
   */
  cleanup() {
    const now = Date.now();
    const maxWindow = Math.max(
      ...Object.values(VALIDATION_RULES.RATE_LIMITS).map((l) => l.window)
    );

    for (const [playerId, playerActions] of this.actions.entries()) {
      for (const [actionType, timestamps] of playerActions.entries()) {
        const limit = VALIDATION_RULES.RATE_LIMITS[actionType];
        const cutoff = now - (limit?.window || maxWindow);

        // Remove old timestamps
        const filtered = timestamps.filter((t) => t >= cutoff);
        if (filtered.length === 0) {
          playerActions.delete(actionType);
        } else {
          playerActions.set(actionType, filtered);
        }
      }

      // Remove player if no actions tracked
      if (playerActions.size === 0) {
        this.actions.delete(playerId);
      }
    }
  }
}
