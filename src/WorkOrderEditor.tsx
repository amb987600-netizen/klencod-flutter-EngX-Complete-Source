import { useEffect, useRef, useState } from "react";
import { X, Plus, Save, Paperclip, CheckCircle } from "lucide-react";
import * as lib from "./lib";
import type { RecordRow } from "./lib";
const baseChecklist = [
  "اختبار السلامة الكهربائية حسب إجراء المستشفى",
  "اختبار الأداء حسب دليل الشركة",
  "تسجيل القياسات بعد الإصلاح",
  "مراجعة مسؤول الإغلاق",
];
const textFields: Record<number, [string, string][]> = {
  0: [
    ["description", "وصف البلاغ"],
    ["reported_by", "اسم المبلّغ"],
  ],
  1: [
    ["symptoms", "الأعراض"],
    ["measurements", "القياسات ونتائج الفحص — حسب مرجعك"],
    ["cause", "سبب العطل"],
  ],
  2: [
    ["actions", "الأعمال المنفذة"],
    ["tests", "نتائج الاختبار بعد الإصلاح"],
  ],
};
export default function WorkOrderEditor({
  row,
  devices,
  parts,
  close,
  notify,
}: any) {
  const settings = lib.useSettings();
  const all = lib.useRecords();
  const initial = row?.data || {
    device_id: row?.device_id || "",
    kind: "fault",
    status: "draft",
    detected_at:lib.localDateTime(),
    device_timezone_offset_minutes:new Date().getTimezoneOffset(),
    priority: "normal",
    assigned_to: settings?.user.id,
    checklist: baseChecklist.map((label) => ({ label, checked: false })),
  };
  const [data, setData] = useState<any>(initial);
  const [recordId, setRecordId] = useState<string | undefined>(row?.id);
  const idRef = useRef<string | undefined>(row?.id);
  const [step, setStep] = useState(0);
  const [quick,setQuick]=useState(!row?.id);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [lastSaved, setLastSaved] = useState("");
  const [comment, setComment] = useState("");
  const [partId, setPartId] = useState("");
  const [qty, setQty] = useState(1);
  const [members, setMembers] = useState<any[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [returnNote, setReturnNote] = useState("");
  const chain = useRef<Promise<any>>(Promise.resolve());
  const saved = useRef(row ? JSON.stringify(initial) : "");
  const mounted = useRef(true);
  const dataRef = useRef(data);
  dataRef.current = data;
  const frozen = ["closed", "pending_approval"].includes(data.status);
  const ownRole = settings?.role || "viewer";
  const manager = ["owner", "admin"].includes(ownRole);
  const canEdit =
    ownRole !== "viewer" &&
    (manager || !data.assigned_to || data.assigned_to === settings?.user.id) &&
    !frozen;
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[]);
  useEffect(() => {
    if (settings?.token) {
      lib
        .teamRequest(`/api/team?workspace_id=${settings.workspace.id}`)
        .then((r) => setMembers(r.members || []))
        .catch(() => {});
    }
  }, [settings?.token, settings?.workspace.id]);
  const persist = (
    snapshot: any = dataRef.current,
  ): Promise<string | undefined> => {
    const task = async () => {
      if (!snapshot.device_id) throw Error("اختر الجهاز أولًا");
      if(quick&&!String(snapshot.description||" ").trim())throw Error("اكتب وصف العطل لحفظ المسودة السريعة");
      if (["closed", "pending_approval"].includes(snapshot.status))
        return idRef.current;
      const signature = JSON.stringify(snapshot);
      if (signature === saved.current && idRef.current) return idRef.current;
      if (mounted.current) {
        setSaving(true);
        setError("");
      }
      try {
        let result: RecordRow;
        if (idRef.current)
          result = await lib.updateRecord(idRef.current, snapshot);
        else {
          result = await lib.createRecord("order", snapshot);
          if (snapshot.status && snapshot.status !== "draft")
            result = await lib.updateRecord(result.id, {
              status: snapshot.status,
            });
          idRef.current = result.id;
          if (mounted.current) setRecordId(result.id);
        }
        saved.current = signature;
        if (mounted.current) setLastSaved(new Date().toLocaleTimeString("ar"));
        return result.id;
      } finally {
        if (mounted.current) setSaving(false);
      }
    };
    const next = chain.current.catch(() => {}).then(task);
    chain.current = next;
    return next;
  };
  useEffect(() => {
    if (!canEdit || !data.device_id || (quick&&!String(data.description||" ").trim())) return;
    const t = setTimeout(() => {
      persist(data).catch((e) => {
        if (mounted.current) setError(e.message);
      });
    }, 700);
    return () => clearTimeout(t);
  }, [data, canEdit,quick]);
  const refresh = async () => {
    if (!idRef.current) return;
    const r = await lib.db.records.get(idRef.current);
    if (r) {
      saved.current = JSON.stringify(r.data);
      setData(r.data);
    }
  };
  const guarded = async (fn: () => Promise<any>) => {
    try {
      await fn();
      setError("");
    } catch (e: any) {
      setError(e.message);
      notify(e.message);
    }
  };
  const patch = (key: string, value: any) =>
    setData((d: any) => ({ ...d, [key]: value }));
  const comments = all.filter(
    (r) =>
      r.type === "comment" &&
      r.data.entity_type === "order" &&
      r.data.entity_id === recordId,
  );
  const docs = all.filter(
    (r) =>
      r.type === "attachment" &&
      r.data.entity_type === "order" &&
      r.data.entity_id === recordId,
  );
  const usages = all.filter(
    (r) => r.type === "usage" && r.data.order_id === recordId,
  );
  const closureReady =
    Array.isArray(data.checklist) &&
    data.checklist.length >= 4 &&
    data.checklist.every((c: any) => c.checked) &&
    String(data.tests || "").trim();
  const finish = () =>
    guarded(async () => {
      if(canEdit){if(data.device_id&&(!quick||String(data.description||'').trim()))await persist();else if(!data.device_id&&(data.description||data.title))throw Error('اختر الجهاز لحفظ النص الذي كتبته');}
      close();
    });
  return (
    <div className="modal-backdrop">
      <section className="modal wide" role="dialog" aria-label="أمر الصيانة">
        <div className="modal-head">
          <div>
            <small>أمر صيانة {recordId?.slice(0, 8) || "جديد"}</small>
            <h2>{data.title || "تسجيل أعمال الصيانة"}</h2>
            <span>
              {data.status === "closed"
                ? "مغلق ومعتمد"
                : data.status === "pending_approval"
                  ? "في انتظار الاعتماد"
                  : saving
                    ? "جارٍ الحفظ…"
                    : lastSaved
                      ? `محفوظ على الجهاز ${lastSaved}`
                      : "يُحفظ تلقائيًا بعد اختيار الجهاز"}
            </span>
          </div>
          <button
            aria-label="حفظ وإغلاق النافذة"
            className="icon-btn"
            onClick={finish}
          >
            <X />
          </button>
        </div>
        <div className="notice">
          ممنوع إدخال بيانات مرضى. اكتمال السجل لا يثبت السلامة الطبية؛ اتبع
          دليل الشركة وإجراء المستشفى.
        </div>
        {canEdit&&step===0&&<label className="check-label"><input type="checkbox" checked={quick} onChange={e=>setQuick(e.target.checked)}/>إدخال سريع — الجهاز ووصف العطل فقط</label>}
        {quick&&step===0&&<p className="notice">يُحفظ تلقائيًا كمسودة بعد اختيار الجهاز وكتابة الوصف. باقي البيانات اختيارية الآن؛ شروط السلامة عند الإغلاق النهائي فقط.</p>}
        <div className="steps">
          {["البلاغ", "الفحص", "التنفيذ", "المراجعة والاعتماد"].map(
            (name, i) => (
              <button
                key={name}
                className={step === i ? "active" : ""}
                onClick={() =>
                  guarded(async () => {
                    if (canEdit && data.device_id) await persist();
                    setStep(i);
                  })
                }
              >
                {i + 1}. {name}
              </button>
            ),
          )}
        </div>
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        <fieldset
          disabled={!canEdit}
          style={{ border: 0, padding: 0, margin: 0 }}
        >
          {step===0&&quick&&<div className="form-grid"><label>وقت اكتشاف العطل — تلقائي بتوقيت الموبايل<input type="datetime-local" value={data.detected_at||''} onChange={e=>patch('detected_at',e.target.value)}/><small>عدله فقط لو العطل حصل قبل التسجيل؛ التغيير محفوظ في السجل.</small></label><label>الجهاز <b>* مطلوب</b><select value={data.device_id||''} onChange={e=>patch('device_id',e.target.value)}><option value="">اختر الجهاز</option>{devices.map((device:RecordRow)=><option key={device.id} value={device.id}>{device.data.asset_code} — {device.data.name}</option>)}</select></label><label className="full">وصف العطل أو المشكلة <b>* مطلوب للمسودة السريعة</b><textarea value={data.description||''} onChange={e=>patch('description',e.target.value)} placeholder="اكتب البلاغ الآن وكمل التفاصيل بعدين — بدون بيانات مرضى"/></label></div>}
          {step === 0 && !quick && (
            <div className="form-grid">
              <label>
                عنوان الأمر
                <input
                  value={data.title || ""}
                  onChange={(e) => patch("title", e.target.value)}
                />
              </label>
              <label>
                الجهاز
                <select
                  value={data.device_id || ""}
                  onChange={(e) => patch("device_id", e.target.value)}
                >
                  <option value="">اختر جهازًا</option>
                  {devices.map((d: RecordRow) => (
                    <option key={d.id} value={d.id}>
                      {d.data.asset_code} — {d.data.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                نوع الأمر
                <select
                  value={data.kind || "fault"}
                  onChange={(e) => patch("kind", e.target.value)}
                >
                  <option value="fault">عطل</option>
                  <option value="preventive">وقائية</option>
                  <option value="calibration">معايرة</option>
                </select>
              </label>
              <label>
                الأولوية
                <select
                  value={data.priority || "normal"}
                  onChange={(e) => patch("priority", e.target.value)}
                >
                  <option value="low">منخفضة</option>
                  <option value="normal">عادية</option>
                  <option value="high">عالية</option>
                  <option value="critical">عاجلة</option>
                </select>
              </label>
              <label>
                وقت اكتشاف البلاغ
                <input
                  type="datetime-local"
                  value={String(data.detected_at || "").slice(0, 16)}
                  onChange={(e) => patch("detected_at", e.target.value)}
                />
              </label>
              <label>
                موعد المتابعة
                <input
                  type="date"
                  value={data.due_date || ""}
                  onChange={(e) => patch("due_date", e.target.value)}
                />
              </label>
            </div>
          )}
          {(step===0&&quick?[]:textFields[step] || []).map(([key, label]) => (
            <label key={key} style={{ display: "block", marginBlock: 12 }}>
              {label}
              <textarea
                value={data[key] || ""}
                onChange={(e) => patch(key, e.target.value)}
                placeholder="بدون أسماء أو معلومات المرضى"
              />
            </label>
          ))}
          {step === 1 && (
            <div className="form-grid">
              {manager && (
                <label>
                  الفني المسؤول
                  <select
                    value={data.assigned_to || settings?.user.id}
                    onChange={(e) => patch("assigned_to", e.target.value)}
                  >
                    <option value={settings?.user.id}>
                      {settings?.user.name} (أنا)
                    </option>
                    {members
                      .filter(
                        (m) =>
                          m.status === "active" &&
                          m.user_id !== settings?.user.id &&
                          m.role !== "viewer",
                      )
                      .map((m) => (
                        <option key={m.id} value={m.user_id}>
                          {m.name || m.email}
                        </option>
                      ))}
                  </select>
                </label>
              )}
              <label>
                حالة التنفيذ
                <select
                  value={
                    ["draft", "open", "in_progress"].includes(data.status)
                      ? data.status
                      : "draft"
                  }
                  onChange={(e) => patch("status", e.target.value)}
                >
                  <option value="draft">مسودة</option>
                  <option value="open">مفتوح</option>
                  <option value="in_progress">قيد التنفيذ</option>
                </select>
              </label>
              <label>
                بداية العمل
                <input
                  type="datetime-local"
                  value={String(data.started_at || "").slice(0, 16)}
                  onChange={(e) => patch("started_at", e.target.value)}
                />
              </label>
            </div>
          )}
          {step === 2 && (
            <>
              <label>
                نهاية العمل
                <input
                  type="datetime-local"
                  value={String(data.ended_at || "").slice(0, 16)}
                  onChange={(e) => patch("ended_at", e.target.value)}
                />
              </label>
              <h3>قطع الغيار المستخدمة</h3>
              <div className="button-row">
                <select
                  value={partId}
                  onChange={(e) => setPartId(e.target.value)}
                >
                  <option value="">اختر قطعة</option>
                  {parts.map((p: RecordRow) => (
                    <option key={p.id} value={p.id}>
                      {p.data.name} — المتاح {p.data.quantity || 0}
                    </option>
                  ))}
                </select>
                <input
                  aria-label="كمية الصرف"
                  type="number"
                  min="0.001"
                  step="any"
                  value={qty}
                  onChange={(e) => setQty(Number(e.target.value))}
                />
                <button
                  type="button"
                  className="secondary"
                  disabled={!partId || saving}
                  onClick={() =>
                    guarded(async () => {
                      const id = await persist();
                      if (!id) throw Error("احفظ الأمر أولًا");
                      await lib.usePart(id, partId, qty);
                      notify("تم تسجيل الصرف وخصم الكمية معًا");
                      setPartId("");
                    })
                  }
                >
                  صرف القطعة
                </button>
              </div>
            </>
          )}
          {step === 3 && (
            <>
              <h3>قائمة تحقق السلامة</h3>
              {(data.checklist || []).map((c: any, i: number) => (
                <div className="list-row" key={i}>
                  <input
                    style={{ width: 24, flex: "none" }}
                    type="checkbox"
                    checked={!!c.checked}
                    aria-label={c.label}
                    onChange={(e) =>
                      patch(
                        "checklist",
                        data.checklist.map((item: any, j: number) =>
                          j === i
                            ? {
                                ...item,
                                checked: e.target.checked,
                                confirmed_by: e.target.checked
                                  ? settings?.user.id
                                  : null,
                                confirmed_at: e.target.checked
                                  ? new Date().toISOString()
                                  : null,
                              }
                            : item,
                        ),
                      )
                    }
                  />
                  <input
                    aria-label={`بند تحقق ${i + 1}`}
                    value={c.label}
                    onChange={(e) =>
                      patch(
                        "checklist",
                        data.checklist.map((item: any, j: number) =>
                          j === i
                            ? {
                                ...item,
                                label: e.target.value,
                                checked: false,
                                confirmed_by: null,
                                confirmed_at: null,
                              }
                            : item,
                        ),
                      )
                    }
                  />
                </div>
              ))}
              <button
                className="secondary"
                onClick={() =>
                  patch("checklist", [
                    ...(data.checklist || []),
                    { label: "بند إضافي من إجراء المستشفى", checked: false },
                  ])
                }
              >
                <Plus size={15} />
                إضافة بند
              </button>
            </>
          )}
        </fieldset>
        {step === 2 && usages.length > 0 && (
          <div className="card">
            <h3>سجل صرف القطع</h3>
            {usages.map((u) => (
              <div className="list-row" key={u.id}>
                <span>
                  {parts.find((p: RecordRow) => p.id === u.data.part_id)?.data
                    .name || u.data.part_id}
                </span>
                <b>{u.data.quantity}</b>
              </div>
            ))}
          </div>
        )}
        {(step === 0 || step === 2) && (
          <div className="card">
            <h3>مرفقات الأمر</h3>
            {docs.map((d) => (
              <button
                key={d.id}
                className="secondary"
                onClick={() =>
                  guarded(async () => {
                    const response = await fetch(d.data.content);
                    await lib.downloadBlob(await response.blob(), d.data.name);
                    await lib.logActivity(
                      "attachment_downloaded",
                      "attachment",
                      d.id,
                    );
                  })
                }
              >
                {d.data.name}
              </button>
            ))}
            {canEdit && (
              <div className="button-row">
                <input
                  aria-label="مرفق أمر الصيانة"
                  type="file"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                />
                <button
                  className="secondary"
                  disabled={!file}
                  onClick={() =>
                    guarded(async () => {
                      const id = await persist();
                      if (!id) return;
                      await lib.saveAttachment(file!, "order", id, "report");
                      setFile(null);
                      notify("تم حفظ المرفق محليًا");
                    })
                  }
                >
                  <Paperclip size={15} />
                  حفظ المرفق
                </button>
              </div>
            )}
          </div>
        )}
        {step === 3 && (
          <>
            <div className="notice">
              {data.status === "closed"
                ? `اعتمده ${data.approved_by || "—"} في ${data.approved_at || "—"}. التصحيح بإضافة ملاحظة فقط.`
                : "لن يُغلق الأمر نهائيًا إلا بعد اكتمال البنود ونتائج الاختبار واعتماد المالك أو المدير."}
            </div>
            {data.status === "pending_approval" && manager && (
              <div className="card">
                <label>
                  ملاحظة الإرجاع للتنفيذ
                  <textarea
                    value={returnNote}
                    onChange={(e) => setReturnNote(e.target.value)}
                  />
                </label>
                <button
                  className="secondary"
                  disabled={!returnNote.trim()}
                  onClick={() =>
                    guarded(async () => {
                      await lib.createRecord("comment", {
                        entity_type: "order",
                        entity_id: recordId,
                        text: returnNote,
                        kind: "approval_return",
                      });
                      await lib.updateRecord(recordId!, {
                        status: "in_progress",
                        return_note: returnNote,
                      });
                      await refresh();
                      notify("تم إرجاع الأمر للتنفيذ مع الملاحظة");
                    })
                  }
                >
                  إرجاع للفني
                </button>
                <button
                  className="primary"
                  disabled={!closureReady}
                  onClick={() =>
                    guarded(async () => {
                      await lib.approveOrder(recordId!);
                      await refresh();
                      notify("تم اعتماد الإغلاق وتثبيت الأمر");
                    })
                  }
                >
                  <CheckCircle size={16} />
                  اعتماد الإغلاق
                </button>
              </div>
            )}
            <h3>الملاحظات والتصحيحات المضافة</h3>
            {comments.map((c) => (
              <div className="card" key={c.id}>
                <p>{c.data.text}</p>
                <small>
                  {c.created_by} — {new Date(c.created_at).toLocaleString("ar")}
                </small>
              </div>
            ))}
            {recordId && ownRole !== "viewer" && (
              <>
                <label>
                  ملاحظة جديدة — لا تعدل السجل الأصلي
                  <textarea
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                  />
                </label>
                <button
                  className="secondary"
                  disabled={!comment.trim()}
                  onClick={() =>
                    guarded(async () => {
                      await lib.createRecord("comment", {
                        entity_type: "order",
                        entity_id: recordId,
                        text: comment,
                        kind: data.status === "closed" ? "correction" : "note",
                      });
                      setComment("");
                      notify("تمت إضافة الملاحظة باسمك وتوقيتها");
                    })
                  }
                >
                  إضافة الملاحظة
                </button>
              </>
            )}
          </>
        )}
        <div className="modal-actions">
          <button className="secondary" onClick={finish}>
            حفظ وإغلاق النافذة
          </button>
          {step > 0 && (
            <button className="secondary" onClick={() => setStep(step - 1)}>
              السابق
            </button>
          )}
          {step < 3 ? (
            <button
              className="primary"
              onClick={() =>
                guarded(async () => {
                  if (canEdit) await persist();
                  setStep(step + 1);
                })
              }
            >
              التالي
            </button>
          ) : (
            canEdit && (
              <button
                className="primary"
                disabled={!closureReady || saving}
                onClick={() =>
                  guarded(async () => {
                    const id = await persist();
                    if (id) {
                      await lib.submitOrder(id);
                      await refresh();
                      notify("تم طلب اعتماد الإغلاق");
                    }
                  })
                }
              >
                طلب اعتماد الإغلاق
              </button>
            )
          )}
          {canEdit && (
            <button
              className="secondary"
              disabled={saving || !data.device_id || (quick&&!String(data.description||" ").trim())}
              onClick={() =>
                guarded(async () => {
                  await persist();
                  notify("تم الحفظ على الجهاز");
                })
              }
            >
              <Save size={15} />
              حفظ الآن
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
