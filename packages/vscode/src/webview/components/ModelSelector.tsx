import React from 'react';
import { useChatStore } from '../store';

interface Props {
  selectedModelId: string;
  onSelect: (modelId: string) => void;
  modelPool: string[];
}

export function ModelSelector({ selectedModelId, onSelect, modelPool }: Props) {
  const allModels = useChatStore((s) => s.models);

  // Filter to pool models if pool is non-empty
  const models = modelPool.length > 0
    ? allModels.filter(m => modelPool.includes(m.id))
    : allModels;

  return (
    <select
      className="model-selector"
      value={selectedModelId}
      onChange={(e) => onSelect(e.target.value)}
    >
      {!selectedModelId && <option value="">Select Model...</option>}
      {models.map((m) => (
        <option key={m.id} value={m.id}>
          {m.name}
          {m.pricing
            ? ` ($${m.pricing.prompt.toFixed(2)}/$${m.pricing.completion.toFixed(2)})`
            : ''}
        </option>
      ))}
    </select>
  );
}
