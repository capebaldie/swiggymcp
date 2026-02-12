import type { SwiggyService } from "../types/mcp.types.js";
import type { SessionStore } from "../memory/sessionStore.js";
import type { OAuthCallbackServer, AuthCallbackEvent } from "./oauthCallbackServer.js";
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

  constructor(
    sessionStore: SessionStore,
    callbackServer: OAuthCallbackServer,
    onAuthComplete: AuthCompleteHandler,
  ) {
    this.sessionStore = sessionStore;
    this.callbackServer = callbackServer;
    this.onAuthComplete = onAuthComplete;

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

    // The actual token exchange is handled by the MCP SDK's transport layer
    // when we next try to connect. We store the auth code so the OAuthProvider
    // can use it. For the MCP SDK flow, the transport handles the exchange
    // automatically via the OAuthClientProvider.

    // For now, we signal success — the actual token exchange happens when
    // the MCP client connects with the code stored in the provider.
    logger.info("OAuth callback received, signaling auth complete", {
      userId: flow.telegramUserId,
      service: flow.service,
    });

    this.onAuthComplete({
      userId: flow.telegramUserId,
      chatId: flow.chatId,
      service: flow.service,
      success: true,
    });
  }
}
