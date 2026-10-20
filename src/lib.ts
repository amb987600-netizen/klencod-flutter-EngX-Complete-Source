import Dexie, { type Table } from "dexie";
import { useLiveQuery } from "dexie-react-hooks";
import * as XLSX from "xlsx";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { LocalNotifications } from "@capacitor/local-notifications";
import { encryptBackup, decryptBackup } from "./security";
export function localDateTime(date=new Date()){return new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16);}
export type EntityType =
  | "device"
  | "order"
  | "part"
  | "usage"
  | "plan"
  | "event"
  | "attachment"
  | "comment"
  | "checklist"
  | "calibration"
  | "sale"
  | "purchase"
  | "report"
  | "correction";
export type RecordRow = {
  id: string;
  type: EntityType;
  workspace_id: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  created_by: string;
  domain: string;
  data: Record<string, any>;
  version: number;
  sync_status: string;
};
export type AuditRow = {
  id: string;
  workspace_id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  created_at: string;
  created_by: string;
  before: any;
  after: any;
  [key: string]: any;
};
export type Settings = {
  id: "settings";
  user: { id: string; name: string; email: string; virtual_number?: string };
  workspace: { id: string; name: string; owner_id: string };
  role: "owner" | "admin" | "technician" | "viewer";
  language: "ar" | "en";
  dark: boolean;
  widgetsEnabled?:boolean;
  cloudEnabled: boolean;
  serverUrl: string;
  token?: string;
  lastSync?: number;
  lastBackup?: string;
};
export type QueueRow = {
  id: string;
  queued_at: number;
  entity_id: string;
  entity_type: string;
  base_version: number;
  record: RecordRow;
  action: "create" | "update" | "delete";
  audit: AuditRow[];
  error?: string;
};
class EngDB extends Dexie {
  records!: Table<RecordRow, string>;
  audit!: Table<AuditRow, string>;
  queue!: Table<QueueRow, string>;
  settings!: Table<Settings, string>;
  activity!: Table<AuditRow, string>;
  constructor(name = "engx-v1") {
    super(name);
    this.version(1).stores({
      records: "id,type,workspace_id,[workspace_id+type],updated_at",
      audit: "id,workspace_id,created_at,action",
      queue: "id,entity_id",
      settings: "id",
      activity: "id,workspace_id",
    });
    this.version(2)
      .stores({ queue: "id,entity_id,queued_at" })
      .upgrade(async (tx) => {
        let i = Date.now() * 1000;
        await tx
          .table("queue")
          .toCollection()
          .modify((q: any) => {
            q.queued_at = ++i;
          });
      });
    this.version(3).stores({}).upgrade(async (tx) => {
      await tx.table("records").toCollection().modify((r: RecordRow) => { r.data = { ...r.data, record_code: recordCode(r) }; });
    });
  }
}
export const db = new EngDB();
const CODE_PREFIX: Record<EntityType, string> = { device: "DEV", order: "WO", part: "PART", plan: "PM", event: "EVT", usage: "USE", correction: "NOTE", attachment: "DOC", calibration: "CAL", sale: "SAL", purchase: "PUR", report: "REP", comment: "NOTE", checklist: "NOTE" } as Record<EntityType, string>;
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
function uuidBits(id: string): string | null {
  const hex = id.replace(/-/g, "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) return null;
  let n = BigInt("0x" + hex), out = "";
  for (let i = 0; i < 26; i++) { out = CROCKFORD[Number(n & 31n)] + out; n >>= 5n; }
  return out;
}
export function codeFor(type: EntityType, id: string): string {
  const prefix = CODE_PREFIX[type] || String(type).toUpperCase().replace(/[^A-Z0-9]/g, "");
  const bits = uuidBits(id);
  if (bits) return `${prefix}-${bits}`;
  const safe = String(id).toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "") || "ID";
  return `${prefix}-${safe}`;
}
export function recordCode(row: Pick<RecordRow, "id" | "type" | "data">): string {
  return typeof row.data?.record_code === "string" && row.data.record_code ? row.data.record_code : codeFor(row.type, row.id);
}
const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();
export async function getSettings() {
  const s = await db.settings.get("settings");
  if (!s) throw Error("التطبيق لم يبدأ بعد");
  return s;
}
export async function ensureRecordCodes(): Promise<void> {
  const s = await db.settings.get("settings");
  if (!s) return;
  const rows = await db.records.where("workspace_id").equals(s.workspace.id).toArray();
  const missing = rows.filter((r) => !r.data?.record_code);
  if (!missing.length) return;
  await db.transaction("rw", db.records, async () => {
    for (const r of missing) await db.records.put({ ...r, data: { ...r.data, record_code: codeFor(r.type, r.id) } });
  });
  await logActivity("record_codes_backfilled", "records", "", null, { count: missing.length });
}
export async function init() {
  if (!(await db.settings.get("settings"))) {
    const user = { id: uid(), name: "مالك المساحة", email: "" };
    await db.settings.put({
      id: "settings",
      user,
      workspace: { id: uid(), name: "مساحة عملي", owner_id: user.id },
      role: "owner",
      language: "ar",
      dark: false,
      cloudEnabled: false,
      serverUrl: "",
    });
    await logActivity("app_initialized");
  }
  await ensureRecordCodes();
  if (navigator.storage?.persist) void navigator.storage.persist();
  await logActivity("app_opened");
}
export function useSettings() {
  return useLiveQuery(() => db.settings.get("settings"), []);
}
export function useRecords(type?: EntityType) {
  return useLiveQuery(
    async () => {
      const s = await db.settings.get("settings");
      if (!s) return [];
      return (
        await db.records.where("workspace_id").equals(s.workspace.id).toArray()
      ).filter((r) => !r.deleted_at && (!type || r.type === type));
    },
    [type],
    [],
  );
}
export function useAudit() {
  return useLiveQuery(
    async () => {
      const s = await db.settings.get("settings");
      return s
        ? (
            await db.audit
              .where("workspace_id")
              .equals(s.workspace.id)
              .toArray()
          ).sort((a, b) => b.created_at.localeCompare(a.created_at))
        : [];
    },
    [],
    [],
  );
}
function auditValue(value: any): any {
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    "content" in value
  )
    return { ...value, content: "[ملف محفوظ منفصلًا؛ راجع بصمة sha256]" };
  return value;
}
async function auditEvent(
  action: string,
  type = "",
  id = "",
  before: any = null,
  after: any = null,
) {
  const s = await getSettings();
  return {
    id: uid(),
    workspace_id: s.workspace.id,
    created_by: s.user.id,
    created_at: now(),
    updated_at: now(),
    deleted_at: null,
    domain: "medical",
    action,
    entity_type: type,
    entity_id: id,
    before: structuredClone(auditValue(before)),
    after: structuredClone(auditValue(after)),
  } as AuditRow;
}
export async function logActivity(
  action: string,
  type = "",
  id = "",
  before: any = null,
  after: any = null,
) {
  const event = await auditEvent(action, type, id, before, after);
  await db.transaction("rw", db.audit, db.activity, async () => {
    await db.audit.add(event);
    await db.activity.add(event);
  });
}
export async function saveSettings(patch: Partial<Settings>) {
  const s = await getSettings();
  const safe = { ...patch };
  delete safe.id;
  await db.settings.put({ ...s, ...safe, id: "settings" });
  const { token, ...redacted } = safe;
  await logActivity("settings_changed", "settings", "settings", null, redacted);
}
function checkRole(
  s: Settings,
  type: EntityType,
  action: string,
  row?: RecordRow,
) {
  if (s.role === "viewer") throw Error("حسابك للقراءة فقط");
  if (s.role === "technician") {
    if (type === "calibration" && row && row.created_by !== s.user.id)
      throw Error("يمكنك تعديل معايراتك فقط");
    if (["device", "part", "plan", "sale", "purchase"].includes(type) || action === "delete")
      throw Error("هذا الإجراء يحتاج مالك أو مدير");
    if (
      type === "order" &&
      row &&
      row.data.assigned_to &&
      row.data.assigned_to !== s.user.id
    )
      throw Error("الأمر مسند لفني آخر");
  }
}
export function validateData(type: EntityType, data: Record<string, any>) {
  if (["device", "part"].includes(type) && !String(data.name || "").trim())
    throw Error("الاسم مطلوب");
  if (type === "device" && !String(data.asset_code || "").trim())
    throw Error("كود الجهاز مطلوب");
  if (
    type === "device" &&
    data.status &&
    !["working", "stopped", "maintenance", "unknown"].includes(data.status)
  )
    throw Error("حالة الجهاز غير صحيحة");
  if (type === "order" && !data.device_id) throw Error("اختر الجهاز");
  if (
    type === "calibration" &&
    (!data.device_id ||
      !Number.isFinite(Date.parse(data.performed_at)) ||
      !String(data.reference || " ").trim() ||
      !String(data.result || " ").trim())
  )
    throw Error("اختر الجهاز وأدخل تاريخ المعايرة ومرجعها والنتيجة بنفسك");
  if (
    type === "calibration" &&
    data.next_due &&
    !Number.isFinite(Date.parse(data.next_due))
  )
    throw Error("تاريخ المعايرة القادمة غير صحيح");
  if (type === "part") {
    for (const k of ["quantity", "min_quantity", "purchase_price"])
      if (
        data[k] !== undefined &&
        data[k] !== "" &&
        (!Number.isFinite(Number(data[k])) || Number(data[k]) < 0)
      )
        throw Error("الكميات والأسعار أرقام موجبة أو صفر");
  }
  if (
    type === "plan" &&
    (!data.device_id ||
      !Number.isFinite(Number(data.interval_days)) ||
      Number(data.interval_days) <= 0 ||
      (!data.next_due||!Number.isFinite(Date.parse(data.next_due))))
  )
    throw Error("اختر الجهاز والفترة وتاريخ الاستحقاق حسب دليل الشركة");
  if (type === "event" && (!data.title || !Number.isFinite(Date.parse(data.at))))
    throw Error("العنوان والموعد الصحيح مطلوبان");
  if (["sale", "purchase"].includes(type)) {
    if (!String(data.title || data.document_title || "").trim()) throw Error("عنوان المستند مطلوب");
    if (!String(data.currency||"").trim()) throw Error("حدد عملة المستند");
    if (!Array.isArray(data.items)) throw Error("بنود المستند مطلوبة");
    for (const item of data.items) {
      if (!Number.isFinite(Number(item?.qty)) || Number(item.qty) <= 0 || !Number.isFinite(Number(item?.unit_price)) || Number(item.unit_price) < 0)
        throw Error("كمية وسعر الوحدة صحيحان وموجبان أو صفر");
    }
    if (data.status !== undefined && !["draft", "completed"].includes(data.status)) throw Error("حالة المستند غير صحيحة");
  }
  if (type === "report" && !String(data.title || "").trim()) throw Error("عنوان التقرير مطلوب");
}
async function validateReferences(
  type: EntityType,
  data: Record<string, any>,
  s: Settings,
  id?: string,
) {
  if (type === "device") {
    const all = await db.records
      .where("[workspace_id+type]")
      .equals([s.workspace.id, "device"])
      .toArray();
    if (
      all.some(
        (r) =>
          r.id !== id &&
          !r.deleted_at &&
          String(r.data.asset_code).toLowerCase() ===
            String(data.asset_code).toLowerCase(),
      )
    )
      throw Error("كود الجهاز مستخدم بالفعل");
  }
  if (
    ["order", "plan", "calibration"].includes(type) ||
    (type === "event" && data.device_id)
  ) {
    const device = await db.records.get(data.device_id);
    if (
      !device ||
      device.deleted_at ||
      device.type !== "device" ||
      device.workspace_id !== s.workspace.id
    )
      throw Error("الجهاز غير موجود في هذه المساحة");
  }
}
async function enqueue(operation: Omit<QueueRow, "queued_at">) {
  const last = await db.queue.orderBy("queued_at").last();
  return db.queue.add({
    ...operation,
    queued_at: Math.max(last?.queued_at || 0, Date.now() * 1000) + 1,
  });
}
async function putMutation(
  row: RecordRow,
  action: QueueRow["action"],
  before: RecordRow | null,
  base: number,
) {
  const event = await auditEvent(
    action,
    row.type,
    row.id,
    before?.data ?? null,
    row.data,
  );
  await db.records.put(row);
  await db.audit.add(event);
  await enqueue({
    id: uid(),
    entity_id: row.id,
    entity_type: row.type,
    base_version: base,
    record: row,
    action,
    audit: [event],
  });
}
export async function createRecord(
  type: EntityType,
  data: Record<string, any>,
) {
  const s = await getSettings();
  checkRole(s, type, "create");
  validateData(type, data);
  return db.transaction(
    "rw",
    db.records,
    db.audit,
    db.queue,
    db.settings,
    async () => {
      await validateReferences(type, data, s);
      const t = now();
      const id = uid();
      const cleanData = structuredClone(data);
      delete cleanData.record_code;
      const row: RecordRow = {
        id,
        type,
        workspace_id: s.workspace.id,
        created_at: t,
        updated_at: t,
        deleted_at: null,
        created_by: s.user.id,
        domain: "medical",
        data: cleanData,
        version: 1,
        sync_status: "pending",
      };
      row.data.record_code = codeFor(type, row.id);
      if (type === "order") {
        row.data.status = "draft";
        row.data.detected_at ||= localDateTime();
        row.data.device_timezone_offset_minutes ??= new Date().getTimezoneOffset();
        row.data.assigned_to ||= s.user.id;
        row.data.checklist ||= [
          {
            label: "اختبار السلامة الكهربائية حسب إجراء المستشفى",
            checked: false,
          },
          { label: "اختبار الأداء حسب دليل الشركة", checked: false },
          { label: "تسجيل القياسات بعد الإصلاح", checked: false },
          { label: "مراجعة مسؤول الإغلاق", checked: false },
        ];
      }
      await putMutation(row, "create", null, 0);
      return row;
    },
  );
}
export async function updateRecord(id: string, patchData: Record<string, any>) {
  const s = await getSettings();
  return db.transaction(
    "rw",
    db.records,
    db.audit,
    db.queue,
    db.settings,
    async () => {
      const old = await db.records.get(id);
      if (!old || old.deleted_at || old.workspace_id !== s.workspace.id)
        throw Error("السجل غير موجود");
      checkRole(s, old.type, "update", old);
      if (old.type === "order" && old.data.status === "closed")
        throw Error("الأمر المغلق ثابت؛ أضف ملاحظة تصحيح بدل تعديله");
      if (Object.prototype.hasOwnProperty.call(patchData, "record_code") && patchData.record_code !== old.data.record_code)
        throw Error("كود السجل ثابت ولا يمكن تغييره");
      const data: Record<string, any> = { ...old.data, ...structuredClone(patchData), record_code: old.data.record_code || codeFor(old.type, old.id) };
      if (
        old.type === "order" &&
        data.status === "closed" &&
        old.data.status !== "closed"
      )
        throw Error("استخدم زر اعتماد الإغلاق");
      validateData(old.type, data);
      await validateReferences(old.type, data, s, id);
      const row = {
        ...old,
        data,
        updated_at: now(),
        version: old.version + 1,
        sync_status: "pending",
      };
      await putMutation(row, "update", old, old.version);
      return row;
    },
  );
}
export async function deleteRecord(id: string) {
  const s = await getSettings();
  await db.transaction(
    "rw",
    db.records,
    db.audit,
    db.queue,
    db.settings,
    async () => {
      const old = await db.records.get(id);
      if (!old || old.workspace_id !== s.workspace.id)
        throw Error("السجل غير موجود");
      checkRole(s, old.type, "delete", old);
      if (old.type === "order" && old.data.status === "closed")
        throw Error("لا يمكن حذف أمر مغلق");
      if (old.type === "usage")
        throw Error("سجل استهلاك القطع ثابت؛ استخدم أمر تصحيح");
      if (old.type === "device") {
        const linked = (
          await db.records
            .where("workspace_id")
            .equals(s.workspace.id)
            .toArray()
        ).some((r) => !r.deleted_at && r.data.device_id === id);
        if (linked) throw Error("الجهاز مرتبط بسجلات؛ غيّر حالته بدل حذفه");
      }
      await putMutation(
        {
          ...old,
          deleted_at: now(),
          updated_at: now(),
          version: old.version + 1,
          sync_status: "pending",
        },
        "delete",
        old,
        old.version,
      );
    },
  );
}
export async function usePart(
  orderId: string,
  partId: string,
  quantity: number,
) {
  if (!Number.isFinite(quantity) || quantity <= 0)
    throw Error("أدخل كمية أكبر من صفر");
  const s = await getSettings();
  await db.transaction(
    "rw",
    db.records,
    db.audit,
    db.queue,
    db.settings,
    async () => {
      const order = await db.records.get(orderId),
        part = await db.records.get(partId);
      if (
        !order ||
        !part ||
        order.type !== "order" ||
        part.type !== "part" ||
        order.deleted_at ||
        part.deleted_at ||
        order.workspace_id !== s.workspace.id ||
        part.workspace_id !== s.workspace.id
      )
        throw Error("الأمر أو القطعة غير موجودة");
      checkRole(s, "usage", "create", order);
      if (["closed", "pending_approval"].includes(order.data.status))
        throw Error("افتح الأمر للتنفيذ قبل صرف القطع");
      if (Number(part.data.quantity) < quantity)
        throw Error("الكمية غير كافية");
      const t = now();
      const usage: RecordRow = {
        id: uid(),
        type: "usage",
        workspace_id: s.workspace.id,
        created_at: t,
        updated_at: t,
        deleted_at: null,
        created_by: s.user.id,
        domain: "medical",
        version: 1,
        sync_status: "pending",
        data: {
          order_id: orderId,
          part_id: partId,
          quantity,
          unit_cost: Number(part.data.purchase_price || 0),
        },
      };
      await putMutation(usage, "create", null, 0);
      await putMutation(
        {
          ...part,
          data: {
            ...part.data,
            quantity: Number(part.data.quantity) - quantity,
          },
          version: part.version + 1,
          updated_at: t,
          sync_status: "pending",
        },
        "update",
        part,
        part.version,
      );
    },
  );
}
export function checkClosure(data: Record<string, any>) {
  if (
    !Array.isArray(data.checklist) ||
    data.checklist.length < 4 ||
    data.checklist.some((c: any) => !c.label || !c.checked)
  )
    throw Error("أكد كل بنود السلامة قبل طلب الإغلاق");
  if (!String(data.tests || "").trim())
    throw Error("سجل نتائج الاختبار بعد الإصلاح");
}
export async function submitOrder(id: string) {
  const row = await db.records.get(id);
  if (!row || row.type !== "order") throw Error("الأمر غير موجود");
  checkClosure(row.data);
  const s = await getSettings();
  return updateRecord(id, {
    status: "pending_approval",
    closure_requested_by: s.user.id,
    closure_requested_at: now(),
  });
}
export async function approveOrder(id: string) {
  const s = await getSettings();
  if (!["owner", "admin"].includes(s.role))
    throw Error("الاعتماد للمالك أو المدير فقط");
  return db.transaction(
    "rw",
    db.records,
    db.audit,
    db.queue,
    db.settings,
    async () => {
      const old = await db.records.get(id);
      if (
        !old ||
        old.workspace_id !== s.workspace.id ||
        old.type !== "order" ||
        old.data.status !== "pending_approval"
      )
        throw Error("الأمر ليس في انتظار الاعتماد");
      checkClosure(old.data);
      const t = now();
      await putMutation(
        {
          ...old,
          data: {
            ...old.data,
            status: "closed",
            approved_by: s.user.id,
            approved_at: t,
            ended_at: old.data.ended_at || t,
          },
          updated_at: t,
          version: old.version + 1,
          sync_status: "pending",
        },
        "update",
        old,
        old.version,
      );
    },
  );
}
export async function saveAttachment(
  file: File,
  entityType: string,
  entityId: string,
  kind: string,
) {
  if (file.size > 10 * 1024 * 1024)
    throw Error(
      "حد الملف 10 ميجابايت؛ احتفظ بالملفات الأكبر في نظام مستندات المستشفى",
    );
  const content = await new Promise<string>((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await file.arrayBuffer(),
  );
  const sha256 = Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  return createRecord("attachment", {
    name: file.name,
    mime: file.type,
    size: file.size,
    entity_type: entityType,
    entity_id: entityId,
    kind,
    content,
    sha256,
  });
}
const templates: Record<string, string[]> = {
  device: [
    "name",
    "asset_code",
    "manufacturer",
    "model",
    "serial",
    "location",
    "status",
    "notes",
  ],
  part: [
    "name",
    "part_number",
    "quantity",
    "min_quantity",
    "purchase_price",
    "supplier",
    "storage",
  ],
  plan: [
    "device_code",
    "interval_days",
    "last_completed",
    "next_due",
    "reference",
  ],
  event: ["title", "at", "remind_at", "device_code"],
};
export async function downloadBlob(blob: Blob, name: string) {
  if (Capacitor.isNativePlatform()) {
    const data = await new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result).split(",")[1]);
      fr.onerror = reject;
      fr.readAsDataURL(blob);
    });
    const saved = await Filesystem.writeFile({
      path: name.replace(/[^a-zA-Z0-9._-]/g, "_"),
      data,
      directory: Directory.Cache,
      recursive: true,
    });
    await Share.share({
      title: "EngX",
      url: saved.uri,
      dialogTitle: "احفظ الملف خارج الهاتف أو شاركه",
    });
    return;
  }
  const a = document.createElement("a");
  const u = URL.createObjectURL(blob);
  a.href = u;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 3000);
}
const NativePrinter = registerPlugin<{ print(): Promise<void> }>("EngXPrinter");
export async function printReport() {
  await logActivity("report_print_requested", "report");
  if (Capacitor.isNativePlatform()) await NativePrinter.print();
  else window.print();
}
export async function downloadTemplate(type: EntityType) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([templates[type] || ["name"]]),
    type,
  );
  await downloadBlob(
    new Blob([XLSX.write(wb, { type: "array", bookType: "xlsx" })], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    `EngX-${type}-template.xlsx`,
  );
  await logActivity("excel_template_downloaded", type);
}
export async function parseExcel(file: File) {
  if (file.size > 20 * 1024 * 1024) throw Error("حد ملف الاستيراد 20 ميجابايت");
  const wb = XLSX.read(await file.arrayBuffer(), {
    type: "array",
    cellDates: true,
  });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) throw Error("ملف فارغ");
  const matrix = XLSX.utils.sheet_to_json<any[]>(sheet, {
    header: 1,
    defval: "",
    raw: true,
  });
  const headers = (matrix.shift() || []).map(String);
  if (new Set(headers).size !== headers.length)
    throw Error("أسماء الأعمدة مكررة؛ صحح الصف الأول");
  if (matrix.length > 10000) throw Error("استورد حتى 10000 صف في كل مرة");
  const rows = matrix
    .filter((r) => r.some((v) => v !== ""))
    .map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ""])));
  await logActivity("excel_preview", "import", "", null, {
    name: file.name,
    rows: rows.length,
  });
  return { headers, rows, sheetNames: wb.SheetNames };
}
export async function validateImport(
  type: EntityType,
  rows: Record<string, any>[],
  mapping: Record<string, string>,
) {
  const s = await getSettings();
  const all = await db.records
    .where("workspace_id")
    .equals(s.workspace.id)
    .toArray();
  const codes = new Set(
    all
      .filter((r) => r.type === "device" && !r.deleted_at)
      .map((r) => String(r.data.asset_code).toLowerCase()),
  );
  const valid: Record<string, any>[] = [],
    errors: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    try {
      const d: Record<string, any> = {};
      for (const [target, column] of Object.entries(mapping))
        if (column) {
          let v = rows[i][column];
          if (v instanceof Date) v = v.toISOString();
          d[target] = typeof v === "string" ? v.trim() : v;
        }
      for (const k of [
        "quantity",
        "min_quantity",
        "purchase_price",
        "interval_days",
      ])
        if (d[k] !== undefined && d[k] !== "") {
          d[k] = Number(d[k]);
          if (!Number.isFinite(d[k])) throw Error(`${k}: رقم غير صالح`);
        }
      if (type === "device") {
        d.status ||= "unknown";
        const c = String(d.asset_code || "").toLowerCase();
        if (codes.has(c)) throw Error("كود جهاز مكرر");
        codes.add(c);
      }
      if (d.device_code) {
        const dev = all.find(
          (r) =>
            r.type === "device" &&
            !r.deleted_at &&
            String(r.data.asset_code) === String(d.device_code),
        );
        if (!dev) throw Error("كود الجهاز غير موجود");
        d.device_id = dev.id;
        delete d.device_code;
      }
      validateData(type, d);
      valid.push(d);
    } catch (e) {
      errors.push(`الصف ${i + 2}: ${(e as Error).message}`);
    }
  }
  return { valid, errors };
}
export async function importRows(
  type: EntityType,
  validRows: Record<string, any>[],
) {
  const s = await getSettings();
  checkRole(s, type, "create");
  const batch_id = uid();
  await db.transaction(
    "rw",
    db.records,
    db.audit,
    db.queue,
    db.settings,
    async () => {
      for (const data of validRows)
        await createRecord(type, { ...data, _import_batch_id: batch_id });
    },
  );
  await logActivity("excel_imported", type, batch_id, null, {
    count: validRows.length,
  });
  return { batch_id, count: validRows.length };
}
function excelSafe(v: any): any {
  if (typeof v === "string" && /^[=+@\-\t\r]/.test(v)) return `'${v}`;
  if (typeof v === "object" && v !== null) return JSON.stringify(v);
  return v;
}
export async function exportDataExcel() {
  const s = await getSettings();
  const rows = (
    await db.records.where("workspace_id").equals(s.workspace.id).toArray()
  ).filter((r) => !r.deleted_at);
  const wb = XLSX.utils.book_new();
  for (const type of [
    "device",
    "order",
    "part",
    "usage",
    "plan",
    "event",
    "comment",
    "calibration",
  ]) {
    const data = rows
      .filter((r) => r.type === type)
      .map((r) =>
        Object.fromEntries(
          Object.entries({ id: r.id, ...r.data }).map(([k, v]) => [
            k,
            excelSafe(v),
          ]),
        ),
      );
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), type);
  }
  await downloadBlob(
    new Blob([XLSX.write(wb, { type: "array", bookType: "xlsx" })], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    "EngX-data.xlsx",
  );
  await logActivity("excel_exported");
}
export async function createBackup(password: string) {
  const s = await getSettings();
  const records = await db.records
    .where("workspace_id")
    .equals(s.workspace.id)
    .toArray();
  const audit = await db.audit
    .where("workspace_id")
    .equals(s.workspace.id)
    .toArray();
  const { exportCachedChat } = await import("./chat");
  const chat = await exportCachedChat(s.workspace.id);
  const payload = {
    format: "engx",
    version: 1,
    created_at: now(),
    workspace: s.workspace,
    user: s.user,
    role: s.role,
    records,
    audit,
    settings: { language: s.language, dark: s.dark },
    chat,
  };
  const blob = await encryptBackup(payload, password);
  await db.settings.update("settings", { lastBackup: now() });
  await logActivity("backup_created", "backup", "", null, {
    records: records.length,
    attachments: records.filter((r) => r.type === "attachment").length,
  });
  return blob;
}
export async function inspectBackup(file: File, password: string) {
  if (file.size > 150 * 1024 * 1024)
    throw Error("النسخة كبيرة جدًا لهذا الجهاز");
  const payload = await decryptBackup(await file.text(), password);
  validateBackup(payload);
  const counts: Record<string, number> = {};
  for (const r of payload.records) counts[r.type] = (counts[r.type] || 0) + 1;
  return { counts, created_at: payload.created_at, payload };
}
function validateBackup(p: any) {
  if (
    p?.format !== "engx" ||
    p.version !== 1 ||
    !Array.isArray(p.records) ||
    !Array.isArray(p.audit) ||
    !p.workspace?.id ||
    !p.user?.id
  )
    throw Error("صيغة النسخة غير مدعومة");
  const ids = new Set<string>();
  for (const r of p.records) {
    if (
      !r.id ||
      ids.has(r.id) ||
      r.workspace_id !== p.workspace.id ||
      ![
        "device",
        "order",
        "part",
        "usage",
        "plan",
        "event",
        "attachment",
        "comment",
        "checklist",
        "calibration",
        "sale",
        "purchase",
        "report",
        "correction",
      ].includes(r.type) ||
      !r.data
    )
      throw Error("نسخة غير متسقة");
    ids.add(r.id);
  }
  if (p.audit.some((a: any) => !a.id || a.workspace_id !== p.workspace.id)) throw Error("سجل أنشطة غير صالح");
  if (p.chat !== undefined && (!p.chat || !Array.isArray(p.chat.messages) || !Array.isArray(p.chat.files) || p.chat.messages.length > 100000 || p.chat.files.length > 100000)) throw Error("أرشيف المحادثة غير صالح");
  for (const f of p.chat?.files || []) if (f.workspace_id !== p.workspace.id || Number(f.size) > 10 * 1024 * 1024) throw Error("ملف محادثة غير صالح");
  for (const m of p.chat?.messages || []) if (m.workspace_id !== p.workspace.id || typeof m.text !== "string") throw Error("رسالة محادثة غير صالحة");
}
export async function restoreBackup(payload: any) {
  validateBackup(payload);
  const old = await getSettings();
  if (old.token)
    throw Error(
      "سجل الخروج قبل استعادة نسخة؛ ثم اربط حساب النسخة بعد الاسترجاع",
    );
  await db.transaction(
    "rw",
    db.records,
    db.audit,
    db.queue,
    db.settings,
    db.activity,
    async () => {
      await db.records.clear();
      await db.queue.clear();
      await db.audit.clear();
      await db.activity.clear();
      await db.records.bulkPut(
        payload.records.map((r: RecordRow) => ({ ...r, data: { ...r.data, record_code: r.data?.record_code || codeFor(r.type, r.id) }, sync_status: "local" })),
      );
      await db.audit.bulkPut(payload.audit);
      await db.settings.put({
        ...old,
        id: "settings",
        user: payload.user,
        workspace: payload.workspace,
        role: payload.role || "owner",
        language: payload.settings?.language || "ar",
        dark: !!payload.settings?.dark,
        token: undefined,
        cloudEnabled: false,
        lastSync: 0,
        lastBackup: payload.created_at,
      });
    },
  );
  const { restoreCachedChat } = await import("./chat");
  await restoreCachedChat(payload.workspace.id, payload.chat || { messages: [], files: [] });
  await logActivity("backup_restored", "backup", "", null, { created_at: payload.created_at });
}
export function displaySyncReason(code: string) {
  const m: Record<string, string> = {
    UNAUTHORIZED: "انتهت جلسة الدخول؛ سجل الدخول مرة أخرى",
    INVALID_CREDENTIALS: "البريد أو كلمة المرور غير صحيحين",
    EMAIL_EXISTS: "البريد مسجل بالفعل؛ استخدم تسجيل الدخول",
    GOOGLE_NOT_CONFIGURED: "دخول Google يحتاج إعداد معرّف التطبيق على الخادم",
    INVALID_GOOGLE_TOKEN: "تعذر التحقق من حساب Google",
    ROLE_FORBIDDEN: "صلاحياتك لا تسمح بهذا الإجراء",
    FORBIDDEN: "لا تملك الوصول إلى هذه المساحة",
    WORKSPACE_REVOKED: "تم إيقاف الوصول؛ حُذفت نسخة هذه المساحة من الجهاز",
    VERSION_CONFLICT: "تعديل آخر وصل للسجل؛ يحتاج مراجعة",
    ASSET_CODE_EXISTS: "كود الجهاز مستخدم بالفعل",
    ORDER_CLOSED: "أمر الصيانة مغلق ولا يقبل التعديل",
    CHECKLIST_INCOMPLETE: "قائمة السلامة غير مكتملة",
    APPROVAL_REQUIRED: "اعتماد مسؤول الإغلاق مطلوب",
    INVITATION_INVALID: "الدعوة غير صحيحة أو انتهت أو استُخدمت",
    NOT_FOUND: "البيانات غير موجودة",
  };
  return m[code] || code;
}
function serverBase(s: Settings) {
  const u = s.serverUrl.replace(/\/$/, "");
  if (!u) throw Error("أدخل عنوان خادم الحفظ أولًا");
  const url = new URL(u);
  if (
    url.protocol !== "https:" &&
    !["localhost", "127.0.0.1", "10.0.2.2"].includes(url.hostname)
  )
    throw Error("استخدم عنوان HTTPS لحماية الحساب والبيانات");
  return u;
}
async function request(path: string, method = "GET", body?: any) {
  const s = await getSettings();
  const response = await fetch(`${serverBase(s)}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(s.token ? { Authorization: `Bearer ${s.token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response
    .json()
    .catch(() => ({ error: "تعذر قراءة رد الخادم" }));
  if (!response.ok) {
    if (response.status === 403 && ["WORKSPACE_REVOKED","MEMBERSHIP_INACTIVE"].includes(result.code)) {
      const { clearWorkspaceChat } = await import("./chat");
      await clearWorkspaceChat(s.workspace.id);
      await db.transaction(
        "rw",
        db.records,
        db.queue,
        db.audit,
        db.activity,
        async () => {
          await db.records
            .where("workspace_id")
            .equals(s.workspace.id)
            .delete();
          await db.audit.where("workspace_id").equals(s.workspace.id).delete();
          await db.queue.clear();
          await db.activity.clear();
        },
      );
      await db.settings.update("settings", {
        token: undefined,
        cloudEnabled: false,
        role: "viewer",
      });
    }
    throw Error(
      result.error ||
        result.message ||
        displaySyncReason(result.code || "تعذر الاتصال بالخادم"),
    );
  }
  return result;
}
export async function teamRequest(path: string, method = "GET", body?: any) {
  const result = await request(path, method, body);
  if (
    path === "/api/invitations/accept" &&
    result.workspace &&
    result.membership
  ) {
    await db.settings.update("settings", {
      workspace: result.workspace,
      role: result.membership.role,
      lastSync: 0,
    });
  }
  if (method !== "GET")
    await logActivity("team_action", "team", path, null, { method });
  return result;
}
export async function signIn(
  mode: "register" | "login" | "google",
  values: {
    email?: string;
    password?: string;
    name?: string;
    credential?: string;
  },
) {
  const old = await getSettings();
  const result = await request(`/api/auth/${mode}`, "POST", values);
  if (!result.token || !result.workspace?.id)
    throw Error("رد تسجيل الدخول غير صالح");
  const orderOf: Record<string, number> = {
    device: 0,
    part: 1,
    order: 2,
    plan: 3,
    event: 4,
    usage: 5,
    attachment: 6,
    comment: 7,
    checklist: 8,
    calibration: 9,
    sale: 10,
    purchase: 11,
    report: 12,
  };
  const local = (
    await db.records.where("workspace_id").equals(old.workspace.id).toArray()
  ).sort((a, b) => (orderOf[a.type] ?? 9) - (orderOf[b.type] ?? 9));
  if (local.length && old.workspace.id !== result.workspace.id) {
    const remote = await fetch(`${serverBase(old)}/api/sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${result.token}`,
      },
      body: JSON.stringify({
        workspace_id: result.workspace.id,
        operations: [],
        since: 0,
      }),
    });
    const remoteData = await remote.json();
    if (!remote.ok) throw Error(remoteData.error || "فشل فحص مساحة الحساب");
    if (remoteData.records?.length)
      throw Error(
        "الحساب يحتوي بيانات أخرى؛ صدّر نسخة من البيانات المحلية وسجل الخروج قبل فتح هذا الحساب لتجنب خلط البيانات",
      );
    await db.transaction(
      "rw",
      db.records,
      db.audit,
      db.queue,
      db.activity,
      async () => {
        await db.queue.clear();
        await db.activity.clear();
        for (const r of local) {
          const migrated = {
            ...r,
            workspace_id: result.workspace.id,
            created_by: result.user.id,
            version: 1,
            sync_status: "pending",
            data: {
              ...r.data,
              ...(r.type === "usage" ? { historical: true } : {}),
              assigned_to:
                r.data.assigned_to === old.user.id
                  ? result.user.id
                  : r.data.assigned_to,
              approved_by:
                r.data.approved_by === old.user.id
                  ? result.user.id
                  : r.data.approved_by,
              closure_requested_by:
                r.data.closure_requested_by === old.user.id
                  ? result.user.id
                  : r.data.closure_requested_by,
              ...(Array.isArray(r.data.checklist)
                ? {
                    checklist: r.data.checklist.map((c: any) => ({
                      ...c,
                      confirmed_by:
                        c.confirmed_by === old.user.id
                          ? result.user.id
                          : c.confirmed_by,
                    })),
                  }
                : {}),
            },
          };
          await db.records.put(migrated);
          await enqueue({
            id: uid(),
            entity_id: r.id,
            entity_type: r.type,
            base_version: 0,
            record: migrated,
            action: "create",
            audit: [],
          });
        }
        const audits = await db.audit
          .where("workspace_id")
          .equals(old.workspace.id)
          .toArray();
        for (const a of audits) {
          const event = {
            ...a,
            workspace_id: result.workspace.id,
            created_by: result.user.id,
          };
          await db.audit.put(event);
          await db.activity.put(event);
        }
      },
    );
  }
  await db.settings.put({
    ...old,
    user: result.user,
    workspace: result.workspace,
    role: result.membership?.role || "owner",
    token: result.token,
    cloudEnabled: true,
    lastSync: 0,
  });
  await logActivity("signed_in", "account", result.user.id);
}
export async function signOut() {
  await logActivity("signed_out", "account");
  await db.settings.update("settings", {
    token: undefined,
    cloudEnabled: false,
  });
}
let syncing = false;
export async function syncNow() {
  if (syncing) return;
  const s = await getSettings();
  if (!s.cloudEnabled || !s.token)
    throw Error("فعّل الحفظ السحابي وسجل الدخول أولًا");
  if (!navigator.onLine)
    throw Error("البيانات محفوظة على الجهاز؛ اتصل بالإنترنت للمزامنة");
  syncing = true;
  try {
    const me = await request(
      `/api/me?workspace_id=${encodeURIComponent(s.workspace.id)}`,
    );
    if (me.membership?.role)
      await db.settings.update("settings", { role: me.membership.role });
    const queue = (await db.queue.orderBy("queued_at").toArray()).filter(
      (q) => q.record.workspace_id === s.workspace.id,
    );
    let cursor = s.lastSync || 0;
    const batches: QueueRow[][] = [];
    let batch: QueueRow[] = [];
    let bytes = 0;
    for (let i = 0; i < queue.length; i++) {
      const group = [queue[i]];
      if (
        queue[i].entity_type === "usage" &&
        queue[i + 1]?.entity_type === "part"
      )
        group.push(queue[++i]);
      const size = JSON.stringify(group).length;
      if (
        batch.length &&
        (bytes + size > 8 * 1024 * 1024 || batch.length + group.length > 25)
      ) {
        batches.push(batch);
        batch = [];
        bytes = 0;
      }
      batch.push(...group);
      bytes += size;
    }
    if (batch.length || !batches.length) batches.push(batch);
    for (const batch of batches) {
      const result = await request("/api/sync", "POST", {
        workspace_id: s.workspace.id,
        operations: batch,
        since: cursor,
      });
      await db.transaction(
        "rw",
        db.records,
        db.audit,
        db.queue,
        db.settings,
        async () => {
          for (const id of result.accepted || []) await db.queue.delete(id);
          for (const reject of result.rejected || []) {
            const q = await db.queue.get(reject.id);
            if (q) {
              await db.queue.update(q.id, { error: reject.reason });
              await db.records.update(q.entity_id, { sync_status: "review" });
            }
          }
          for (const row of result.records || []) {
            const pending = await db.queue
              .where("entity_id")
              .equals(row.id)
              .count();
            if (!pending)
              await db.records.put({ ...row, sync_status: "synced" });
          }
          if (result.audit?.length) await db.audit.bulkPut(result.audit);
        },
      );
      cursor = result.cursor ?? cursor;
    }
    const activity = await db.activity
      .where("workspace_id")
      .equals(s.workspace.id)
      .toArray();
    for (let i = 0; i < activity.length; i += 100) {
      const res = await request("/api/activity", "POST", {
        workspace_id: s.workspace.id,
        events: activity.slice(i, i + 100),
      });
      await db.activity.bulkDelete(res.accepted || []);
    }
    await db.settings.update("settings", { lastSync: cursor });
    const remain = (await db.queue.toArray()).filter(
      (q) => q.record.workspace_id === s.workspace.id,
    );
    if (remain.some((q) => q.error))
      throw Error(
        "بعض التعديلات تحتاج مراجعة؛ لم تُدمج أو تُحذف بصمت. صدّر نسخة واتصل بمدير المساحة.",
      );
  } finally {
    syncing = false;
  }
}
export async function uploadCloudBackup(password: string) {
  const s = await getSettings();
  if (!s.token || !s.cloudEnabled) throw Error("سجل الدخول وفعّل السحابة");
  const blob = await createBackup(password);
  await request("/api/backups", "POST", {
    workspace_id: s.workspace.id,
    encrypted: await blob.text(),
  });
  await logActivity("backup_uploaded");
}
export async function downloadCloudBackup() {
  const s = await getSettings();
  const result = await request(
    `/api/backups/latest?workspace_id=${encodeURIComponent(s.workspace.id)}`,
  );
  await logActivity("backup_downloaded");
  return new Blob([result.encrypted], { type: "application/json" });
}
export async function requestReminder(event: RecordRow) {
  const date = new Date(event.data.remind_at || event.data.at);
  if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now())
    throw Error("حدد وقت تذكير في المستقبل");
  if (Capacitor.isNativePlatform()) {
    const permission = await LocalNotifications.requestPermissions();
    if (permission.display !== "granted")
      throw Error("اسمح بالإشعارات من إعدادات الهاتف");
    const hash = Array.from(event.id).reduce(
      (n, c) => (n * 31 + c.charCodeAt(0)) | 0,
      0,
    );
    await LocalNotifications.schedule({
      notifications: [
        {
          id: Math.abs(hash) || 1,
          title: "EngX — تذكير",
          body: event.data.title,
          schedule: { at: date, allowWhileIdle: true },
        },
      ],
    });
  } else {
    throw Error(
      "التذكير المضمون عند إغلاق التطبيق متاح في نسخة أندرويد فقط؛ استخدم التقويم داخل المتصفح",
    );
  }
  await logActivity("reminder_scheduled", "event", event.id);
}
export function startAutoSync() {
  const run = async () => {
    const s = await getSettings();
    if (s.cloudEnabled && s.token && navigator.onLine)
      try {
        await syncNow();
      } catch (e) {
        console.warn("EngX:", (e as Error).message);
      }
  };
  window.addEventListener("online", run);
  const id = setInterval(run, 60000);
  void run();
  return () => {
    window.removeEventListener("online", run);
    clearInterval(id);
  };
}
export async function pendingIssues() {
  return (await db.queue.toArray()).filter((q) => q.error);
}

