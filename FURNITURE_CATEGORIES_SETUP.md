# Furniture Categories Setup Guide

## ✅ Setup Complete!

Your organized furniture models are now automatically available in the spawn menu!

### 📦 Categories Added:
- ✅ **arcade/** - Arcade machines and gaming equipment
- ✅ **holiday/** - Holiday-themed decorations and items
- ✅ **minimarket/** - Minimarket shelves, displays, and equipment

---

## 📁 Directory Structure

```
public/furniture/glb/
├── arcade/
│   ├── arcade_machine.glb
│   ├── (other arcade models)
│   └── Textures/
│       └── colormap.png
├── holiday/
│   └── (holiday-themed models)
├── minimarket/
│   └── (minimarket equipment)
├── chair.glb                  ← Root level models still work
├── table.glb
└── ... (other furniture)
```

---

## 🔧 How It Works

### Automatic Recursive Scanning

The server automatically scans **ALL subdirectories** in `public/furniture/glb/`:

```javascript
// Server scans recursively
public/furniture/glb/
  ├── arcade/arcade_machine.glb   → "arcade/arcade_machine"
  ├── holiday/christmas_tree.glb  → "holiday/christmas_tree"
  ├── minimarket/shelf.glb        → "minimarket/shelf"
  ├── minimarket/freezer.glb      → "minimarket/freezer"
  └── chair.glb                   → "chair"
```

**No code changes needed!** Just add folders and models.

---

## 🎮 Using Your Models

### In-Game

1. **Press `B`** - Open spawn menu
2. **Click "Furniture" tab**
3. **Browse by category**:
   - `arcade/arcade_machine`
   - `arcade/pinball_machine`
   - `holiday/christmas_tree`
   - `holiday/decorations`
   - `minimarket/shelf`
   - `minimarket/cash_register`
4. **Click to spawn** at platform center
5. **Press `E`** - Enter edit mode
6. **Drag to position** your furniture

### Model Paths

Models are referenced by their full path (without `.glb`):

```
File Location                                  → Spawn Menu Name
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
public/furniture/glb/arcade/arcade_machine.glb  → arcade/arcade_machine
public/furniture/glb/holiday/santa.glb          → holiday/santa
public/furniture/glb/minimarket/shelf.glb       → minimarket/shelf
public/furniture/glb/chair.glb                  → chair
```

---

## 🎨 Adding More Categories

Just create a new folder and add models:

```bash
# Example: Add kitchen equipment
mkdir public/furniture/glb/kitchen
# Copy your models
copy kitchen_stove.glb public/furniture/glb/kitchen/
copy kitchen_fridge.glb public/furniture/glb/kitchen/
```

**They'll automatically appear!** No code changes needed.

### Suggested Categories

```
public/furniture/glb/
├── arcade/           ✅ Done!
├── holiday/          ✅ Done!
├── minimarket/       ✅ Done!
├── kitchen/          ← Add kitchen equipment
├── bathroom/         ← Add bathroom fixtures
├── office/           ← Add office furniture
├── outdoor/          ← Add outdoor items
├── decorations/      ← Add decorative items
├── lighting/         ← Add lamps and lights
└── plants/           ← Add plants and nature
```

---

## 📝 Best Practices

### ✅ Good Organization

```
arcade/
├── arcade_machine_red.glb
├── arcade_machine_blue.glb
├── pinball_classic.glb
└── Textures/
    ├── red_texture.png
    └── blue_texture.png
```

### ✅ Consistent Naming

- Use lowercase
- Use underscores for spaces
- Be descriptive but concise

```
✅ arcade_machine_red.glb
✅ holiday_christmas_tree.glb
✅ minimarket_shelf_tall.glb

❌ Arcade Machine Red.glb (spaces)
❌ ArcadeMachineRED.glb (mixed case)
❌ arcade#1.glb (special characters)
```

### ✅ Texture Management

Place textures in a `Textures/` subfolder:

```
arcade/
├── arcade_machine.glb        ← Model references: Textures/colormap.png
└── Textures/
    └── colormap.png          ← Texture file
```

---

## 🧪 Testing Your Setup

### 1. Check Server Response

```bash
# Start server
npm start

# In browser console (F12):
fetch('/api/models/furniture')
  .then(r => r.json())
  .then(models => console.log(models))

# Should include:
# ["chair", "table", "arcade/arcade_machine", "holiday/...", "minimarket/..."]
```

### 2. Check Spawn Menu

1. Open game
2. Press `B`
3. Look for your categories in the furniture list

### 3. Test Spawning

1. Click on a model (e.g., `arcade/arcade_machine`)
2. Should appear at platform center
3. Press `E` to edit
4. Drag to move

---

## 🎯 Category Ideas & Examples

### 🕹️ Arcade
- `arcade_machine.glb`
- `pinball_machine.glb`
- `racing_cabinet.glb`
- `prize_machine.glb`

### 🎄 Holiday
- `christmas_tree.glb`
- `halloween_pumpkin.glb`
- `valentine_heart.glb`
- `easter_egg.glb`

### 🏪 Minimarket
- `shelf_tall.glb`
- `shelf_short.glb`
- `freezer_vertical.glb`
- `cash_register.glb`
- `shopping_cart.glb`
- `shopping_basket.glb`

### 🍳 Kitchen (Future)
- `stove.glb`
- `oven.glb`
- `fridge.glb`
- `counter.glb`
- `sink.glb`

### 🪑 Office (Future)
- `desk.glb`
- `office_chair.glb`
- `filing_cabinet.glb`
- `bookshelf.glb`
- `computer.glb`

---

## 🐛 Troubleshooting

### Models don't appear in spawn menu

**Check 1**: Correct folder structure
```
✅ public/furniture/glb/arcade/arcade_machine.glb
❌ public/furniture/arcade/glb/arcade_machine.glb
❌ public/arcade/furniture/glb/arcade_machine.glb
```

**Check 2**: File extension
```
✅ .glb (lowercase)
❌ .GLB (uppercase may cause issues)
❌ .gltf (wrong format)
```

**Check 3**: Server logs
```
Look for: "Error reading furniture directory"
```

**Check 4**: Browser console (F12)
```javascript
// Should show your models:
["arcade/arcade_machine", "holiday/tree", ...]
```

### Model loads but looks wrong

**Textures missing**:
- Check `Textures/` subfolder exists
- Check texture paths in GLB match actual files

**Model too big/small**:
- Use `E` (edit mode) in-game
- Scale with mouse or keyboard

**Model is dark**:
- Check materials in Blender
- Ensure normals are correct
- Add emission to materials if needed

---

## 📊 Current Setup

```
public/furniture/glb/
├── arcade/          ← Arcade & gaming equipment
├── holiday/         ← Seasonal decorations
├── minimarket/      ← Store equipment
└── (140+ models)    ← Existing furniture
```

**Total**: 140+ categorized furniture models ready to spawn!

---

## 🚀 Next Steps

### 1. Organize Existing Models

Move existing models into categories:

```powershell
# PowerShell example
mkdir public/furniture/glb/tables
mkdir public/furniture/glb/chairs
move public/furniture/glb/*table*.glb public/furniture/glb/tables/
move public/furniture/glb/*chair*.glb public/furniture/glb/chairs/
```

### 2. Add More Categories

Based on your game needs:
- Kitchen equipment for restaurant gameplay
- Office furniture for corporate theme
- Outdoor items for parks/gardens
- Decorations for customization

### 3. Create Category Metadata (Optional)

Future enhancement - add category icons and descriptions:

```json
{
  "arcade": {
    "displayName": "Arcade Games",
    "icon": "🕹️",
    "description": "Gaming and entertainment"
  },
  "holiday": {
    "displayName": "Holiday Items",
    "icon": "🎄",
    "description": "Seasonal decorations"
  }
}
```

---

## 💡 Pro Tips

1. **Consistent Scale**: Export all models at similar scale in Blender
2. **Pivot Point**: Set pivot at bottom-center for easy placement
3. **LODs**: Use lower-poly models for performance
4. **Textures**: Keep under 2K for most models (4K for hero assets)
5. **Testing**: Test each model in-game before adding more
6. **Backups**: Keep original source files (.blend, .fbx) separate

---

## ✅ Summary

### What's Working

✅ Automatic recursive scanning of subdirectories  
✅ All models available in spawn menu  
✅ Clean category organization  
✅ No code changes needed to add models  
✅ Textures load automatically from GLB files

### Your Categories

- **arcade/** - Gaming equipment
- **holiday/** - Seasonal items  
- **minimarket/** - Store furniture

### How to Use

1. Press `B` → Spawn menu
2. Find your model (e.g., `arcade/arcade_machine`)
3. Click to spawn
4. Press `E` to edit position/rotation/scale

**No server restart needed!** Just refresh the game page.

---

🎮 **Enjoy your organized furniture library!**

Need more help? Check the original `ARCADE_MODEL_SETUP.md` for detailed troubleshooting.

