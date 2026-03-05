/**
 * Security Manager — configurable security levels and safety gates.
 */

export type SecurityLevel = 'yolo' | 'permissive' | 'standard' | 'strict';

export interface SecurityConfig {
  level: SecurityLevel;
  trustedProjects: string[];
  allowedCommands: string[];
  blockedCommands: string[];
}

export type CommandCategory = 'readonly' | 'mutating_local' | 'mutating_remote' | 'destructive';

const READONLY_PATTERNS = [
  /^ls\b/, /^dir\b/, /^cat\b/, /^head\b/, /^tail\b/, /^grep\b/, /^find\b/, /^file\b/,
  /^wc\b/, /^diff\b/, /^git\s+status/, /^git\s+log/, /^git\s+diff/,
  /^git\s+show/, /^git\s+branch\s*$/, /^echo\b/, /^pwd/, /^which\b/, /^where\b/,
  /^node\b/, /^python\b/, /^python3\b/, /^ruby\b/, /^go\s+version/,
  /^npm\s+(--version|list|ls|info|view|show|outdated|audit|explain|why)\b/,
  /^pnpm\s+(--version|list|ls|why|outdated|audit)\b/,
  /^yarn\s+(--version|list|info|why)\b/,
  /^npx\b/, /^type\b/, /^whoami/, /^hostname/,
  /^curl\s/, /^wget\s/,
  /^dotnet\s+--version/, /^cargo\s+--version/, /^rustc\b/, /^gcc\b/, /^g\+\+\b/,
  /^java\s+-version/, /^javac\s+-version/, /^mvn\s+-version/,
  /--version$/, /^(env|printenv|set)\b/, /^uname\b/, /^ver\b/,
];

const MUTATING_REMOTE_PATTERNS = [
  /^git\s+push/, /^git\s+fetch/, /^git\s+pull/,
  /^npm\s+publish/, /^yarn\s+publish/, /^pnpm\s+publish/,
  /^curl\s.*\s-X\s*(POST|PUT|DELETE|PATCH)/,
  /^curl\s.*\s--data/, /^curl\s.*\s-d\s/,
];

const DESTRUCTIVE_PATTERNS = [
  /^rm\s+-rf/, /^rm\s+-r/, /^rmdir/, /^del\s/,
  /^git\s+reset\s+--hard/, /^git\s+clean\s+-f/,
  /^git\s+checkout\s+--\s/, /^git\s+branch\s+-[dD]/,
  /^drop\s+database/i, /^drop\s+table/i, /^truncate\s/i,
  /^format\s/, /^mkfs\./,
];

export class SecurityManager {
  private config: SecurityConfig;

  constructor(config?: Partial<SecurityConfig>) {
    this.config = {
      level: config?.level ?? 'standard',
      trustedProjects: config?.trustedProjects ?? [],
      allowedCommands: config?.allowedCommands ?? [],
      blockedCommands: config?.blockedCommands ?? [],
    };
  }

  /**
   * Classify a terminal command into a security category.
   */
  classifyCommand(command: string): CommandCategory {
    const trimmed = command.trim();

    if (DESTRUCTIVE_PATTERNS.some(p => p.test(trimmed))) return 'destructive';
    if (MUTATING_REMOTE_PATTERNS.some(p => p.test(trimmed))) return 'mutating_remote';
    if (READONLY_PATTERNS.some(p => p.test(trimmed))) return 'readonly';
    return 'mutating_local';
  }

  /**
   * Check if a command should be auto-approved, needs confirmation, or is blocked.
   */
  checkCommand(command: string): 'approve' | 'confirm' | 'block' {
    const category = this.classifyCommand(command);

    // Explicitly blocked
    if (this.config.blockedCommands.some(p => command.includes(p))) return 'block';

    // Explicitly allowed
    if (this.config.allowedCommands.some(p => command.includes(p))) return 'approve';

    switch (this.config.level) {
      case 'yolo':
        return 'approve'; // No confirmation for anything

      case 'permissive':
        if (category === 'destructive') return 'confirm';
        return 'approve';

      case 'standard':
        if (category === 'readonly') return 'approve';
        return 'confirm';

      case 'strict':
        return 'confirm';
    }
  }

  /**
   * Check if a project path is trusted.
   */
  isProjectTrusted(projectPath: string): boolean {
    return this.config.trustedProjects.includes(projectPath);
  }

  /**
   * Trust a project path.
   */
  trustProject(projectPath: string): void {
    if (!this.config.trustedProjects.includes(projectPath)) {
      this.config.trustedProjects.push(projectPath);
    }
  }

  /**
   * Check if a memory write should require user confirmation.
   */
  requiresMemoryWriteReview(): boolean {
    return this.config.level !== 'yolo';
  }

  /**
   * Check if file content should be sanitized before context injection.
   */
  shouldSanitize(): boolean {
    return this.config.level !== 'permissive' && this.config.level !== 'yolo';
  }

  /**
   * Sanitize content for prompt injection resilience.
   */
  sanitizeContent(content: string): string {
    if (!this.shouldSanitize()) return content;

    // Detect and mark instruction-like patterns in file content
    const suspiciousPatterns = [
      /ignore\s+(all\s+)?previous\s+instructions/gi,
      /you\s+are\s+now\s+a/gi,
      /system\s*:\s*you/gi,
      /forget\s+(all\s+)?(your|previous)/gi,
    ];

    let sanitized = content;
    for (const pattern of suspiciousPatterns) {
      sanitized = sanitized.replace(pattern, (match) => `[SANITIZED: ${match}]`);
    }

    return sanitized;
  }

  getLevel(): SecurityLevel {
    return this.config.level;
  }

  setLevel(level: SecurityLevel): void {
    this.config.level = level;
  }

  getConfig(): SecurityConfig {
    return { ...this.config };
  }
}
