import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { SwiggyService } from "../types/mcp.types.js";
import type { SessionStore } from "../memory/sessionStore.js";
import { SwiggyOAuthProvider } from "./oauthProvider.js";
import { AuthenticationRequiredError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";

export class McpClientManager {
  private clients: Map<string, Client> = new Map();
  private transports: Map<string, StreamableHTTPClientTransport> = new Map();
  private sessionStore: SessionStore;
  private endpoints: Record<SwiggyService, string>;
  private callbackPort: number;
  private callbackHost: string;

  constructor(
    sessionStore: SessionStore,
    endpoints: Record<SwiggyService, string>,
    callbackPort: number,
    callbackHost: string = "localhost",
  ) {
    this.sessionStore = sessionStore;
    this.endpoints = endpoints;
    this.callbackPort = callbackPort;
    this.callbackHost = callbackHost;
  }

  private getKey(userId: number, service: SwiggyService): string {
    return `${userId}:${service}`;
  }

  /**
   * Get or create an authenticated MCP client for a user + service.
   * If the user isn't authenticated, the transport's OAuth flow will
   * trigger, storing the auth URL for the bot to send.
   */
  async getClient(userId: number, service: SwiggyService): Promise<Client> {
    const key = this.getKey(userId, service);
    const existing = this.clients.get(key);
    if (existing) return existing;

    // Check if user has tokens already
    if (!this.sessionStore.isAuthenticated(userId, service)) {
      throw new AuthenticationRequiredError(userId, service);
    }

    const oauthProvider = new SwiggyOAuthProvider(
      userId,
      service,
      this.sessionStore,
      this.callbackPort,
      this.callbackHost,
    );

    const url = new URL(this.endpoints[service]);
    const transport = new StreamableHTTPClientTransport(url, {
      authProvider: oauthProvider,
    });

    const client = new Client(
      { name: "swiggymcp-telegram-bot", version: "1.0.0" },
      { capabilities: {} },
    );

    try {
      await client.connect(transport);
      logger.info("MCP client connected", { userId, service });
    } catch (err) {
      logger.error("MCP client connection failed", {
        userId,
        service,
        error: String(err),
      });

      // Check if OAuth redirect was triggered
      const pendingAuth = this.sessionStore.getPendingAuthUrl(userId);
      if (pendingAuth) {
        throw new AuthenticationRequiredError(userId, service);
      }
      throw err;
    }

    this.clients.set(key, client);
    this.transports.set(key, transport);
    return client;
  }

  /**
   * Initiate OAuth flow for a user + service.
   * Creates a transport that will trigger OAuth, stores the auth URL.
   * Returns the auth URL for the bot to send to the user.
   */
  async initiateAuth(userId: number, service: SwiggyService): Promise<string | null> {
    const oauthProvider = new SwiggyOAuthProvider(
      userId,
      service,
      this.sessionStore,
      this.callbackPort,
      this.callbackHost,
    );

    const url = new URL(this.endpoints[service]);
    const transport = new StreamableHTTPClientTransport(url, {
      authProvider: oauthProvider,
    });

    const client = new Client(
      { name: "swiggymcp-telegram-bot", version: "1.0.0" },
      { capabilities: {} },
    );

    try {
      // This will trigger the OAuth flow since there are no tokens
      await client.connect(transport);
      // If it succeeds, auth was already done (shouldn't normally happen here)
      const key = this.getKey(userId, service);
      this.clients.set(key, client);
      this.transports.set(key, transport);
      return null;
    } catch {
      // Expected: connection fails because OAuth redirect happened
      const pending = this.sessionStore.getPendingAuthUrl(userId);
      if (pending) {
        return pending.url;
      }
      return null;
    }
  }

  /**
   * Disconnect and remove a client for a user + service.
   */
  async disconnectClient(userId: number, service: SwiggyService): Promise<void> {
    const key = this.getKey(userId, service);
    const client = this.clients.get(key);
    if (client) {
      try {
        await client.close();
      } catch {
        // Ignore close errors
      }
      this.clients.delete(key);
      this.transports.delete(key);
    }
  }

  /**
   * Disconnect all clients for a user.
   */
  async disconnectUser(userId: number): Promise<void> {
    for (const service of ["food", "instamart", "dineout"] as SwiggyService[]) {
      await this.disconnectClient(userId, service);
    }
  }

  /**
   * Remove cached client (e.g., after auth refresh) so next getClient creates fresh connection.
   */
  invalidateClient(userId: number, service: SwiggyService): void {
    const key = this.getKey(userId, service);
    this.clients.delete(key);
    this.transports.delete(key);
  }
}
