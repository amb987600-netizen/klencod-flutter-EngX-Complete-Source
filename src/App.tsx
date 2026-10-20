import AgentChat from "./AgentChat";
import TeamChat from "./TeamChat";
import LocalAI from "./LocalAI";
import BusinessDocuments from "./BusinessDocuments";
import QRReader from "./QRReader";
import Settings from "./SettingsPanel";
import DeviceDetail from "./DeviceProfile";
import Reports from "./ReportPanel";
import OrderWizard from "./WorkOrderEditor";
import { App as NativeApp } from "@capacitor/app";
import { useEffect, useMemo, useRef, useState } from "react";
import * as lib from "./lib";
import type { EntityType, RecordRow } from "./lib";
import {
  Activity,
  Archive,
  ArrowLeft,
  Bell,
  CalendarDays,
  Check,
  Cloud,
  Database,
  Download,
  FileSpreadsheet,
  FileText,
  Filter,
  HeartPulse,
  LayoutDashboard,
  Lock,
  LogIn,
  Menu,
  Moon,
  Package,
  Plus,
  Printer,
  RefreshCw,
  Search,
  Settings as SettingsIcon,
  ShieldCheck,
  Tablet,
  Trash2,
  Upload,
  UserRound,
  Users,
  Wrench,
  X,
} from "lucide-react";
import "./styles.css";

type Screen =
  | "dashboard"
  | "devices"
  | "orders"
  | "inventory"
  | "plans"
  | "calendar"
  | "reports"
  | "activity"
  | "assist"
  | "settings"
  | "chat"
  | "documents";
