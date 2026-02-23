import TelegramBot from "node-telegram-bot-api";
import type { SwiggyService } from "../types/mcp.types.js";
import type { SessionStore } from "../memory/sessionStore.js";
import type { ConversationMemory } from "../memory/conversationMemory.js";
import type { McpClientManager } from "../mcp/mcpClientManager.js";
import type { ToolDiscovery } from "../mcp/toolDiscovery.js";
import type { ToolInvoker } from "../mcp/toolInvoker.js";
import { MESSAGES, VALID_SERVICES, SERVICE_LABELS, OAUTH_FLOW_TIMEOUT_MS } from "../config/constants.js";
import { buildLoginKeyboard, buildAuthLinkKeyboard } from "./inlineKeyboards.js";
import { logger } from "../utils/logger.js";

export class CommandHandlers {
  private bot: TelegramBot;
  private sessionStore: SessionStore;
  private conversationMemory: ConversationMemory;
  private mcpClientManager: McpClientManager;
  private toolDiscovery: ToolDiscovery;
  private toolInvoker: ToolInvoker;

  constructor(
    bot: TelegramBot,
    sessionStore: SessionStore,
    conversationMemory: ConversationMemory,
    mcpClientManager: McpClientManager,
    toolDiscovery: ToolDiscovery,
    toolInvoker: ToolInvoker,
  ) {
    this.bot = bot;
    this.sessionStore = sessionStore;
    this.conversationMemory = conversationMemory;
    this.mcpClientManager = mcpClientManager;
    this.toolDiscovery = toolDiscovery;
    this.toolInvoker = toolInvoker;
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
      const authUrl = await this.mcpClientManager.initiateAuth(userId, service, state);

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

  async handleDetails(msg: TelegramBot.Message): Promise<void> {
    const userId = msg.from!.id;
    const chatId = msg.chat.id;

    const connected = this.sessionStore.getAuthenticatedServices(userId);
    if (connected.length === 0) {
      await this.bot.sendMessage(
        chatId,
        "You're not connected to any Swiggy services.\nUse /login to connect first.",
      );
      return;
    }

    await this.bot.sendChatAction(chatId, "typing");

    const sections: string[] = [];

    // For each connected service, fetch user details via available MCP tools
    for (const service of connected) {
      const tools = this.toolDiscovery.getToolsForService(service, userId);

      // Find address-related tools
      const addressTool = tools.find((t) => {
        const name = t.tool.name.toLowerCase();
        const desc = (t.tool.description ?? "").toLowerCase();
        return name.includes("address") || name.includes("location") ||
          desc.includes("address") || desc.includes("saved location");
      });

      // Find profile/user-related tools
      const profileTool = tools.find((t) => {
        const name = t.tool.name.toLowerCase();
        const desc = (t.tool.description ?? "").toLowerCase();
        return name.includes("profile") || name.includes("user") || name.includes("account") ||
          desc.includes("profile") || desc.includes("user detail") || desc.includes("account");
      });

      let serviceSection = `<b>${SERVICE_LABELS[service]}</b>\n`;
      let hasData = false;

      try {
        const client = await this.mcpClientManager.getClient(userId, service);

        // Fetch profile if tool exists
        if (profileTool) {
          try {
            const result = await this.toolInvoker.invoke(client, service, profileTool.tool.name, {});
            const text = result.content
              .filter((c) => c.type === "text")
              .map((c) => c.text ?? "")
              .join("\n");

            if (!result.isError) {
              const profile = this.safeJsonParse(text);
              if (profile) {
                const name = profile.name ?? profile.userName ?? profile.fullName ?? profile.first_name;
                const email = profile.email ?? profile.emailId ?? profile.email_id;
                const phone = profile.phone ?? profile.mobile ?? profile.phoneNumber ?? profile.phone_number;
                const superStatus = profile.superStatus ?? profile.is_super ?? profile.isSuperUser;

                if (name) serviceSection += `  Name: <b>${this.escapeHtml(String(name))}</b>\n`;
                if (email) serviceSection += `  Email: ${this.escapeHtml(String(email))}\n`;
                if (phone) serviceSection += `  Phone: ${this.escapeHtml(String(phone))}\n`;
                if (superStatus != null) serviceSection += `  Super: ${superStatus ? "Yes" : "No"}\n`;
                hasData = true;
              }
            } else {
              logger.debug("Profile tool returned error", { userId, service, error: text });
            }
          } catch (err) {
            logger.debug("Profile fetch failed", { userId, service, error: String(err) });
          }
        }

        // Fetch addresses if tool exists
        if (addressTool) {
          try {
            const result = await this.toolInvoker.invoke(client, service, addressTool.tool.name, {});
            const text = result.content
              .filter((c) => c.type === "text")
              .map((c) => c.text ?? "")
              .join("\n");

            if (!result.isError) {
              const parsed = this.safeJsonParse(text);
              if (parsed) {
                const addresses = Array.isArray(parsed)
                  ? parsed
                  : parsed.addresses ?? parsed.data ?? parsed.items ?? parsed.results ?? [parsed];

                if (Array.isArray(addresses) && addresses.length > 0) {
                  serviceSection += `\n  <b>Addresses:</b>\n`;
                  for (const addr of addresses.slice(0, 5)) {
                    const label = addr.name ?? addr.label ?? addr.type ?? addr.addressType ?? "Address";
                    const line = addr.address ?? addr.fullAddress ?? addr.formatted_address ?? addr.address_line ?? "";
                    const id = addr.id ?? addr.addressId ?? addr.address_id ?? "";
                    serviceSection += `  - <b>${this.escapeHtml(String(label))}</b>`;
                    if (id) serviceSection += ` (ID: ${this.escapeHtml(String(id))})`;
                    if (line) serviceSection += `\n    ${this.escapeHtml(String(line).substring(0, 100))}`;
                    serviceSection += `\n`;
                  }
                  hasData = true;
                }
              }
            } else {
              logger.debug("Address tool returned error", { userId, service, error: text });
            }
          } catch (err) {
            logger.debug("Address fetch failed", { userId, service, error: String(err) });
          }
        }

        // Show cached addressId
        const cachedAddr = this.sessionStore.getAddressId(userId, service);
        if (cachedAddr) {
          serviceSection += `\n  Cached addressId: <code>${this.escapeHtml(cachedAddr)}</code>\n`;
          hasData = true;
        }

        // Show discovered tools
        if (tools.length > 0) {
          serviceSection += `\n  <b>Available tools (${tools.length}):</b>\n`;
          for (const t of tools) {
            serviceSection += `  - <code>${this.escapeHtml(t.tool.name)}</code>\n`;
          }
          hasData = true;
        }
      } catch (err) {
        serviceSection += `  Error: ${this.escapeHtml(String(err instanceof Error ? err.message : err))}\n`;
        hasData = true;
      }

      if (!hasData) {
        serviceSection += `  No details available. Try /login ${service} again.\n`;
      }

      sections.push(serviceSection);
    }

    const message = `<b>Account Details</b>\n\n${sections.join("\n")}`;
    await this.bot.sendMessage(chatId, message, { parse_mode: "HTML" });
  }

  private safeJsonParse(text: string): Record<string, unknown> | null {
    try {
      const parsed = JSON.parse(text);
      if (typeof parsed === "object" && parsed !== null) return parsed;
      return null;
    } catch {
      return null;
    }
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }
}
