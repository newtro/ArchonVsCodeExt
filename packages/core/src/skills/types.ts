/**
 * Types for the Archon Skills System.
 *
 * Skills are reusable, file-based capabilities that extend the agent
 * with domain-specific knowledge, workflows, and executable scripts.
 */

// ── Skill Definition ──

export interface SkillMetadata {
  /** Unique identifier — lowercase, hyphens allowed, max 64 chars. */
  name: string;
  /** What the skill does and when to use it (max 1024 chars). */
  description: string;
  /** Where this skill is available. */
  scope: 'global' | 'project';
  /** Whether the skill is active. */
  enabled: boolean;
  /** Categories for organization and filtering. */
  tags?: string[];
  /** Auto-incremented revision number. */
  version?: number;
  /** Activation condition for auto-detection (e.g. "file:.py", "repo:Dockerfile"). */
  trigger?: string;
  /** Tools this skill is allowed to use. */
  tools?: string[];
  /** Whether the agent can auto-invoke this skill (default true). */
  modelInvocable?: boolean;
}

export interface Skill {
  /** Parsed frontmatter metadata. */
  metadata: SkillMetadata;
  /** Full markdown body (instructions). Loaded on demand (progressive disclosure). */
  body: string | null;
  /** Absolute path to the skill file or directory. */
  path: string;
  /** Whether this is a simple (single file) or rich (directory) skill. */
  type: 'simple' | 'rich';
  /** For rich skills, list of script files available. */
  scripts?: string[];
  /** For rich skills, list of reference files available. */
  references?: string[];
  /** For rich skills, list of asset files available. */
  assets?: string[];
}

/** Lightweight representation used in the registry (progressive disclosure level 1). */
export interface SkillSummary {
  name: string;
  description: string;
  scope: 'global' | 'project';
  enabled: boolean;
  tags: string[];
  type: 'simple' | 'rich';
  path: string;
  trigger?: string;
  modelInvocable: boolean;
}

// ── Skill Version ──

export interface SkillVersion {
  version: number;
  timestamp: number;
  path: string;
}

// ── Skill Events ──

export type SkillEventType =
  | 'skill-loaded'
  | 'skill-invoked'
  | 'skill-created'
  | 'skill-updated'
  | 'skill-deleted'
  | 'skill-enabled'
  | 'skill-disabled';

export interface SkillEvent {
  type: SkillEventType;
  skillName: string;
  timestamp: number;
  detail?: string;
}

// ── Loader / Registry Config ──

export interface SkillLoaderConfig {
  /** Workspace root for project-level skills. */
  workspaceRoot: string;
  /** User home directory for global skills. */
  userHome: string;
  /** Custom project skills directory (default: .archon/skills). */
  projectSkillsDir?: string;
  /** Custom global skills directory (default: ~/.archon/skills). */
  globalSkillsDir?: string;
}

// ── Executor Config ──

export interface SkillExecutorConfig {
  /** Current security level for script execution. */
  securityLevel: 'yolo' | 'permissive' | 'standard' | 'strict';
  /** Callback to ask user for confirmation. */
  askUser: (prompt: string, options?: import('../types').AskUserOptionInput[]) => Promise<string>;
  /** Callback to execute a shell command. */
  executeCommand: (command: string) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
  /** Callback to read a file. */
  readFile: (path: string) => Promise<string>;
}

// ── Extension Messages (for webview integration) ──

export interface SkillInfo {
  name: string;
  description: string;
  scope: 'global' | 'project';
  enabled: boolean;
  tags: string[];
  type: 'simple' | 'rich';
  version?: number;
  trigger?: string;
  modelInvocable: boolean;
  hasScripts: boolean;
  path: string;
}
