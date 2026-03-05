/**
 * PipelineStorage — layered pipeline storage with global + project-level support.
 *
 * Global pipelines: stored via a save/load callback (VS Code globalState in practice).
 * Project pipelines: stored in .archon/pipelines/ as JSON files.
 */

import type { Pipeline, PipelineTemplate } from './types';
import type { PipelineInfo } from '../types';
import { DEFAULT_PIPELINE } from './default-pipeline';
import { getBuiltInTemplates } from './templates';

export interface PipelineStorageConfig {
  /** Workspace root path (for project-level pipeline storage) */
  workspaceRoot?: string;
  /** Read a file from disk */
  readFile: (path: string) => Promise<string>;
  /** Write a file to disk */
  writeFile: (path: string, content: string) => Promise<void>;
  /** Check if a file or directory exists */
  exists: (path: string) => Promise<boolean>;
  /** Create a directory (recursively) */
  mkdir: (path: string) => Promise<void>;
  /** List files in a directory */
  listFiles: (dirPath: string) => Promise<string[]>;
  /** Delete a file */
  deleteFile: (path: string) => Promise<void>;
  /** Get global pipelines (from VS Code globalState) */
  getGlobalPipelines: () => Pipeline[];
  /** Set global pipelines (to VS Code globalState) */
  setGlobalPipelines: (pipelines: Pipeline[]) => void;
}

export class PipelineStorage {
  private config: PipelineStorageConfig;

  constructor(config: PipelineStorageConfig) {
    this.config = config;
  }

  /**
   * Get all available pipelines (built-in + global + project) as PipelineInfo.
   * Project pipelines take precedence over global when IDs collide.
   */
  async getAvailablePipelines(): Promise<PipelineInfo[]> {
    const pipelines: PipelineInfo[] = [];
    const seenIds = new Set<string>();

    // Built-in: Default pipeline
    pipelines.push({
      id: 'default',
      name: DEFAULT_PIPELINE.name,
      description: DEFAULT_PIPELINE.description,
      source: 'builtin',
    });
    seenIds.add('default');

    // Built-in templates
    for (const template of getBuiltInTemplates()) {
      pipelines.push({
        id: template.id,
        name: template.name,
        description: template.description,
        source: 'builtin',
      });
      seenIds.add(template.id);
    }

    // Project pipelines (take precedence)
    const projectPipelines = await this.loadProjectPipelines();
    for (const p of projectPipelines) {
      if (seenIds.has(p.id)) {
        // Override builtin/global with project version
        const idx = pipelines.findIndex(x => x.id === p.id);
        if (idx !== -1) {
          pipelines[idx] = { id: p.id, name: p.name, description: p.description, source: 'project' };
        }
      } else {
        pipelines.push({ id: p.id, name: p.name, description: p.description, source: 'project' });
      }
      seenIds.add(p.id);
    }

    // Global pipelines
    const globalPipelines = this.config.getGlobalPipelines();
    for (const p of globalPipelines) {
      if (!seenIds.has(p.id)) {
        pipelines.push({ id: p.id, name: p.name, description: p.description, source: 'global' });
        seenIds.add(p.id);
      }
    }

    return pipelines;
  }

  /**
   * Get a pipeline definition by ID.
   * Resolution order: project → global → built-in templates → default.
   */
  async getPipeline(id: string): Promise<Pipeline> {
    if (id === 'default') return DEFAULT_PIPELINE;

    // Check project pipelines first
    const projectPipelines = await this.loadProjectPipelines();
    const projectMatch = projectPipelines.find(p => p.id === id);
    if (projectMatch) return projectMatch;

    // Check global pipelines
    const globalPipelines = this.config.getGlobalPipelines();
    const globalMatch = globalPipelines.find(p => p.id === id);
    if (globalMatch) return globalMatch;

    // Check built-in templates
    const templates = getBuiltInTemplates();
    const template = templates.find(t => t.id === id);
    if (template) return template.pipeline;

    return DEFAULT_PIPELINE;
  }

