import type { SwiggyService } from "../types/mcp.types.js";

type InlineButton = { text: string; callback_data?: string; url?: string };
type InlineKeyboard = InlineButton[][];

export function buildLoginKeyboard(): InlineKeyboard {
  return [
    [{ text: "🍔 Food", callback_data: "login:food" }],
    [{ text: "🛒 Instamart", callback_data: "login:instamart" }],
    [{ text: "🍽️ Dineout", callback_data: "login:dineout" }],
  ];
}

export function buildAuthLinkKeyboard(url: string, service: SwiggyService): InlineKeyboard {
  return [[{ text: `Login to ${service}`, url }]];
}

export function buildConfirmCheckoutKeyboard(service: SwiggyService): InlineKeyboard {
  return [
    [
      { text: "✅ Confirm Order (COD)", callback_data: `checkout:${service}:confirm` },
      { text: "❌ Cancel", callback_data: `checkout:${service}:cancel` },
    ],
  ];
}

export function buildPaginationKeyboard(
  service: SwiggyService,
  currentPage: number,
  hasMore: boolean,
): InlineKeyboard {
  const buttons: InlineButton[] = [];

  if (currentPage > 0) {
    buttons.push({ text: "⬅️ Previous", callback_data: `page:${service}:${currentPage - 1}` });
  }
  if (hasMore) {
    buttons.push({ text: "Next ➡️", callback_data: `page:${service}:${currentPage + 1}` });
  }

  return buttons.length > 0 ? [buttons] : [];
}
