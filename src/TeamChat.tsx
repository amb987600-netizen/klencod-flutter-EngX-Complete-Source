import LocalAI from "./LocalAI";
import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import * as lib from "./lib";
import { cacheChatFile, cacheChatMessage, chatDb, getCachedChatFile, syncChatOnce, type ChatFile, type ChatMessage } from "./chat";
import "./chat.css";

type Props = { notify?: (message: string) => void };
const MAX_FILE = 10 * 1024 * 1024;
const tell = (notify: Props["notify"], message: string) => notify?.(message);
const dataUrl = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(new Error("تعذر قراءة الملف"));
  reader.readAsDataURL(file);
});
const formatBytes = (n: number) => n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} ك.ب` : `${(n / 1024 / 1024).toFixed(1)} م.ب`;
const formatDate = (value: string) => { try { return new Date(value).toLocaleString("ar", { dateStyle: "short", timeStyle: "short" }); } catch { return value; } };

export default function TeamChat({ notify }: Props) {
  const settings = lib.useSettings();
  const workspaceId = settings?.workspace?.id || "";
  const messages = useLiveQuery(
    () => workspaceId ? chatDb.messages.where("workspace_id").equals(workspaceId).sortBy("seq") : Promise.resolve([] as ChatMessage[]),
    [workspaceId], [],
  );
  const files = useLiveQuery(
    () => workspaceId ? chatDb.files.where("workspace_id").equals(workspaceId).toArray() : Promise.resolve([] as ChatFile[]),
    [workspaceId], [],
  );
  const [text, setText] = useState("");
  const [attachment, setAttachment] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const draftClientId = useRef<string | undefined>(undefined);
  const bottom = useRef<HTMLDivElement>(null);
  const online = typeof navigator === "undefined" || navigator.onLine;
  const configured = Boolean(settings?.cloudEnabled && settings?.token && workspaceId);
  const viewer = settings?.role === "viewer";

  const refresh = async () => {
    if (!configured || !online) return;
    setRefreshing(true);
    try { await syncChatOnce(); } catch (e) { tell(notify, e instanceof Error ? e.message : "تعذر تحديث المحادثة"); }
    finally { setRefreshing(false); }
  };
  useEffect(() => {
    if (!configured || !workspaceId) return;
    let timer: number | undefined;
    const tick = () => { if (document.visibilityState === "visible" && navigator.onLine) void syncChatOnce().catch(() => undefined); };
    const reconnect = () => tick();
    tick();
    timer = window.setInterval(tick, 4000);
    window.addEventListener("online", reconnect);
    return () => { if (timer) window.clearInterval(timer); window.removeEventListener("online", reconnect); };
  }, [configured, workspaceId]);
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: "smooth" }); }, [messages?.length]);

  const chooseFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > MAX_FILE) { tell(notify, "الحد الأقصى للملف 10 م.ب"); return; }
    setAttachment(file);
  };
  const send = async () => {
    const trimmed = text.trim();
    if (sending || viewer || !configured || !online || (!trimmed && !attachment)) return;
    setSending(true);
    const client_id = draftClientId.current || crypto.randomUUID();
    draftClientId.current = client_id;
    const composedText = text;
    try {
      const file = attachment ? { name: attachment.name, mime: attachment.type || "application/octet-stream", size: attachment.size, content: await dataUrl(attachment) } : undefined;
      const response = await lib.teamRequest("/api/chat/messages", "POST", { workspace_id: workspaceId, client_id, text: composedText, ...(file ? { file } : {}) });
      if (!response?.message) throw new Error("رد الرسالة غير صالح");
      await cacheChatMessage(response.message as ChatMessage);
      draftClientId.current = undefined;
      setText(""); setAttachment(null);
      await lib.logActivity("chat_message_sent", "team_chat", workspaceId, null, { has_file: Boolean(file) });
    } catch (e) {
      // Keep text and client id so a retry is idempotent after a network failure.
      tell(notify, e instanceof Error ? e.message : "تعذر إرسال الرسالة؛ يمكنك المحاولة مجدداً");
    } finally { setSending(false); }
  };
  const download = async (message: ChatMessage) => {
    if (!message.file || !workspaceId) return;
    try {
      let cached = await getCachedChatFile(message.file.id);
      if (!cached) {
        if (!online || !configured) { tell(notify, "الملف غير محفوظ محلياً؛ اتصل بالإنترنت لتنزيله"); return; }
        const response = await lib.teamRequest(`/api/chat/files/${encodeURIComponent(message.file.id)}?workspace_id=${encodeURIComponent(workspaceId)}`);
        if (!response?.content) throw new Error("الملف غير متاح");
        cached = { ...response, workspace_id: workspaceId } as ChatFile;
        await cacheChatFile(cached);
      }
      const blob = await (await fetch(cached.content!)).blob();
      await lib.downloadBlob(blob, cached.name);
    } catch (e) { tell(notify, e instanceof Error ? e.message : "تعذر تنزيل الملف"); }
  };

  if (!settings) return <section className="team-chat"><p>جارٍ تحميل المحادثة…</p></section>;
  return <section className="team-chat" dir="rtl">
    <header className="team-chat-head">
      <div><h2>محادثة مساحة العمل</h2><p>الأعضاء • رقم داخلي افتراضي وليس رقم هاتف</p></div>
      <button className="chat-refresh" type="button" onClick={() => void refresh()} disabled={refreshing || !configured || !online}>↻ {refreshing ? "جارٍ التحديث" : "تحديث"}</button>
    </header>
    <LocalAI messages={messages||[]} notify={notify}/>
    <div className="chat-status"><span className={online ? "status-dot online" : "status-dot"} />{online && configured ? "متصل — تحديث تلقائي أثناء فتح المحادثة" : online ? "الخدمة السحابية غير مفعلة — تعرض المحفوظ محلياً" : "غير متصل — تعرض المحفوظ محلياً فقط"}</div>
    <div className="chat-privacy">لا ترسل بيانات مرضى. الملفات المرفقة لا تتحمل تلقائياً. الخدمة اختيارية وتحتاج خادم HTTPS. ليست بتشفير طرف لطرف.</div>
    <div className="chat-log" aria-live="polite">
      {!messages?.length && <div className="chat-empty">لا توجد رسائل محفوظة في هذه المساحة.</div>}
      {messages?.map((message) => <article className="chat-message" key={message.id}>
        <div className="chat-message-meta"><strong>{message.sender_name || "عضو"}</strong><span>{message.virtual_number ? `رقم داخلي: ${message.virtual_number}` : `المعرّف: ${message.sender_id}`}</span><time>{formatDate(message.created_at)}</time><small>مخزنة محلياً</small></div>
        {message.text && <p>{message.text}</p>}
        {message.file && <button className="chat-file" type="button" onClick={() => void download(message)}>{files?.some((f) => f.id === message.file?.id) ? "تنزيل من المحفوظ: " : "تنزيل: "}{message.file.name} ({formatBytes(message.file.size)})</button>}
      </article>)}
      <div ref={bottom} />
    </div>
    <div className="chat-compose">
      {viewer && <div className="chat-readonly">حسابك للقراءة فقط.</div>}
      <textarea value={text} onChange={(e) => setText(e.target.value)} disabled={viewer || sending || !configured || !online} placeholder="اكتب رسالة…" aria-label="نص الرسالة" />
      <div className="chat-compose-row">
        <label className="chat-attach"><input type="file" onChange={chooseFile} disabled={viewer || sending || !configured || !online} />إرفاق ملف</label>
        {attachment && <span className="chat-selected">{attachment.name} ({formatBytes(attachment.size)}) <button type="button" onClick={() => setAttachment(null)}>×</button></span>}
        <button className="chat-send" type="button" onClick={() => void send()} disabled={sending || viewer || !configured || !online || (!text.trim() && !attachment)}>{sending ? "جارٍ الإرسال…" : "إرسال"}</button>
      </div>
    </div>
  </section>;
}
