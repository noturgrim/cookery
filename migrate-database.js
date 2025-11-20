/**
 * Standalone Database Migration Script
 *
 * This script migrates all data from your current PostgreSQL database
 * to a new PostgreSQL database on Render (or any other provider).
 *
 * USAGE:
 * 1. Set up your environment variables for source (current) database
 * 2. Run: node migrate-database.js
 * 3. Follow the prompts to enter your new database connection details
 * 4. The script will copy all tables and data
 *
 * REQUIREMENTS:
 * - Node.js installed
 * - pg package installed (npm install pg)
 * - Access to both source and destination databases
 */

import pkg from "pg";
import { createInterface } from "readline";
const { Pool } = pkg;

// ANSI color codes for better output
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
};

// Logging utilities
const log = {
  info: (msg) => console.log(`${colors.blue}ℹ${colors.reset} ${msg}`),
  success: (msg) => console.log(`${colors.green}✓${colors.reset} ${msg}`),
  error: (msg) => console.log(`${colors.red}✗${colors.reset} ${msg}`),
  warning: (msg) => console.log(`${colors.yellow}⚠${colors.reset} ${msg}`),
  title: (msg) =>
    console.log(`\n${colors.bright}${colors.cyan}${msg}${colors.reset}\n`),
  data: (msg) => console.log(`  ${colors.cyan}→${colors.reset} ${msg}`),
};

// Create readline interface for user input
const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
});

// Promisified question function
const question = (query) =>
  new Promise((resolve) => rl.question(query, resolve));

/**
 * Parse connection string or build from individual params
 */
function createPoolConfig(config) {
  if (config.connectionString) {
    return {
      connectionString: config.connectionString,
      ssl:
        config.ssl !== false
          ? {
              rejectUnauthorized: config.rejectUnauthorized !== false,
            }
          : false,
    };
  }

  return {
    user: config.user,
    host: config.host,
    database: config.database,
    password: config.password,
    port: config.port || 5432,
    ssl:
      config.ssl !== false
        ? {
            rejectUnauthorized: config.rejectUnauthorized !== false,
          }
        : false,
  };
}

/**
 * Test database connection
 */
async function testConnection(pool, label) {
  try {
    const result = await pool.query(
      "SELECT NOW() as time, version() as version"
    );
    log.success(`${label} connection successful`);
    log.data(`Connected at: ${result.rows[0].time}`);
    return true;
  } catch (error) {
    log.error(`${label} connection failed: ${error.message}`);
    return false;
  }
}

/**
 * Get table schema
 */
async function getTableSchema(pool, tableName) {
  const result = await pool.query(
    `
    SELECT 
      column_name,
      data_type,
      character_maximum_length,
      column_default,
      is_nullable,
      udt_name
    FROM information_schema.columns
    WHERE table_name = $1
    ORDER BY ordinal_position
  `,
    [tableName]
  );

  return result.rows;
}

/**
 * Get table constraints (primary keys, foreign keys, etc.)
 */
async function getTableConstraints(pool, tableName) {
  const result = await pool.query(
    `
    SELECT
      tc.constraint_name,
      tc.constraint_type,
      kcu.column_name,
      ccu.table_name AS foreign_table_name,
      ccu.column_name AS foreign_column_name
    FROM information_schema.table_constraints AS tc
    LEFT JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    LEFT JOIN information_schema.constraint_column_usage AS ccu
      ON ccu.constraint_name = tc.constraint_name
      AND ccu.table_schema = tc.table_schema
    WHERE tc.table_name = $1
    ORDER BY tc.constraint_type, kcu.ordinal_position
  `,
    [tableName]
  );

  return result.rows;
}

/**
 * Get indexes for a table
 */
async function getTableIndexes(pool, tableName) {
  const result = await pool.query(
    `
    SELECT
      indexname,
      indexdef
    FROM pg_indexes
    WHERE tablename = $1
    AND schemaname = 'public'
  `,
    [tableName]
  );

  return result.rows;
}

/**
 * Get all tables in the database
 */