const statusMap: any = {
  unknown:["غير محدد","gray"],
  working: ["يعمل", "green"],
  stopped: ["متوقف", "red"],
  maintenance: ["صيانة", "orange"],
  open: ["مفتوح", "blue"],
  in_progress: ["قيد التنفيذ", "orange"],
  pending_approval: ["بانتظار الاعتماد", "orange"],
  closed: ["مغلق", "green"],
  draft: ["مسودة", "gray"],
  low: ["منخفض", "red"],
};
const labels: any = {
  ar: {
    dashboard: "لوحة المتابعة",
    devices: "الأجهزة",
    orders: "أوامر العمل",
    inventory: "المخزون",
    plans: "خطط الصيانة",
    calendar: "التقويم",
    reports: "التقارير",
    activity: "سجل النشاط",
    assist: "شات المساعد",
    settings: "الإعدادات",
    chat: "محادثة الفريق",
    documents: "بيع وشراء ومستندات",
  },
  en: {
    dashboard: "Dashboard",
    devices: "Devices",
    orders: "Work orders",
    inventory: "Inventory",
    plans: "Plans",
    calendar: "Calendar",
    reports: "Reports",
    activity: "Activity",
    assist: "Local assistant",
    settings: "Settings",
    chat: "Team chat",
    documents: "Documents",
  },
};
const nav: any[] = [
  ["dashboard", LayoutDashboard],
  ["devices", Tablet],
  ["orders", FileText],
  ["inventory", Package],
  ["plans", Wrench],
  ["calendar", CalendarDays],
  ["reports", FileText],
  ["documents", Archive],
  ["chat", Users],
  ["activity", Activity],
  ["assist", Search],
  ["settings", SettingsIcon],
];
const deviceFields = [
  ["name", "اسم الجهاز"],
  ["asset_code", "رمز الأصل"],
  ["manufacturer", "الشركة المصنعة"],
  ["model", "الطراز"],
  ["serial", "الرقم التسلسلي"],
  ["location", "الموقع"],
  ["installation_date", "تاريخ التركيب"],
  ["notes", "ملاحظات"],
];
const genericFields: any = {
  part: [
    ["name", "اسم القطعة"],
    ["part_number", "رقم القطعة"],
    ["quantity", "الكمية"],
    ["min_quantity", "حد إعادة الطلب"],
    ["purchase_price", "سعر الشراء"],
    ["supplier", "المورد"],
    ["storage", "مكان التخزين"],
  ],
  plan: [
    ["device_id", "الجهاز"],
    ["interval_days", "الفاصل بالأيام"],
    ["last_completed", "آخر تنفيذ"],
    ["next_due", "الاستحقاق القادم"],
    ["reference", "مرجع الخطة"],
  ],
  event: [
    ["title", "العنوان"],
    ["at", "التاريخ والوقت"],
    ["remind_at", "وقت التذكير"],
  ],
};
function Badge({ status }: any) {
  const m = statusMap[status] || [status || "—", "gray"];
  return <span className={"badge " + m[1]}>{m[0]}</span>;
}
function App() {
  const s = lib.useSettings();
  const records = lib.useRecords();
  const audit = lib.useAudit();
  const [screen, setScreen] = useState<Screen>("dashboard");
  const [query, setQuery] = useState("");
  const [scanner,setScanner]=useState(false);
  const [widgetAction,setWidgetAction]=useState("");
  const [mobile, setMobile] = useState(false);
  const [dark, setDark] = useState(false);
  const [lang, setLang] = useState<"ar" | "en">("ar");
  const [toast, setToast] = useState("");
  const [online, setOnline] = useState(navigator.onLine);
  const [welcome, setWelcome] = useState(
    () => !localStorage.getItem("engx-intro"),
  );
  const [pendingDevice, setPendingDevice] = useState(
    new URLSearchParams(location.search).get("device") || "",
  );
  useEffect(() => {
    const yes = () => setOnline(true),
      no = () => setOnline(false);
    window.addEventListener("online", yes);
    window.addEventListener("offline", no);
    return () => {
      window.removeEventListener("online", yes);
      window.removeEventListener("offline", no);
    };
  }, []);
  useEffect(() => {
    const parse = (url: string) => {
      try {
        const u = new URL(url);
        if(u.protocol!=="engx:")return;
        if(u.hostname==="device")setPendingDevice(u.pathname.replace(/^\//,""));
        else if(["home","new-order","scan"].includes(u.hostname))setWidgetAction(u.hostname);
      } catch {}
    };
    let remove: (() => void) | undefined;
    NativeApp.getLaunchUrl()
      .then((r) => {
        if (r?.url) parse(r.url);
      })
      .catch(() => {});
    NativeApp.addListener("appUrlOpen", (r) => parse(r.url))
      .then((h) => {
        remove = () => h.remove();
      })
      .catch(() => {});
    return () => remove?.();
  }, []);
  useEffect(() => {
    if (!pendingDevice || !records.length) return;
    const found = records.find(
      (r) => r.type === "device" && r.id === pendingDevice,
    );
    if (found) {
      setDetail(found);
      setPendingDevice("");
      void lib.logActivity("device_opened_via_qr", "device", found.id);
    }
  }, [pendingDevice, records]);
  useEffect(() => {
    if (query.trim().length < 2) return;
    const t = setTimeout(() => {
      void lib.logActivity("search_performed", "search", "", null, {
        characters: query.length,
      });
    }, 650);
    return () => clearTimeout(t);
  }, [query]);
  const [modal, setModal] = useState<any>(null);
  const [detail, setDetail] = useState<RecordRow | null>(null);
  const [wizard, setWizard] = useState<any>(null);
  useEffect(()=>{if(!s||!widgetAction)return;if(widgetAction==='new-order'){if(s.role==='viewer')setToast('الحساب للقراءة فقط');else setWizard({});}else if(widgetAction==='scan')setScanner(true);else setScreen('dashboard');void lib.logActivity('widget_shortcut','widget',widgetAction);setWidgetAction('');},[widgetAction,s?.role]);
  useEffect(()=>{if(!s)return;void lib.publishWidgetSnapshot(records,!!s.widgetsEnabled).catch(()=>{});},[records,s?.widgetsEnabled,s?.workspace.id]);
  const L = labels[lang];
  useEffect(() => {
    if (s) {
      setDark(s.dark);
      setLang(s.language);
    }
  }, [s]);
  useEffect(() => {
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
    document.documentElement.lang = lang;
    document.body.classList.toggle("dark", dark);
  }, [lang, dark]);
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(""), 3500);
      return () => clearTimeout(t);
    }
  }, [toast]);
  const data = (type: EntityType) =>
    records.filter((r) => r.type === type && !r.deleted_at);
  const devices = data("device"),
    orders = data("order"),
    parts = data("part"),
    plans = data("plan"),
    events = data("event");
  const notify = (x: string) => setToast(x);
  const go = (x: Screen) => {
    setScreen(x);
    setMobile(false);
    void lib.logActivity("screen_view", "screen", x);
  };
  const save = async (type: EntityType, d: any, row?: RecordRow) => {
    try {
      row ? await lib.updateRecord(row.id, d) : await lib.createRecord(type, d);
      setModal(null);
      notify("تم الحفظ محلياً — بانتظار المزامنة");
    } catch (e: any) {
      notify(e.message);
    }
  };
  const del = async (r: RecordRow) => {
    if (confirm("حذف السجل؟"))
      try {
        await lib.deleteRecord(r.id);
        notify("تم الحذف");
      } catch (e: any) {
        notify(e.message);
      }
  };
  if (!s) return null;
  return (
    <div className="app-shell">
      <aside className={"sidebar " + (mobile ? "show" : "")}>
        <div className="brand">
          <span className="brand-mark">
            <HeartPulse />
          </span>
          <b>
            EngX<small>Medical Care</small>
          </b>
          <button
            className="icon-btn mobile-close"
            onClick={() => setMobile(false)}
          >
            <X />
          </button>
        </div>
        <div className="workspace">
          <span className="avatar">{s.user.name?.[0] || "E"}</span>
          <div>
            <b>{s.workspace.name}</b>
            <small>{s.user.email || "حساب محلي"}</small>
          </div>
        </div>
        <nav>
          {nav.map(([id, I]) => (
            <button
              className={screen === id ? "active" : ""}
              onClick={() => go(id)}
              key={id}
            >
              <I size={17} />
              {L[id]}
              {id === "orders" &&
                orders.some((o) => o.data.status !== "closed") && (
                  <em>
                    {orders.filter((o) => o.data.status !== "closed").length}
                  </em>
                )}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <button
            onClick={() => {
              setDark(!dark);
              lib.saveSettings({ dark: !dark });
            }}
          >
            <Moon size={16} />
            {dark ? "الوضع الفاتح" : "الوضع الداكن"}
          </button>
          <span className="network">{online ? "● متصل" : "● غير متصل"}</span>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <button className="icon-btn menu-btn" onClick={() => setMobile(true)}>
            <Menu />
          </button>
          <div className="global-search">
            <Search size={17} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="بحث شامل بالاسم أو الكود أو الرقم..."
            />
            <button onClick={() => setQuery("")}>
              {query && <X size={14} />}
            </button>
          </div>
          <button
            className="lang-btn"
            onClick={() => {
              const x = lang === "ar" ? "en" : "ar";
              setLang(x);
              lib.saveSettings({ language: x });
            }}
          >
            {lang === "ar" ? "EN" : "عربي"}
          </button>
          <button className="icon-btn" onClick={() => go("calendar")}>
            <Bell />
          </button>
          <button className="secondary" onClick={()=>setScanner(true)}>QR</button>
          <span className="top-avatar">{s.user.name?.[0] || "E"}</span>
        </header>
        <div className="page">
          {query.trim()&&<GlobalResults rows={records} q={query} open={(r:RecordRow)=>{if(r.type==='device'){setDetail(r);setQuery('');}else if(r.type==='order'){setWizard(r);setQuery('');}else if(['sale','purchase','report'].includes(r.type)){go('documents');setQuery(lib.recordCode(r));}else if(r.type==='part')go('inventory');else if(r.type==='plan')go('plans');else if(r.type==='event')go('calendar');else if(r.data.device_id){const d=devices.find(x=>x.id===r.data.device_id);if(d){setDetail(d);setQuery('');}}}}/>}

          {screen === "dashboard" ? (
            <Dashboard
              devices={devices}
              orders={orders}
              plans={plans}
              parts={parts}
              events={events}
              go={go}
              add={
                s.role === "owner" || s.role === "admin"
                  ? () => setModal({ type: "device" })
                  : undefined
              }
            />
          ) : screen === "devices" ? (
            <Devices
              rows={devices}
              q={query}
              open={(r: any) => {
                setDetail(r);
                void lib.logActivity("device_viewed", "device", r.id);
              }}
              edit={(r: any) => setModal({ type: "device", row: r })}
              add={
                s.role === "owner" || s.role === "admin"
                  ? () => setModal({ type: "device" })
                  : undefined
              }
              del={del}
            />
          ) : screen === "orders" ? (
            <Orders
              rows={orders}
              devices={devices}
              q={query}
              edit={(r: any) => setWizard(r)}
              add={s.role !== "viewer" ? () => setWizard({}) : undefined}
              del={del}
            />
          ) : screen === "inventory" ? (
            <List
              title="المخزون"
              q={query}
              rows={parts}
              type="part"
              add={
                s.role === "owner" || s.role === "admin"
                  ? () => setModal({ type: "part" })
                  : undefined
              }
              edit={(r: any) => setModal({ type: "part", row: r })}
              del={del}
            />
          ) : screen === "plans" ? (
            <List
              title="خطط الصيانة"
              q={query}
              rows={plans}
              type="plan"
              add={
                s.role === "owner" || s.role === "admin"
                  ? () => setModal({ type: "plan" })
                  : undefined
              }
              edit={(r: any) => setModal({ type: "plan", row: r })}
              del={del}
            />
          ) : screen === "calendar" ? (
            <Calendar
              events={events}
              plans={plans}
              add={
                s.role !== "viewer"
                  ? () => setModal({ type: "event" })
                  : undefined
              }
              edit={(r: any) => setModal({ type: "event", row: r })}
              del={del}
            />
          ) : screen === "reports" ? (
            <Reports />
          ) : screen === "chat" ? (
            <TeamChat notify={notify}/>
          ) : screen === "documents" ? (
            <BusinessDocuments notify={notify} q={query}/>
          ) : screen === "activity" ? (
            <ActivityPage rows={audit} />
          ) : screen === "assist" ? (
            <AgentChat notify={notify} onNavigate={(next:any)=>go(next as Screen)}/>
          ) : (
            <Settings s={s} notify={notify} />
          )}
        </div>
      </main>
      {welcome && (
        <div className="modal-backdrop">
          <section className="modal">
            <h1>EngX</h1>
            <h2>كل أجهزتك وصيانتك في مكان واحد</h2>
            <p>
              الأجهزة الطبية متاحة. المجالات الأخرى غير مفعلة في هذا المشروع.
            </p>
            <p className="notice">
              لا تُدخل بيانات مرضى. ابدأ محليًا دون حساب؛ الحفظ السحابي اختياري
              ويحتاج إعداد خادم.
            </p>
            <button
              className="secondary"
              onClick={() =>
                lib.saveSettings({ language: lang === "ar" ? "en" : "ar" })
              }
            >
              العربية / English (عناوين رئيسية)
            </button>
            <button
              className="secondary"
              onClick={() => lib.saveSettings({ dark: !dark })}
            >
              فاتح / داكن
            </button>
            <button
              className="primary"
              onClick={() => {
                localStorage.setItem("engx-intro", "yes");
                setWelcome(false);
                void lib.logActivity("welcome_completed");
              }}
            >
              ابدأ الآن
            </button>
          </section>
        </div>
      )}
      {scanner&&<QRReader close={()=>setScanner(false)} onDevice={(r:any)=>setDetail(r)} notify={notify}/>}
      {modal && (
        <EntityModal
          type={modal.type}
          row={modal.row}
          devices={devices}
          close={() => setModal(null)}
          save={save}
        />
      )}{" "}
      {detail && (
        <DeviceDetail
          row={detail}
          close={() => setDetail(null)}
          notify={notify}
          onNewOrder={() => {
            setWizard({ device_id: detail.id });
            setDetail(null);
          }}
        />
      )}{" "}
      {wizard && (
        <OrderWizard
          row={wizard}
          devices={devices}
          parts={parts}
          close={() => setWizard(null)}
          notify={notify}
        />
      )}{" "}
      {toast && (
        <div className="toast">
          {toast}
          <button onClick={() => setToast("")}>
            <X size={14} />
          </button>
        </div>
      )}
      <nav className="bottom-nav" aria-label="التنقل السريع">
        {(["dashboard","devices","orders","chat"] as Screen[]).map(id=>{const Icon=nav.find(n=>n[0]===id)?.[1]||LayoutDashboard;return <button key={id} className={screen===id?'selected':''} onClick={()=>go(id)}><Icon size={20}/><span>{L[id]}</span></button>})}
        <button onClick={()=>setMobile(true)}><Menu size={20}/><span>المزيد</span></button>
      </nav>
      {s.role !== "viewer" && (
        <button className="fab" onClick={() => setWizard({})}>
          <Plus />
        </button>
      )}
    </div>
  );
}
function Head({ title, sub, add }: any) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        <p>{sub}</p>
      </div>
      {add && (
        <button className="primary" onClick={add}>
          <Plus size={16} />
          إضافة
        </button>
      )}
    </div>
  );
}
function Dashboard({ devices, orders, plans, parts, events, go, add }: any) {
  const today = new Date().toISOString().slice(0, 10);
  const due = plans.filter(
    (p: any) => p.data.next_due && p.data.next_due <= today,
  );
  return (
    <>
      <Head
        title="مرحباً بك في EngX"
        sub="صيانة الأجهزة الطبية — البيانات محفوظة محلياً"
        add={add}
      />
      <div className="hero">
        <div>
          <b>مركز عمليات الصيانة</b>
          <h2>صيانة أدق، رعاية أكثر أماناً</h2>
          <p>لا تُدخل بيانات المرضى أو المعلومات الصحية الشخصية.</p>
        </div>
        <ShieldCheck size={70} />
      </div>
      <div className="stat-grid">
        {[
          ["الأجهزة", devices.length, "devices"],
          [
            "الأوامر المفتوحة",
            orders.filter((x: any) => x.data.status !== "closed").length,
            "orders",
          ],
          ["الصيانة المستحقة", due.length, "plans"],
          [
            "قطع منخفضة",
            parts.filter((x: any) => +x.data.quantity <= +x.data.min_quantity)
              .length,
            "inventory",
          ],
        ].map(([t, v, id]) => (
          <button className="stat" key={id} onClick={() => go(id)}>
            <span>{t}</span>
            <strong>{v as number}</strong>
          </button>
        ))}
      </div>
      <div className="grid-2">
        <section className="card">
          <h3>أحداث اليوم</h3>
          {events
            .filter((e: any) => String(e.data.at || "").slice(0, 10) === today)
            .map((e: any) => (
              <div className="list-row" key={e.id}>
                <b>{e.data.title}</b>
                <small>{e.data.at}</small>
              </div>
            ))}
          {!events.some(
            (e: any) => String(e.data.at || "").slice(0, 10) === today,
          ) && <Empty />}
        </section>
        <section className="card">
          <h3>خطط مستحقة</h3>
          {due.slice(0, 5).map((p: any) => (
            <div className="list-row" key={p.id}>
              <b>{p.data.reference || "خطة صيانة"}</b>
              <small>{p.data.next_due}</small>
              <Badge status="maintenance" />
            </div>
          ))}
          {!due.length && <Empty />}
        </section>
      </div>
    </>
  );
}
function Empty() {
  return <div className="empty">لا توجد بيانات</div>;
}
function Devices({ rows, q, open, edit, add, del }: any) {
  const role = lib.useSettings()?.role;
  const manage = role === "owner" || role === "admin";
  const [tab, setTab] = useState("all");
  const [ascending,setAscending]=useState(true);
  const f = [...rows].sort((a:any,b:any)=>ascending?a.created_at.localeCompare(b.created_at):b.created_at.localeCompare(a.created_at)).filter(
    (r: any) =>
      (tab === "all" || r.data.status === tab) &&
      (!q || JSON.stringify(r.data).toLowerCase().includes(q.toLowerCase())),
  );
  return (
    <>
      <Head title="الأجهزة" sub={`${rows.length} سجل`} add={add} />
      <div className="toolbar">
        <div className="tabs">
          {[
            ["all", "الكل"],
            ["working", "يعمل"],
            ["stopped", "متوقف"],
            ["maintenance", "صيانة"],
          ].map((x) => (
            <button
              className={tab === x[0] ? "selected" : ""}
              onClick={() => setTab(x[0])}
              key={x[0]}
            >
              {x[1]}
            </button>
          ))}
        </div>
      </div>
      <div className="card table-card">
        <table>
          <thead>
            <tr>
              <th><button className="link" onClick={()=>setAscending(!ascending)}>م {ascending?"↑":"↓"}</button></th>
              <th>الكود الثابت</th>
              <th>الجهاز</th>
              <th>رمز الأصل</th>
              <th>الموقع</th>
              <th>الحالة</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {f.map((r: any,i:number) => (
              <tr key={r.id}>
                <td>{ascending?i+1:f.length-i}</td>
                <td><RecordCode row={r}/></td>
                <td>
                  <button className="link" onClick={() => open(r)}>
                    {r.data.name}
                  </button>
                  <small className="block">
                    {{
                      local: "محفوظ على الجهاز",
                      pending: "في انتظار المزامنة",
                      synced: "تمت المزامنة",
                      review: "يحتاج مراجعة",
                    }[r.sync_status as string] || "محفوظ على الجهاز"}
                  </small>
                </td>
                <td>{r.data.asset_code}</td>
                <td>{r.data.location || "—"}</td>
                <td>
                  <Badge status={r.data.status || "unknown"} />
                </td>
                <td>
                  {manage && (
                    <button className="icon-btn" onClick={() => edit(r)}>
                      <SettingsIcon size={15} />
                    </button>
                  )}
                  {manage && (
                    <button className="icon-btn" onClick={() => del(r)}>
                      <Trash2 size={15} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!f.length && <Empty />}
      </div>
    </>
  );
}
function List({ title, rows, type, add, edit, del, q="" }: any) {
  const role = lib.useSettings()?.role;
  const manage = role === "owner" || role === "admin";
  return (
    <>
      <Head title={title} sub={`${rows.length} سجل محفوظ محلياً`} add={add} />
      <div className="inventory-grid">
        {[...rows].sort((a:any,b:any)=>a.created_at.localeCompare(b.created_at)).filter((r:any)=>!q||JSON.stringify(r.data).toLowerCase().includes(q.toLowerCase())).map((r: any,i:number) => (
          <div className="card" key={r.id}>
            <small className="block">م {i+1}</small><RecordCode row={r}/>
            <div className="card-head">
              <b>{r.data.name || r.data.reference || "سجل"}</b>
              <Badge status={r.data.status || "active"} />
            </div>
            <p className="muted">
              {type === "part"
                ? `${r.data.quantity || 0} متاح · حد ${r.data.min_quantity || 0}`
                : `الاستحقاق: ${r.data.next_due || "—"}`}
            </p>
            <div className="button-row">
              {manage && (
                <button className="secondary" onClick={() => edit(r)}>
                  تعديل
                </button>
              )}
              {manage && (
                <button className="icon-btn" onClick={() => del(r)}>
                  <Trash2 size={15} />
                </button>
              )}
            </div>
          </div>
        ))}
        {!rows.length && <Empty />}
      </div>
    </>
  );
}
function Orders({ rows, devices, q, edit, add, del }: any) {
  const [ascending,setAscending]=useState(true);
  const [filter,setFilter]=useState("all");
  const settings=lib.useSettings();
  const role = settings?.role;
  const manage = role === "owner" || role === "admin";
  return (
    <>
      <Head
        title="أوامر العمل"
        sub="لا يمكن تعديل الأمر المغلق؛ أضف تعليق تصحيحي بدلاً من ذلك"
        add={add}
      />
      <div className="order-cards">
        {[
          ["open", "مفتوح"],
          ["in_progress", "قيد التنفيذ"],
          ["closed", "مغلق"],
        ].map((x) => (
          <div className="small-stat" key={x[0]}>
            <span>{x[1]}</span>
            <b>
              {
                rows.filter(
                  (r: any) =>
                    r.data.status === x[0] ||
                    (x[0] === "open" && !r.data.status),
                ).length
              }
            </b>
          </div>
        ))}
      </div>
      <div className="card table-card">
        <table>
          <thead>
            <tr>
              <th><button className="link" onClick={()=>setAscending(!ascending)}>م {ascending?"↑":"↓"}</button></th>
              <th>الكود الثابت</th>
              <th>الأمر</th>
              <th>الجهاز</th>
              <th>تاريخ ووقت البلاغ</th>
              <th>الحالة</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {[...rows].sort((a:any,b:any)=>ascending?a.created_at.localeCompare(b.created_at):b.created_at.localeCompare(a.created_at))
              .filter(
                (r: any) =>
                  !q ||
                  JSON.stringify(r.data)
                    .toLowerCase()
                    .includes(q.toLowerCase()),
              )
              .map((r: any,i:number) => (
                <tr key={r.id}>
                  <td>{ascending?i+1:rows.length-i}</td>
                  <td><RecordCode row={r}/></td>
                  <td>
                    <b>{r.data.title || "أمر صيانة"}</b>
                    <small className="block">
                      {{
                        local: "محفوظ على الجهاز",
                        pending: "في انتظار المزامنة",
                        synced: "تمت المزامنة",
                        review: "يحتاج مراجعة",
                      }[r.sync_status as string] || "محفوظ على الجهاز"}
                    </small>
                  </td>
                  <td>
                    {devices.find((d: any) => d.id === r.data.device_id)?.data
                      .asset_code ||
                      r.data.device_code ||
                      "—"}
                  </td>
                  <td>{new Date(r.data.detected_at||r.created_at).toLocaleString("ar-EG")}<small className="block">{r.data.due_date?`متابعة: ${r.data.due_date}`:""}</small></td>
                  <td>
                    <Badge status={r.data.status || "draft"} />
                  </td>
                  <td>
                    <button
                      className="icon-btn"
                      onClick={() => edit(r)}
                      aria-label="فتح أمر الصيانة"
                    >
                      <Wrench size={15} />
                    </button>
                    {manage && r.data.status !== "closed" && (
                      <button className="icon-btn" onClick={() => del(r)}>
                        <Trash2 size={15} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
function Calendar({ events, plans, add, edit, del }: any) {
  const [mode, setMode] = useState<"day" | "week" | "month">("month");
  const [date, setDate] = useState(new Date());
  const start = new Date(date);
  if (mode === "day") start.setHours(0, 0, 0, 0);
  else if (mode === "week") {
    start.setDate(start.getDate() - start.getDay());
    start.setHours(0, 0, 0, 0);
  } else (start.setDate(1), start.setHours(0, 0, 0, 0));
  const end = new Date(start);
  if (mode === "day") end.setDate(end.getDate() + 1);
  else if (mode === "week") end.setDate(end.getDate() + 7);
  else end.setMonth(end.getMonth() + 1);
  const items = [
    ...events.map((e: any) => ({ ...e, when: e.data.at, label: e.data.title })),
    ...plans
      .filter((p: any) => p.data.next_due)
      .map((p: any) => ({
        ...p,
        when: p.data.next_due,
        label: "استحقاق خطة: " + (p.data.reference || "صيانة"),
      })),
  ].filter((x: any) => {
    const t = new Date(x.when);
    return t >= start && t < end;
  });
  return (
    <>
      <Head title="التقويم" sub="أحداث وخطط الصيانة" add={add} />
      <div className="calendar-head">
        <button
          onClick={() => setMode("day")}
          className={mode === "day" ? "selected" : ""}
        >
          يوم
        </button>
        <button
          onClick={() => setMode("week")}
          className={mode === "week" ? "selected" : ""}
        >
          أسبوع
        </button>
        <button
          onClick={() => setMode("month")}
          className={mode === "month" ? "selected" : ""}
        >
          شهر
        </button>
        <button onClick={() => setDate(new Date())}>اليوم</button>
        <button
          onClick={() => {
            const d = new Date(date);
            d.setMonth(d.getMonth() - 1);
            setDate(d);
          }}
        >
          السابق
        </button>
        <button
          onClick={() => {
            const d = new Date(date);
            d.setMonth(d.getMonth() + 1);
            setDate(d);
          }}
        >
          التالي
        </button>
      </div>
      <div className="calendar-grid">
        {items.map((e: any) => (
          <div className="event-card" key={e.id}>
            <div className="event-date">
              {new Date(e.when).toLocaleDateString("ar")}
            </div>
            <div className="grow">
              <b>{e.label}</b>
              <small>{e.when}</small><RecordCode row={e}/>
            </div>
            {e.type === "event" && (
              <button
                className="icon-btn"
                onClick={() =>
                  lib.requestReminder(e).catch((x: any) => alert(x.message))
                }
              >
                <Bell size={15} />
              </button>
            )}
            <button className="icon-btn" onClick={() => edit(e)}>
              <SettingsIcon size={15} />
            </button>
            <button className="icon-btn" onClick={() => del(e)}>
              <Trash2 size={15} />
            </button>
          </div>
        ))}
        {!items.length && <Empty />}
      </div>
    </>
  );
}
function ActivityPage({ rows }: any) {
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<any>(null);
  return (
    <>
      <Head
        title="سجل النشاط"
        sub="سجل محلي قابل للإضافة؛ حماية الخادم تعتمد على صلاحيات قاعدة البيانات"
      />
      <div className="head-actions">
        <div className="button-row">
          <button
            className="secondary"
            onClick={async () => {
              try {
                await lib.downloadBlob(
                  new Blob([JSON.stringify(rows, null, 2)], {
                    type: "application/json",
                  }),
                  "engx-activity.json",
                );
                await lib.logActivity("activity_exported", "audit");
              } catch (e: any) {
                alert(e.message);
              }
            }}
          >
            <Download size={15} />
            JSON
          </button>
          <button
            className="secondary"
            onClick={() => lib.printReport().catch((e) => alert(e.message))}
          >
            <Printer size={15} />
            طباعة / PDF
          </button>
        </div>
      </div>
      <div className="notice">
        <ShieldCheck size={17} />
        السجل محمي من تحديثات التطبيق، لكنه ليس غير قابل للتلاعب أمام مدير قاعدة
        البيانات أو مسؤول الخادم.
      </div>
      <div className="card table-card">
        <div className="inline-search">
          <Search size={15} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="تصفية النشاط"
          />
        </div>
        <table>
          <thead>
            <tr>
              <th>الوقت</th>
              <th>الإجراء</th>
              <th>النوع</th>
              <th>المعرف</th>
            </tr>
          </thead>
          <tbody>
            {rows
              .filter(
                (r: any) =>
                  !q ||
                  JSON.stringify(r).toLowerCase().includes(q.toLowerCase()),
              )
              .map((r: any) => (
                <tr key={r.id} onClick={() => setSelected(r)}>
                  <td>{new Date(r.created_at).toLocaleString("ar")}</td>
                  <td>{r.action}</td>
                  <td>{r.entity_type || "—"}</td>
                  <td>{r.entity_id?.slice(0, 12) || "—"}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {selected && (
        <div className="modal-backdrop">
          <div className="modal">
            <div className="modal-head">
              <h2>تفاصيل النشاط</h2>
              <button className="icon-btn" onClick={() => setSelected(null)}>
                <X />
              </button>
            </div>
            <pre className="audit-detail">
              {JSON.stringify(selected, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </>
  );
}
function Assist({ rows }: any) {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(
      () => setDebounced(q.trim().length >= 2 ? q.trim().toLowerCase() : ""),
      250,
    );
    return () => clearTimeout(t);
  }, [q]);
  const hits = rows.filter(
    (r: any) =>
      debounced && JSON.stringify(r.data).toLowerCase().includes(debounced),
  );
  return (
    <>
      <Head
        title="المساعد المحلي"
        sub="بحث محلي فقط؛ لا يرسل استعلاماً كاملاً أو بيانات إلى خادم خارجي"
      />
      <div className="assist-box card">
        <Search size={27} />
        <h2>ابحث في سجلات الصيانة</h2>
        <p>يبدأ البحث بعد حرفين على الأقل.</p>
        <div className="big-search">
          <Search size={17} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="اسم جهاز أو رمز أصل أو قطعة"
          />
        </div>
      </div>
      {debounced && (
        <div className="card result-card">
          <h3>النتائج ({hits.length})</h3>
          {hits.map((r: any) => (
            <div className="list-row" key={r.id}>
              <b>{r.data.name || r.data.title || r.data.asset_code}</b>
              <small>
                {r.type} ·{" "}
                {{
                  local: "محفوظ على الجهاز",
                  pending: "في انتظار المزامنة",
                  synced: "تمت المزامنة",
                  review: "يحتاج مراجعة",
                }[r.sync_status as string] || "محفوظ على الجهاز"}
              </small>
            </div>
          ))}
          {!hits.length && <Empty />}
        </div>
      )}
    </>
  );
}
function EntityModal({type,row,devices,close,save}:any){
 const [d,setD]=useState<any>(row?.data||{});const [more,setMore]=useState(false);const [reminder,setReminder]=useState(!!row?.data.remind_at);
 const fields=type==='device'?deviceFields:genericFields[type]||[];
 const needed=type==='device'?['name','asset_code']:type==='part'?['name']:type==='plan'?['device_id','interval_days','next_due']:['title','at'];
 const field=(f:any)=><label key={f[0]}>{f[1]} {needed.includes(f[0])?<b className="required-mark">* مطلوب</b>:<small className="muted">اختياري</small>}{f[0]==='device_id'?<select value={d.device_id||''} onChange={e=>setD({...d,device_id:e.target.value})}><option value="">اختر جهازًا</option>{devices.map((x:any)=><option key={x.id} value={x.id}>{x.data.asset_code} — {x.data.name}</option>)}</select>:<input type={['at','remind_at'].includes(f[0])?'datetime-local':['installation_date','last_completed','next_due'].includes(f[0])?'date':['quantity','min_quantity','purchase_price','interval_days'].includes(f[0])?'number':'text'} min={['quantity','min_quantity','purchase_price','interval_days'].includes(f[0])?0:undefined} step="any" value={d[f[0]]??''} onChange={e=>setD({...d,[f[0]]:e.target.value})}/>}</label>;
 const status=type==='device'?<label>حالة الجهاز <small>اختياري</small><select value={d.status||'unknown'} onChange={e=>setD({...d,status:e.target.value})}><option value="unknown">غير محدد — أدخله لاحقًا</option><option value="working">يعمل</option><option value="stopped">متوقف</option><option value="maintenance">صيانة</option></select></label>:null;
 return <div className="modal-backdrop"><section className="modal" role="dialog" aria-label="إضافة أو تعديل سجل"><div className="modal-head"><h2>{type==='device'?'بيانات الجهاز':type==='part'?'بيانات القطعة':type==='plan'?'خطة صيانة':'حدث'}</h2><button className="icon-btn" aria-label="إغلاق" onClick={close}><X/></button></div><p className="muted">املأ الحقول بعلامة * فقط. تقدر تكمل الباقي بعدين.</p><div className="form-grid">{fields.filter((f:any)=>needed.includes(f[0])).map(field)}{status}</div><label className="check-label"><input type="checkbox" checked={more} onChange={e=>setMore(e.target.checked)}/>إظهار التفاصيل الاختيارية</label>{more&&<div className="form-grid">{fields.filter((f:any)=>!needed.includes(f[0])&&!['notes','remind_at'].includes(f[0])).map(field)}<label className="full">ملاحظات — اختياري<textarea value={d.notes||''} onChange={e=>setD({...d,notes:e.target.value})}/></label></div>}{type==='event'&&<><label className="check-label"><input type="checkbox" checked={reminder} onChange={e=>setReminder(e.target.checked)}/>تذكير على هذا الهاتف — اختياري</label>{reminder&&field(['remind_at','وقت التذكير'])}</>}<p className="warning-text">لا تُدخل بيانات المرضى أو المعلومات الصحية. مواعيد الوقائية تُدخل من دليل الشركة؛ لا توجد فترات مفترضة.</p><div className="modal-actions"><button className="secondary" onClick={close}>إلغاء</button><button className="primary" onClick={()=>save(type,type==='event'?{...d,remind_at:reminder?d.remind_at:null}:d,row)}>حفظ</button></div></section></div>;
}
export default App;

function RecordCode({row}:{row:RecordRow}){const code=lib.recordCode(row);return <code className="record-code" dir="ltr" title="الكود ثابت ويمكن البحث عنه">{code}</code>;}
function GlobalResults({rows,q,open}:{rows:RecordRow[];q:string;open:(r:RecordRow)=>void}){
 const [limit,setLimit]=useState(30),[asc,setAsc]=useState(true);useEffect(()=>setLimit(30),[q]);
 const names:any={device:'جهاز',order:'أمر صيانة',part:'قطعة',plan:'وقائية',event:'حدث',usage:'صرف',correction:'تصحيح',attachment:'مرفق',calibration:'معايرة',sale:'أمر بيع',purchase:'أمر شراء',report:'تقرير'};
 const results=rows.filter(r=>!r.deleted_at).filter(r=>{const safe=Object.fromEntries(Object.entries(r.data).filter(([k])=>!['content','data_url','base64'].includes(k)));return JSON.stringify({code:lib.recordCode(r),id:r.id,data:safe}).toLowerCase().includes(q.trim().toLowerCase());}).sort((a,b)=>asc?a.created_at.localeCompare(b.created_at):b.created_at.localeCompare(a.created_at));
 return <section className="card global-results"><div className="card-head"><div><h2>نتائج البحث الشامل</h2><p>{results.length} نتيجة في كل السجلات المحفوظة على هذا الجهاز</p></div><button className="secondary" onClick={()=>setAsc(!asc)}>م {asc?'↑ الأقدم أولًا':'↓ الأحدث أولًا'}</button></div><div className="global-results-list">{results.slice(0,limit).map((r,i)=><button className="search-record" key={r.id} onClick={()=>open(r)}><span>{asc?i+1:results.length-i}</span><div><b>{r.data.title||r.data.name||r.data.reference||r.data.description||names[r.type]}</b><small>{names[r.type]} · {new Date(r.created_at).toLocaleString('ar-EG')}</small><RecordCode row={r}/></div></button>)}</div>{!results.length&&<p className="muted">لا توجد نتيجة. ابحث بكود ثابت أو اسم، أو استقبل بيانات الفريق أولًا عند الاتصال.</p>}{results.length>limit&&<button className="secondary" onClick={()=>setLimit(limit+30)}>عرض المزيد</button>}</section>;
}
