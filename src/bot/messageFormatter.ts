import type { FormattedMessage } from "../types/telegram.types.js";
import type { FilteredResult, SwiggyService } from "../types/mcp.types.js";
import type { IntentCategory } from "../types/gemini.types.js";
import { TELEGRAM_MAX_MESSAGE_LENGTH, MAX_RESULTS_PER_MESSAGE } from "../config/constants.js";

export class MessageFormatter {
  /**
   * Format filtered results based on the intent type and service.
   */
  formatResults(
    service: SwiggyService,
    intent: IntentCategory,
    result: FilteredResult,
    originalQuery: string,
  ): FormattedMessage {
    switch (service) {
      case "food":
        return this.formatFoodResults(result, originalQuery, intent);
      case "instamart":
        return this.formatGroceryResults(result, originalQuery, intent);
      case "dineout":
        return this.formatDineoutResults(result, originalQuery, intent);
      default:
        return this.formatGenericResults(result, originalQuery);
    }
  }

  private formatFoodResults(
    result: FilteredResult,
    query: string,
    intent: IntentCategory,
  ): FormattedMessage {
    if (result.items.length === 0 || (result.items.length === 1 && result.items[0].raw)) {
      // Raw text result or no results
      const raw = result.items[0]?.raw as string | undefined;
      if (raw) {
        return { text: this.truncate(raw), parseMode: "HTML" };
      }
      return this.noResultsMessage(query, result.filtersApplied);
    }

    let text = "";

    if (intent === "food_view_cart") {
      text = this.formatCartView(result, "food");
    } else {
      text = this.formatSearchResults(result, query, "🍔");
    }

    const buttons = this.buildResultButtons(result, "food");

    return {
      text: this.truncate(text),
      parseMode: "HTML",
      replyMarkup: buttons.length > 0 ? { inline_keyboard: buttons } : undefined,
    };
  }

  private formatGroceryResults(
    result: FilteredResult,
    query: string,
    intent: IntentCategory,
  ): FormattedMessage {
    if (result.items.length === 0 || (result.items.length === 1 && result.items[0].raw)) {
      const raw = result.items[0]?.raw as string | undefined;
      if (raw) {
        return { text: this.truncate(raw), parseMode: "HTML" };
      }
      return this.noResultsMessage(query, result.filtersApplied);
    }

    const text = this.formatSearchResults(result, query, "🛒");
    const buttons = this.buildResultButtons(result, "instamart");

    return {
      text: this.truncate(text),
      parseMode: "HTML",
      replyMarkup: buttons.length > 0 ? { inline_keyboard: buttons } : undefined,
    };
  }

  private formatDineoutResults(
    result: FilteredResult,
    query: string,
    intent: IntentCategory,
  ): FormattedMessage {
    if (result.items.length === 0 || (result.items.length === 1 && result.items[0].raw)) {
      const raw = result.items[0]?.raw as string | undefined;
      if (raw) {
        return { text: this.truncate(raw), parseMode: "HTML" };
      }
      return this.noResultsMessage(query, result.filtersApplied);
    }

    const text = this.formatSearchResults(result, query, "🍽️");
    const buttons = this.buildResultButtons(result, "dineout");

    return {
      text: this.truncate(text),
      parseMode: "HTML",
      replyMarkup: buttons.length > 0 ? { inline_keyboard: buttons } : undefined,
    };
  }

  private formatSearchResults(
    result: FilteredResult,
    query: string,
    emoji: string,
  ): string {
    let text = `${emoji} Found <b>${result.totalAfterFilter}</b> results`;
    if (result.filtersApplied.length > 0) {
      text += ` (filtered from ${result.totalBeforeFilter})`;
    }
    text += `\n`;

    if (result.filtersApplied.length > 0) {
      text += `<i>Filters: ${this.escapeHtml(result.filtersApplied.join(" | "))}</i>\n`;
    }
    text += "\n";

    const displayItems = result.items.slice(0, MAX_RESULTS_PER_MESSAGE);

    displayItems.forEach((item, idx) => {
      const name = (item.name ?? item.restaurantName ?? item.productName ?? "Unknown") as string;
      const rating = item.rating ?? item.avgRating ?? item.stars;
      const price = item.price ?? item.cost ?? item.costForTwo ?? item.mrp;
      const time = item.deliveryTime ?? item.eta;
      const isVeg = item.isVeg ?? item.veg ?? item.vegetarian;

      text += `<b>${idx + 1}. ${this.escapeHtml(String(name))}</b>`;
      if (isVeg === true) text += " 🟢";
      else if (isVeg === false) text += " 🔴";
      text += "\n";

      const details: string[] = [];
      if (rating != null) details.push(`⭐ ${rating}`);
      if (price != null) details.push(`₹${price}`);
      if (time != null) details.push(`🕐 ${time} min`);

      if (details.length > 0) {
        text += `   ${details.join(" | ")}\n`;
      }

      // Extra info if available
      const description = item.description ?? item.cuisines ?? item.brand;
      if (description) {
        const desc = Array.isArray(description)
          ? description.join(", ")
          : String(description);
        text += `   <i>${this.escapeHtml(desc.substring(0, 80))}</i>\n`;
      }

      text += "\n";
    });

    if (result.items.length > MAX_RESULTS_PER_MESSAGE) {
      text += `<i>... and ${result.items.length - MAX_RESULTS_PER_MESSAGE} more results</i>\n`;
    }

    return text;
  }

