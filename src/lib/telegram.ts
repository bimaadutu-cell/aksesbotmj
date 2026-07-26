/** Minimal typed Telegram Bot API client (raw fetch, no deps) */

const API = "https://api.telegram.org";

export interface TgResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

async function call<T>(token: string, method: string, payload?: unknown, form?: FormData): Promise<TgResponse<T>> {
  const url = `${API}/bot${token}/${method}`;
  const res = await fetch(url, {
    method: "POST",
    headers: form ? undefined : { "Content-Type": "application/json" },
    body: form ?? JSON.stringify(payload ?? {}),
    signal: AbortSignal.timeout(method === "getUpdates" ? 40_000 : 15_000),
  });
  return (await res.json()) as TgResponse<T>;
}

export const tg = {
  async getMe(token: string) {
    const t0 = Date.now();
    const r = await call<any>(token, "getMe");
    return { ...r, latency: Date.now() - t0 };
  },
  getMyDescription: (token: string) => call<any>(token, "getMyDescription", { language_code: "id" }),
  getMyShortDescription: (token: string) => call<any>(token, "getMyShortDescription", {}),
  getUpdates: (token: string, offset: number) =>
    call<any[]>(token, "getUpdates", { offset, timeout: 25, allowed_updates: ["message", "edited_message", "callback_query", "my_chat_member"] }),
  deleteWebhook: (token: string) => call<boolean>(token, "deleteWebhook", { drop_pending_updates: false }),
  setWebhook: (token: string, url: string, secret: string) =>
    call<boolean>(token, "setWebhook", { url, secret_token: secret, allowed_updates: ["message", "edited_message", "callback_query"] }),
  getWebhookInfo: (token: string) => call<any>(token, "getWebhookInfo"),
  sendMessage: (token: string, chat_id: string | number, text: string, extra: Record<string, unknown> = {}) =>
    call<any>(token, "sendMessage", { chat_id, text, disable_web_page_preview: false, ...extra }),
  sendPhoto: (token: string, chat_id: string | number, photo: string, caption?: string, extra: Record<string, unknown> = {}) =>
    call<any>(token, "sendPhoto", { chat_id, photo, caption, ...extra }),
  sendChatAction: (token: string, chat_id: string | number, action: string) =>
    call<boolean>(token, "sendChatAction", { chat_id, action }).catch(() => ({ ok: false } as any)),
  answerCallbackQuery: (token: string, callback_query_id: string, text?: string) =>
    call<boolean>(token, "answerCallbackQuery", { callback_query_id, text }).catch(() => ({ ok: false } as any)),
  editMessageText: (token: string, chat_id: string | number, message_id: number, text: string, extra: Record<string, unknown> = {}) =>
    call<any>(token, "editMessageText", { chat_id, message_id, text, ...extra }).catch(() => ({ ok: false } as any)),
  getFile: (token: string, file_id: string) => call<any>(token, "getFile", { file_id }),
  fileUrl: (token: string, file_path: string) => `${API}/file/bot${token}/${file_path}`,
  getUserProfilePhotos: (token: string, user_id: number) =>
    call<any>(token, "getUserProfilePhotos", { user_id, limit: 1 }).catch(() => ({ ok: false } as any)),
  banChatMember: (token: string, chat_id: string | number, user_id: number) =>
    call<boolean>(token, "banChatMember", { chat_id, user_id }),
  unbanChatMember: (token: string, chat_id: string | number, user_id: number) =>
    call<boolean>(token, "unbanChatMember", { chat_id, user_id, only_if_banned: true }),
  restrictChatMember: (token: string, chat_id: string | number, user_id: number, perms: Record<string, boolean>) =>
    call<boolean>(token, "restrictChatMember", { chat_id, user_id, permissions: perms }),
  promoteChatMember: (token: string, chat_id: string | number, user_id: number, promote: boolean) =>
    call<boolean>(token, "promoteChatMember", {
      chat_id, user_id,
      can_manage_chat: promote, can_delete_messages: promote, can_pin_messages: promote,
      can_restrict_members: promote, can_invite_users: promote,
    }),
  pinChatMessage: (token: string, chat_id: string | number, message_id: number) =>
    call<boolean>(token, "pinChatMessage", { chat_id, message_id }),
  setChatPermissions: (token: string, chat_id: string | number, permissions: Record<string, boolean>) =>
    call<boolean>(token, "setChatPermissions", { chat_id, permissions }),
  getChatAdministrators: (token: string, chat_id: string | number) =>
    call<any[]>(token, "getChatAdministrators", { chat_id }).catch(() => ({ ok: false } as any)),
  deleteMessage: (token: string, chat_id: string | number, message_id: number) =>
    call<boolean>(token, "deleteMessage", { chat_id, message_id }).catch(() => ({ ok: false } as any)),
  sendAudio: (token: string, chat_id: string | number, audio: string, caption?: string) =>
    call<any>(token, "sendAudio", { chat_id, audio, caption }),
  sendVideo: (token: string, chat_id: string | number, video: string, caption?: string) =>
    call<any>(token, "sendVideo", { chat_id, video, caption, supports_streaming: true }),
  unpinChatMessage: (token: string, chat_id: string | number) =>
    call<boolean>(token, "unpinChatMessage", { chat_id }),
  /** multipart upload (sticker / document / photo / audio as raw bytes) */
  async sendFile(token: string, method: string, fields: Record<string, string | number>, fileField: string, fileName: string, bytes: Buffer, mime: string) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.append(k, String(v));
    fd.append(fileField, new File([new Uint8Array(bytes)], fileName, { type: mime }));
    const res = await fetch(`${API}/bot${token}/${method}`, { method: "POST", body: fd, signal: AbortSignal.timeout(30_000) });
    return (await res.json()) as TgResponse<any>;
  },
};
