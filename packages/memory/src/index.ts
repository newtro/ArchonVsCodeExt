/**
 * @archon/memory — Six-layer memory system with unified SQLite storage.
 */

export const MEMORY_VERSION = '0.2.0';

// Storage: Unified SQLite database
export { MemoryDatabase } from './db/memory-database';
export { MemoryTelemetry } from './db/memory-telemetry';
export type { MetricSummary, MetricTimeSeries } from './db/memory-telemetry';

// Layer 1: Rules engine
export { RulesEngine } from './rules/rules-engine';
export type { Rule } from './rules/rules-engine';

// Layer 2: Code knowledge graph
export { GraphBuilder } from './graph/graph-builder';
export type { SymbolInfo, SymbolKind, EdgeInfo, EdgeKind, GraphQueryResult } from './graph/graph-builder';

// Layer 3: Codebase RAG
export { CodebaseIndexer, OllamaEmbeddingProvider, ApiEmbeddingProvider } from './rag/codebase-indexer';
export { ASTChunker } from './rag/ast-chunker';
export type { CodeChunk, SearchResult, EmbeddingProvider } from './rag/codebase-indexer';

// Layer 4: Session memory
export { SessionMemory } from './session/session-memory';
export type { SessionSummary, PreferencePattern } from './session/session-memory';
export { AutoSummarizer } from './session/auto-summarizer';
export type { LlmCompletionFn, SummarizerConfig, ForgettingReport } from './session/auto-summarizer';
export { EditTracker } from './session/edit-tracker';
export type { EditObservation, LearnedPattern, PatternCategory } from './session/edit-tracker';

// Layer 5: Interaction archive
export { InteractionArchive } from './archive/interaction-archive';
export type { ArchivedInteraction, ArchiveSearchResult } from './archive/interaction-archive';

// Layer 6: Context manager
export { ContextManager } from './context/context-manager';
export type {
  ContextItem,
  ContextCategory,
  TokenBudget,
  ContextHealth,
  ConversationMessage,
  AssembledContext,
} from './context/context-manager';

// Dependency awareness
export { DependencyAwareness } from './deps/dependency-awareness';
export type { DependencyInfo } from './deps/dependency-awareness';
