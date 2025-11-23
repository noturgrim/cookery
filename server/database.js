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
    // Allow hyphens since UUIDs contain them, but block quotes, semicolons, and backslashes
    if (/['";\\]/.test(id)) {
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
      ssl:
        process.env.DB_SSL_DISABLED === "true"
          ? false // Completely disable SSL (local dev only)
          : {
              rejectUnauthorized:
                process.env.DB_SSL_REJECT_UNAUTHORIZED !== "false",
              // Only set to false if you trust your cloud provider and can't get valid certs
              // Better: Use CA certificate for production
              ...(process.env.DB_SSL_CA && {
                ca: process.env.DB_SSL_CA, // Path to CA certificate
              }),
            },
    }
  : {
      // Fallback to individual params if DATABASE_URL not provided (local development)
      user: process.env.DB_USER || "postgres",
      host: process.env.DB_HOST || "localhost",
      database: process.env.DB_NAME || "supercooked",
      password: process.env.DB_PASSWORD || "postgres",
      port: process.env.DB_PORT || 5432,
      // Local development usually doesn't need SSL
      ssl: false,
    };

const pool = new Pool(poolConfig);

// Test database connection
pool.on("connect", () => {
  console.log("✅ Connected to PostgreSQL database");
});

pool.on("error", (err) => {
  console.error("❌ Unexpected database error:", err);
});

const normalizePlatformNames = async () => {
  try {
    const duplicates = await pool.query(`
      SELECT LOWER(name) AS lname
      FROM platforms
      GROUP BY LOWER(name)
      HAVING COUNT(*) > 1
    `);

    for (const dup of duplicates.rows) {
      const { rows: platforms } = await pool.query(
        `
          SELECT id, name
          FROM platforms
          WHERE LOWER(name) = $1
          ORDER BY created_at ASC, id ASC
        `,
        [dup.lname]
      );

      if (platforms.length <= 1) {
        continue;
      }

      const baseName = platforms[0].name || "Platform";
      for (let i = 1; i < platforms.length; i++) {
        const platform = platforms[i];
        let suffix = platform.id.slice(-6).toUpperCase();
        let newName = `${baseName} #${suffix}`;
        let attempts = 0;

        while (attempts < 5) {
          const conflict = await pool.query(
            `
              SELECT 1
              FROM platforms
              WHERE LOWER(name) = LOWER($1)
                AND id <> $2
              LIMIT 1
            `,
            [newName, platform.id]
          );

          if (conflict.rowCount === 0) {
            break;
          }

          attempts += 1;
          suffix = `${platform.id.slice(-4)}${attempts}`;
          newName = `${baseName} #${suffix}`;
        }

        await pool.query(`UPDATE platforms SET name = $1 WHERE id = $2`, [
          newName,
          platform.id,
        ]);
        console.log(
          `✏️ Renamed duplicate platform "${platform.name}" -> "${newName}"`
        );
      }
    }
  } catch (error) {
    console.warn(
      "⚠️ Could not normalize duplicate platform names:",
      error.message
    );
  }
};

/**
 * Initialize database tables
 */
export async function initializeDatabase() {
  try {
    // Create users table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        username VARCHAR(50) UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        display_name VARCHAR(50) NOT NULL,
        skin_index INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_login TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create sessions table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        token VARCHAR(128) PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP NOT NULL,
        last_active TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create index on sessions for faster lookups
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)
    `);

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
        opacity FLOAT DEFAULT 1.0,
        music_current_song VARCHAR(255),
        music_is_playing BOOLEAN DEFAULT false,
        music_start_time BIGINT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Add music columns if they don't exist (for existing databases)
    await pool.query(`
      ALTER TABLE obstacles 
      ADD COLUMN IF NOT EXISTS music_current_song VARCHAR(255),
      ADD COLUMN IF NOT EXISTS music_is_playing BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS music_start_time BIGINT,
      ADD COLUMN IF NOT EXISTS music_is_paused BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS music_paused_time BIGINT,
      ADD COLUMN IF NOT EXISTS music_volume INTEGER DEFAULT 70
    `);

    // Create speaker connections table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS speaker_connections (
        id SERIAL PRIMARY KEY,
        speaker1_id VARCHAR(255) NOT NULL,
        speaker2_id VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(speaker1_id, speaker2_id),
        CONSTRAINT fk_speaker1 FOREIGN KEY (speaker1_id) REFERENCES obstacles(id) ON DELETE CASCADE,
        CONSTRAINT fk_speaker2 FOREIGN KEY (speaker2_id) REFERENCES obstacles(id) ON DELETE CASCADE
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
      ADD COLUMN IF NOT EXISTS depth FLOAT DEFAULT 1.0,
      ADD COLUMN IF NOT EXISTS platform_id VARCHAR(255)
    `);

    // Add is_passthrough column to obstacles table if it doesn't exist
    await pool.query(`
      ALTER TABLE obstacles 
      ADD COLUMN IF NOT EXISTS is_passthrough BOOLEAN DEFAULT false
    `);

    // Add opacity column to obstacles table if it doesn't exist
    await pool.query(`
      ALTER TABLE obstacles 
      ADD COLUMN IF NOT EXISTS opacity FLOAT DEFAULT 1.0
    `);

    // Add platform_id column to obstacles table if it doesn't exist
    await pool.query(`
      ALTER TABLE obstacles 
      ADD COLUMN IF NOT EXISTS platform_id VARCHAR(255)
    `);

    // Create world_time table (single row for global time state)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS world_time (
        id INTEGER PRIMARY KEY DEFAULT 1,
        game_time FLOAT NOT NULL DEFAULT 12.0,
        time_speed FLOAT NOT NULL DEFAULT 0.1,
        is_paused BOOLEAN DEFAULT false,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT single_row_check CHECK (id = 1)
      )
    `);

    // Insert default world time if not exists
    await pool.query(`
      INSERT INTO world_time (id, game_time, time_speed, is_paused)
      VALUES (1, 12.0, 0.1, false)
      ON CONFLICT (id) DO NOTHING
    `);

    // Create world_settings table (single row for global world configuration)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS world_settings (
        id INTEGER PRIMARY KEY DEFAULT 1,
        platform_size INTEGER NOT NULL DEFAULT 40,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT single_world_settings_check CHECK (id = 1),
        CONSTRAINT platform_size_range CHECK (platform_size >= 20 AND platform_size <= 200)
      )
    `);

    // Insert default world settings if not exists
    await pool.query(`
      INSERT INTO world_settings (id, platform_size)
      VALUES (1, 40)
      ON CONFLICT (id) DO NOTHING
    `);

    // Create platforms table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS platforms (
        id VARCHAR(255) PRIMARY KEY,
        owner_username VARCHAR(50) NOT NULL,
        name VARCHAR(100) NOT NULL,
        x FLOAT NOT NULL,
        y FLOAT NOT NULL,
        z FLOAT NOT NULL,
        size INTEGER NOT NULL DEFAULT 40,
        floor_texture VARCHAR(255) DEFAULT 'floor2.jpg',
        is_main BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT platform_size_range CHECK (size >= 20 AND size <= 200)
      )
    `);

    // Add missing columns to platforms table (comprehensive migration)
    await pool.query(`
      ALTER TABLE platforms 
      ADD COLUMN IF NOT EXISTS owner_username VARCHAR(50) DEFAULT 'unknown',
      ADD COLUMN IF NOT EXISTS name VARCHAR(100) DEFAULT 'Unnamed Platform',
      ADD COLUMN IF NOT EXISTS size INTEGER DEFAULT 40,
      ADD COLUMN IF NOT EXISTS floor_texture VARCHAR(255) DEFAULT 'floor2.jpg',
      ADD COLUMN IF NOT EXISTS is_main BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    `);

    // Remove the default constraints after adding columns
    await pool.query(`
      ALTER TABLE platforms 
      ALTER COLUMN owner_username DROP DEFAULT,
      ALTER COLUMN name DROP DEFAULT,
      ALTER COLUMN size DROP DEFAULT
    `);

    // Update existing platforms with NULL/missing values
    await pool.query(`
      UPDATE platforms 
      SET owner_username = 'system' 
      WHERE owner_username IS NULL OR owner_username = 'unknown'
    `);

    await pool.query(`
      UPDATE platforms 
      SET name = 'Platform ' || id 
      WHERE name IS NULL OR name = 'Unnamed Platform'
    `);

    await pool.query(`
      UPDATE platforms 
      SET size = 40 
      WHERE size IS NULL OR size = 0
    `);

    await normalizePlatformNames();

    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_platforms_name_unique
      ON platforms (LOWER(name))
    `);

    // Create bridges table (auto-generated walkways between platforms)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS bridges (
        id VARCHAR(255) PRIMARY KEY,
        platform1_id VARCHAR(255) NOT NULL,
        platform2_id VARCHAR(255) NOT NULL,
        start_x FLOAT NOT NULL,
        start_y FLOAT NOT NULL,
        start_z FLOAT NOT NULL,
        end_x FLOAT NOT NULL,
        end_y FLOAT NOT NULL,
        end_z FLOAT NOT NULL,
        width FLOAT DEFAULT 2.0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_platform1 FOREIGN KEY (platform1_id) REFERENCES platforms(id) ON DELETE CASCADE,
        CONSTRAINT fk_platform2 FOREIGN KEY (platform2_id) REFERENCES platforms(id) ON DELETE CASCADE,
        CONSTRAINT unique_bridge UNIQUE(platform1_id, platform2_id)
      )
    `);

    // Create platform_permissions table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS platform_permissions (
        id SERIAL PRIMARY KEY,
        platform_id VARCHAR(255) NOT NULL,
        username VARCHAR(50) NOT NULL,
        permission VARCHAR(20) NOT NULL DEFAULT 'view',
        granted_by VARCHAR(50) NOT NULL,
        granted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_platform FOREIGN KEY (platform_id) REFERENCES platforms(id) ON DELETE CASCADE,
        CONSTRAINT unique_platform_user UNIQUE(platform_id, username),
        CONSTRAINT valid_permission CHECK (permission IN ('view', 'edit', 'admin'))
      )
    `);

    // Add platform_id column to obstacles table if not exists
    await pool.query(`
      ALTER TABLE obstacles 
      ADD COLUMN IF NOT EXISTS platform_id VARCHAR(255)
    `);

    // Add platform_id column to food_items table if not exists
    await pool.query(`
      ALTER TABLE food_items 
      ADD COLUMN IF NOT EXISTS platform_id VARCHAR(255)
    `);

    // Insert default main platform if not exists (safe operation - ignore if exists or fails)
    try {
      await pool.query(`
        INSERT INTO platforms (id, owner_username, name, x, y, z, size, is_main)
        VALUES ('platform_main', 'system', 'Main Platform', 0, 0, 0, 40, true)
        ON CONFLICT (id) DO NOTHING
      `);
    } catch (insertError) {
      // Platform already exists or columns don't match - this is OK
      console.log(
        "ℹ️ Main platform already exists or column structure differs (this is normal)"
      );
    }

    // Update main platform size to match world_settings if they differ (safe operation)
    try {
      const worldSettings = await pool.query(
        `SELECT platform_size FROM world_settings WHERE id = 1`
      );
      if (worldSettings.rows.length > 0) {
        const currentSize = worldSettings.rows[0].platform_size;
        await pool.query(
          `UPDATE platforms 
           SET size = $1 
           WHERE id = 'platform_main' AND size != $1`,
          [currentSize]
        );
      }
    } catch (updateError) {
      // Update failed - this is OK, existing platforms will keep their size
      console.log(
        "ℹ️ Could not sync main platform size (this is normal for existing platforms)"
      );
    }

    // Create indexes for better performance (after tables and data exist)
    try {
      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_platforms_owner ON platforms(owner_username)
      `);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_obstacles_platform ON obstacles(platform_id)
      `);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_food_platform ON food_items(platform_id)
      `);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_permissions_platform ON platform_permissions(platform_id)
      `);
    } catch (indexError) {
      console.warn(
        "⚠️ Some indexes may already exist or failed to create:",
        indexError.message
      );
    }

    console.log("✅ Database tables initialized");
    console.log("   - users table ready");
    console.log("   - sessions table ready");
    console.log("   - obstacles table ready");
    console.log("   - food_items table ready");
    console.log("   - world_time table ready");
    console.log("   - world_settings table ready");
    console.log("   - platforms table ready");
    console.log("   - bridges table ready");
    console.log("   - platform_permissions table ready");
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
      opacity: parseFloat(row.opacity) || 1.0,
      musicCurrentSong: row.music_current_song || null,
      musicIsPlaying: row.music_is_playing || false,
      musicIsPaused: row.music_is_paused || false,
      musicVolume: parseInt(row.music_volume) || 70,
      musicStartTime: row.music_start_time
        ? parseInt(row.music_start_time)
        : null,
      musicPausedTime: row.music_paused_time
        ? parseInt(row.music_paused_time)
        : null,
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
      INSERT INTO obstacles (id, name, type, x, y, z, width, height, depth, model, scale, rotation, is_passthrough, opacity, music_current_song, music_is_playing, music_start_time, music_is_paused, music_paused_time, music_volume, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, CURRENT_TIMESTAMP)
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
        opacity = $14,
        music_current_song = $15,
        music_is_playing = $16,
        music_start_time = $17,
        music_is_paused = $18,
        music_paused_time = $19,
        music_volume = $20,
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
        obstacle.opacity || 1.0,
        obstacle.musicCurrentSong || null,
        obstacle.musicIsPlaying || false,
        obstacle.musicStartTime || null,
        obstacle.musicIsPaused || false,
        obstacle.musicPausedTime || null,
        obstacle.musicVolume || 70,
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

