export type CallbackAction =
  | "select_restaurant"
  | "select_item"
  | "add_to_cart"
  | "view_cart"
  | "checkout"
  | "confirm_order"
  | "cancel"
  | "next_page"
  | "prev_page"
  | "login_food"
  | "login_instamart"
  | "login_dineout"
  | "book_slot";

export interface CallbackData {
  action: CallbackAction;
  service: string;
  payload: string;
}

export interface FormattedMessage {
  text: string;
  parseMode: "HTML" | "Markdown";
  replyMarkup?: {
    inline_keyboard: Array<
      Array<{
        text: string;
        callback_data?: string;
        url?: string;
      }>
    >;
  };
}
