import pkg from "pg";
const { Pool } = pkg;

/**
 * Validate data types before database operations
 * Prevents type confusion and ensures data integrity
 */
const validateDatabaseTypes = {
  /**
   * Validate obstacle data types
   */
  obstacle: (obstacle) => {
    // Required fields type checks
    if (typeof obstacle.id !== "string" || obstacle.id.length === 0) {
      throw new Error(
        `Invalid obstacle.id type: expected non-empty string, got ${typeof obstacle.id}`
      );
    }
    if (typeof obstacle.name !== "string") {
      throw new Error(
        `Invalid obstacle.name type: expected string, got ${typeof obstacle.name}`
      );
    }
    if (typeof obstacle.type !== "string") {
      throw new Error(
        `Invalid obstacle.type type: expected string, got ${typeof obstacle.type}`
      );
    }

    // Numeric fields type checks
    const numericFields = [
      "x",
      "y",
      "z",
      "width",
      "height",
      "depth",
      "scale",
      "rotation",
    ];
    for (const field of numericFields) {
      const value = obstacle[field];
      if (typeof value !== "number" || !isFinite(value)) {
        throw new Error(
          `Invalid obstacle.${field} type: expected finite number, got ${typeof value} (${value})`
        );
      }
    }

    // Boolean field type check
    if (typeof obstacle.isPassthrough !== "boolean") {
      throw new Error(
        `Invalid obstacle.isPassthrough type: expected boolean, got ${typeof obstacle.isPassthrough}`
      );
    }

    // Optional string field
    if (
      obstacle.model !== null &&
      obstacle.model !== undefined &&
      typeof obstacle.model !== "string"
    ) {
      throw new Error(
        `Invalid obstacle.model type: expected string or null, got ${typeof obstacle.model}`
      );
    }

    return true;
  },

  /**
   * Validate food item data types
   */
  foodItem: (foodItem) => {
    // Required fields type checks
    if (typeof foodItem.id !== "string" || foodItem.id.length === 0) {
      throw new Error(
        `Invalid foodItem.id type: expected non-empty string, got ${typeof foodItem.id}`
      );
    }
    if (typeof foodItem.name !== "string") {
      throw new Error(
        `Invalid foodItem.name type: expected string, got ${typeof foodItem.name}`
      );
    }

    // Numeric fields type checks
    const numericFields = ["x", "y", "z", "scale", "width", "height", "depth"];
    for (const field of numericFields) {
      const value = foodItem[field];
      if (typeof value !== "number" || !isFinite(value)) {
        throw new Error(
          `Invalid foodItem.${field} type: expected finite number, got ${typeof value} (${value})`
        );
      }
    }

    return true;
  },

  /**
   * Validate ID for delete operations
   */
  id: (id) => {
    if (typeof id !== "string" || id.length === 0) {
      throw new Error(
        `Invalid id type: expected non-empty string, got ${typeof id}`
      );
    }
    // Check for SQL injection patterns (defense in depth)
    if (/['";\\-]/.test(id)) {
      throw new Error(`Invalid id format: contains dangerous characters`);
    }
    return true;
  },
};

// PostgreSQL connection pool
// Use DATABASE_URL if provided (for cloud deployments), otherwise use individual params
const poolConfig = process.env.DATABASE_URL
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl: {
        rejectUnauthorized: false, // Required for Render.com and most cloud databases
      },
    }
  : {
      // Fallback to individual params if DATABASE_URL not provided (local development)
      user: process.env.DB_USER || "postgres",
      host: process.env.DB_HOST || "localhost",
      database: process.env.DB_NAME || "supercooked",
      password: process.env.DB_PASSWORD || "postgres",
      port: process.env.DB_PORT || 5432,
    };

const pool = new Pool(poolConfig);

// Test database connection
pool.on("connect", () => {
  console.log("✅ Connected to PostgreSQL database");
});

pool.on("error", (err) => {
  console.error("❌ Unexpected database error:", err);
});

/**
 * Initialize database tables
 */
export async function initializeDatabase() {
  try {
    // Create obstacles table (furniture/tables)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS obstacles (
        id VARCHAR(255) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        type VARCHAR(50) NOT NULL DEFAULT 'furniture',
        x FLOAT NOT NULL,
        y FLOAT NOT NULL,
        z FLOAT NOT NULL,
        width FLOAT NOT NULL,
        height FLOAT NOT NULL,
        depth FLOAT NOT NULL,
        model VARCHAR(255),
        scale FLOAT DEFAULT 1.0,
        rotation FLOAT DEFAULT 0.0,
        is_passthrough BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create food_items table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS food_items (
        id VARCHAR(255) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        x FLOAT NOT NULL,
        y FLOAT NOT NULL,
        z FLOAT NOT NULL,
        scale FLOAT DEFAULT 1.0,
        width FLOAT DEFAULT 1.0,
        height FLOAT DEFAULT 1.0,
        depth FLOAT DEFAULT 1.0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Add columns to existing food_items table if they don't exist
    await pool.query(`
      ALTER TABLE food_items 
      ADD COLUMN IF NOT EXISTS width FLOAT DEFAULT 1.0,
      ADD COLUMN IF NOT EXISTS height FLOAT DEFAULT 1.0,
      ADD COLUMN IF NOT EXISTS depth FLOAT DEFAULT 1.0
    `);

    // Add is_passthrough column to obstacles table if it doesn't exist
    await pool.query(`
      ALTER TABLE obstacles 
      ADD COLUMN IF NOT EXISTS is_passthrough BOOLEAN DEFAULT false
    `);

    console.log("✅ Database tables initialized");
  } catch (error) {
    console.error("❌ Error initializing database:", error);
  }
}

/**
 * Load all obstacles from database
 */
export async function loadObstacles() {
  try {
    const result = await pool.query(
      "SELECT * FROM obstacles ORDER BY created_at"
    );
    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      type: row.type,
      x: parseFloat(row.x),
      y: parseFloat(row.y),
      z: parseFloat(row.z),
      width: parseFloat(row.width),
      height: parseFloat(row.height),
      depth: parseFloat(row.depth),
      model: row.model,
      scale: parseFloat(row.scale),
      rotation: parseFloat(row.rotation),
      isPassthrough: row.is_passthrough || false,
    }));
  } catch (error) {
    console.error("❌ Error loading obstacles:", error);
    return [];
  }
}