/**
 * Create a new user
 */
export async function createUser(
  username,
  passwordHash,
  displayName,
  skinIndex = 0
) {
  try {
    // Validate inputs
    if (
      typeof username !== "string" ||
      username.length < 3 ||
      username.length > 50
    ) {
      throw new Error("Username must be 3-50 characters");
    }
    if (typeof passwordHash !== "string" || passwordHash.length === 0) {
      throw new Error("Password hash is required");
    }
    if (typeof displayName !== "string" || displayName.length === 0) {
      throw new Error("Display name is required");
    }

    const result = await pool.query(
      `INSERT INTO users (username, password_hash, display_name, skin_index)
       VALUES ($1, $2, $3, $4)
       RETURNING id, username, display_name, skin_index, created_at`,
      [
        username.toLowerCase().trim(),
        passwordHash,
        displayName.trim(),
        skinIndex,
      ]
    );

    if (result.rows.length > 0) {
      console.log(`👤 Created user: ${username}`);
      return result.rows[0];
    }
    return null;
  } catch (error) {
    if (error.code === "23505") {
      // Unique constraint violation
      throw new Error("Username already exists");
    }
    console.error("❌ Error creating user:", error);
    throw error;
  }
}

/**
 * Find user by username
 */
export async function findUserByUsername(username) {
  try {
    if (typeof username !== "string" || username.length === 0) {
      return null;
    }

    const result = await pool.query(
      `SELECT id, username, password_hash, display_name, skin_index, created_at, last_login
       FROM users
       WHERE username = $1`,
      [username.toLowerCase().trim()]
    );

    return result.rows.length > 0 ? result.rows[0] : null;
  } catch (error) {
    console.error("❌ Error finding user:", error);
    return null;
  }
}

