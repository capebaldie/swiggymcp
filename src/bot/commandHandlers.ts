import TelegramBot from "node-telegram-bot-api";
import type { SwiggyService } from "../types/mcp.types.js";
import type { SessionStore } from "../memory/sessionStore.js";
import type { ConversationMemory } from "../memory/conversationMemory.js";
import type { McpClientManager } from "../mcp/mcpClientManager.js";
import { MESSAGES, VALID_SERVICES, SERVICE_LABELS, OAUTH_FLOW_TIMEOUT_MS } from "../config/constants.js";
import { buildLoginKeyboard, buildAuthLinkKeyboard } from "./inlineKeyboards.js";
import { logger } from "../utils/logger.js";

export class CommandHandlers {
  private bot: TelegramBot;
  private sessionStore: SessionStore;
  private conversationMemory: ConversationMemory;
  private mcpClientManager: McpClientManager;

  constructor(
    bot: TelegramBot,
    sessionStore: SessionStore,
    conversationMemory: ConversationMemory,
    mcpClientManager: McpClientManager,
  ) {
    this.bot = bot;
    this.sessionStore = sessionStore;
    this.conversationMemory = conversationMemory;
    this.mcpClientManager = mcpClientManager;
  }

  async handleStart(msg: TelegramBot.Message): Promise<void> {
    const userId = msg.from!.id;
    const chatId = msg.chat.id;

    this.sessionStore.getOrCreateSession(userId, chatId, msg.from?.username);
    await this.bot.sendMessage(chatId, MESSAGES.WELCOME, { parse_mode: "HTML" });
  }

  async handleHelp(msg: TelegramBot.Message): Promise<void> {
    await this.bot.sendMessage(msg.chat.id, MESSAGES.HELP, { parse_mode: "HTML" });
  }

  async handleLogin(msg: TelegramBot.Message, serviceArg?: string): Promise<void> {
    const userId = msg.from!.id;
    const chatId = msg.chat.id;

    this.sessionStore.getOrCreateSession(userId, chatId, msg.from?.username);

    if (!serviceArg) {
      // Show service selection buttons
      await this.bot.sendMessage(
        chatId,
        "Which Swiggy service would you like to connect?",
        { reply_markup: { inline_keyboard: buildLoginKeyboard() } },
      );
      return;
    }

    const service = serviceArg.toLowerCase() as SwiggyService;
    if (!VALID_SERVICES.includes(service)) {
      await this.bot.sendMessage(
        chatId,
        `Invalid service. Use one of: ${VALID_SERVICES.join(", ")}`,
      );
      return;
    }

    if (this.sessionStore.isAuthenticated(userId, service)) {
      await this.bot.sendMessage(
        chatId,
        `You're already connected to <b>${SERVICE_LABELS[service]}</b>. Use /logout ${service} to disconnect first.`,
        { parse_mode: "HTML" },
      );
      return;
    }

    await this.initiateLogin(userId, chatId, service);
  }

  async initiateLogin(userId: number, chatId: number, service: SwiggyService): Promise<void> {
    await this.bot.sendMessage(
      chatId,
      `Connecting to <b>${SERVICE_LABELS[service]}</b>...\nPlease wait while I generate your authentication link.`,
      { parse_mode: "HTML" },
    );

    // Register a pending OAuth flow
    const state = crypto.randomUUID();
    this.sessionStore.registerPendingFlow(state, {
      telegramUserId: userId,
      chatId,
      service,
      codeVerifier: "", // Will be set by the OAuth provider
      state,
      createdAt: Date.now(),
      expiresAt: Date.now() + OAUTH_FLOW_TIMEOUT_MS,
    });

    try {
      const authUrl = await this.mcpClientManager.initiateAuth(userId, service);

      if (authUrl) {
        await this.bot.sendMessage(
          chatId,
          `Please click the button below to log in to <b>${SERVICE_LABELS[service]}</b>:\n\n⚠️ This link expires in 5 minutes.`,
          {
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: buildAuthLinkKeyboard(authUrl, service),
            },
          },
        );
      } else {
        // Check if auth URL was stored by the OAuth provider
        const pending = this.sessionStore.getPendingAuthUrl(userId);
        if (pending) {
          await this.bot.sendMessage(
            chatId,
            `Please click the button below to log in to <b>${SERVICE_LABELS[pending.service]}</b>:\n\n⚠️ This link expires in 5 minutes.`,
            {
              parse_mode: "HTML",
              reply_markup: {
                inline_keyboard: buildAuthLinkKeyboard(pending.url, pending.service),
              },
            },
          );
        } else {
          // Already authenticated somehow
          await this.bot.sendMessage(
            chatId,
            MESSAGES.AUTH_SUCCESS(SERVICE_LABELS[service]),
            { parse_mode: "HTML" },
          );
        }
      }
    } catch (err) {
      logger.error("Failed to initiate login", { userId, service, error: String(err) });
      await this.bot.sendMessage(
        chatId,
        `Failed to start authentication for ${SERVICE_LABELS[service]}. Please try again later.`,
      );
    }
  }

  async handleLogout(msg: TelegramBot.Message, serviceArg?: string): Promise<void> {
    const userId = msg.from!.id;
    const chatId = msg.chat.id;

    if (!serviceArg) {
      await this.bot.sendMessage(chatId, "Usage: /logout <service>\nServices: food, instamart, dineout");
      return;
    }

    const service = serviceArg.toLowerCase() as SwiggyService;
    if (!VALID_SERVICES.includes(service)) {
      await this.bot.sendMessage(chatId, `Invalid service. Use one of: ${VALID_SERVICES.join(", ")}`);
      return;
    }

    await this.mcpClientManager.disconnectClient(userId, service);
    this.sessionStore.clearTokens(userId, service);

    await this.bot.sendMessage(
      chatId,
      `Disconnected from <b>${SERVICE_LABELS[service]}</b>.`,
      { parse_mode: "HTML" },
    );
  }

  async handleStatus(msg: TelegramBot.Message): Promise<void> {
    const userId = msg.from!.id;
    const chatId = msg.chat.id;

    const connected = this.sessionStore.getAuthenticatedServices(userId);

    if (connected.length === 0) {
      await this.bot.sendMessage(
        chatId,
        "You're not connected to any Swiggy services.\nUse /login to connect.",
      );
      return;
    }

    const statusLines = VALID_SERVICES.map((s) => {
      const isConnected = connected.includes(s);
      return `${isConnected ? "✅" : "❌"} ${SERVICE_LABELS[s]}`;
    });

    await this.bot.sendMessage(
      chatId,
      `<b>Connection Status:</b>\n\n${statusLines.join("\n")}`,
      { parse_mode: "HTML" },
    );
  }

  async handleClear(msg: TelegramBot.Message): Promise<void> {
    const userId = msg.from!.id;
    this.conversationMemory.clearHistory(userId);
    await this.bot.sendMessage(msg.chat.id, "Conversation history cleared.");
  }
}
