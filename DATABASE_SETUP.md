# PostgreSQL Database Setup Guide

## 🗄️ Database Integration

Your Supercooked game now saves all furniture and food placements to a PostgreSQL database! This means:

- ✅ All spawned objects persist across server restarts
- ✅ All players see the same layout
- ✅ Drag-and-drop changes are saved automatically
- ✅ No more manual code copying!

## 📦 Installation Steps

### 1. Install PostgreSQL

**Windows:**

- Download from: https://www.postgresql.org/download/windows/
- Run the installer
- Remember the password you set for the `postgres` user
- Default port is `5432`

**Mac (using Homebrew):**

```bash
brew install postgresql@15
brew services start postgresql@15
```

**Linux (Ubuntu/Debian):**

```bash
sudo apt update
sudo apt install postgresql postgresql-contrib
sudo systemctl start postgresql
```

### 2. Create the Database

Open PostgreSQL command line (psql) and run:

```sql
CREATE DATABASE supercooked;
```

Or using command line:

```bash
# Windows/Linux
createdb -U postgres supercooked

# Mac
createdb supercooked
```

### 3. Install Node.js PostgreSQL Driver

In your project directory:

```bash
npm install pg
```

### 4. Configure Database Connection

Create a `.env` file in the root directory:

**Option A: Using DATABASE_URL (Recommended for Cloud/Render.com):**

```env
# Server Configuration
PORT=3000

# PostgreSQL Database URL (single connection string)
DATABASE_URL=postgresql://supercookeddb_user:8b7LXMFEq4DAkuipC6SWyeXjkHOzDfk5@dpg-d4es8b49c44c73ciljlg-a.singapore-postgres.render.com/supercookeddb
```

**Option B: Using Individual Parameters (Local PostgreSQL):**

```env
# Server Configuration
PORT=3000

# PostgreSQL Database Configuration
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=your_password_here
DB_NAME=supercooked
```

**Important:** The app will use `DATABASE_URL` if provided, otherwise falls back to individual parameters!

### 5. Start the Server

```bash
npm run dev
```

You should see:

```
✅ Connected to PostgreSQL database
✅ Database tables initialized
📦 Loaded 0 obstacles from database
🍔 Loaded 0 food items from database
🎮 Game server running on http://localhost:3000
📡 WebSocket server ready for connections
💾 Database persistence enabled
```

## 🎮 How It Works

### Automatic Saving

Everything is saved automatically:

- **Spawn objects** (Press B) → Saved to database instantly
- **Move objects** (Press E, drag) → Saved on release
- **Delete objects** (Delete Mode) → Removed from database

### Database Tables

Two tables are created automatically:

**obstacles** (furniture/tables):

- id, name, type, x, y, z
- width, height, depth
- model, scale, rotation
- timestamps

**food_items**:

- id, name, x, y, z, scale
- timestamps

### Syncing Across Players

- When a player joins → Loads all objects from database
- When a player spawns/moves/deletes → Broadcasts to all connected players + saves to database
- Everyone sees the same kitchen layout in real-time!

## 🛠️ Troubleshooting

### Connection Error

If you see `❌ Unexpected database error`:

1. Check PostgreSQL is running:

   ```bash
   # Windows
   pg_ctl status

   # Mac/Linux
   brew services list  # Mac
   sudo systemctl status postgresql  # Linux
   ```

2. Verify database exists:

   ```bash
   psql -U postgres -l
   ```

3. Check your `.env` file settings

### Reset Database

To clear all spawned objects:

```sql
-- Connect to database
psql -U postgres -d supercooked

-- Clear all objects
DELETE FROM obstacles;
DELETE FROM food_items;
```

Or drop and recreate:

```sql
DROP DATABASE supercooked;
CREATE DATABASE supercooked;
```

## 🎉 That's It!

Your game now has persistent storage! Spawn some furniture, place some food, restart the server, and everything will still be there!

No more copying code from the console - it's all automatic! 🚀
