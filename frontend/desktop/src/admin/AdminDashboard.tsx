import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  BookOpenCheck,
  Boxes,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Clock3,
  Database,
  Download,
  FileClock,
  Filter,
  Gauge,
  KeyRound,
  Laptop2,
  MoreHorizontal,
  PackageCheck,
  RefreshCw,
  ServerCog,
  ShieldCheck,
  SlidersHorizontal,
  UserCog,
  Users,
  X,
} from "lucide-react";
import { Badge, Button, EmptyState, SearchField, SectionHeading, Segmented } from "../components/ui";

export type AdminView = "admin-overview" | "admin-users" | "admin-roles" | "admin-subscriptions" | "admin-operations" | "admin-system" | "admin-audit" | "admin-releases";

export const adminNavigation: Array<{ id: AdminView; label: string; icon: typeof Gauge; group: string }> = [
  { id: "admin-overview", label: "Control overview", icon: Gauge, group: "Administration" },
  { id: "admin-users", label: "Users", icon: Users, group: "Administration" },
  { id: "admin-roles", label: "Roles & access", icon: KeyRound, group: "Administration" },
  { id: "admin-subscriptions", label: "Subscriptions", icon: PackageCheck, group: "Commercial" },
  { id: "admin-operations", label: "System operations", icon: ServerCog, group: "Operations" },
  { id: "admin-system", label: "System data", icon: Database, group: "Operations" },
  { id: "admin-audit", label: "Audit log", icon: FileClock, group: "Governance" },
  { id: "admin-releases", label: "Desktop releases", icon: Laptop2, group: "Governance" },
];

type AdminUser = {
  id: string;
  name: string;
  email: string;
  role: "Admin" | "User";
  status: "Active" | "Suspended";
  plan: "Free" | "Pro" | "—";
  lastSeen: string;
  joined: string;
};

const users: AdminUser[] = [
  { id: "USR-1048", name: "Ayu Prameswari", email: "ayu@signalgen.id", role: "Admin", status: "Active", plan: "Pro", lastSeen: "2 menit lalu", joined: "12 Sep 2026" },
  { id: "USR-1047", name: "Rizky Mahendra", email: "rizky@example.com", role: "User", status: "Active", plan: "Pro", lastSeen: "18 menit lalu", joined: "11 Sep 2026" },
  { id: "USR-1046", name: "Nadia Putri", email: "nadia@example.com", role: "User", status: "Active", plan: "Free", lastSeen: "1 jam lalu", joined: "10 Sep 2026" },
  { id: "USR-1045", name: "Dimas Setiawan", email: "dimas@example.com", role: "User", status: "Suspended", plan: "—", lastSeen: "2 hari lalu", joined: "08 Sep 2026" },
  { id: "USR-1044", name: "Fajar Nugraha", email: "fajar@example.com", role: "User", status: "Active", plan: "Free", lastSeen: "3 hari lalu", joined: "06 Sep 2026" },
];

const health = [
  { name: "FastAPI", detail: "REST · :3456", state: "Preview", latency: "Admin API pending" },
  { name: "SQLite", detail: "Primary operational store", state: "Preview", latency: "Admin API pending" },
  { name: "Socket.IO", detail: "Realtime · :8765", state: "Preview", latency: "Admin API pending" },
  { name: "Yahoo data", detail: "Historical market source", state: "Preview", latency: "Admin API pending" },
  { name: "IBKR", detail: "Live market adapter", state: "Preview", latency: "Admin API pending" },
];

const activity = [
  { action: "user.role_changed", actor: "Ayu Prameswari", target: "USR-1039", time: "09:42", tone: "success" as const },
  { action: "user.status_suspended", actor: "Ayu Prameswari", target: "USR-1045", time: "08:17", tone: "warning" as const },
  { action: "system_rule.updated", actor: "Backend migration", target: "RULE-SYS-04", time: "Kemarin", tone: "neutral" as const },
];

export function AdminDashboard({ view, onNavigate, backendOnline }: { view: AdminView; onNavigate: (view: AdminView) => void; backendOnline: boolean }) {
  if (view === "admin-users") return <UsersView />;
  if (view === "admin-roles") return <RolesView />;
  if (view === "admin-subscriptions") return <SubscriptionsView />;
  if (view === "admin-operations") return <OperationsView backendOnline={backendOnline} />;
  if (view === "admin-system") return <SystemDataView />;
  if (view === "admin-audit") return <AuditView />;
  if (view === "admin-releases") return <ReleasesView />;
  return <AdminOverview onNavigate={onNavigate} backendOnline={backendOnline} />;
}

