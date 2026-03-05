/**
 * GlassWire-style Network Monitor — real-time visibility into every
 * outbound request the agent makes.
 */

export type RequestStatus = 'pending' | 'success' | 'error' | 'blocked';
export type ThreatLevel = 'safe' | 'unknown' | 'blocked';

export interface NetworkRequest {
  id: string;
  timestamp: number;
  method: string;
  url: string;
  host: string;
  payloadSize: number;
  responseStatus?: number;
  responseSize?: number;
  duration?: number;
  status: RequestStatus;
  threatLevel: ThreatLevel;
  source: string; // Which tool/agent made the request
}

export interface NetworkMonitorConfig {
  enabled: boolean;
  knownHosts: string[];     // Green — known API providers
  blockedHosts: string[];   // Red — blocked hosts
  logToFile: boolean;
  notifyOnUnknown: boolean;
}

export class NetworkMonitor {
  private requests: NetworkRequest[] = [];
  private config: NetworkMonitorConfig;
  private listeners: Array<(req: NetworkRequest) => void> = [];

  constructor(config?: Partial<NetworkMonitorConfig>) {
    this.config = {
      enabled: config?.enabled ?? true,
      knownHosts: config?.knownHosts ?? [
        'openrouter.ai',
        'api.openai.com',
        'api.anthropic.com',
        'generativelanguage.googleapis.com',
        'localhost',
        '127.0.0.1',
      ],
      blockedHosts: config?.blockedHosts ?? [],
      logToFile: config?.logToFile ?? false,
      notifyOnUnknown: config?.notifyOnUnknown ?? true,
    };
  }

  /**
   * Record an outbound network request.
   */
  recordRequest(
    method: string,
    url: string,
    payloadSize: number,
    source: string,
  ): NetworkRequest {
    const parsedUrl = new URL(url);
    const host = parsedUrl.hostname;

    const threatLevel = this.classifyHost(host);

    const request: NetworkRequest = {
      id: Math.random().toString(36).slice(2, 11),
      timestamp: Date.now(),
      method,
      url,
      host,
      payloadSize,
      status: threatLevel === 'blocked' ? 'blocked' : 'pending',
      threatLevel,
      source,
    };

    this.requests.push(request);
    this.notifyListeners(request);

    return request;
  }

  /**
   * Update a request with response information.
   */
  updateRequest(
    id: string,
    responseStatus: number,
    responseSize: number,
    duration: number,
  ): void {
    const request = this.requests.find(r => r.id === id);
    if (request) {
      request.responseStatus = responseStatus;
      request.responseSize = responseSize;
      request.duration = duration;
      request.status = responseStatus >= 200 && responseStatus < 400 ? 'success' : 'error';
      this.notifyListeners(request);
    }
  }

  /**
   * Check if a host is blocked.
   */
  isHostBlocked(host: string): boolean {
    return this.config.blockedHosts.includes(host);
  }

  /**
   * Get all logged requests.
   */
  getRequests(limit?: number): NetworkRequest[] {
    const sorted = [...this.requests].sort((a, b) => b.timestamp - a.timestamp);
    return limit ? sorted.slice(0, limit) : sorted;
  }

  /**
   * Get request statistics.
   */
  getStats(): {
    total: number;
    byHost: Record<string, number>;
    byStatus: Record<string, number>;
    totalPayloadBytes: number;
    totalResponseBytes: number;
  } {
    const byHost: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    let totalPayload = 0;
    let totalResponse = 0;

    for (const req of this.requests) {
      byHost[req.host] = (byHost[req.host] ?? 0) + 1;
      byStatus[req.status] = (byStatus[req.status] ?? 0) + 1;
      totalPayload += req.payloadSize;
      totalResponse += req.responseSize ?? 0;
    }

    return {
      total: this.requests.length,
      byHost,
      byStatus,
      totalPayloadBytes: totalPayload,
      totalResponseBytes: totalResponse,
    };
  }

  /**
   * Subscribe to request events.
   */
  onRequest(listener: (req: NetworkRequest) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  /**
   * Add a host to known hosts list.
   */
  addKnownHost(host: string): void {
    if (!this.config.knownHosts.includes(host)) {
      this.config.knownHosts.push(host);
    }
  }

  /**
   * Block a host.
   */
  blockHost(host: string): void {
    if (!this.config.blockedHosts.includes(host)) {
      this.config.blockedHosts.push(host);
    }
  }

  /**
   * Clear the request log.
   */
  clear(): void {
    this.requests = [];
  }

  private classifyHost(host: string): ThreatLevel {
    if (this.config.blockedHosts.includes(host)) return 'blocked';
    if (this.config.knownHosts.some(k => host === k || host.endsWith(`.${k}`))) return 'safe';
    return 'unknown';
  }

  private notifyListeners(req: NetworkRequest): void {
    for (const listener of this.listeners) {
      try {
        listener(req);
      } catch {
        // Ignore listener errors
      }
    }
  }
}
