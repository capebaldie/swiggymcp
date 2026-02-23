import type {
  OAuthClientProvider,
} from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthTokens,
  OAuthClientInformationFull,
  OAuthClientInformation,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { SwiggyService } from "../types/mcp.types.js";
import type { SessionStore } from "../memory/sessionStore.js";
import { logger } from "../utils/logger.js";

/**
 * Per-user, per-service OAuth provider that implements the MCP SDK's
 * OAuthClientProvider interface. This bridges Swiggy's OAuth flow
 * with Telegram's non-browser interaction model.
 *
 * Instead of opening a browser directly, redirectToAuthorization()
 * stores the URL so the bot can send it to the user via Telegram.
 */
export class SwiggyOAuthProvider implements OAuthClientProvider {
  private userId: number;
  private service: SwiggyService;
  private sessionStore: SessionStore;
  private callbackPort: number;
  private callbackHost: string;
  private oauthState?: string;

  constructor(
    userId: number,
    service: SwiggyService,
    sessionStore: SessionStore,
    callbackPort: number,
    callbackHost: string = "localhost",
    oauthState?: string,
  ) {
    this.userId = userId;
    this.service = service;
    this.sessionStore = sessionStore;
    this.callbackPort = callbackPort;
    this.callbackHost = callbackHost;
    this.oauthState = oauthState;
  }

  get redirectUrl(): string {
    return `http://${this.callbackHost}:${this.callbackPort}/callback`;
  }

  get clientMetadata() {
    return {
      client_name: `swiggymcp-telegram-bot`,
      redirect_uris: [this.redirectUrl] as [string, ...string[]],
      grant_types: ["authorization_code" as const],
      response_types: ["code" as const],
    };
  }

  async clientInformation(): Promise<OAuthClientInformation | undefined> {
    return this.sessionStore.getClientInfo(this.userId, this.service);
  }

  async saveClientInformation(info: OAuthClientInformationFull): Promise<void> {
    this.sessionStore.saveClientInfo(this.userId, this.service, info);
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    return this.sessionStore.getTokens(this.userId, this.service);
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    logger.info("Saving OAuth tokens", { userId: this.userId, service: this.service });
    this.sessionStore.saveTokens(this.userId, this.service, tokens);
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    // Store the authorization URL for the bot to send to the user via Telegram
    logger.info("OAuth redirect requested", {
      userId: this.userId,
      service: this.service,
    });
    this.sessionStore.setPendingAuthUrl(
      this.userId,
      this.service,
      authorizationUrl.toString(),
    );
  }

  async state(): Promise<string> {
    return this.oauthState ?? crypto.randomUUID();
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    this.sessionStore.saveCodeVerifier(this.userId, this.service, codeVerifier);
  }

  async codeVerifier(): Promise<string> {
    return this.sessionStore.getCodeVerifier(this.userId, this.service);
  }
}