function AdminOverview({ onNavigate, backendOnline }: { onNavigate: (view: AdminView) => void; backendOnline: boolean }) {
  return <div className="admin-page admin-page--overview">
    <section className="admin-intro">
      <div>
        <h2>Keep the system accountable.</h2>
        <p>Account posture, operational health, and administrative changes in one controlled view. Private trading data stays outside this surface.</p>
      </div>
      <Button variant="primary" onClick={() => onNavigate("admin-users")}><Users size={16} /> Review users</Button>
    </section>

    <div className={`verification-rail ${backendOnline ? "is-live" : "is-offline"}`}>
      <span><i />{backendOnline ? "Root API reachable" : "Backend unavailable"}</span>
      <b>{backendOnline ? "Detailed service checks await the admin operations endpoint" : "Reconnect the local backend to verify reachability"}</b>
      <small>Metrics below are illustrative</small>
    </div>

    <section className="ledger-metrics" aria-label="Account summary">
      <LedgerMetric label="Total accounts" value="1,248" delta="+38 this month" trend="up" />
      <LedgerMetric label="Active users" value="1,207" delta="96.7% of accounts" trend="up" />
      <LedgerMetric label="Suspended" value="12" delta="3 need review" trend="down" />
      <LedgerMetric label="Admin access" value="4" delta="Last changed today" trend="neutral" />
    </section>

    <section className="admin-overview-grid">
      <div className="ledger-panel operations-panel">
        <PanelHeader title="System operations" description="Core service posture" action="Inspect system" onAction={() => onNavigate("admin-operations")} />
        <div className="health-list">{health.slice(0, 4).map((item) => <HealthRow key={item.name} {...item} />)}</div>
        <div className="uptime-strip"><span>Illustrative uptime</span><div>{Array.from({ length: 48 }, (_, index) => <i key={index} className={index === 31 ? "is-warn" : ""} />)}</div><b>Example</b></div>
      </div>
      <div className="ledger-panel attention-panel">
        <PanelHeader title="Needs attention" description="Exceptions before routine work" />
        <button className="attention-row" onClick={() => onNavigate("admin-users")}><span className="attention-row__icon"><UserCog size={17} /></span><span><b>3 account reviews</b><small>Suspension reasons need follow-up</small></span><ChevronRight size={16} /></button>
        <button className="attention-row" onClick={() => onNavigate("admin-subscriptions")}><span className="attention-row__icon"><PackageCheck size={17} /></span><span><b>Subscription contract pending</b><small>Provider and plans are not finalized</small></span><ChevronRight size={16} /></button>
        <button className="attention-row" onClick={() => onNavigate("admin-releases")}><span className="attention-row__icon"><Download size={17} /></span><span><b>No published desktop build</b><small>Release metadata API is P2</small></span><ChevronRight size={16} /></button>
      </div>
    </section>

    <section className="admin-lower-grid">
      <div className="ledger-panel">
        <PanelHeader title="Account movement" description="Illustrative 30-day profile creation" />
        <AccountChart />
      </div>
      <div className="ledger-panel">
        <PanelHeader title="Recent administrative activity" description="Sanitized preview events" action="Open audit" onAction={() => onNavigate("admin-audit")} />
        <div className="activity-list">{activity.map((event) => <div className="activity-row" key={`${event.action}-${event.time}`}><Badge tone={event.tone}>{event.action}</Badge><div><b>{event.actor}</b><small>{event.target}</small></div><time>{event.time}</time></div>)}</div>
      </div>
    </section>
  </div>;
}