  /**
   * Save a pipeline to the specified storage layer.
   */
  async savePipeline(pipeline: Pipeline, target: 'project' | 'global'): Promise<void> {
    pipeline.metadata = {
      ...pipeline.metadata,
      updatedAt: Date.now(),
      createdAt: pipeline.metadata?.createdAt ?? Date.now(),
    };

    if (target === 'project') {
      await this.saveProjectPipeline(pipeline);
    } else {
      this.saveGlobalPipeline(pipeline);
    }
  }

  /**
   * Delete a pipeline from storage.
   * Built-in pipelines cannot be deleted.
   */
  async deletePipeline(id: string): Promise<boolean> {
    if (id === 'default') return false;

    // Try project first — always allow deleting project overrides,
    // even if they share an ID with a built-in template
    if (await this.deleteProjectPipeline(id)) return true;

    // Try global
    if (this.deleteGlobalPipeline(id)) return true;

    // If it's a built-in template with no override, can't delete
    return false;
  }

  /**
   * Clone a pipeline with a new ID and name.
   */
  async clonePipeline(sourceId: string, newName: string, target: 'project' | 'global'): Promise<Pipeline> {
    const source = await this.getPipeline(sourceId);
    const newId = `${newName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now().toString(36)}`;

    const clone: Pipeline = {
      ...JSON.parse(JSON.stringify(source)),
      id: newId,
      name: newName,
      metadata: {
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    };

    await this.savePipeline(clone, target);
    return clone;
  }

  // ── Project-level storage (.archon/pipelines/) ──

  private get projectDir(): string {
    return `${this.config.workspaceRoot}/.archon/pipelines`;
  }

  private async loadProjectPipelines(): Promise<Pipeline[]> {
    if (!this.config.workspaceRoot) return [];

    try {
      const dirExists = await this.config.exists(this.projectDir);
      if (!dirExists) return [];

      const files = await this.config.listFiles(this.projectDir);
      const jsonFiles = files.filter(f => f.endsWith('.json'));

      const pipelines: Pipeline[] = [];
      for (const file of jsonFiles) {
        try {
          const content = await this.config.readFile(`${this.projectDir}/${file}`);
          const pipeline = JSON.parse(content) as Pipeline;
          pipelines.push(pipeline);
        } catch {
          // Skip invalid files
        }
      }
      return pipelines;
    } catch {
      return [];
    }
  }

  private async saveProjectPipeline(pipeline: Pipeline): Promise<void> {
    if (!this.config.workspaceRoot) {
      throw new Error('No workspace open — cannot save project pipeline');
    }

    const dirExists = await this.config.exists(this.projectDir);
    if (!dirExists) {
      await this.config.mkdir(this.projectDir);
    }

    const filename = `${pipeline.id}.json`;
    const content = JSON.stringify(pipeline, null, 2);
    await this.config.writeFile(`${this.projectDir}/${filename}`, content);
  }

  private async deleteProjectPipeline(id: string): Promise<boolean> {
    if (!this.config.workspaceRoot) return false;

    try {
      const filePath = `${this.projectDir}/${id}.json`;
      const exists = await this.config.exists(filePath);
      if (exists) {
        await this.config.deleteFile(filePath);
        return true;
      }
    } catch {
      // Ignore
    }
    return false;
  }

  // ── Global storage (VS Code globalState) ──

  private saveGlobalPipeline(pipeline: Pipeline): void {
    const pipelines = this.config.getGlobalPipelines();
    const idx = pipelines.findIndex(p => p.id === pipeline.id);
    if (idx !== -1) {
      pipelines[idx] = pipeline;
    } else {
      pipelines.push(pipeline);
    }
    this.config.setGlobalPipelines(pipelines);
  }

  private deleteGlobalPipeline(id: string): boolean {
    const pipelines = this.config.getGlobalPipelines();
    const idx = pipelines.findIndex(p => p.id === id);
    if (idx !== -1) {
      pipelines.splice(idx, 1);
      this.config.setGlobalPipelines(pipelines);
      return true;
    }
    return false;
  }
}
