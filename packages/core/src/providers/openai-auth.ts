/**
 * OpenAI OAuth PKCE authentication for ChatGPT subscription users.
 *
 * Implements the same OAuth flow used by the Codex CLI (open source):
 * - Authorization via https://auth.openai.com/oauth/authorize
 * - Token exchange via https://auth.openai.com/oauth/token
 * - Token refresh with single-use rotation
 *
 * Two auth modes:
 * - 'api-key': standard sk-... API key against api.openai.com/v1
 * - 'subscription': OAuth JWT against chatgpt.com/backend-api/codex
 */

import * as http from 'http';
import * as crypto from 'crypto';

// ── Constants (from Codex CLI open-source repo) ──

const AUTH_BASE = 'https://auth.openai.com';
const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const REDIRECT_PORT = 1455;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/auth/callback`;
const SCOPES = 'openid profile email offline_access api.connectors.read api.connectors.invoke';
const TOKEN_REFRESH_INTERVAL_MS = 8 * 60 * 1000; // 8 minutes

// ── Types ──

export type OpenAIAuthMode = 'api-key' | 'subscription';

export interface OpenAITokens {
  accessToken: string;
  refreshToken: string;
  idToken: string;
  accountId?: string;
}

export interface OpenAISubscriptionInfo {
  planType?: string; // free, go, plus, pro, team, business, enterprise, edu
  email?: string;
  accountId?: string;
}

export interface OpenAIAuthState {
  mode: OpenAIAuthMode;
  apiKey?: string;
  tokens?: OpenAITokens;
  subscriptionInfo?: OpenAISubscriptionInfo;
}

// Callbacks for the extension to handle token persistence
export interface OpenAIAuthCallbacks {
  /** Called when tokens are obtained or refreshed — persist them */
  onTokensUpdated: (tokens: OpenAITokens) => Promise<void>;
  /** Called to open a URL in the user's browser */
  openBrowser: (url: string) => Promise<void>;
  /** Called on auth errors */
  onError?: (error: string) => void;
}

// ── PKCE Helpers ──

function generateCodeVerifier(): string {
  return crypto.randomBytes(64).toString('base64url');
}

function generateCodeChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

function generateState(): string {
  return crypto.randomBytes(32).toString('base64url');
}

// ── JWT Parsing (no verification — we trust auth.openai.com) ──

function parseJwtPayload(token: string): Record<string, unknown> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return {};
    const payload = Buffer.from(parts[1], 'base64url').toString('utf-8');
    return JSON.parse(payload) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function extractSubscriptionInfo(idToken: string): OpenAISubscriptionInfo {
  const payload = parseJwtPayload(idToken);
  const authClaims = (payload['https://api.openai.com/auth'] ?? {}) as Record<string, unknown>;
  return {
    planType: authClaims['chatgpt_plan_type'] as string | undefined,
    email: payload['email'] as string | undefined,
    accountId: authClaims['chatgpt_account_id'] as string | undefined,
  };
}

// ── OAuth Flow ──

/**
 * Start the OAuth PKCE flow for ChatGPT subscription authentication.
 * Opens a browser window and listens for the callback on localhost:1455.
 * Returns the obtained tokens.
 */
export async function startOAuthFlow(callbacks: OpenAIAuthCallbacks): Promise<OpenAITokens> {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = generateState();

  // Build authorization URL
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    id_token_add_organizations: 'true',
    codex_cli_simplified_flow: 'true',
    state,
    originator: 'archon-vscode',
  });

  const authorizeUrl = `${AUTH_BASE}/oauth/authorize?${params.toString()}`;

  // Start localhost callback server
  const authCode = await new Promise<string>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (!req.url?.startsWith('/auth/callback')) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }

      const url = new URL(req.url, `http://localhost:${REDIRECT_PORT}`);
      const error = url.searchParams.get('error');
      const returnedState = url.searchParams.get('state');
      const code = url.searchParams.get('code');

      // Send success page to browser
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`
        <html>
          <body style="font-family: system-ui; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #1a1a2e; color: #e0e0e0;">
            <div style="text-align: center;">
              <h1>${error ? 'Authentication Failed' : 'Authenticated!'}</h1>
              <p>${error ? `Error: ${error}` : 'You can close this tab and return to VS Code.'}</p>
            </div>
          </body>
        </html>
      `);

      server.close();

      if (error) {
        const errorDesc = url.searchParams.get('error_description') ?? error;
        reject(new Error(`OAuth error: ${errorDesc}`));
        return;
      }

      if (returnedState !== state) {
        reject(new Error('OAuth state mismatch — possible CSRF attack'));
        return;
      }

      if (!code) {
        reject(new Error('No authorization code received'));
        return;
      }

      resolve(code);
    });

    server.on('error', (err) => {
      reject(new Error(`Failed to start OAuth callback server on port ${REDIRECT_PORT}: ${err.message}`));
    });

    server.listen(REDIRECT_PORT, '127.0.0.1', () => {
      // Server is ready, open browser
      callbacks.openBrowser(authorizeUrl).catch(reject);
    });

    // Timeout after 5 minutes
    setTimeout(() => {
      server.close();
      reject(new Error('OAuth flow timed out (5 minutes)'));
    }, 5 * 60 * 1000);
  });

  // Exchange authorization code for tokens
  const tokens = await exchangeCodeForTokens(authCode, codeVerifier);

  // Notify extension to persist tokens
  await callbacks.onTokensUpdated(tokens);

  return tokens;
}

