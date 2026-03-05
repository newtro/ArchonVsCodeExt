/**
 * @archon/memory — Four-layer memory system.
 */

export const MEMORY_VERSION = '0.1.0';

// Layer 1: Rules engine
export { RulesEngine } from './rules/rules-engine';
export type { Rule } from './rules/rules-engine';

// Layer 2: Codebase RAG
export { CodebaseIndexer, OllamaEmbeddingProvider, ApiEmbeddingProvider } from './rag/codebase-indexer';
export type { CodeChunk, SearchResult, EmbeddingProvider } from './rag/codebase-indexer';

// Layer 3: Session memory
export { SessionMemory } from './session/session-memory';
export type { SessionSummary, PreferencePattern } from './session/session-memory';

// Layer 4: Interaction archive
export { InteractionArchive } from './archive/interaction-archive';
export type { ArchivedInteraction, ArchiveSearchResult } from './archive/interaction-archive';

// Dependency awareness
export { DependencyAwareness } from './deps/dependency-awareness';
export type { DependencyInfo } from './deps/dependency-awareness';