/**
 * Update user's last login time
 */
export async function updateLastLogin(userId) {
  try {
    await pool.query(
      `UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1`,
      [userId]
    );
    return true;
  } catch (error) {
    console.error("❌ Error updating last login:", error);
    return false;
  }
}

/**
 * Create a new session
 */
export async function createSession(token, userId, expiresInHours = 168) {
  try {
    // Validate inputs
    if (typeof token !== "string" || token.length === 0) {
      throw new Error("Session token is required");
    }
    if (typeof userId !== "string" || userId.length === 0) {
      throw new Error("User ID is required");
    }

    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + expiresInHours);

    const result = await pool.query(
      `INSERT INTO sessions (token, user_id, expires_at)
       VALUES ($1, $2, $3)
       RETURNING token, user_id, created_at, expires_at`,
      [token, userId, expiresAt]
    );

    if (result.rows.length > 0) {
      console.log(`🎫 Created session for user: ${userId}`);
      return result.rows[0];
    }
    return null;
  } catch (error) {
    console.error("❌ Error creating session:", error);
    throw error;
  }
}

/**
 * Find session by token and validate expiration
 */
export async function findSession(token) {
  try {
    if (typeof token !== "string" || token.length === 0) {
      return null;
    }

    const result = await pool.query(
      `SELECT s.token, s.user_id, s.expires_at, u.username, u.display_name, u.skin_index
       FROM sessions s
       JOIN users u ON s.user_id = u.id
       WHERE s.token = $1 AND s.expires_at > CURRENT_TIMESTAMP`,
      [token]
    );

    if (result.rows.length > 0) {
      // Update last active time
      await pool.query(
        `UPDATE sessions SET last_active = CURRENT_TIMESTAMP WHERE token = $1`,
        [token]
      );
      return result.rows[0];
    }
    return null;
  } catch (error) {
    console.error("❌ Error finding session:", error);
    return null;
  }
}