/**
 * Save or update an obstacle
 */
export async function saveObstacle(obstacle) {
  try {
    // Validate data types before database operation
    validateDatabaseTypes.obstacle(obstacle);

    const result = await pool.query(
      `
      INSERT INTO obstacles (id, name, type, x, y, z, width, height, depth, model, scale, rotation, is_passthrough, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, CURRENT_TIMESTAMP)
      ON CONFLICT (id) 
      DO UPDATE SET 
        x = $4, 
        y = $5, 
        z = $6, 
        width = $7, 
        height = $8, 
        depth = $9,
        model = $10,
        scale = $11,
        rotation = $12,
        is_passthrough = $13,
        updated_at = CURRENT_TIMESTAMP
      RETURNING id
    `,
      [
        obstacle.id,
        obstacle.name || obstacle.id,
        obstacle.type || "furniture",
        obstacle.x,
        obstacle.y,
        obstacle.z,
        obstacle.width,
        obstacle.height,
        obstacle.depth,
        obstacle.model || null,
        obstacle.scale || 1.0,
        obstacle.rotation || 0.0,
        obstacle.isPassthrough || false,
      ]
    );

    if (result.rows.length > 0) {
      console.log(
        `💾 Saved obstacle: ${obstacle.id} ${
          obstacle.isPassthrough ? "[PASSTHROUGH]" : ""
        }`
      );
      return true;
    } else {
      console.error(
        `❌ Failed to save obstacle: ${obstacle.id} - no rows returned`
      );
      return false;
    }
  } catch (error) {
    console.error(`❌ Error saving obstacle ${obstacle.id}:`, error.message);
    console.error(`   Data:`, JSON.stringify(obstacle, null, 2));
    return false;
  }
}

/**
 * Delete an obstacle
 */
export async function deleteObstacle(id) {
  try {
    // Validate ID type before database operation
    validateDatabaseTypes.id(id);

    await pool.query("DELETE FROM obstacles WHERE id = $1", [id]);
    console.log(`🗑️ Deleted obstacle: ${id}`);
    return true;
  } catch (error) {
    console.error("❌ Error deleting obstacle:", error);
    return false;
  }
}

/**
 * Load all food items from database
 */
export async function loadFoodItems() {
  try {
    const result = await pool.query(
      "SELECT * FROM food_items ORDER BY created_at"
    );
    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      x: parseFloat(row.x),
      y: parseFloat(row.y),
      z: parseFloat(row.z),
      scale: parseFloat(row.scale),
      width: parseFloat(row.width || 1.0),
      height: parseFloat(row.height || 1.0),
      depth: parseFloat(row.depth || 1.0),
    }));
  } catch (error) {
    console.error("❌ Error loading food items:", error);
    return [];
  }
}

/**
 * Save or update a food item
 */
export async function saveFoodItem(foodItem) {
  try {
    // Validate data types before database operation
    validateDatabaseTypes.foodItem(foodItem);

    const result = await pool.query(
      `
      INSERT INTO food_items (id, name, x, y, z, scale, width, height, depth, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP)
      ON CONFLICT (id) 
      DO UPDATE SET 
        x = $3, 
        y = $4, 
        z = $5, 
        scale = $6,
        width = $7,
        height = $8,
        depth = $9,
        updated_at = CURRENT_TIMESTAMP
      RETURNING id
    `,
      [
        foodItem.id,
        foodItem.name,
        foodItem.x,
        foodItem.y,
        foodItem.z,
        foodItem.scale || 1.0,
        foodItem.width || 1.0,
        foodItem.height || 1.0,
        foodItem.depth || 1.0,
      ]
    );

    if (result.rows.length > 0) {
      console.log(`💾 Saved food item: ${foodItem.id}`);
      return true;
    } else {
      console.error(
        `❌ Failed to save food item: ${foodItem.id} - no rows returned`
      );
      return false;
    }
  } catch (error) {
    console.error(`❌ Error saving food item ${foodItem.id}:`, error.message);
    console.error(`   Data:`, JSON.stringify(foodItem, null, 2));
    return false;
  }
}

/**
 * Delete a food item
 */
export async function deleteFoodItem(id) {
  try {
    // Validate ID type before database operation
    validateDatabaseTypes.id(id);

    await pool.query("DELETE FROM food_items WHERE id = $1", [id]);
    console.log(`🗑️ Deleted food item: ${id}`);
    return true;
  } catch (error) {
    console.error("❌ Error deleting food item:", error);
    return false;
  }
}

/**
 * Clear all objects (for reset)
 */
export async function clearAllObjects() {
  try {
    await pool.query("DELETE FROM obstacles");
    await pool.query("DELETE FROM food_items");
    console.log("🗑️ Cleared all objects from database");
    return true;
  } catch (error) {
    console.error("❌ Error clearing database:", error);
    return false;
  }
}

export default pool;
