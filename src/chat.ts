import Dexie, { type Table } from "dexie";
import { getSettings, teamRequest } from "./lib";

export type ChatFile = { id: string; name: string; mime: string; size: number; content?: string; workspace_id: string };
export type ChatMessage = {
  id: string;
  seq: number;
  workspace_id: string;
  sender_id: string;
  sender_name: string;
  virtual_number?: string;
  text: string;
  created_at: string;
  file?: { id: string; name: string; mime: string; size: number };
};

class ChatDB extends Dexie {
  messages!: Table<ChatMessage, string>;
  files!: Table<ChatFile, string>;
  constructor() {
    super("engx-chat-v1");
    this.version(1).stores({
      messages: "id,[workspace_id+seq],workspace_id",
      files: "id,workspace_id",
    });
  }
}
export const chatDb = new ChatDB();

const online = () => typeof navigator === "undefined" || navigator.onLine;
const signedIn = (s: any) => Boolean(s?.cloudEnabled && s?.token && s?.workspace?.id);

export async function syncChatOnce(): Promise<void> {
  if (!online()) return;
  const s = await getSettings();
  if (!signedIn(s)) return;
  const workspace_id = s.workspace.id;
  let after = (await chatDb.messages.where("workspace_id").equals(workspace_id).toArray())
    .reduce((max, row) => Math.max(max, Number(row.seq) || 0), 0);
  for (let page = 0; page < 100; page++) {
    if (!online()) return;
    const result = await teamRequest(`/api/chat?workspace_id=${encodeURIComponent(workspace_id)}&after=${after}`);
    const messages: ChatMessage[] = Array.isArray(result?.messages) ? result.messages : [];
    if (messages.length) {
      await chatDb.messages.bulkPut(messages.map((m) => ({ ...m, workspace_id })));
      after = Math.max(after, ...messages.map((m) => Number(m.seq) || 0));
    }
    if (!result?.more || messages.length === 0) return;
  }
}

export async function exportCachedChat(workspace_id: string): Promise<{ messages: any[]; files: any[] }> {
  const [messages, files] = await Promise.all([
    chatDb.messages.where("workspace_id").equals(workspace_id).toArray(),
    chatDb.files.where("workspace_id").equals(workspace_id).toArray(),
  ]);
  return { messages, files };
}

export async function restoreCachedChat(workspace_id: string, archive: { messages?: any[]; files?: any[] }): Promise<void> {
  await chatDb.transaction("rw", chatDb.messages, chatDb.files, async () => {
    await chatDb.messages.clear();
    await chatDb.files.clear();
    const messages = (archive?.messages || []).filter((m) => m?.workspace_id === workspace_id);
    const files = (archive?.files || []).filter((f) => f?.workspace_id === workspace_id);
    if (messages.length) await chatDb.messages.bulkPut(messages);
    if (files.length) await chatDb.files.bulkPut(files);
  });
}

export async function clearWorkspaceChat(workspace_id: string): Promise<void> {
  await chatDb.transaction("rw", chatDb.messages, chatDb.files, async () => {
    await chatDb.messages.where("workspace_id").equals(workspace_id).delete();
    await chatDb.files.where("workspace_id").equals(workspace_id).delete();
  });
}

export async function cacheChatMessage(message: ChatMessage): Promise<void> {
  await chatDb.messages.put(message);
}
export async function cacheChatFile(file: ChatFile): Promise<void> {
  await chatDb.files.put(file);
}
export async function getCachedChatFile(id: string): Promise<ChatFile | undefined> {
  return chatDb.files.get(id);
}
