/**
 * Variable store for the hook system.
 * Manages three scopes: turn, session, persistent.
 */

import type { VariableDefinition, VariableScope, VariableStore } from './types';

export class HookVariableStore implements VariableStore {
  private turnVars: Map<string, unknown> = new Map();
  private sessionVars: Map<string, unknown> = new Map();
  private persistentVars: Map<string, unknown> = new Map();
  private definitions: Map<string, VariableDefinition> = new Map();

  /** Callback to flush persistent vars to storage (set by consumer). */
  onPersistentFlush?: (vars: Record<string, unknown>) => void;

  /** Get all registered variable definitions. */
  getDefinitions(): VariableDefinition[] {
    return Array.from(this.definitions.values());
  }

  registerDefinitions(defs: VariableDefinition[]): void {
    for (const def of defs) {
      this.definitions.set(def.name, def);
      // Initialize with default if not already set
      if (this.get(def.name) === undefined) {
        this.set(def.name, def.default);
      }
    }
  }

  get(name: string): unknown {
    const def = this.definitions.get(name);
    const scope = def?.scope ?? 'turn';
    return this.getMap(scope).get(name);
  }

  set(name: string, value: unknown): void {
    const def = this.definitions.get(name);
    const scope = def?.scope ?? 'turn';
    this.getMap(scope).set(name, value);
  }

  getAll(): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [k, v] of this.turnVars) result[`$${k}`] = v;
    for (const [k, v] of this.sessionVars) result[`$${k}`] = v;
    for (const [k, v] of this.persistentVars) result[`$${k}`] = v;
    return result;
  }

  /** Create a frozen snapshot for parallel branch isolation. */
  snapshot(): Record<string, unknown> {
    return { ...this.getAll() };
  }

  clearScope(scope: VariableScope): void {
    this.getMap(scope).clear();
    // Re-apply defaults for cleared scope
    for (const def of this.definitions.values()) {
      if (def.scope === scope) {
        this.getMap(scope).set(def.name, def.default);
      }
    }
  }

  /** Flush persistent variables to storage. Called at turn end. */
  flushPersistent(): void {
    if (!this.onPersistentFlush) return;
    const vars: Record<string, unknown> = {};
    for (const [k, v] of this.persistentVars) vars[k] = v;
    this.onPersistentFlush(vars);
  }

  /** Load persistent variables from storage (called on init). */
  loadPersistent(vars: Record<string, unknown>): void {
    for (const [k, v] of Object.entries(vars)) {
      this.persistentVars.set(k, v);
    }
  }

  private getMap(scope: VariableScope): Map<string, unknown> {
    switch (scope) {
      case 'turn': return this.turnVars;
      case 'session': return this.sessionVars;
      case 'persistent': return this.persistentVars;
    }
  }
}
