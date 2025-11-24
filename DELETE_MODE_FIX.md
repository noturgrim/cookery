# Delete Mode Button Fix

## Issue Description

When loading the game fresh or after a refresh, the delete mode button did not work if the user had not spawned any items yet. The button would appear when entering edit mode, but clicking it had no effect until the user opened the spawn menu (Press B) and spawned at least one item.

## Root Cause

The delete mode button's event handlers were being initialized inside the `populateSpawnMenu()` function in `InputManager.js`. This function is only called when:

1. The spawn menu is opened for the first time (Press B key)
2. The `loadAvailableModels()` async function completes

This meant that on a fresh game load:

- The delete mode button HTML element exists in the DOM
- But its click handlers are not attached until the spawn menu is opened
- Therefore, clicking the button before opening spawn menu had no effect

## Solution

Moved the delete mode button initialization out of `populateSpawnMenu()` and into a dedicated `setupDeleteModeButton()` method that is called during `setupInput()` initialization.

### Changes Made

#### File: `public/js/managers/InputManager.js`

1. **Created new method `setupDeleteModeButton()`** (lines 82-110)

   - Initializes delete button click handlers
   - Prevents event propagation
   - Called during game initialization

2. **Updated `setupInput()`** (line 78)

   - Added call to `this.setupDeleteModeButton()`
   - Ensures delete button works immediately on game load

3. **Removed duplicate code from `populateSpawnMenu()`**
   - Deleted the delete button setup code (previously lines 1323-1341)
   - This code is no longer needed since button is initialized earlier

## Testing Steps

1. Load the game fresh or refresh the page
2. Press **E** to enter Edit Mode
3. The delete mode button should appear in the top-right
4. Click the delete mode button - it should toggle ON (red indicator)
5. Click any furniture/food item to delete it
6. Click the delete mode button again to toggle OFF

## Result

✅ Delete mode button now works immediately on fresh game load without needing to spawn items first.

## Technical Details

- The button is initialized as soon as `setupInput()` is called during game initialization
- Event handlers are attached once and reused throughout the game session
- The fix maintains all existing functionality while removing the dependency on spawn menu initialization
