# TSX Dependency Enforcement

## Overview

This document describes the comprehensive system implemented to ensure that `tsx` is always added to `devDependencies` for npm projects using the matrx-ship CLI tools.

## Problem Statement

The matrx-ship CLI relies on `tsx` to execute TypeScript files directly. Without `tsx` in `devDependencies`, the CLI commands will fail. Previously, tsx was only checked during fresh installs, but not consistently across updates and migrations.

## Solution

A unified checking system has been implemented across all three main CLI scripts to ensure `tsx` is always present in npm projects:

1. **install.sh** - Fresh installations
2. **migrate.sh** - Migration from old versions
3. **ship.ts** - Updates and runtime checks

## Implementation Details

### 1. install.sh

**Location:** `/srv/projects/matrx-ship/cli/install.sh`

**Function:** `ensure_tsx_dependency()` (lines 89-141)

**Features:**
- Checks if `package.json` exists (skips non-Node projects)
- Uses `jq` if available, falls back to `grep` for checking
- Detects package manager (pnpm, yarn, bun, npm) via lock files
- Installs tsx using the appropriate package manager
- Provides clear error messages if installation fails

**Called from:**
- Line 476: During Node.js project setup when Ship is being installed

### 2. migrate.sh

**Location:** `/srv/projects/matrx-ship/cli/migrate.sh`

**Function:** `ensure_tsx_dependency()` (lines 59-114)

**Features:**
- Checks if `package.json` exists (skips non-Node projects)
- Uses Node.js to check for tsx in all dependency sections
- Adds tsx to `package.json` using Node.js (version ^4.21.0)
- Detects package manager and runs install command
- Uses `changed()` and `warn()` for consistent logging

**Called from:**
- Line 558: During package.json updates when Ship is installed

### 3. ship.ts

**Location:** `/srv/projects/matrx-ship/cli/ship.ts`

**Function:** `ensureTsxDependency()` (lines 1499-1546)

**Features:**
- Comprehensive JSDoc documentation
- Checks all dependency locations (dependencies, devDependencies, optionalDependencies)
- Adds tsx to `package.json` programmatically (version ^4.21.0)
- Detects package manager via lock file existence
- Runs appropriate install command with inherited stdio
- Comprehensive error handling with user-friendly messages

**Called from:**
- Line 1753: In `checkIntegrity()` - runs during init and integrity checks
- Line 1878: In `handleUpdate()` - runs during CLI updates
- Line 1933: In `main()` - safety check at CLI startup (except for help command)

## Execution Flow

### Fresh Install
```
install.sh
  └─> ensure_tsx_dependency()
      └─> Checks for tsx
      └─> Installs if missing
```

### Migration
```
migrate.sh
  └─> ensure_tsx_dependency()
      └─> Checks for tsx
      └─> Adds to package.json
      └─> Runs install
```

### Update
```
ship.ts update
  └─> handleUpdate()
      └─> ensureTsxDependency()
          └─> Checks for tsx
          └─> Adds to package.json
          └─> Runs install
```

### Init (Auto-provision)
```
ship.ts init
  └─> handleInit()
      └─> checkIntegrity()
          └─> ensureTsxDependency()
              └─> Checks for tsx
              └─> Adds to package.json
              └─> Runs install
```

### Runtime Safety Check
```
ship.ts <any-command>
  └─> main()
      └─> ensureTsxDependency() (if tsx missing)
          └─> Silently ensures tsx is present
```

## Package Manager Detection

All three implementations detect the package manager in the same order:

1. **pnpm** - Checks for `pnpm-lock.yaml` or `pnpm-workspace.yaml`
2. **yarn** - Checks for `yarn.lock`
3. **bun** - Checks for `bun.lockb` or `bun.lock`
4. **npm** - Default fallback

## Version Specification

- **install.sh**: Uses package manager's default (latest stable)
- **migrate.sh**: Explicitly sets `^4.21.0` in package.json
- **ship.ts**: Explicitly sets `^4.21.0` in package.json

The caret (`^`) allows patch and minor updates while maintaining compatibility.

## Error Handling

All implementations provide graceful error handling:

- **Success**: Clear success message with package manager used
- **Failure**: Warning message with manual command to run
- **Non-Node projects**: Silently skipped (no error)

## Testing Scenarios

The implementation handles all these scenarios:

1. ✅ Fresh install on Node project without tsx
2. ✅ Fresh install on Node project with tsx already present
3. ✅ Migration from old version without tsx
4. ✅ Migration from old version with tsx already present
5. ✅ Update command on project without tsx
6. ✅ Update command on project with tsx already present
7. ✅ Init command on new project without tsx
8. ✅ Any ship command on project without tsx (runtime safety check)
9. ✅ Non-Node projects (Python, etc.) - skipped appropriately

## Benefits

1. **Consistency**: Same logic across all entry points
2. **Reliability**: Multiple safety checks ensure tsx is always present
3. **User Experience**: Clear messages and automatic installation
4. **Flexibility**: Works with all major package managers
5. **Safety**: Non-destructive (only adds if missing)
6. **Performance**: Early returns when tsx is already present

## Maintenance

When updating this system:

1. Keep the three implementations in sync
2. Test all entry points (install, migrate, update, init, runtime)
3. Verify with all package managers (pnpm, yarn, bun, npm)
4. Ensure error messages are clear and actionable
5. Update this documentation

## Related Files

- `/srv/projects/matrx-ship/cli/install.sh` - Fresh installation script
- `/srv/projects/matrx-ship/cli/migrate.sh` - Migration script
- `/srv/projects/matrx-ship/cli/ship.ts` - Main CLI implementation
- `/srv/projects/matrx-ship/README.md` - User-facing documentation

## Additional Fixes

### Ship URL Validation (2024-02-12)

Fixed an issue where `checkIntegrity()` would accept invalid URLs during the update process:

**Problem:** During `ship:update`, if ship config was missing, the integrity check would prompt for URL/API key but didn't validate the URL format. Users could enter just a project name (e.g., "matrx-dm") instead of a full URL, which would be saved to `.matrx.json` and cause "Failed to parse URL" errors.

**Solution:**
1. Added `isPlaceholderUrl()` check to `isShipOk` validation
2. Enhanced prompts with clear examples and instructions
3. Added URL format validation (must start with http:// or https://)
4. Recommend using `ship:init` for auto-provisioning instead of manual entry
5. Prevent saving invalid URLs to config file
6. Return `false` from `checkIntegrity()` when config is invalid

**Files Modified:**
- `/srv/projects/matrx-ship/cli/ship.ts` - `checkIntegrity()` function

## Future Improvements

Potential enhancements:

1. Add version checking to ensure tsx is up-to-date
2. Support for alternative TypeScript runners (ts-node, etc.)
3. Offline mode with cached tsx installation
4. Parallel installation for monorepos
5. Better detection of workspace configurations