/**
 * Delete a session (logout)
 */
export async function deleteSession(token) {
  try {
    if (typeof token !== "string" || token.length === 0) {
      return false;
    }

    await pool.query(`DELETE FROM sessions WHERE token = $1`, [token]);
    console.log(`🚪 Deleted session: ${token.substring(0, 10)}...`);
    return true;
  } catch (error) {
    console.error("❌ Error deleting session:", error);
    return false;
  }
}

/**
 * Delete all sessions for a user
 */
export async function deleteUserSessions(userId) {
  try {
    await pool.query(`DELETE FROM sessions WHERE user_id = $1`, [userId]);
    console.log(`🚪 Deleted all sessions for user: ${userId}`);
    return true;
  } catch (error) {
    console.error("❌ Error deleting user sessions:", error);
    return false;
  }
}

/**
 * Clean up expired sessions
 */
export async function cleanupExpiredSessions() {
  try {
    const result = await pool.query(
      `DELETE FROM sessions WHERE expires_at < CURRENT_TIMESTAMP`
    );
    const count = result.rowCount || 0;
    if (count > 0) {
      console.log(`🧹 Cleaned up ${count} expired sessions`);
    }
    return count;
  } catch (error) {
    console.error("❌ Error cleaning up sessions:", error);
    return 0;
  }
}

