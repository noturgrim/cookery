# Pathfinding Debug Instructions

## How to Enable Debug Mode

In the browser console, type:

```javascript
game.networkManager.socket.emit("debugPath", { enabled: true });
```

## What to Test

1. **Restart the server** to apply the latest changes
2. **Refresh the browser**
3. **Enable debug mode** using the command above
4. **Try clicking on:**
   - The bridge
   - Another platform
   - An object on another platform

## What to Look For in Server Logs

The server will now show:

- `🔍 Checking if goal is walkable...`
- `isWalkable: true/false`
- If the goal gets adjusted
- Path calculation details

## Expected Behavior

When you click on a bridge or another platform:

- The clicked position should be `isWalkable: true`
- A path should be generated
- The player should walk to that location

## If It's Still Not Working

Check if the server logs show:

1. `isWalkable: false` - means the platform/bridge check isn't working
2. Goal gets adjusted far away - means `findNearestWalkable` is finding your current platform instead
3. No path generated - means A\* can't find a route

Share the server logs and I'll diagnose the issue!
