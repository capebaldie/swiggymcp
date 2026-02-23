import "dotenv/config";
import { loadConfig } from "./config/env.js";
import { TelegramBotApp } from "./bot/telegramBot.js";
import { OAuthCallbackServer } from "./auth/oauthCallbackServer.js";
import { TokenManager } from "./auth/tokenManager.js";
import { logger } from "./utils/logger.js";

async function main(): Promise<void> {
  logger.info("Starting Swiggy MCP Telegram Bot...");

  // Load and validate configuration
  const config = loadConfig();
  logger.info("Configuration loaded", {
    geminiModel: config.geminiModel,
    oauthCallbackPort: config.oauthCallbackPort,
  });

  // Start OAuth callback server
  const callbackServer = new OAuthCallbackServer(config.oauthCallbackPort);
  await callbackServer.start();

  // Initialize Telegram bot application
  const botApp = new TelegramBotApp(config);

  // Initialize token manager to bridge OAuth callbacks → bot notifications
  const _tokenManager = new TokenManager(
    botApp.getSessionStore(),
    callbackServer,
    async (event) => {
      const session = botApp.getSessionStore().getSession(event.userId);
      const chatId = session?.telegramChatId ?? event.chatId;

      await botApp.handleAuthComplete(
        event.userId,
        chatId,
        event.service,
        event.success,
        event.error,
      );
    },
    {
      food: config.swiggyMcpFoodUrl,
      instamart: config.swiggyMcpInstamartUrl,
      dineout: config.swiggyMcpDineoutUrl,
    },
    config.oauthCallbackPort,
    config.oauthCallbackHost,
  );

  // Start the bot
  await botApp.start();

  logger.info("Swiggy MCP Telegram Bot is running!", {
    oauthCallbackUrl: `http://${config.oauthCallbackHost}:${config.oauthCallbackPort}/callback`,
  });

  // Graceful shutdown
  const shutdown = async () => {
    logger.info("Shutting down...");
    await botApp.stop();
    await callbackServer.stop();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  logger.error("Fatal error during startup", { error: String(err) });
  process.exit(1);
});
