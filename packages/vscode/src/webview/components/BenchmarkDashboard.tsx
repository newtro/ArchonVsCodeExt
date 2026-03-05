/**
 * Live Model Benchmark Dashboard — shows coding benchmark rankings
 * fetched from SWE-Bench, LiveCodeBench, and Aider leaderboards.
 *
 * Layout: models as rows, benchmark sources as columns.
 */

import React, { useState, useMemo } from 'react';
import type { BenchmarkSource, BenchmarkModelEntry, ModelInfo } from '@archon/core';

interface Props {
  sources: BenchmarkSource[];
  onRefresh: () => void;
  isLoading: boolean;
  modelPool: string[];
  selectedModelId: string;
  models: ModelInfo[];
  onAddToPool: (modelId: string) => void;
  onSetDefault: (modelId: string) => void;
}

interface MergedModel {
  name: string;
  provider: string;
  scores: Record<string, number | undefined>;       // sourceName -> score
  secondaryScores: Record<string, number | undefined>;
  costs: Record<string, number | undefined>;
  date?: string;
  bestScore: number; // for sorting
}

/**
 * Try to match a benchmark model name to an OpenRouter model ID.
 */
function findMatchingModelId(benchmarkName: string, models: ModelInfo[]): string | undefined {
  const lower = benchmarkName.toLowerCase()
    .replace(/[^a-z0-9.\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const directMatch = models.find(m => m.id.toLowerCase() === lower || m.name.toLowerCase() === lower);
  if (directMatch) return directMatch.id;

  const tokens = lower.split(/[\s\-_]+/).filter(t => t.length > 1);
  if (tokens.length === 0) return undefined;

  let bestMatch: ModelInfo | undefined;
  let bestScore = 0;

  for (const m of models) {
    const mLower = (m.name + ' ' + m.id).toLowerCase();
    let score = 0;
    for (const token of tokens) {
      if (mLower.includes(token)) score++;
    }
    if (score > bestScore && score >= Math.min(2, tokens.length)) {
      bestScore = score;
      bestMatch = m;
    }
  }

  return bestMatch?.id;
}

/**
 * Normalize a model name to a canonical key for merging across sources.
 * e.g., "Claude 4.5 Opus (high reasoning)" and "claude-4-5-opus" should merge.
 */
function normalizeModelKey(name: string): string {
  return name.toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const SOURCE_LABELS: Record<string, string> = {
  'SWE-Bench Verified': 'SWE-Bench',
  'LiveCodeBench': 'LiveCodeBench',
  'Aider Code Editing': 'Aider',
};

const SCORE_UNITS: Record<string, string> = {
  'SWE-Bench Verified': '% Resolved',
  'LiveCodeBench': 'Pass@1 %',
  'Aider Code Editing': 'Pass Rate %',
};

type SortColumn = 'name' | string; // string = source name

export function BenchmarkDashboard({
  sources, onRefresh, isLoading, modelPool, selectedModelId, models,
  onAddToPool, onSetDefault,
}: Props) {
  const [filterProvider, setFilterProvider] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortCol, setSortCol] = useState<SortColumn>('best');
  const [sortAsc, setSortAsc] = useState(false);

  // Merge entries from all sources into unified rows keyed by model name
  const { merged, allProviders } = useMemo(() => {
    const modelMap = new Map<string, MergedModel>();
    const providerSet = new Set<string>();

    for (const source of sources) {
      for (const entry of source.entries) {
        const key = normalizeModelKey(entry.model);
        providerSet.add(entry.provider);

        let existing = modelMap.get(key);
        if (!existing) {
          existing = {
            name: entry.model,
            provider: entry.provider,
            scores: {},
            secondaryScores: {},
            costs: {},
            date: entry.date,
            bestScore: 0,
          };
          modelMap.set(key, existing);
        }

        existing.scores[source.name] = entry.score;
        if (entry.secondaryScore != null) existing.secondaryScores[source.name] = entry.secondaryScore;
        if (entry.cost != null) existing.costs[source.name] = entry.cost;
        if (entry.date && !existing.date) existing.date = entry.date;

        // Keep the longest/most descriptive name
        if (entry.model.length > existing.name.length) {
          existing.name = entry.model;
        }

        // Track best score across sources for default sorting
        if (entry.score > existing.bestScore) existing.bestScore = entry.score;
      }
    }

    return {
      merged: Array.from(modelMap.values()),
      allProviders: Array.from(providerSet).sort(),
    };
  }, [sources]);

  // Filter and sort
  const rows = useMemo(() => {
    let result = merged;
    if (filterProvider !== 'all') {
      result = result.filter(m => m.provider === filterProvider);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(m =>
        m.name.toLowerCase().includes(q) || m.provider.toLowerCase().includes(q)
      );
    }

    result = [...result].sort((a, b) => {
      let aVal: number | string = 0;
      let bVal: number | string = 0;

      if (sortCol === 'name') {
        aVal = a.name.toLowerCase();
        bVal = b.name.toLowerCase();
        return sortAsc ? (aVal < bVal ? -1 : 1) : (bVal < aVal ? -1 : 1);
      } else if (sortCol === 'best') {
        aVal = a.bestScore;
        bVal = b.bestScore;
      } else {
        // Sort by a specific source column
        aVal = a.scores[sortCol] ?? -1;
        bVal = b.scores[sortCol] ?? -1;
      }

      return sortAsc ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number);
    });

    return result;
  }, [merged, filterProvider, searchQuery, sortCol, sortAsc]);

  // Compute top score per source column (for highlighting)
  const topScores = useMemo(() => {
    const tops: Record<string, number> = {};
    for (const source of sources) {
      let max = -1;
      for (const row of rows) {
        const score = row.scores[source.name];
        if (score != null && score > max) max = score;
      }
      if (max >= 0) tops[source.name] = max;
    }
    return tops;
  }, [sources, rows]);

  // Model ID matching
  const modelIdMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of merged) {
      const id = findMatchingModelId(row.name, models);
      if (id) map.set(row.name, id);
    }
    return map;
  }, [merged, models]);

  const handleSort = (col: SortColumn) => {
    if (sortCol === col) {
      setSortAsc(!sortAsc);
    } else {
      setSortCol(col);
      setSortAsc(false);
    }
  };

  const sortIndicator = (col: SortColumn) => {
    if (sortCol !== col) return '';
    return sortAsc ? ' \u25B2' : ' \u25BC';
  };

  return (
    <div className="benchmark-dashboard">
      {/* Header */}
      <div className="bench-header">
        <h3>Model Benchmarks</h3>
        <div className="bench-controls">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search models..."
            className="bench-search"
          />
          <select
            value={filterProvider}
            onChange={(e) => setFilterProvider(e.target.value)}
            className="bench-select"
          >
            <option value="all">All Organizations</option>
            {allProviders.map(p => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
          <button onClick={onRefresh} disabled={isLoading} className="bench-refresh-btn">
            {isLoading ? 'Loading...' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Source links */}
      {sources.length > 0 && (
        <div className="bench-sources-bar">
          {sources.map(s => (
            <a key={s.name} className="bench-source-link" href={s.url} title={`Open ${s.name}`}>
              {SOURCE_LABELS[s.name] ?? s.name}
            </a>
          ))}
          {sources[0]?.lastFetched > 0 && (
            <span className="bench-updated">
              Updated {new Date(sources[0].lastFetched).toLocaleTimeString()}
            </span>
          )}
        </div>
      )}

      {/* Empty state */}
      {sources.length === 0 ? (
        <div className="bench-empty">
          {isLoading ? (
            <p>Fetching benchmark data from SWE-Bench, LiveCodeBench, and Aider...</p>
          ) : (
            <>
              <p>No benchmark data loaded yet.</p>
              <button onClick={onRefresh} className="bench-load-btn">Load Benchmarks</button>
            </>
          )}
        </div>
      ) : (
        /* Data table */
        <div className="bench-table-wrap">
          <table className="bench-table">
            <thead>
              <tr>
                <th className="col-rank">#</th>
                <th className="col-model clickable" onClick={() => handleSort('name')}>
                  Model{sortIndicator('name')}
                </th>
                <th className="col-org">Org</th>
                {sources.map(s => (
                  <th
                    key={s.name}
                    className="col-score clickable"
                    onClick={() => handleSort(s.name)}
                    title={SCORE_UNITS[s.name] ?? 'Score'}
                  >
                    {SOURCE_LABELS[s.name] ?? s.name}{sortIndicator(s.name)}
                  </th>
                ))}
                <th className="col-date">Date</th>
                <th className="col-actions"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const matchedId = modelIdMap.get(row.name);
                const inPool = matchedId ? modelPool.includes(matchedId) : false;
                const isDefault = matchedId === selectedModelId;

                return (
                  <tr key={row.name} className={inPool ? 'row-pool' : ''}>
                    <td className="col-rank">{i + 1}</td>
                    <td className="col-model">
                      <span className="model-name">{row.name}</span>
                      {inPool && <span className="badge badge-pool">pool</span>}
                      {isDefault && <span className="badge badge-default">default</span>}
                    </td>
                    <td className="col-org">{row.provider}</td>
                    {sources.map(s => {
                      const score = row.scores[s.name];
                      const isTop = score != null && topScores[s.name] != null && score === topScores[s.name];
                      return (
                        <td key={s.name} className={`col-score ${isTop ? 'score-top' : ''}`}>
                          {score != null ? (
                            <span className={`score-value ${isTop ? 'score-top-value' : ''}`}>{score.toFixed(1)}</span>
                          ) : (
                            <span className="score-empty">-</span>
                          )}
                        </td>
                      );
                    })}
                    <td className="col-date">{row.date ?? '-'}</td>
                    <td className="col-actions">
                      {!inPool && (
                        <button
                          className="action-btn"
                          onClick={() => onAddToPool(matchedId ?? row.name)}
                          title={matchedId ? 'Add to model pool' : 'Add to model pool (no exact match found)'}
                        >
                          + Pool
                        </button>
                      )}
                      {!isDefault && (
                        <button
                          className="action-btn"
                          onClick={() => onSetDefault(matchedId ?? row.name)}
                          title={matchedId ? 'Set as default model' : 'Set as default model (no exact match found)'}
                        >
                          Set Default
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows.length === 0 && (
            <div className="bench-no-results">No models match the selected filter.</div>
          )}
        </div>
      )}
    </div>
  );
}
