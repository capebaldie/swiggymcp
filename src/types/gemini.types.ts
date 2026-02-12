export type IntentCategory =
  | "food_search"
  | "food_menu_browse"
  | "food_add_to_cart"
  | "food_view_cart"
  | "food_checkout"
  | "grocery_search"
  | "grocery_add_to_cart"
  | "grocery_checkout"
  | "dineout_search"
  | "dineout_details"
  | "dineout_check_slots"
  | "dineout_book_table"
  | "general_help"
  | "auth_request"
  | "unknown";

export interface ResultFilters {
  maxPrice?: number;
  minRating?: number;
  maxDeliveryTimeMinutes?: number;
  dietaryPreferences?: Array<"veg" | "non-veg" | "vegan" | "egg">;
  cuisine?: string[];
  sortBy?: "price_asc" | "price_desc" | "rating" | "delivery_time" | "relevance";
}

export interface ParsedIntent {
  intent: IntentCategory;
  service: "food" | "instamart" | "dineout" | "general";
  confidence: number;
  toolName: string | null;
  parameters: Record<string, unknown>;
  filters: ResultFilters;
  followUp: boolean;
  originalQuery: string;
}

export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  parsedIntent?: ParsedIntent;
  toolResults?: string;
}