/**
 * Get world time state
 */
export async function getWorldTime() {
  try {
    const result = await pool.query(
      `SELECT game_time, time_speed, is_paused, updated_at FROM world_time WHERE id = 1`
    );

    if (result.rows.length > 0) {
      return {
        currentTime: parseFloat(result.rows[0].game_time),
        timeSpeed: parseFloat(result.rows[0].time_speed),
        isPaused: result.rows[0].is_paused,
        updatedAt: result.rows[0].updated_at,
      };
    }

    // Return default if not found
    return {
      currentTime: 12.0,
      timeSpeed: 0.1,
      isPaused: false,
      updatedAt: new Date(),
    };
  } catch (error) {
    console.error("❌ Error getting world time:", error);
    return {
      currentTime: 12.0,
      timeSpeed: 0.1,
      isPaused: false,
      updatedAt: new Date(),
    };
  }
}

/**
 * Update world time state
 */
export async function updateWorldTime(currentTime, timeSpeed, isPaused) {
  try {
    // Validate inputs
    if (typeof currentTime !== "number" || !isFinite(currentTime)) {
      throw new Error("Invalid currentTime: must be a finite number");
    }
    if (typeof timeSpeed !== "number" || !isFinite(timeSpeed)) {
      throw new Error("Invalid timeSpeed: must be a finite number");
    }
    if (typeof isPaused !== "boolean") {
      throw new Error("Invalid isPaused: must be a boolean");
    }

    // Normalize time to 0-24 range
    const normalizedTime = ((currentTime % 24) + 24) % 24;

    await pool.query(
      `UPDATE world_time 
       SET game_time = $1, time_speed = $2, is_paused = $3, updated_at = CURRENT_TIMESTAMP
       WHERE id = 1`,
      [normalizedTime, timeSpeed, isPaused]
    );

    return true;
  } catch (error) {
    console.error("❌ Error updating world time:", error.message);
    return false;
  }
}