async function exchangeCodeForTokens(code: string, codeVerifier: string): Promise<OpenAITokens> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    client_id: CLIENT_ID,
    code_verifier: codeVerifier,
  });

  const res = await fetch(`${AUTH_BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${errText}`);
  }

  const data = await res.json() as {
    id_token: string;
    access_token: string;
    refresh_token: string;
  };

  const info = extractSubscriptionInfo(data.id_token);

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    idToken: data.id_token,
    accountId: info.accountId,
  };
}

/**
 * Refresh the access token using the refresh token.
 * Refresh tokens are single-use with rotation — the new refresh token
 * must be persisted immediately.
 */
export async function refreshTokens(currentTokens: OpenAITokens): Promise<OpenAITokens> {
  const res = await fetch(`${AUTH_BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: CLIENT_ID,
      grant_type: 'refresh_token',
      refresh_token: currentTokens.refreshToken,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    // Check for known refresh errors that require re-authentication
    if (errText.includes('refresh_token_expired') ||
        errText.includes('refresh_token_reused') ||
        errText.includes('refresh_token_invalidated')) {
      throw new OpenAIAuthError('refresh_expired', `Refresh token is no longer valid: ${errText}`);
    }
    throw new Error(`Token refresh failed (${res.status}): ${errText}`);
  }

  const data = await res.json() as {
    id_token?: string;
    access_token?: string;
    refresh_token?: string;
  };

  return {
    accessToken: data.access_token ?? currentTokens.accessToken,
    refreshToken: data.refresh_token ?? currentTokens.refreshToken,
    idToken: data.id_token ?? currentTokens.idToken,
    accountId: currentTokens.accountId,
  };
}

/** Typed error for auth-specific failures that callers can handle. */
export class OpenAIAuthError extends Error {
  constructor(public code: 'refresh_expired' | 'not_authenticated' | 'entitlement_missing', message: string) {
    super(message);
    this.name = 'OpenAIAuthError';
  }
}

// ── Token Refresh Manager ──

/**
 * Manages automatic token refresh on a timer.
 * Used by the extension host to keep subscription tokens fresh.
 */
export class TokenRefreshManager {
  private timer: ReturnType<typeof setInterval> | null = null;
  private tokens: OpenAITokens | null = null;
  private onTokensUpdated: (tokens: OpenAITokens) => Promise<void>;
  private onError: (error: string) => void;

  constructor(opts: {
    onTokensUpdated: (tokens: OpenAITokens) => Promise<void>;
    onError: (error: string) => void;
  }) {
    this.onTokensUpdated = opts.onTokensUpdated;
    this.onError = opts.onError;
  }

  /** Start auto-refresh with the given tokens. */
  start(tokens: OpenAITokens): void {
    this.stop();
    this.tokens = tokens;
    this.timer = setInterval(() => this.refresh(), TOKEN_REFRESH_INTERVAL_MS);
  }

  /** Stop auto-refresh. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.tokens = null;
  }

  /** Update tokens (e.g., after a manual refresh). */
  updateTokens(tokens: OpenAITokens): void {
    this.tokens = tokens;
  }

  /** Get current tokens. */
  getTokens(): OpenAITokens | null {
    return this.tokens;
  }

  private async refresh(): Promise<void> {
    if (!this.tokens) return;

    try {
      const newTokens = await refreshTokens(this.tokens);
      this.tokens = newTokens;
      await this.onTokensUpdated(newTokens);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.onError(message);

      // If the refresh token is expired, stop auto-refresh
      if (err instanceof OpenAIAuthError && err.code === 'refresh_expired') {
        this.stop();
      }
    }
  }
}