/** Undo only untouched records from a known import; never erase later work. */
export async function undoImport(batch_id: string) {
  const s = await getSettings();
  const skipped: string[] = [];
  let undone = 0;
  await db.transaction(
    "rw",
    db.records,
    db.audit,
    db.queue,
    db.settings,
    async () => {
      const all = await db.records
        .where("workspace_id")
        .equals(s.workspace.id)
        .toArray();
      const batch = all.filter(
        (r) => !r.deleted_at && r.data._import_batch_id === batch_id,
      );
      for (const row of batch) {
        if (row.version !== 1) {
          skipped.push(`${row.data.name || row.id}: تم تعديله بعد الاستيراد`);
          continue;
        }
        const linked = all.some(
          (r) =>
            !r.deleted_at &&
            r.id !== row.id &&
            [
              r.data.device_id,
              r.data.order_id,
              r.data.part_id,
              r.data.entity_id,
            ].includes(row.id),
        );
        if (linked) {
          skipped.push(`${row.data.name || row.id}: مرتبط بسجل آخر`);
          continue;
        }
        try {
          await deleteRecord(row.id);
          undone++;
        } catch (e) {
          skipped.push(`${row.data.name || row.id}: ${(e as Error).message}`);
        }
      }
    },
  );
  await logActivity("excel_import_undone", "import", batch_id, null, {
    undone,
    skipped,
  });
  return { undone, skipped };
}
/** Restore into an isolated temporary database; original workspace is untouched. */
export async function testBackupRoundtrip(password: string) {
  const blob = await createBackup(password);
  const payload = await decryptBackup(await blob.text(), password);
  validateBackup(payload);
  const temporary = new EngDB(`engx-restore-check-${uid()}`);
  let verified = false;
  try {
    await temporary.open();
    await temporary.transaction(
      "rw",
      temporary.records,
      temporary.audit,
      async () => {
        await temporary.records.bulkPut(payload.records);
        await temporary.audit.bulkPut(payload.audit);
      },
    );
    const recovered = await temporary.records.toArray();
    const source = new Map<string, string>(
      payload.records.map((r: RecordRow) => [r.id, JSON.stringify(r)]),
    );
    verified =
      recovered.length === payload.records.length &&
      recovered.every((r) => JSON.stringify(r) === source.get(r.id)) &&
      (await temporary.audit.count()) === payload.audit.length &&
      (!payload.chat || (payload.chat.messages.length >= 0 && payload.chat.files.length >= 0));
    if (!verified)
      throw Error(
        "فشل تطابق البيانات المسترجعة؛ لا تعتمد على هذه النسخة قبل المراجعة",
      );
  } finally {
    await temporary.delete();
  }
  const result = {
    records: payload.records.length,
    attachments: payload.records.filter(
      (r: RecordRow) => r.type === "attachment",
    ).length,
    verified,
  };
  await logActivity("backup_restore_test", "backup", "", null, result);
  return result;
}