  private formatCartView(result: FilteredResult, service: string): string {
    let text = `🛒 <b>Your ${service} cart:</b>\n\n`;
    let total = 0;

    result.items.forEach((item, idx) => {
      const name = (item.name ?? item.itemName ?? "Item") as string;
      const price = (item.price ?? item.cost ?? 0) as number;
      const qty = (item.quantity ?? 1) as number;

      text += `${idx + 1}. ${this.escapeHtml(String(name))} x${qty} — ₹${price}\n`;
      total += price * qty;
    });

    text += `\n<b>Total: ₹${total}</b>\n`;
    text += `\n⚠️ <i>Orders are COD only and cannot be cancelled once placed.</i>`;

    return text;
  }

  private formatGenericResults(result: FilteredResult, query: string): FormattedMessage {
    if (result.items.length === 0) {
      return this.noResultsMessage(query, result.filtersApplied);
    }

    const raw = result.items[0]?.raw as string | undefined;
    if (raw) {
      return { text: this.truncate(raw), parseMode: "HTML" };
    }

    const text = this.formatSearchResults(result, query, "🔍");
    return { text: this.truncate(text), parseMode: "HTML" };
  }

  private noResultsMessage(query: string, filters: string[]): FormattedMessage {
    let text = `No results found for "<b>${this.escapeHtml(query)}</b>"`;
    if (filters.length > 0) {
      text += `\n\n<i>Filters applied: ${this.escapeHtml(filters.join(", "))}</i>`;
    }
    text += `\n\nTry relaxing your filters or searching for something different.`;
    return { text, parseMode: "HTML" };
  }

  private buildResultButtons(
    result: FilteredResult,
    service: SwiggyService,
  ): Array<Array<{ text: string; callback_data: string }>> {
    const buttons: Array<Array<{ text: string; callback_data: string }>> = [];

    result.items.slice(0, MAX_RESULTS_PER_MESSAGE).forEach((item, idx) => {
      const name = (item.name ?? item.restaurantName ?? item.productName ?? `Item ${idx + 1}`) as string;
      const id = (item.id ?? item.restaurantId ?? item.productId ?? String(idx)) as string;

      const action = service === "dineout" ? "select_restaurant" : "select_item";
      const callbackData = JSON.stringify({ a: action, s: service, p: String(id) });

      // Telegram callback_data has a 64-byte limit
      if (callbackData.length <= 64) {
        buttons.push([
          { text: `${idx + 1}. ${name.substring(0, 25)}`, callback_data: callbackData },
        ]);
      }
    });

    return buttons;
  }

  /**
   * Split a long message into chunks respecting Telegram's 4096 char limit.
   */
  splitMessage(text: string): string[] {
    if (text.length <= TELEGRAM_MAX_MESSAGE_LENGTH) return [text];

    const chunks: string[] = [];
    let remaining = text;

    while (remaining.length > 0) {
      if (remaining.length <= TELEGRAM_MAX_MESSAGE_LENGTH) {
        chunks.push(remaining);
        break;
      }

      // Find a good split point (newline) before the limit
      let splitAt = remaining.lastIndexOf("\n", TELEGRAM_MAX_MESSAGE_LENGTH);
      if (splitAt === -1 || splitAt < TELEGRAM_MAX_MESSAGE_LENGTH / 2) {
        splitAt = TELEGRAM_MAX_MESSAGE_LENGTH;
      }

      chunks.push(remaining.substring(0, splitAt));
      remaining = remaining.substring(splitAt);
    }

    return chunks;
  }

  private truncate(text: string): string {
    if (text.length <= TELEGRAM_MAX_MESSAGE_LENGTH) return text;
    return text.substring(0, TELEGRAM_MAX_MESSAGE_LENGTH - 20) + "\n\n<i>... truncated</i>";
  }

  escapeHtml(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }
}
