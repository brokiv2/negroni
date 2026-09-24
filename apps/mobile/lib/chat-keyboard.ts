export type ChatContentInsets = {
  top: number;
  bottom: number;
  left: number;
  right: number;
};

export type ChatKeyboardPlatform = "ios" | "android";

/**
 * Return the scroll offset that represents the latest item in an inverted chat.
 * KeyboardChatScrollView uses a negative iOS contentOffset to move the inverted
 * content by its top inset. Android applies that inset synthetically, so its
 * native scroll offset remains zero at the latest item.
 */
export function invertedChatLatestOffset(
  platform: ChatKeyboardPlatform,
  insets: Pick<ChatContentInsets, "top">,
): number {
  return platform === "ios" ? -Math.max(0, insets.top) : 0;
}

/** Distance from the latest item, independent of the keyboard's active inset. */
export function invertedChatDistanceFromLatest(
  platform: ChatKeyboardPlatform,
  contentOffsetY: number,
  insets: Pick<ChatContentInsets, "top">,
): number {
  return Math.max(0, contentOffsetY - invertedChatLatestOffset(platform, insets));
}
