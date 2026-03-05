/**
 * Dependency Awareness — reads dependency versions from project files
 * and includes them in the system prompt so the model targets correct APIs.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface DependencyInfo {
  name: string;
  version: string;
  type: 'production' | 'development';
  source: string; // e.g., 'package.json', 'requirements.txt'
}

export class DependencyAwareness {
  private workspaceRoot: string;
  private dependencies: DependencyInfo[] = [];

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
  }

  /**
   * Scan the workspace for dependency files and extract version info.
   */
  async scan(): Promise<DependencyInfo[]> {
    this.dependencies = [];

    await Promise.all([
      this.scanPackageJson(),
      this.scanRequirementsTxt(),
      this.scanPyprojectToml(),
      this.scanCargoToml(),
      this.scanGoMod(),
    ]);

    return this.dependencies;
  }

  /**
   * Format dependencies for system prompt injection.
   */
  formatForPrompt(): string {
    if (this.dependencies.length === 0) return '';

    const bySource = new Map<string, DependencyInfo[]>();
    for (const dep of this.dependencies) {
      const existing = bySource.get(dep.source) ?? [];
      existing.push(dep);
      bySource.set(dep.source, existing);
    }

    const sections: string[] = ['# Project Dependencies\n'];
    for (const [source, deps] of bySource) {
      sections.push(`## ${source}`);
      const production = deps.filter(d => d.type === 'production');
      const development = deps.filter(d => d.type === 'development');

      if (production.length > 0) {
        sections.push('Production:');
        production.forEach(d => sections.push(`  - ${d.name}: ${d.version}`));
      }
      if (development.length > 0) {
        sections.push('Development:');
        development.forEach(d => sections.push(`  - ${d.name}: ${d.version}`));
      }
      sections.push('');
    }

    return sections.join('\n');
  }

  getDependencies(): DependencyInfo[] {
    return [...this.dependencies];
  }

  private async scanPackageJson(): Promise<void> {
    const pkgPath = path.join(this.workspaceRoot, 'package.json');
    if (!fs.existsSync(pkgPath)) return;

    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));

      if (pkg.dependencies) {
        for (const [name, version] of Object.entries(pkg.dependencies)) {
          this.dependencies.push({
            name,
            version: version as string,
            type: 'production',
            source: 'package.json',
          });
        }
      }

      if (pkg.devDependencies) {
        for (const [name, version] of Object.entries(pkg.devDependencies)) {
          this.dependencies.push({
            name,
            version: version as string,
            type: 'development',
            source: 'package.json',
          });
        }
      }
    } catch {
      // Skip malformed package.json
    }
  }

  private async scanRequirementsTxt(): Promise<void> {
    const reqPath = path.join(this.workspaceRoot, 'requirements.txt');
    if (!fs.existsSync(reqPath)) return;

    try {
      const content = fs.readFileSync(reqPath, 'utf-8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;

        const match = trimmed.match(/^([a-zA-Z0-9_-]+)\s*([>=<~!]+\s*.+)?$/);
        if (match) {
          this.dependencies.push({
            name: match[1],
            version: match[2]?.trim() ?? '*',
            type: 'production',
            source: 'requirements.txt',
          });
        }
      }
    } catch {
      // Skip
    }
  }

  private async scanPyprojectToml(): Promise<void> {
    const tomlPath = path.join(this.workspaceRoot, 'pyproject.toml');
    if (!fs.existsSync(tomlPath)) return;

    try {
      const content = fs.readFileSync(tomlPath, 'utf-8');
      // Simple TOML dependency parsing
      const depsMatch = content.match(/\[project\][\s\S]*?dependencies\s*=\s*\[([\s\S]*?)\]/);
      if (depsMatch) {
        const deps = depsMatch[1].match(/"([^"]+)"/g);
        if (deps) {
          for (const dep of deps) {
            const cleaned = dep.replace(/"/g, '');
            const parts = cleaned.split(/[>=<~!]/);
            this.dependencies.push({
              name: parts[0].trim(),
              version: cleaned.slice(parts[0].length).trim() || '*',
              type: 'production',
              source: 'pyproject.toml',
            });
          }
        }
      }
    } catch {
      // Skip
    }
  }

  private async scanCargoToml(): Promise<void> {
    const cargoPath = path.join(this.workspaceRoot, 'Cargo.toml');
    if (!fs.existsSync(cargoPath)) return;

    try {
      const content = fs.readFileSync(cargoPath, 'utf-8');
      const sections = content.split(/\[([^\]]+)\]/);

      for (let i = 0; i < sections.length; i++) {
        const header = sections[i].trim();
        if (header === 'dependencies' || header === 'dev-dependencies') {
          const body = sections[i + 1] ?? '';
          const type = header === 'dependencies' ? 'production' as const : 'development' as const;

          for (const line of body.split('\n')) {
            const match = line.match(/^([a-zA-Z0-9_-]+)\s*=\s*"?([^"{\n]+)"?/);
            if (match) {
              this.dependencies.push({
                name: match[1].trim(),
                version: match[2].trim(),
                type,
                source: 'Cargo.toml',
              });
            }
          }
        }
      }
    } catch {
      // Skip
    }
  }

  private async scanGoMod(): Promise<void> {
    const goModPath = path.join(this.workspaceRoot, 'go.mod');
    if (!fs.existsSync(goModPath)) return;

    try {
      const content = fs.readFileSync(goModPath, 'utf-8');
      const requireMatch = content.match(/require\s*\(([\s\S]*?)\)/);
      if (requireMatch) {
        for (const line of requireMatch[1].split('\n')) {
          const match = line.trim().match(/^(\S+)\s+(\S+)/);
          if (match && !match[1].startsWith('//')) {
            this.dependencies.push({
              name: match[1],
              version: match[2],
              type: 'production',
              source: 'go.mod',
            });
          }
        }
      }
    } catch {
      // Skip
    }
  }
}
