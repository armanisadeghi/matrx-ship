# Ship URL Validation Fix

## Issue

During `pnpm ship:update`, the integrity check would prompt for Ship URL and API key if the config was missing, but it didn't properly validate the URL format. This led to invalid URLs being saved to `.matrx.json`.

### Example Error Flow

```bash
$ pnpm ship:update
# ... update process ...
🔧 Step 4/5: Integrity Check & Cleanup...
🔍 Checking project integrity...
   ⚠️  Ship configuration missing or incomplete.
   Ship URL: matrx-dm                    # ❌ User enters project name instead of URL
   Ship API Key: sk_ship_xxxxx
   ✅ Updated .matrx.json                # ❌ Invalid URL saved!

$ pnpm ship "commit message"
❌ Failed to create version
    Network error: Failed to parse URL from matrx-dm/api/ship
```

## Root Cause

The `checkIntegrity()` function in `ship.ts` was checking:

```typescript
const isShipOk = current.shipUrl && current.shipKey && !isPlaceholderKey(current.shipKey);
```

It validated the API key but **not the URL format**. The function `isPlaceholderUrl()` existed but wasn't being used in this check.

## Solution

### 1. Enhanced URL Validation

```typescript
const isShipOk = current.shipUrl && 
                 current.shipKey && 
                 !isPlaceholderUrl(current.shipUrl) &&  // ✅ Added
                 !isPlaceholderKey(current.shipKey);
```

### 2. Improved User Prompts

Before:
```
⚠️  Ship configuration missing or incomplete.
Ship URL: 
```

After:
```
⚠️  Ship configuration missing or incomplete.

╔════════════════════════════════════════════════════════════╗
║  RECOMMENDED: Auto-provision a ship instance              ║
╚════════════════════════════════════════════════════════════╝

Exit this update and run:
pnpm ship:init matrx-dm "Matrx Dm"

─────────────────────────────────────────────────────────────
Or manually enter your existing instance details:
(Full URL required, e.g., https://ship-project.dev.codematrx.com)

Ship URL (or press Enter to skip): 
```

### 3. URL Format Validation

Added explicit validation that the URL:
- Is not empty
- Starts with `http://` or `https://`
- Is not a placeholder value

```typescript
if (isPlaceholderUrl(urlInput) || !urlInput.startsWith("http")) {
  console.log("");
  console.log(`   ❌ Invalid URL: "${urlInput}"`);
  console.log("   URL must start with https:// or http://");
  console.log(`   Example: https://ship-${projectName}.dev.codematrx.com`);
  console.log("");
  console.log(`   Run: ${shipCmd("init")} ${projectName} "Project Name"`);
  console.log("");
  return false;
}
```

### 4. Prevent Invalid Config Saves

Added validation before saving to `.matrx.json`:

```typescript
if (needsSave) {
  // Only save ship config if we have valid values
  if (current.shipUrl && current.shipKey && 
      !isPlaceholderUrl(current.shipUrl) && 
      !isPlaceholderKey(current.shipKey)) {
    config.ship = { url: current.shipUrl, apiKey: current.shipKey };
  }
  writeFileSync(unifiedPath, JSON.stringify(config, null, 2) + "\n");
}
```

### 5. Return False on Invalid Config

The function now returns `false` when the config is invalid, signaling to the caller that setup is incomplete:

```typescript
if (!urlInput || urlInput.trim() === "") {
  console.log("   ⚠️  Skipped ship configuration.");
  console.log(`   Run the init command above to set up automatically.`);
  return false;
}
```

## Files Modified

- `/srv/projects/matrx-ship/cli/ship.ts`
  - `checkIntegrity()` function (lines ~1673-1740)

## Testing

To verify the fix works:

1. **Test with invalid URL:**
   ```bash
   cd test-project
   pnpm ship:update
   # When prompted, enter just "test-project"
   # Should reject and show error message
   ```

2. **Test with valid URL:**
   ```bash
   cd test-project
   pnpm ship:update
   # When prompted, enter "https://ship-test.dev.codematrx.com"
   # Should accept and save to config
   ```

3. **Test skip option:**
   ```bash
   cd test-project
   pnpm ship:update
   # When prompted, press Enter to skip
   # Should exit gracefully with instructions
   ```

## User Instructions

When users encounter this during update, they should:

1. **Recommended:** Exit and use auto-provisioning:
   ```bash
   pnpm ship:init project-name "Project Display Name"
   ```

2. **Alternative:** Provide full URL manually:
   ```bash
   # When prompted during update:
   Ship URL: https://ship-project.dev.codematrx.com
   Ship API Key: sk_ship_xxxxx
   ```

## Prevention

This fix prevents:
- Invalid URLs from being saved to `.matrx.json`
- Cryptic "Failed to parse URL" errors during ship commands
- Users having to manually edit config files
- Confusion about what format the URL should be

## Related Issues

- TSX dependency enforcement (see TSX_DEPENDENCY_ENFORCEMENT.md)
- Ship initialization workflow
- Config file validation

## Date

Fixed: 2024-02-12
