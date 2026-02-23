import type { SwiggyService } from "../types/mcp.types.js";
import type { SessionStore } from "../memory/sessionStore.js";
import type { OAuthCallbackServer, AuthCallbackEvent } from "./oauthCallbackServer.js";
import { SwiggyOAuthProvider } from "../mcp/oauthProvider.js";
import { auth } from "@modelcontextprotocol/sdk/client/auth.js";
import { logger } from "../utils/logger.js";

export interface AuthCompleteEvent {
  userId: number;
  chatId: number;
  service: SwiggyService;
  success: boolean;
  error?: string;
}

export type AuthCompleteHandler = (event: AuthCompleteEvent) => void;

export class TokenManager {
  private sessionStore: SessionStore;
  private callbackServer: OAuthCallbackServer;
  private onAuthComplete: AuthCompleteHandler;
  private endpoints: Record<SwiggyService, string>;
  private callbackPort: number;
  private callbackHost: string;

  constructor(
    sessionStore: SessionStore,
    callbackServer: OAuthCallbackServer,
    onAuthComplete: AuthCompleteHandler,
    endpoints: Record<SwiggyService, string>,
    callbackPort: number,
    callbackHost: string = "localhost",
  ) {
    this.sessionStore = sessionStore;
    this.callbackServer = callbackServer;
    this.onAuthComplete = onAuthComplete;
    this.endpoints = endpoints;
    this.callbackPort = callbackPort;
    this.callbackHost = callbackHost;

    this.callbackServer.on("authCallback", (event: AuthCallbackEvent) => {
      this.handleCallback(event).catch((err) => {
        logger.error("Error handling auth callback", { error: String(err) });
      });
    });
  }

  private async handleCallback(event: AuthCallbackEvent): Promise<void> {
    const { code, state } = event;
    const flow = this.sessionStore.getPendingFlow(state);

    if (!flow) {
      logger.warn("Received callback for unknown state", { state: state.substring(0, 8) });
      return;
    }

    // Check expiry
    if (Date.now() > flow.expiresAt) {
      this.sessionStore.removePendingFlow(state);
      this.onAuthComplete({
        userId: flow.telegramUserId,
        chatId: flow.chatId,
        service: flow.service,
        success: false,
        error: "Authentication flow expired. Please try /login again.",
      });
      return;
    }

    this.sessionStore.removePendingFlow(state);

    // Exchange the authorization code for tokens using the MCP SDK's auth flow
    try {
      const oauthProvider = new SwiggyOAuthProvider(
        flow.telegramUserId,
        flow.service,
        this.sessionStore,
        this.callbackPort,
        this.callbackHost,
      );

      const serverUrl = this.endpoints[flow.service];
      const result = await auth(oauthProvider, {
        serverUrl,
        authorizationCode: code,
      });

      if (result === "AUTHORIZED") {
        logger.info("OAuth token exchange successful", {
          userId: flow.telegramUserId,
          service: flow.service,
        });

        this.onAuthComplete({
          userId: flow.telegramUserId,
          chatId: flow.chatId,
          service: flow.service,
          success: true,
        });
      } else {
        logger.warn("OAuth token exchange returned unexpected result", {
          userId: flow.telegramUserId,
          service: flow.service,
          result,
        });

        this.onAuthComplete({
          userId: flow.telegramUserId,
          chatId: flow.chatId,
          service: flow.service,
          success: false,
          error: "Token exchange failed. Please try /login again.",
        });
      }
    } catch (err) {
      logger.error("OAuth token exchange failed", {
        userId: flow.telegramUserId,
        service: flow.service,
        error: String(err),
      });

      this.onAuthComplete({
        userId: flow.telegramUserId,
        chatId: flow.chatId,
        service: flow.service,
        success: false,
        error: "Token exchange failed. Please try /login again.",
      });
    }
  }
}
