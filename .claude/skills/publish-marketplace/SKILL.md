---
name: publish-marketplace
description: Publish the Archon VS Code extension to the VS Code Marketplace. Use this skill whenever the user wants to publish, release, deploy, or push a new version of the extension to the marketplace. Also trigger when the user says "publish", "release", "new version", "bump version", "update marketplace", "push to marketplace", or "deploy extension".
---

# Publish Archon to VS Code Marketplace

This skill handles the full release workflow for the Archon VS Code extension: version bump, changelog update, build, package, and upload to the VS Code Marketplace via Playwright browser automation.

## Why Each Step Matters

The marketplace displays the CHANGELOG.md to users on the extension page, so keeping it current is critical for user trust. The version in package.json must match what's uploaded. The VSIX must be built fresh after the version bump so the manifest is correct. And the native module rebuild is necessary because better-sqlite3 must target VS Code's Electron runtime, not system Node.

---

## Step 1: Determine the New Version

Read the current version from `packages/vscode/package.json`.

Ask the user what kind of release this is (or infer from context):
- **patch** (0.1.3 -> 0.1.4): bug fixes, small improvements
- **minor** (0.1.3 -> 0.2.0): new features, significant changes
- **major** (0.1.3 -> 1.0.0): breaking changes, major milestones

If the user already specified a version or bump type, use that. Otherwise default to patch.

---

## Step 2: Gather Changes for the Changelog

Run `git log` to find commits since the last version tag or the last changelog entry. Summarize the changes into user-facing categories:

```bash
# Find commits since last tag (or use the version from CHANGELOG.md)
git log --oneline <last-tag>..HEAD
```

Organize changes into these categories (skip empty ones):
- **Added** - New features
- **Changed** - Changes to existing features
- **Fixed** - Bug fixes
- **Removed** - Removed features

Write concise, user-facing descriptions. Users don't care about internal refactors or file moves unless they affect behavior. Focus on what changed from the user's perspective.

---

## Step 3: Update the Changelog

Edit `packages/vscode/CHANGELOG.md`. Insert the new version entry at the top (below the `# Changelog` heading), above all existing entries. Use this format:

```markdown
## X.Y.Z (YYYY-MM-DD)

### Added
- Feature description

### Changed
- Change description

### Fixed
- Fix description
```

Use today's date. The marketplace renders this file directly on the extension page under the "Changelog" tab.

---

## Step 4: Bump the Version

Edit `packages/vscode/package.json` and update the `"version"` field to the new version number.

---

## Step 5: Build and Package

Run these commands in sequence:

```bash
# Build all packages (core -> memory -> vscode)
cd d:/Repos/ArchonVsCodeExt && pnpm run build

# Package the VSIX
cd packages/vscode && npx vsce package --no-dependencies
```

Verify the build succeeds and the VSIX is created at `packages/vscode/archon-X.Y.Z.vsix`.

---

## Step 6: Commit and Push

Create a release commit with the version bump and changelog:

```bash
git add packages/vscode/package.json packages/vscode/CHANGELOG.md
git commit -m "release: vX.Y.Z"
git push
```

Only commit `package.json` and `CHANGELOG.md`. Do not commit the `.vsix` file.

---

## Step 7: Upload to Marketplace via Playwright

Use Playwright browser automation to upload the VSIX:

1. Navigate to the marketplace publisher management page:
   ```
   https://marketplace.visualstudio.com/manage/publishers/JohnnyCode-ai
   ```

2. If a sign-in page appears, tell the user to sign in manually and wait for them to confirm.

3. Once on the publisher page, click the "More Actions..." button (three dots) next to the Archon extension row.

4. Click "Update" from the dropdown menu.

5. In the upload dialog, click the upload button to trigger the file chooser.

6. Use Playwright's file upload to provide the VSIX file:
   ```
   D:\Repos\ArchonVsCodeExt\packages\vscode\archon-X.Y.Z.vsix
   ```

7. Click the "Upload" button to submit.

8. Wait for confirmation — the page should show "Verifying X.Y.Z" or "It's live!".

---

## Step 8: Confirm

Report the result to the user:
- New version number
- Changelog entry that was added
- Marketplace URL: https://marketplace.visualstudio.com/items?itemName=JohnnyCode-ai.archon
- Note that verification may take a few minutes

---

## Important Notes

- The publisher ID is `JohnnyCode-ai`
- The extension ID is `archon`
- The VSIX is built with `--no-dependencies` flag
- The marketplace URL for the extension is: https://marketplace.visualstudio.com/items?itemName=JohnnyCode-ai.archon
- The CHANGELOG.md lives at `packages/vscode/CHANGELOG.md`
- The package.json lives at `packages/vscode/package.json`
- Always build from the monorepo root (`pnpm run build`) to ensure core and memory packages compile first