function UsersView() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | "active" | "suspended">("all");
  const [selected, setSelected] = useState<AdminUser | null>(null);
  const filtered = useMemo(() => users.filter((user) => {
    const matchesQuery = `${user.name} ${user.email} ${user.id}`.toLowerCase().includes(query.toLowerCase());
    const matchesStatus = status === "all" || user.status.toLowerCase() === status;
    return matchesQuery && matchesStatus;
  }), [query, status]);

  return <div className="admin-page">
    <SectionHeading title="Users" description="Manage account posture without entering private trading workspaces." action={<Button variant="primary" disabled><Users size={16} /> Invite unavailable</Button>} />
    <div className="table-toolbar">
      <SearchField value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, email, or user ID…" />
      <Segmented value={status} onChange={setStatus} label="Filter status" options={[{ value: "all", label: "All" }, { value: "active", label: "Active" }, { value: "suspended", label: "Suspended" }]} />
      <Button size="icon" aria-label="More filters" disabled><Filter size={16} /></Button>
    </div>
    <div className="data-table user-table">
      <div className="data-table__head"><span>User</span><span>Role</span><span>Status</span><span>Plan</span><span>Last seen</span><span /></div>
      {filtered.map((user) => <button className="data-table__row" key={user.id} onClick={() => setSelected(user)}>
        <span className="identity-cell"><i>{initials(user.name)}</i><span><b>{user.name}</b><small>{user.email} · {user.id}</small></span></span>
        <span>{user.role}</span>
        <span><Badge tone={user.status === "Active" ? "success" : "danger"}>{user.status}</Badge></span>
        <span>{user.plan}</span><span>{user.lastSeen}</span><span><ChevronRight size={15} /></span>
      </button>)}
      {!filtered.length && <EmptyState icon={<Users />} title="No users match" description="Adjust the search or account-status filter." />}
    </div>
    <div className="table-footer"><span>Showing {filtered.length} of {users.length} preview accounts</span><div><Button size="sm" disabled>Previous</Button><Button size="sm" disabled>Next</Button></div></div>
    {selected && <UserSheet user={selected} onClose={() => setSelected(null)} />}
  </div>;
}

function UserSheet({ user, onClose }: { user: AdminUser; onClose: () => void }) {
  const sheetRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const background = document.querySelector(".workbench");
    background?.setAttribute("inert", "");
    closeRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab" || !sheetRef.current) return;
      const focusable = Array.from(sheetRef.current.querySelectorAll<HTMLElement>("button:not([disabled]), textarea:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex='-1'])"));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      background?.removeAttribute("inert");
      document.removeEventListener("keydown", onKeyDown);
      previousFocus?.focus();
    };
  }, [onClose]);

  return createPortal(<><button className="sheet-backdrop" aria-label="Close user detail" onClick={onClose} /><aside ref={sheetRef} className="side-sheet" role="dialog" aria-modal="true" aria-labelledby="account-sheet-title">
    <div className="side-sheet__header"><div><span className="sheet-id">{user.id}</span><h3 id="account-sheet-title">{user.name}</h3><p>{user.email}</p></div><Button ref={closeRef} size="icon" variant="ghost" onClick={onClose} aria-label="Close"><X size={18} /></Button></div>
    <div className="account-state"><span className="identity-avatar">{initials(user.name)}</span><div><Badge tone={user.status === "Active" ? "success" : "danger"}>{user.status}</Badge><small>Joined {user.joined}</small></div></div>
    <section className="sheet-section"><h4>Administrative profile</h4><dl><div><dt>Role</dt><dd>{user.role}</dd></div><div><dt>Plan</dt><dd>{user.plan}</dd></div><div><dt>Last seen</dt><dd>{user.lastSeen}</dd></div><div><dt>Identity source</dt><dd>Supabase Auth</dd></div></dl></section>
    <section className="privacy-boundary"><ShieldCheck size={18} /><div><b>Required privacy boundary</b><p>The admin API must exclude rules, watchlists, signals, backtests, credentials, and tokens before this view connects to real data.</p></div></section>
    <section className="sheet-section"><h4>Account controls</h4><label className="control-field"><span>Reason for change</span><textarea placeholder="Required before role or status mutation" /></label><div className="sheet-actions"><Button disabled>Change role</Button><Button variant={user.status === "Active" ? "danger" : "primary"} disabled>{user.status === "Active" ? "Suspend account" : "Reactivate account"}</Button></div><p className="disabled-note">Controls activate after the admin mutation endpoints are available.</p></section>
  </aside></>, document.body);
}

function RolesView() {
  const permissions = [
    ["Use personal analysis workspace", true, true],
    ["Read shared system rules", true, true],
    ["Manage users and account status", false, true],
    ["Manage system rules", false, true],
    ["Read sanitized operational health", false, true],
    ["Read or export passwords and tokens", false, false],
    ["Open another user's private workspace", false, false],
  ] as const;
  return <div className="admin-page"><SectionHeading title="Roles & access" description="A small, explicit permission model enforced by the backend." />
    <div className="role-summary"><div><span className="role-mark"><Users /></span><h3>User</h3><p>Operates a private analytical workspace and reads shared system reference data.</p><b>1,244 accounts</b></div><div><span className="role-mark role-mark--admin"><ShieldCheck /></span><h3>Admin</h3><p>Manages account posture, system operations, and governance. Private user data stays excluded.</p><b>4 accounts</b></div></div>
    <div className="ledger-panel permission-panel"><PanelHeader title="Permission matrix" description="Backend policy target from the admin PRD" /><div className="permission-table"><div className="permission-head"><span>Capability</span><span>User</span><span>Admin</span></div>{permissions.map(([label, user, admin]) => <div className="permission-row" key={label}><span>{label}</span><span>{user ? <CheckCircle2 /> : <X />}</span><span>{admin ? <CheckCircle2 /> : <X />}</span></div>)}</div></div>
  </div>;
}