/**
 * Get world settings (platform size, etc.)
 */
export async function getWorldSettings() {
  try {
    const result = await pool.query(
      `SELECT platform_size, updated_at FROM world_settings WHERE id = 1`
    );

    if (result.rows.length > 0) {
      return {
        platformSize: parseInt(result.rows[0].platform_size),
        updatedAt: result.rows[0].updated_at,
      };
    }

    // Return default if not found
    return {
      platformSize: 40,
      updatedAt: new Date(),
    };
  } catch (error) {
    console.error("❌ Error getting world settings:", error);
    return {
      platformSize: 40,
      updatedAt: new Date(),
    };
  }
}

/**
 * Update world settings (platform size)
 */
export async function updateWorldSettings(platformSize) {
  try {
    // Validate inputs
    if (typeof platformSize !== "number" || !Number.isInteger(platformSize)) {
      throw new Error("Invalid platformSize: must be an integer");
    }
    if (platformSize < 20 || platformSize > 200) {
      throw new Error("Invalid platformSize: must be between 20 and 200");
    }

    await pool.query(
      `UPDATE world_settings 
       SET platform_size = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = 1`,
      [platformSize]
    );

    console.log(`🌍 Updated platform size to: ${platformSize}`);
    return true;
  } catch (error) {
    console.error("❌ Error updating world settings:", error.message);
    return false;
  }
}

/**
 * Load all speaker connections
 */
export async function loadSpeakerConnections() {
  try {
    const result = await pool.query(
      "SELECT * FROM speaker_connections ORDER BY created_at"
    );
    return result.rows.map((row) => ({
      speaker1: row.speaker1_id,
      speaker2: row.speaker2_id,
    }));
  } catch (error) {
    console.error("❌ Error loading speaker connections:", error);
    return [];
  }
}

/**
 * Save speaker connection
 */
export async function saveSpeakerConnection(speaker1Id, speaker2Id) {
  try {
    // Ensure consistent ordering (smaller ID first)
    const [id1, id2] =
      speaker1Id < speaker2Id
        ? [speaker1Id, speaker2Id]
        : [speaker2Id, speaker1Id];

    await pool.query(
      `INSERT INTO speaker_connections (speaker1_id, speaker2_id)
       VALUES ($1, $2)
       ON CONFLICT (speaker1_id, speaker2_id) DO NOTHING`,
      [id1, id2]
    );

    console.log(`🔌 Saved speaker connection: ${id1} ↔ ${id2}`);
    return true;
  } catch (error) {
    console.error("❌ Error saving speaker connection:", error);
    return false;
  }
}

/**
 * Delete speaker connection
 */
export async function deleteSpeakerConnection(speaker1Id, speaker2Id) {
  try {
    // Check both orderings
    await pool.query(
      `DELETE FROM speaker_connections 
       WHERE (speaker1_id = $1 AND speaker2_id = $2)
          OR (speaker1_id = $2 AND speaker2_id = $1)`,
      [speaker1Id, speaker2Id]
    );

    console.log(`🔌 Deleted speaker connection: ${speaker1Id} ↔ ${speaker2Id}`);
    return true;
  } catch (error) {
    console.error("❌ Error deleting speaker connection:", error);
    return false;
  }
}

/**
 * Load all platforms
 */
