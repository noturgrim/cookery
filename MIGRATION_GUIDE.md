# Database Migration Guide

This guide will help you safely migrate your entire database from your current PostgreSQL instance to a new Render PostgreSQL database.

## 🎯 Overview

The `migrate-database.js` script is a standalone tool that:

- ✅ Connects to your current database (even if you've lost dashboard access)
- ✅ Creates all tables with proper schemas in the new database
- ✅ Copies all data (users, sessions, obstacles, food_items)
- ✅ Recreates indexes and constraints
- ✅ Provides detailed progress and error reporting
- ✅ **Does NOT modify your existing code or database**

## 📋 Prerequisites

1. **Node.js installed** (v16 or higher)
2. **Your current database is still accessible via connection string/credentials**
3. **New PostgreSQL database created on Render** (or any other provider)
4. **pg package installed** (already in your project)

## 🚀 Step-by-Step Instructions

### Step 1: Create a New PostgreSQL Database on Render

1. Go to [Render Dashboard](https://dashboard.render.com/)
2. Click "New +" → "PostgreSQL"
3. Fill in the details:
   - **Name**: `supercooked-new` (or any name you prefer)
   - **Database**: `supercooked` (or any name)
   - **User**: Will be auto-generated
   - **Region**: Choose closest to your users
   - **Plan**: Choose appropriate plan
4. Click "Create Database"
5. Wait for the database to be provisioned (2-3 minutes)
6. Once ready, you'll see connection details:
   - **Internal Database URL** (for apps on Render)
   - **External Database URL** (for external connections)
   - **PSQL Command**
   - Individual connection parameters (Host, Port, Database, Username, Password)

### Step 2: Run the Migration Script

1. **Open your terminal** in the project directory (`F:\Projects\supercooked`)

2. **Run the migration script**:

   ```bash
   node migrate-database.js
   ```

3. **Follow the prompts**:

   **First**, the script will connect to your **source database** (current database) using your existing `.env` configuration or environment variables.

   **Then**, you'll be asked for destination database details:

   ```
   Do you have a connection string? (y/n):
   ```

   **Option A: Using Connection String** (Recommended)

   - Type: `y`
   - Paste the **External Database URL** from Render (looks like):
     ```
     postgres://username:password@host.oregon-postgres.render.com:5432/database
     ```
   - When asked "Trust SSL certificate?": type `y` (Render uses valid SSL certs)

   **Option B: Using Individual Parameters**

   - Type: `n`
   - Enter each parameter from Render:
     - Host: `dpg-xxxxx.oregon-postgres.render.com`
     - Port: `5432`
     - Database name: `supercooked`
     - Username: `supercooked_user` (example)
     - Password: `[your password]`
     - Trust SSL certificate?: `y`

4. **Review and Confirm**:

   ```
   Found X tables: users, sessions, obstacles, food_items
   Are you sure you want to proceed? (yes/no):
   ```

   Type: `yes`

5. **Wait for completion** - The script will:
   - Create all tables with schemas
   - Copy all data in batches
   - Create indexes
   - Show progress for each table

### Step 3: Verify the Migration

After the migration completes, verify your data:

1. **Check the migration summary**:

   ```
   ✅ Migration Complete!
   ✓ Tables migrated: 4
   ✓ Total rows copied: XXX
   ✓ Duration: XX seconds
   ```

2. **Connect to the new database** (optional):

   ```bash
   psql "postgres://username:password@host.oregon-postgres.render.com:5432/database"
   ```

   Then run SQL queries to verify:

   ```sql
   -- Check tables exist
   \dt

   -- Count records
   SELECT COUNT(*) FROM users;
   SELECT COUNT(*) FROM sessions;
   SELECT COUNT(*) FROM obstacles;
   SELECT COUNT(*) FROM food_items;

   -- Sample data
   SELECT * FROM users LIMIT 5;
   SELECT * FROM obstacles LIMIT 5;
   ```

### Step 4: Update Your Application

1. **Update your `.env` file**:

   ```env
   # Replace with your NEW database URL
   DATABASE_URL=postgres://username:password@host.oregon-postgres.render.com:5432/database

   # SSL settings for Render (keep these)
   DB_SSL_REJECT_UNAUTHORIZED=false
   ```

2. **Test your application**:

   ```bash
   npm run dev
   ```

3. **Verify everything works**:
   - Login with existing users
   - Check that obstacles and food items load
   - Create new data to ensure writes work
   - Test all game functionality

### Step 5: Clean Up (After Confirmation)

⚠️ **ONLY do this after thoroughly testing the new database**

1. Keep the old database running for a few days as backup
2. Once you're 100% confident everything works:
   - Delete the old database from Render
   - Or keep it as an archive backup

## 🔧 Troubleshooting

### Connection Issues

**Error: "Cannot connect to source database"**

- Check your `.env` file has correct `DATABASE_URL` or individual DB credentials
- Verify your old database is still running
- Check network connectivity

**Error: "Cannot connect to destination database"**

- Double-check the connection string/credentials from Render
- Ensure the new database is fully provisioned (check Render dashboard)
- Verify SSL settings (Render requires SSL)

### SSL Certificate Issues

**Error: "self signed certificate"**

- When prompted "Trust SSL certificate?", answer `y`
- Or set `DB_SSL_REJECT_UNAUTHORIZED=false` in your environment

### Data Copy Issues

**Error: "Failed to insert row"**

- The script will skip problematic rows and continue
- Check the warnings to see which rows failed
- Usually caused by constraint violations (shouldn't happen with proper migration)

### Foreign Key Constraint Issues

**Warning: "Could not add foreign key"**

- This is usually safe to ignore during migration
- The script creates tables in alphabetical order, so foreign keys might fail initially
- The data will still be copied correctly
- You can manually add foreign keys after migration if needed

## 📊 What Gets Migrated

The script migrates **everything** from your database:

### Tables

- ✅ `users` - All user accounts
- ✅ `sessions` - Active user sessions
- ✅ `obstacles` - Game furniture/objects
- ✅ `food_items` - Food objects in the game

### Schema

- ✅ Column definitions (types, lengths, nullability)
- ✅ Default values
- ✅ Primary keys
- ✅ Unique constraints
- ✅ Foreign key relationships
- ✅ Indexes (for performance)

### Data

- ✅ All rows from all tables
- ✅ Preserves data types (UUIDs, timestamps, etc.)
- ✅ Maintains relationships between tables

## 🛡️ Safety Features

- **Read-only on source**: Script only reads from your old database, never modifies it
- **No code changes**: Your application code remains untouched
- **Batch processing**: Large tables are copied in batches to avoid memory issues
- **Error handling**: Continues even if individual rows fail
- **Detailed logging**: Every action is logged with success/failure status
- **Confirmation prompt**: Requires explicit "yes" before starting migration

## 🆘 Need Help?

If you encounter issues:

1. **Check the error message** - The script provides detailed error information
2. **Review your connection details** - Most issues are connection-related
3. **Try with connection string** - Often more reliable than individual parameters
4. **Check Render dashboard** - Ensure database is fully provisioned and available
5. **Test connection manually**:
   ```bash
   psql "your-connection-string-here"
   ```

## 📝 Manual Migration (Alternative)

If the script doesn't work, you can use PostgreSQL's native tools:

```bash
# Dump from old database
pg_dump "old-database-url" > backup.sql

# Restore to new database
psql "new-database-url" < backup.sql
```

However, the script is recommended because it:

- Handles SSL configuration automatically
- Provides progress feedback
- Continues on errors
- Creates proper table structure

## 🎉 After Successful Migration

Your application should now be running on the new database with:

- All your users and their data
- All game objects (obstacles, food items)
- All active sessions
- Full functionality preserved

Remember to update any documentation or deployment scripts with the new database URL!