function SubscriptionsView() {
  return <div className="admin-page"><SectionHeading title="Subscriptions" description="Entitlement becomes authoritative here after provider and plans are approved." action={<Button disabled><SlidersHorizontal size={16} /> Configure plans</Button>} />
    <section className="decision-banner"><CircleAlert /><div><h3>Commercial contract is intentionally locked</h3><p>Payment provider, plans, currency, billing cycle, and trial policy are open decisions in the PRD. This surface does not invent prices or payment state.</p></div><Badge tone="warning">Backend decision required</Badge></section>
    <div className="subscription-layout"><div className="ledger-panel"><PanelHeader title="Entitlement contract" description="States expected by web and desktop" /><div className="contract-list"><div><code>free</code><span>Default account access</span><Badge>Proposed</Badge></div><div><code>active</code><span>Verified provider entitlement</span><Badge tone="success">Allow</Badge></div><div><code>past_due</code><span>Grace policy to be decided</span><Badge tone="warning">Review</Badge></div><div><code>canceled</code><span>Ends according to provider period</span><Badge>Restrict</Badge></div></div></div><div className="ledger-panel"><PanelHeader title="Integration gates" description="Required before launch" /><div className="gate-list"><Gate label="Provider selected" done={false} /><Gate label="Plan catalog approved" done={false} /><Gate label="Webhook signature verified" done={false} /><Gate label="Idempotency tests passing" done={false} /><Gate label="Shared entitlement response" done={false} /></div></div></div>
  </div>;
}

function OperationsView({ backendOnline }: { backendOnline: boolean }) {
  return <div className="admin-page"><SectionHeading title="System operations" description="A sanitized view of backend readiness and external adapters." action={<Button disabled><RefreshCw size={15} /> Refresh checks</Button>} />
    <div className={`operations-banner ${backendOnline ? "is-healthy" : "is-down"}`}><span><Activity /></span><div><h3>{backendOnline ? "Core system operational" : "Backend connection unavailable"}</h3><p>{backendOnline ? "Local FastAPI responded and the preview health matrix is ready." : "Start the backend before trusting operational state."}</p></div><Badge tone={backendOnline ? "success" : "danger"}>{backendOnline ? "Verified" : "Offline"}</Badge></div>
    <div className="ledger-panel"><PanelHeader title="Component matrix" description="Credentials and internal paths are always redacted" /><div className="health-list health-list--large">{health.map((item) => <HealthRow key={item.name} {...item} />)}</div></div>
    <div className="operations-notes"><div><Clock3 /><span><b>Readiness strategy</b><small>Each provider has an independent timeout.</small></span></div><div><ShieldCheck /><span><b>Sanitized output</b><small>No tokens, DSN, or stack traces.</small></span></div><div><Boxes /><span><b>Partial failure</b><small>Degraded components do not hide healthy state.</small></span></div></div>
  </div>;
}

function SystemDataView() {
  const rules = [
    { id: "RULE-SYS-01", name: "EMA Momentum", version: "v2.3", status: "Published", changed: "12 Sep 2026" },
    { id: "RULE-SYS-02", name: "RSI Reversal", version: "v1.8", status: "Published", changed: "08 Sep 2026" },
    { id: "RULE-SYS-03", name: "Volume Breakout", version: "v1.2", status: "Draft", changed: "15 Sep 2026" },
  ];
  return <div className="admin-page"><SectionHeading title="System data" description="Shared reference material separated from user-owned strategies." action={<Button variant="primary" disabled>Create system rule</Button>} />
    <div className="data-table system-table"><div className="data-table__head"><span>System rule</span><span>Version</span><span>Status</span><span>Updated</span><span /></div>{rules.map((rule) => <button className="data-table__row" key={rule.id}><span><b>{rule.name}</b><small>{rule.id}</small></span><span>{rule.version}</span><span><Badge tone={rule.status === "Published" ? "success" : "warning"}>{rule.status}</Badge></span><span>{rule.changed}</span><span><MoreHorizontal size={16} /></span></button>)}</div>
    <p className="boundary-note"><ShieldCheck size={15} /> This registry contains only shared system data. Custom rules remain in each user's private workspace.</p>
  </div>;
}

