# Debug Platform Clicks

## Check if platforms are loaded

In browser console, run:

```javascript
// Check platform count
console.log("Platforms:", game.platformManager.platforms.size);
console.log("Platform meshes:", game.platformManager.platformMeshes.size);
console.log("Bridges:", game.platformManager.bridgeMeshes.size);

// List all platforms
game.platformManager.platforms.forEach((p, id) => {
  console.log(`Platform ${id}: ${p.name} at (${p.x}, ${p.z}), size: ${p.size}`);
});

// List all platform meshes
game.platformManager.platformMeshes.forEach((mesh, id) => {
  console.log(`Mesh ${id}:`, mesh.position, `in scene:`, mesh.parent !== null);
});
```

## Expected Output

You should see:

- Platforms: [number] (e.g., 3)
- Platform meshes: [number] (same as platforms)
- Bridges: [number]
- List of each platform with name and position
- List of each mesh confirming they're in the scene

## If you see 0 platforms

The platforms aren't loading! Check:

1. Did you restart the server?
2. Are platforms showing visually in the game?
3. Check browser console for errors during load

## Test the click detection

After running the above, try clicking on another platform and check the console log:

```
🔍 Checking X clickable surfaces (1 main floor + Y platforms/bridges)
```

The X number should be:

- 1 (main floor) + number of platforms + number of bridges

If it says "Checking 1 clickable surfaces" then the platforms aren't being added to the clickable array!
