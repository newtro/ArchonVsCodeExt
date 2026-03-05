/**
 * ProviderManager — registry and switcher for LLM providers.
 */

import type { LLMProvider, ProviderId } from './types';
import type { ModelInfo } from '../types';

export class ProviderManager {
  private providers = new Map<ProviderId, LLMProvider>();
  private activeProviderId: ProviderId = 'openrouter';

  register(provider: LLMProvider): void {
    this.providers.set(provider.id, provider);
  }

  get(id: ProviderId): LLMProvider | undefined {
    return this.providers.get(id);
  }

  getActive(): LLMProvider | undefined {
    return this.providers.get(this.activeProviderId);
  }

  getActiveId(): ProviderId {
    return this.activeProviderId;
  }

  setActive(id: ProviderId): void {
    if (!this.providers.has(id)) {
      throw new Error(`Provider "${id}" is not registered`);
    }
    this.activeProviderId = id;
  }

  getAll(): LLMProvider[] {
    return Array.from(this.providers.values());
  }

  /** Get models from the active provider */
  async getModels(): Promise<ModelInfo[]> {
    const provider = this.getActive();
    if (!provider) return [];
    return provider.getModels();
  }

  /** Check which providers are currently available */
  async getAvailability(): Promise<Record<ProviderId, boolean>> {
    const results: Record<string, boolean> = {};
    for (const [id, provider] of this.providers) {
      try {
        results[id] = await provider.isAvailable();
      } catch {
        results[id] = false;
      }
    }
    return results as Record<ProviderId, boolean>;
  }
}