async function getTables(pool) {
  const result = await pool.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
    AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `);

  return result.rows.map((row) => row.table_name);
}

/**
 * Create table in destination database
 */
async function createTable(destPool, tableName, schema, constraints) {
  // Build column definitions
  const columns = schema
    .map((col) => {
      let def = `${col.column_name} `;

      // Handle data type
      if (col.data_type === "character varying") {
        def += `VARCHAR(${col.character_maximum_length || 255})`;
      } else if (col.data_type === "USER-DEFINED") {
        def += col.udt_name === "uuid" ? "UUID" : col.udt_name.toUpperCase();
      } else {
        def += col.data_type.toUpperCase();
      }

      // Handle default value
      if (col.column_default) {
        def += ` DEFAULT ${col.column_default}`;
      }

      // Handle nullable
      if (col.is_nullable === "NO") {
        def += " NOT NULL";
      }

      return def;
    })
    .join(",\n    ");

  // Build constraints
  const primaryKeys = constraints.filter(
    (c) => c.constraint_type === "PRIMARY KEY"
  );
  const foreignKeys = constraints.filter(
    (c) => c.constraint_type === "FOREIGN KEY"
  );
  const uniqueKeys = constraints.filter((c) => c.constraint_type === "UNIQUE");

  let constraintDefs = [];

  // Add primary key constraint
  if (primaryKeys.length > 0) {
    const pkColumns = [
      ...new Set(primaryKeys.map((pk) => pk.column_name)),
    ].join(", ");
    constraintDefs.push(`PRIMARY KEY (${pkColumns})`);
  }

  // Add unique constraints
  const uniqueGroups = {};
  uniqueKeys.forEach((uk) => {
    if (!uniqueGroups[uk.constraint_name]) {
      uniqueGroups[uk.constraint_name] = [];
    }
    uniqueGroups[uk.constraint_name].push(uk.column_name);
  });

  Object.values(uniqueGroups).forEach((columns) => {
    constraintDefs.push(`UNIQUE (${columns.join(", ")})`);
  });

  const constraintStr =
    constraintDefs.length > 0 ? ",\n    " + constraintDefs.join(",\n    ") : "";

  const createTableSQL = `
    CREATE TABLE IF NOT EXISTS ${tableName} (
    ${columns}${constraintStr}
    )
  `;

  await destPool.query(createTableSQL);
  log.success(`Created table: ${tableName}`);

  // Add foreign key constraints separately (to avoid circular dependencies)
  for (const fk of foreignKeys) {
    if (fk.foreign_table_name) {
      try {
        await destPool.query(`
          ALTER TABLE ${tableName}
          ADD CONSTRAINT ${fk.constraint_name}
          FOREIGN KEY (${fk.column_name})
          REFERENCES ${fk.foreign_table_name}(${fk.foreign_column_name})
          ON DELETE CASCADE
        `);
        log.data(
          `Added foreign key: ${fk.column_name} -> ${fk.foreign_table_name}(${fk.foreign_column_name})`
        );
      } catch (error) {
        log.warning(
          `Could not add foreign key ${fk.constraint_name}: ${error.message}`
        );
      }
    }
  }
}

/**
 * Copy table data
 */
async function copyTableData(sourcePool, destPool, tableName) {
  try {
    // Get all data from source
    const result = await sourcePool.query(`SELECT * FROM ${tableName}`);
    const rows = result.rows;

    if (rows.length === 0) {
      log.info(`Table ${tableName} is empty, skipping data copy`);
      return 0;
    }

    // Get column names
    const columns = Object.keys(rows[0]);
    const columnStr = columns.join(", ");

    // Insert data in batches
    const batchSize = 100;
    let inserted = 0;

    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);

      for (const row of batch) {
        const values = columns.map((col, idx) => `$${idx + 1}`).join(", ");
        const valueData = columns.map((col) => row[col]);

        try {
          await destPool.query(
            `INSERT INTO ${tableName} (${columnStr}) VALUES (${values})`,
            valueData
          );
          inserted++;
        } catch (error) {
          log.warning(`Failed to insert row: ${error.message}`);
        }
      }

      log.data(`Copied ${inserted}/${rows.length} rows...`);
    }

    log.success(`Copied ${inserted} rows to ${tableName}`);
    return inserted;
  } catch (error) {
    log.error(`Error copying data for ${tableName}: ${error.message}`);
    return 0;
  }
}

/**
 * Copy indexes
 */
async function copyIndexes(destPool, tableName, indexes) {
  for (const index of indexes) {
    try {
      // Skip primary key indexes (already created with table)
      if (index.indexname.includes("_pkey")) {
        continue;
      }

      // Replace table name in index definition if needed
      const indexDef = index.indexdef.replace(/public\./g, "");

      await destPool.query(indexDef);
      log.success(`Created index: ${index.indexname}`);
    } catch (error) {
      log.warning(
        `Could not create index ${index.indexname}: ${error.message}`
      );
    }
  }
}

/**
 * Get source database configuration from environment
 */
async function getSourceConfig() {
  // Try to load from .env if it exists
  try {
    const dotenv = await import("dotenv");
    dotenv.config();
  } catch (error) {
    log.warning("dotenv not available, using only environment variables");
  }

  if (process.env.DATABASE_URL) {
    return {
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DB_SSL_DISABLED !== "true",
      rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== "false",
    };
  }

  return {
    user: process.env.DB_USER || "postgres",
    host: process.env.DB_HOST || "localhost",
    database: process.env.DB_NAME || "supercooked",
    password: process.env.DB_PASSWORD || "postgres",
    port: process.env.DB_PORT || 5432,
    ssl: false,
  };
}

/**
 * Get destination database configuration from user input
 */
async function getDestinationConfig() {
  log.title("Enter Destination Database Details");
  log.info(
    "You can provide either a connection string OR individual parameters"
  );

  const useConnectionString = await question(
    "Do you have a connection string? (y/n): "
  );

  if (useConnectionString.toLowerCase() === "y") {
    const connectionString = await question("Enter connection string: ");
    const trustCert = await question(
      "Trust SSL certificate? (y/n, default: n): "
    );

    return {
      connectionString: connectionString.trim(),
      ssl: true,
      rejectUnauthorized: trustCert.toLowerCase() !== "y",
    };
  } else {
    const host = await question(
      "Host (e.g., dpg-xxxxx.oregon-postgres.render.com): "
    );
    const port = (await question("Port (default: 5432): ")) || "5432";
    const database = await question("Database name: ");
    const user = await question("Username: ");
    const password = await question("Password: ");
    const trustCert = await question(
      "Trust SSL certificate? (y/n, default: n): "
    );

    return {
      host: host.trim(),
      port: parseInt(port),
      database: database.trim(),
      user: user.trim(),
      password: password.trim(),
      ssl: true,
      rejectUnauthorized: trustCert.toLowerCase() !== "y",
    };
  }
}

/**
 * Main migration function
 */
async function migrateDatabase() {
  log.title("🚀 Database Migration Tool");

  let sourcePool, destPool;

  try {
    // Get source database config
    log.title("Step 1: Connect to Source Database");
    const sourceConfig = await getSourceConfig();
    sourcePool = new Pool(createPoolConfig(sourceConfig));

    if (!(await testConnection(sourcePool, "Source database"))) {
      throw new Error("Cannot connect to source database");
    }

    // Get destination database config
    log.title("Step 2: Connect to Destination Database");
    const destConfig = await getDestinationConfig();
    destPool = new Pool(createPoolConfig(destConfig));

    if (!(await testConnection(destPool, "Destination database"))) {
      throw new Error("Cannot connect to destination database");
    }

    // Confirm migration
    log.title("Step 3: Confirm Migration");
    log.warning(
      "This will copy ALL tables and data to the destination database"
    );
    const confirm = await question(
      "Are you sure you want to proceed? (yes/no): "
    );

    if (confirm.toLowerCase() !== "yes") {
      log.info("Migration cancelled by user");
      return;
    }

    // Get all tables from source
    log.title("Step 4: Analyzing Source Database");
    const tables = await getTables(sourcePool);
    log.success(`Found ${tables.length} tables: ${tables.join(", ")}`);

    // Track statistics
    const stats = {
      tables: tables.length,
      totalRows: 0,
      startTime: Date.now(),
    };

    // Migrate each table
    log.title("Step 5: Migrating Tables");

    for (const tableName of tables) {
      log.info(`\nProcessing table: ${tableName}`);

      // Get schema
      const schema = await getTableSchema(sourcePool, tableName);
      log.data(`Columns: ${schema.length}`);

      // Get constraints
      const constraints = await getTableConstraints(sourcePool, tableName);

      // Create table in destination
      await createTable(destPool, tableName, schema, constraints);

      // Copy data
      const rowsCopied = await copyTableData(sourcePool, destPool, tableName);
      stats.totalRows += rowsCopied;

      // Get and copy indexes
      const indexes = await getTableIndexes(sourcePool, tableName);
      if (indexes.length > 0) {
        log.info(`Copying ${indexes.length} indexes...`);
        await copyIndexes(destPool, tableName, indexes);
      }
    }

    // Final summary
    const duration = ((Date.now() - stats.startTime) / 1000).toFixed(2);

    log.title("✅ Migration Complete!");
    log.success(`Tables migrated: ${stats.tables}`);
    log.success(`Total rows copied: ${stats.totalRows}`);
    log.success(`Duration: ${duration} seconds`);

    log.info("\nNext steps:");
    log.data("1. Verify the data in your new database");
    log.data("2. Update your .env file with the new DATABASE_URL");
    log.data("3. Test your application with the new database");
    log.data("4. Once confirmed, you can safely delete the old database");
  } catch (error) {
    log.error(`Migration failed: ${error.message}`);
    console.error(error);
  } finally {
    // Close connections
    if (sourcePool) {
      await sourcePool.end();
      log.info("Closed source database connection");
    }
    if (destPool) {
      await destPool.end();
      log.info("Closed destination database connection");
    }

    rl.close();
  }
}

// Run the migration
migrateDatabase().catch((error) => {
  log.error(`Fatal error: ${error.message}`);
  console.error(error);
  process.exit(1);
});