function AuditView() {
  return <div className="admin-page"><SectionHeading title="Audit log" description="Append-only records for sensitive administrative changes." action={<Button disabled><Download size={15} /> Export preview</Button>} /><div className="table-toolbar"><SearchField placeholder="Search actor, action, or target…" /><Button disabled><Filter size={15} /> Filters</Button></div>
    <div className="data-table audit-table"><div className="data-table__head"><span>Event</span><span>Actor</span><span>Target</span><span>Request</span><span>Time</span></div>{activity.concat([{ action: "release.metadata_created", actor: "Ayu Prameswari", target: "REL-0.1.0", time: "12 Sep", tone: "neutral" }]).map((event, index) => <div className="data-table__row" key={`${event.action}-${index}`}><span><Badge tone={event.tone}>{event.action}</Badge></span><span>{event.actor}</span><span>{event.target}</span><span className="mono-cell">REQ-{1048 - index}</span><span>{event.time}</span></div>)}</div>
  </div>;
}

function ReleasesView() {
  return <div className="admin-page"><SectionHeading title="Desktop releases" description="Publish verified installer metadata without storing binaries in SQLite." action={<Button variant="primary" disabled><Download size={16} /> New release</Button>} />
    <div className="release-empty"><div className="release-artifact"><Laptop2 /><span>SG</span><i /></div><div><h3>No production release published</h3><p>Release management is a P2 backend capability. When available, this page will verify version, platform, architecture, checksum, and artifact URL before publishing.</p><div className="release-requirements"><span><CheckCircle2 /> Semantic version</span><span><CheckCircle2 /> SHA-256 checksum</span><span><CheckCircle2 /> Platform & architecture</span><span><CheckCircle2 /> Signed artifact URL</span></div><Button disabled>Awaiting release API</Button></div></div>
  </div>;
}

function LedgerMetric({ label, value, delta, trend }: { label: string; value: string; delta: string; trend: "up" | "down" | "neutral" }) {
  return <article className="ledger-metric"><span>{label}</span><strong>{value}</strong><small>{trend === "up" ? <ArrowUpRight /> : trend === "down" ? <ArrowDownRight /> : <Activity />}{delta}</small></article>;
}

function PanelHeader({ title, description, action, onAction }: { title: string; description: string; action?: string; onAction?: () => void }) {
  return <div className="panel-header"><div><h3>{title}</h3><p>{description}</p></div>{action && <Button variant="ghost" size="sm" onClick={onAction}>{action}<ChevronRight size={14} /></Button>}</div>;
}

function HealthRow({ name, detail, state, latency }: { name: string; detail: string; state: string; latency: string }) {
  return <div className="health-row"><span className="health-indicator"><i /></span><div><b>{name}</b><small>{detail}</small></div><Badge tone="info">{state}</Badge><strong>{latency}</strong></div>;
}

function Gate({ label, done }: { label: string; done: boolean }) {
  return <div className={done ? "is-done" : ""}><span>{done ? <CheckCircle2 /> : <CircleAlert />}</span><b>{label}</b><small>{done ? "Complete" : "Pending"}</small></div>;
}

function AccountChart() {
  return <div className="account-chart"><div className="chart-axis"><span>60</span><span>40</span><span>20</span><span>0</span></div><svg viewBox="0 0 640 180" role="img" aria-label="Illustrative chart of account registrations"><defs><linearGradient id="account-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#50e3a4" stopOpacity=".28" /><stop offset="1" stopColor="#50e3a4" stopOpacity="0" /></linearGradient></defs><path className="account-chart__grid" d="M0 20H640M0 65H640M0 110H640M0 155H640" /><path className="account-chart__area" d="M0 142 C45 133 72 140 112 121 S183 126 221 100 S292 109 330 83 S402 93 444 62 S517 76 554 48 S608 39 640 24 V180H0Z" /><path className="account-chart__line" d="M0 142 C45 133 72 140 112 121 S183 126 221 100 S292 109 330 83 S402 93 444 62 S517 76 554 48 S608 39 640 24" /><circle cx="640" cy="24" r="4" /></svg><div className="chart-labels"><span>17 Aug</span><span>24 Aug</span><span>31 Aug</span><span>07 Sep</span><span>15 Sep</span></div></div>;
}

function initials(name: string) {
  return name.split(" ").slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}