export function widgetSnapshot(records:RecordRow[],enabled:boolean){
 const active=records.filter(r=>!r.deleted_at);const today=new Date().toISOString().slice(0,10);
 const plans=active.filter(r=>r.type==='plan'&&Number.isFinite(Date.parse(r.data.next_due))&&!['cancelled','inactive'].includes(r.data.status)).sort((a,b)=>String(a.data.next_due).localeCompare(String(b.data.next_due)));
 return {enabled,openOrders:enabled?active.filter(r=>r.type==='order'&&r.data.status!=='closed').length:0,pmDue:enabled?plans.filter(r=>String(r.data.next_due).slice(0,10)<=today).length:0,upcoming:enabled?plans.slice(0,3).map(p=>{const device=active.find(r=>r.type==='device'&&r.id===p.data.device_id);return {title:String(device?`${device.data.asset_code} — ${device.data.name}`:p.data.reference||'صيانة وقائية').slice(0,80),date:String(p.data.next_due).slice(0,10)}}):[],updatedAt:new Date().toISOString()};
}
const WidgetBridge=registerPlugin<{update(data:ReturnType<typeof widgetSnapshot>):Promise<void>}>('EngXWidgets');
export async function publishWidgetSnapshot(records:RecordRow[],enabled:boolean){if(Capacitor.isNativePlatform())await WidgetBridge.update(widgetSnapshot(records,enabled));}
