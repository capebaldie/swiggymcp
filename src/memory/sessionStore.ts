import type { OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { SwiggyService } from "../types/mcp.types.js";
import type { UserSession, PendingOAuthFlow } from "../types/user.types.js";

export class SessionStore {
  private sessions: Map<number, UserSession> = new Map();
  private pendingFlows: Map<string, PendingOAuthFlow> = new Map();
  private clientInfos: Map<string, OAuthClientInformationFull> = new Map();

  getOrCreateSession(userId: number, chatId: number, username?: string): UserSession {
    if (!this.sessions.has(userId)) {
      this.sessions.set(userId, {
        telegramUserId: userId,
        telegramChatId: chatId,
        username,
        oauthState: {},
        isAuthenticating: false,
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
      });
    }
    const session = this.sessions.get(userId)!;
    session.lastActiveAt = Date.now();
    return session;
  }

  getSession(userId: number): UserSession | undefined {
    return this.sessions.get(userId);
  }

  // OAuth tokens
  saveTokens(userId: number, service: SwiggyService, tokens: OAuthTokens): void {
    const session = this.sessions.get(userId);
    if (!session) return;
    if (!session.oauthState[service]) session.oauthState[service] = {};
    session.oauthState[service]!.tokens = tokens;
    session.oauthState[service]!.authenticatedAt = Date.now();
    session.isAuthenticating = false;
    session.pendingAuthService = undefined;
    session.pendingAuthUrl = undefined;
  }

  getTokens(userId: number, service: SwiggyService): OAuthTokens | undefined {
    return this.sessions.get(userId)?.oauthState[service]?.tokens;
  }

  clearTokens(userId: number, service: SwiggyService): void {
    const session = this.sessions.get(userId);
    if (!session?.oauthState[service]) return;
    delete session.oauthState[service];
  }

  // Code verifier for PKCE
  saveCodeVerifier(userId: number, service: SwiggyService, verifier: string): void {
    const session = this.sessions.get(userId);
    if (!session) return;
    if (!session.oauthState[service]) session.oauthState[service] = {};
    session.oauthState[service]!.codeVerifier = verifier;
  }

  getCodeVerifier(userId: number, service: SwiggyService): string {
    return this.sessions.get(userId)?.oauthState[service]?.codeVerifier ?? "";
  }

  // Client information (from dynamic client registration)
  saveClientInfo(userId: number, service: SwiggyService, info: OAuthClientInformationFull): void {
    this.clientInfos.set(`${userId}:${service}`, info);
  }

  getClientInfo(userId: number, service: SwiggyService): OAuthClientInformationFull | undefined {
    return this.clientInfos.get(`${userId}:${service}`);
  }

  // Pending auth URL (for sending to Telegram user)
  setPendingAuthUrl(userId: number, service: SwiggyService, url: string): void {
    const session = this.sessions.get(userId);
    if (!session) return;
    session.pendingAuthUrl = url;
    session.pendingAuthService = service;
    session.isAuthenticating = true;
  }

  getPendingAuthUrl(userId: number): { url: string; service: SwiggyService } | undefined {
    const session = this.sessions.get(userId);
    if (!session?.pendingAuthUrl || !session.pendingAuthService) return undefined;
    return { url: session.pendingAuthUrl, service: session.pendingAuthService };
  }

  clearPendingAuth(userId: number): void {
    const session = this.sessions.get(userId);
    if (!session) return;
    session.isAuthenticating = false;
    session.pendingAuthService = undefined;
    session.pendingAuthUrl = undefined;
  }

  // Pending OAuth flows (matched by state parameter)
  registerPendingFlow(state: string, flow: PendingOAuthFlow): void {
    this.pendingFlows.set(state, flow);
  }

  getPendingFlow(state: string): PendingOAuthFlow | undefined {
    return this.pendingFlows.get(state);
  }

  removePendingFlow(state: string): void {
    this.pendingFlows.delete(state);
  }

  // Check authentication status
  isAuthenticated(userId: number, service: SwiggyService): boolean {
    return !!this.sessions.get(userId)?.oauthState[service]?.tokens;
  }

  getAuthenticatedServices(userId: number): SwiggyService[] {
    const session = this.sessions.get(userId);
    if (!session) return [];
    return (Object.keys(session.oauthState) as SwiggyService[]).filter(
      (s) => !!session.oauthState[s]?.tokens,
    );
  }
}
