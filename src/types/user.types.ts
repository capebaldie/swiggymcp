import type { OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { SwiggyService } from "./mcp.types.js";

export interface UserOAuthState {
  tokens?: OAuthTokens;
  codeVerifier?: string;
  state?: string;
  authenticatedAt?: number;
}

export interface UserSession {
  telegramUserId: number;
  telegramChatId: number;
  username?: string;
  oauthState: Partial<Record<SwiggyService, UserOAuthState>>;
  isAuthenticating: boolean;
  pendingAuthService?: SwiggyService;
  pendingAuthUrl?: string;
  createdAt: number;
  lastActiveAt: number;
}

export interface PendingOAuthFlow {
  telegramUserId: number;
  chatId: number;
  service: SwiggyService;
  codeVerifier: string;
  state: string;
  createdAt: number;
  expiresAt: number;
}
