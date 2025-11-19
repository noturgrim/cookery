# Quick Start Guide

## ✅ Refactoring Complete!

Your game has been successfully refactored into a clean, modular architecture. Everything is working and ready to use!

---

## 🚀 Running the Game

### 1. Start the Server

```bash
cd F:\Projects\supercooked
node server/index.js
```

### 2. Open Your Browser

Navigate to: `http://localhost:3000`

### 3. Play!

- Enter your name
- Select a character
- Click "Start Game"
- Click on the floor to move
- Press **T** to open emote wheel
- Press **E** to toggle edit mode

---

## 📁 New File Structure

```
public/js/
├── game.js                    ← Main orchestrator (429 lines)
│
├── managers/                  ← NEW! All managers here
│   ├── SceneManager.js       ← Three.js scene & world
│   ├── PlayerManager.js      ← Player management
│   ├── UIManager.js          ← Visual UI elements
│   ├── InputManager.js       ← User input handling
│   └── NetworkManager.js     ← Server communication
│
├── animationController.js    ← Limb animations
├── characterManager.js       ← Model loading
└── soundManager.js           ← Audio system
```

---

## 🎯 Quick Reference

### To Modify Gameplay

| Feature           | File to Edit                 |
| ----------------- | ---------------------------- |
| Player movement   | `managers/PlayerManager.js`  |
| Walking animation | `animationController.js`     |
| Click-to-move     | `managers/InputManager.js`   |
| Name tags         | `managers/UIManager.js`      |
| Network sync      | `managers/NetworkManager.js` |
| Scene setup       | `managers/SceneManager.js`   |
| Sound effects     | `soundManager.js`            |
| Character models  | `characterManager.js`        |

### Key Methods

```javascript
// Create a player
playerManager.createPlayer(playerData);

// Move to position
networkManager.moveTo(x, z);

// Play an emote
networkManager.playEmote("hello");

// Toggle edit mode
inputManager.toggleEditMode();

// Spawn food
sceneManager.spawnFoodItem("tomato", x, y, z);
```

---

## 📚 Documentation Files

1. **ARCHITECTURE.md** - Detailed explanation of each manager
2. **ARCHITECTURE_DIAGRAM.md** - Visual diagrams and data flow
3. **REFACTORING_SUMMARY.md** - Before/after comparison
4. **QUICK_START.md** (this file) - Quick reference

---

## 🔧 Adding New Features

### Example: Add Jump Feature

**1. Input (InputManager.js)**

```javascript
handleKeyDown(e) {
  if (e.code === 'Space') {
    this.networkManager.jump();
  }
}
```

**2. Network (NetworkManager.js)**

```javascript
jump() {
  this.socket.emit('jump', { playerId: this.playerId });
}
```

**3. Animation (AnimationController.js)**

```javascript
applyJumpAnimation(limbs, jumpPhase) {
  // Animate jump
}
```

**4. Server (server/index.js)**

```javascript
socket.on("jump", (data) => {
  io.emit("playerJumped", data);
});
```

That's it! Each change is isolated to its appropriate manager.

---

## ✅ What's Working

- ✅ Player movement (click-to-move)
- ✅ Character animations (legs, arms, torso)
- ✅ Name tags above players
- ✅ Emote wheel (Hold T)
- ✅ Voice lines with spatial audio
- ✅ Footstep sounds synced to animation
- ✅ Obstacle editing (Press E)
- ✅ Multiplayer synchronization
- ✅ Character selection screen
- ✅ Settings menu
- ✅ Food items

---

## 🐛 Debugging

### If Something Doesn't Work

**1. Check Browser Console (F12)**

- Look for error messages
- Verify all files are loading

**2. Check Server Console**

- See if server is running
- Check for connection errors

**3. Common Issues**

| Issue                  | Solution                                   |
| ---------------------- | ------------------------------------------ |
| Blank screen           | Check console for import errors            |
| Players not moving     | Check NetworkManager connection            |
| No animations          | Verify AnimationController is initializing |
| No sounds              | Check SoundManager loading                 |
| Can't select character | Verify CharacterManager loaded models      |

**4. Verify File Paths**
All manager imports use relative paths:

```javascript
import { SceneManager } from "./managers/SceneManager.js";
```

---

## 📊 Code Statistics

### Line Count

- **Before**: 1,431 lines in one file
- **After**: 429 lines in game.js + 5 focused managers

### File Organization

- **Before**: Everything in `game.js`
- **After**: 9 files with clear responsibilities

### Maintainability Score

- **Before**: 😰 Hard to maintain
- **After**: 😊 Easy to maintain!

---

## 🎉 Success!

Your game is now:

- ✅ **Modular** - Easy to understand
- ✅ **Maintainable** - Easy to modify
- ✅ **Extensible** - Easy to add features
- ✅ **Testable** - Easy to test
- ✅ **Production-ready** - Professional code structure

**Happy coding! 🚀**

---

## 💡 Tips

1. **Read ARCHITECTURE.md** first to understand the system
2. **Check ARCHITECTURE_DIAGRAM.md** for visual reference
3. **Each manager is self-contained** - modify independently
4. **Follow the existing patterns** when adding features
5. **Keep game.js as orchestrator** - don't add game logic there

---

## 🤝 Need Help?

Check the documentation files:

- Questions about structure? → **ARCHITECTURE.md**
- Need to see data flow? → **ARCHITECTURE_DIAGRAM.md**
- Comparing before/after? → **REFACTORING_SUMMARY.md**
- Quick reference? → **QUICK_START.md** (this file)

All code includes clear JSDoc comments explaining what each function does!
