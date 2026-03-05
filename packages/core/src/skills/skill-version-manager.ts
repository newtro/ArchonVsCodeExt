/**
 * SkillVersionManager — Handles skill versioning and rollback.
 *
 * Each save creates a timestamped copy in .history/<skill-name>/.
 * Maximum 20 versions retained per skill (oldest pruned automatically).
 */

import * as fs from 'fs';
import * as path from 'path';
import type { SkillVersion } from './types';

const MAX_VERSIONS = 20;
const HISTORY_DIR = '.history';

export class SkillVersionManager {
  /**
   * Save a version snapshot before overwriting a skill file.
   * Call this BEFORE writing the new content.
   */
  saveVersion(skillPath: string, skillName: string): SkillVersion | null {
    try {
      // Determine the source file to back up
      const stat = fs.statSync(skillPath);
      const sourceFile = stat.isDirectory()
        ? path.join(skillPath, 'SKILL.md')
        : skillPath;

      if (!fs.existsSync(sourceFile)) return null;

      const content = fs.readFileSync(sourceFile, 'utf-8');

      // Extract current version from frontmatter
      const versionMatch = content.match(/^version:\s*(\d+)/m);
      const version = versionMatch ? parseInt(versionMatch[1], 10) : 1;

      // Determine history directory (sibling to skill files)
      const skillsDir = stat.isDirectory()
        ? path.dirname(skillPath)
        : path.dirname(skillPath);
      const historyDir = path.join(skillsDir, HISTORY_DIR, skillName);

      fs.mkdirSync(historyDir, { recursive: true });

      // Create timestamped backup
      const timestamp = Date.now();
      const isoDate = new Date(timestamp).toISOString().replace(/[:.]/g, '-');
      const backupName = `${skillName}.v${version}.${isoDate}.md`;
      const backupPath = path.join(historyDir, backupName);

      fs.writeFileSync(backupPath, content, 'utf-8');

      // Prune old versions
      this.pruneVersions(historyDir);

      return { version, timestamp, path: backupPath };
    } catch {
      return null;
    }
  }

  /**
   * List all versions of a skill, newest first.
   */
  listVersions(skillPath: string, skillName: string): SkillVersion[] {
    try {
      const stat = fs.statSync(skillPath);
      const skillsDir = stat.isDirectory()
        ? path.dirname(skillPath)
        : path.dirname(skillPath);
      const historyDir = path.join(skillsDir, HISTORY_DIR, skillName);

      if (!fs.existsSync(historyDir)) return [];

      const files = fs.readdirSync(historyDir)
        .filter(f => f.startsWith(`${skillName}.v`) && f.endsWith('.md'))
        .sort()
        .reverse();

      return files.map(f => {
        const match = f.match(/\.v(\d+)\.(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})/);
        const version = match ? parseInt(match[1], 10) : 0;
        const dateStr = match ? match[2].replace(/-/g, (m, offset) => {
          // Restore ISO format: first 10 chars use -, then T, then : for time
          return m;
        }) : '';

        // Parse timestamp from filename
        const fileStat = fs.statSync(path.join(historyDir, f));

        return {
          version,
          timestamp: fileStat.mtimeMs,
          path: path.join(historyDir, f),
        };
      });
    } catch {
      return [];
    }
  }

  /**
   * Read the content of a specific version.
   */
  readVersion(versionPath: string): string | null {
    try {
      return fs.readFileSync(versionPath, 'utf-8');
    } catch {
      return null;
    }
  }

  /**
   * Restore a previous version by overwriting the current skill file.
   * Creates a new version snapshot before restoring.
   */
  restoreVersion(skillPath: string, skillName: string, versionPath: string): boolean {
    try {
      // Save current state before restoring
      this.saveVersion(skillPath, skillName);

      const content = fs.readFileSync(versionPath, 'utf-8');

      // Increment version number in the restored content
      const versionMatch = content.match(/^(version:\s*)(\d+)/m);
      let newContent = content;
      if (versionMatch) {
        const currentMax = this.getMaxVersion(skillPath, skillName);
        const newVersion = currentMax + 1;
        newContent = content.replace(/^(version:\s*)\d+/m, `$1${newVersion}`);
      }

      // Write restored content
      const stat = fs.statSync(skillPath);
      const targetFile = stat.isDirectory()
        ? path.join(skillPath, 'SKILL.md')
        : skillPath;

      fs.writeFileSync(targetFile, newContent, 'utf-8');
      return true;
    } catch {
      return false;
    }
  }

  // ── Private ──

  private pruneVersions(historyDir: string): void {
    try {
      const files = fs.readdirSync(historyDir)
        .filter(f => f.endsWith('.md'))
        .sort(); // oldest first

      while (files.length > MAX_VERSIONS) {
        const oldest = files.shift()!;
        try {
          fs.unlinkSync(path.join(historyDir, oldest));
        } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
  }

  private getMaxVersion(skillPath: string, skillName: string): number {
    const versions = this.listVersions(skillPath, skillName);
    if (versions.length === 0) return 1;
    return Math.max(...versions.map(v => v.version));
  }
}