export async function loadPlatforms() {
  try {
    const result = await pool.query(
      "SELECT * FROM platforms ORDER BY created_at"
    );
    return result.rows.map((row) => ({
      id: row.id,
      owner: row.owner_username,
      name: row.name,
      x: parseFloat(row.x),
      y: parseFloat(row.y),
      z: parseFloat(row.z),
      size: parseInt(row.size),
      floorTexture: row.floor_texture,
      isMain: row.is_main,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  } catch (error) {
    console.error("❌ Error loading platforms:", error);
    return [];
  }
}

/**
 * Save or update a platform
 */
export async function savePlatform(platform) {
  try {
    // Validate data types
    if (typeof platform.id !== "string" || platform.id.length === 0) {
      throw new Error("Invalid platform ID");
    }
    if (typeof platform.owner !== "string" || platform.owner.length === 0) {
      throw new Error("Invalid platform owner");
    }
    if (typeof platform.name !== "string" || platform.name.length === 0) {
      throw new Error("Invalid platform name");
    }

    const result = await pool.query(
      `INSERT INTO platforms (id, owner_username, name, x, y, z, size, floor_texture, is_main, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP)
       ON CONFLICT (id) 
       DO UPDATE SET 
         name = $3,
         x = $4, 
         y = $5, 
         z = $6,
         size = $7,
         floor_texture = $8,
         updated_at = CURRENT_TIMESTAMP
       RETURNING id`,
      [
        platform.id,
        platform.owner,
        platform.name,
        platform.x,
        platform.y,
        platform.z,
        platform.size || 40,
        platform.floorTexture || "floor2.jpg",
        platform.isMain || false,
      ]
    );

    if (result.rows.length > 0) {
      console.log(`🏗️ Saved platform: ${platform.id} (${platform.name})`);
      return { success: true };
    }
    return { success: false, errorCode: "UNKNOWN" };
  } catch (error) {
    if (
      error.code === "23505" &&
      (error.constraint === "idx_platforms_name_unique" ||
        error.message?.includes("idx_platforms_name_unique"))
    ) {
      console.warn(
        `⚠️ Duplicate platform name prevented: ${platform.name.toLowerCase()}`
      );
      return { success: false, errorCode: "DUPLICATE_PLATFORM_NAME" };
    }

    console.error(`❌ Error saving platform ${platform.id}:`, error.message);
    return { success: false, errorCode: "UNKNOWN", error };
  }
}

/**
 * Delete a platform
 */
export async function deletePlatform(id) {
  try {
    // Validate ID
    if (typeof id !== "string" || id.length === 0) {
      throw new Error("Invalid platform ID");
    }

    // Prevent deleting main platform
    if (id === "platform_main") {
      throw new Error("Cannot delete main platform");
    }

    await pool.query("DELETE FROM platforms WHERE id = $1", [id]);
    console.log(`🗑️ Deleted platform: ${id}`);
    return true;
  } catch (error) {
    console.error("❌ Error deleting platform:", error);
    return false;
  }
}

/**
 * Get platform by ID
 */
export async function getPlatform(id) {
  try {
    const result = await pool.query("SELECT * FROM platforms WHERE id = $1", [
      id,
    ]);
    if (result.rows.length > 0) {
      const row = result.rows[0];
      return {
        id: row.id,
        owner: row.owner_username,
        name: row.name,
        x: parseFloat(row.x),
        y: parseFloat(row.y),
        z: parseFloat(row.z),
        size: parseInt(row.size),
        floorTexture: row.floor_texture,
        isMain: row.is_main,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    }
    return null;
  } catch (error) {
    console.error("❌ Error getting platform:", error);
    return null;
  }
}

/**
 * Load all bridges
 */
export async function loadBridges() {
  try {
    const result = await pool.query(
      "SELECT * FROM bridges ORDER BY created_at"
    );
    return result.rows.map((row) => ({
      id: row.id,
      platform1: row.platform1_id,
      platform2: row.platform2_id,
      startX: parseFloat(row.start_x),
      startY: parseFloat(row.start_y),
      startZ: parseFloat(row.start_z),
      endX: parseFloat(row.end_x),
      endY: parseFloat(row.end_y),
      endZ: parseFloat(row.end_z),
      width: parseFloat(row.width),
      createdAt: row.created_at,
    }));
  } catch (error) {
    console.error("❌ Error loading bridges:", error);
    return [];
  }
}

/**
 * Save a bridge
 */
export async function saveBridge(bridge) {
  try {
    const result = await pool.query(
      `INSERT INTO bridges (id, platform1_id, platform2_id, start_x, start_y, start_z, end_x, end_y, end_z, width)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (platform1_id, platform2_id) 
       DO UPDATE SET 
         start_x = $4,
         start_y = $5,
         start_z = $6,
         end_x = $7,
         end_y = $8,
         end_z = $9,
         width = $10
       RETURNING id`,
      [
        bridge.id,
        bridge.platform1,
        bridge.platform2,
        bridge.startX,
        bridge.startY,
        bridge.startZ,
        bridge.endX,
        bridge.endY,
        bridge.endZ,
        bridge.width || 2.0,
      ]
    );

    if (result.rows.length > 0) {
      console.log(`🌉 Saved bridge: ${bridge.id}`);
      return true;
    }
    return false;
  } catch (error) {
    console.error(`❌ Error saving bridge ${bridge.id}:`, error.message);
    return false;
  }
}

/**
 * Delete a bridge
 */
export async function deleteBridge(id) {
  try {
    await pool.query("DELETE FROM bridges WHERE id = $1", [id]);
    console.log(`🗑️ Deleted bridge: ${id}`);
    return true;
  } catch (error) {
    console.error("❌ Error deleting bridge:", error);
    return false;
  }
}

/**
 * Load platform permissions
 */
export async function loadPlatformPermissions(platformId) {
  try {
    const result = await pool.query(
      "SELECT * FROM platform_permissions WHERE platform_id = $1",
      [platformId]
    );
    return result.rows.map((row) => ({
      id: row.id,
      platformId: row.platform_id,
      username: row.username,
      permission: row.permission,
      grantedBy: row.granted_by,
      grantedAt: row.granted_at,
    }));
  } catch (error) {
    console.error("❌ Error loading platform permissions:", error);
    return [];
  }
}

/**
 * Grant platform permission
 */
export async function grantPlatformPermission(
  platformId,
  username,
  permission,
  grantedBy
) {
  try {
    const result = await pool.query(
      `INSERT INTO platform_permissions (platform_id, username, permission, granted_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (platform_id, username) 
       DO UPDATE SET 
         permission = $3,
         granted_by = $4,
         granted_at = CURRENT_TIMESTAMP
       RETURNING id`,
      [platformId, username, permission, grantedBy]
    );

    if (result.rows.length > 0) {
      console.log(
        `🔑 Granted ${permission} permission to ${username} on ${platformId}`
      );
      return true;
    }
    return false;
  } catch (error) {
    console.error("❌ Error granting platform permission:", error.message);
    return false;
  }
}

/**
 * Revoke platform permission
 */
export async function revokePlatformPermission(platformId, username) {
  try {
    await pool.query(
      "DELETE FROM platform_permissions WHERE platform_id = $1 AND username = $2",
      [platformId, username]
    );
    console.log(`🔑 Revoked permission for ${username} on ${platformId}`);
    return true;
  } catch (error) {
    console.error("❌ Error revoking platform permission:", error);
    return false;
  }
}

/**
 * Check if user has permission on platform
 */
export async function checkPlatformPermission(platformId, username) {
  try {
    // Get platform owner
    const platformResult = await pool.query(
      "SELECT owner_username FROM platforms WHERE id = $1",
      [platformId]
    );

    if (platformResult.rows.length === 0) {
      return { hasPermission: false, level: null };
    }

    const owner = platformResult.rows[0].owner_username;

    // Owner has full access
    if (owner === username) {
      return { hasPermission: true, level: "owner" };
    }

    // Check permissions table
    const permResult = await pool.query(
      "SELECT permission FROM platform_permissions WHERE platform_id = $1 AND username = $2",
      [platformId, username]
    );

    if (permResult.rows.length > 0) {
      return {
        hasPermission: true,
        level: permResult.rows[0].permission,
      };
    }

    return { hasPermission: false, level: null };
  } catch (error) {
    console.error("❌ Error checking platform permission:", error);
    return { hasPermission: false, level: null };
  }
}

export default pool;
