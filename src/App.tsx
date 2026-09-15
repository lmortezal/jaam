import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowDownUp,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronRight,
  CircleHelp,
  Command,
  Download,
  ExternalLink,
  FileUp,
  Fingerprint,
  FolderOpen,
  LayoutGrid,
  Link2,
  List,
  LockKeyhole,
  Network,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Terminal,
  Trash2,
  Upload,
  X,
  Pencil,
  Filter,
  Globe2,
} from "lucide-react";
import { parse as parseYaml } from "yaml";
import { ImportReview } from "./ImportReview";
import { importMatch } from "./importPlan";
import { GroupEditor } from "./GroupEditor";
import { RelationBatchEditor } from "./RelationBatchEditor";
import { BulkEditor } from "./BulkEditor";
import { BackupPassword } from "./BackupPassword";
import * as api from "./api";
import { Icon, Empty, Modal } from "./ui";
import { EnvironmentEditor, ComponentEditor, TypeEditor } from "./Editors";
import { mergeDiagramGeometry, pruneDiagramViews } from "./diagram";
import { Graph } from "./Graph";
import {
  actionOf,
  criticalityOf,
  emptyFilters,
  filteredComponents,
  parseBackup,
  removeComponent,
  removeEnvironment,
  summaryOf,
  typeOf,
  uid,
  versionOf,
  type Inventory,
  type Component,
  type Environment,
  type ComponentType,
  type Scan,
  type DiagramView,
} from "./model";

type Page = "home" | "environment" | "imports" | "settings";
type Editor =
  | { kind: "environment"; value: Environment | null }
  | { kind: "component"; value: Component | null }
  | { kind: "type"; value: ComponentType | null }
  | null;
type Confirmation = {
  title: string;
  description: string;
  label: string;
  run: () => Promise<void>;
};
export function App() {
  const [data, setData] = useState<Inventory | null>(null),
    [page, setPage] = useState<Page>("home"),
    [environment, setEnvironment] = useState("");
  const [view, setView] = useState<"list" | "diagram">("list"),
    [filters, setFilters] = useState(emptyFilters),
    [highlight, setHighlight] = useState(""),
    [sort, setSort] = useState("name"),
    [descending, setDescending] = useState(false);
  const [groupDialog, setGroupDialog] = useState<{ id: string | null } | null>(
    null,
  );
  const [relationsOpen, setRelationsOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set()),
    [bulkOpen, setBulkOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null),
    [editor, setEditor] = useState<Editor>(null),
    [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [palette, setPalette] = useState(false),
    [query, setQuery] = useState("");
  const [importReview, setImportReview] = useState(false);
  const [scan, setScan] = useState<Scan | null>(null),
    [picked, setPicked] = useState<Set<string>>(new Set()),
    [importEnvironment, setImportEnvironment] = useState(""),
    [scanning, setScanning] = useState(false);
  const [passwordDialog, setPasswordDialog] = useState<{ file?: File } | null>(
    null,
  );
  const [backup, setBackup] = useState<Inventory | null>(null),
    [help, setHelp] = useState(false);
  const backupGeneration = useRef(0);
  const generation = useRef(0),
    saveTail = useRef<Promise<unknown>>(Promise.resolve()),
    dataRef = useRef<Inventory | null>(null),
    lastActivity = useRef(Date.now()),
    lastPulse = useRef(0);
  const clear = useCallback(() => {
    generation.current++;
    backupGeneration.current++;
    dataRef.current = null;
    setData(null);
    setSelected(null);
    setSelectedIds(new Set());
    setBulkOpen(false);
    setRelationsOpen(false);
    setGroupDialog(null);
    setEditor(null);
    setConfirmation(null);
    setPalette(false);
    setScan(null);
    setImportReview(false);
    setBackup(null);
    setPasswordDialog(null);
    setQuery("");
    setToast("");
    setError("");
    setBusy(false);
    setHelp(false);
  }, []);
  const report = useCallback(
    (e: unknown) => {
      const message = String(e).replace(/^Error: /, "");
      if (message.includes("LOCKED")) clear();
      else setError(message);
    },
    [clear],
  );
  const notify = (message: string) => setToast(message);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4000);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    let disposed = false,
      unlisten: (() => void) | undefined;
    api.onLock(clear).then((f) => {
      if (disposed) f();
      else unlisten = f;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [clear]);
  useEffect(() => {
    if (!data) return;
    const activity = (event: Event) => {
      if (!event.isTrusted) return;
      const now = Date.now();
      if (
        now - lastActivity.current >=
        data.settings.auto_lock_minutes * 60000
      ) {
        clear();
        void api.lock();
        return;
      }
      lastActivity.current = now;
      if (now - lastPulse.current > 5000) {
        lastPulse.current = now;
        void api.activity().catch(report);
      }
    };
    const verify = () => {
      const epoch = generation.current;
      if (
        Date.now() - lastActivity.current >=
        data.settings.auto_lock_minutes * 60000
      ) {
        clear();
        void api.lock();
      } else
        void api
          .status()
          .then((ok) => {
            if (epoch === generation.current && !ok) clear();
          })
          .catch((e) => {
            if (epoch === generation.current) report(e);
          });
    };
    ["pointerdown", "keydown", "wheel"].forEach((e) =>
      window.addEventListener(e, activity, { passive: true }),
    );
    window.addEventListener("focus", verify);
    document.addEventListener("visibilitychange", verify);
    const interval = setInterval(verify, 1000);
    return () => {
      ["pointerdown", "keydown", "wheel"].forEach((e) =>
        window.removeEventListener(e, activity),
      );
      window.removeEventListener("focus", verify);
      document.removeEventListener("visibilitychange", verify);
      clearInterval(interval);
    };
  }, [data?.settings.auto_lock_minutes, Boolean(data), clear, report]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k" && data) {
        e.preventDefault();
        setPalette((p) => !p);
      }
      if (
        (e.metaKey || e.ctrlKey) &&
        e.shiftKey &&
        e.key.toLowerCase() === "l"
      ) {
        e.preventDefault();
        clear();
        void api.lock();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [data, clear]);
  async function unlock() {
    setError("");
    setBusy(true);
    const epoch = ++generation.current;
    try {
      const d = await api.unlock();
      if (epoch === generation.current) {
        lastActivity.current = Date.now();
        dataRef.current = d;
        setData(d);
        setPage("home");
        setEnvironment("");
      }
    } catch (e) {
      if (epoch === generation.current) report(e);
    } finally {
      if (epoch === generation.current) setBusy(false);
    }
  }
  function save(
    next: Inventory | ((current: Inventory) => Inventory),
  ): Promise<Inventory> {
    const epoch = generation.current;
    const operation = saveTail.current
      .catch(() => {})
      .then(async () => {
        const current = dataRef.current;
        if (!current || epoch !== generation.current) throw new Error("LOCKED");
        const candidate = typeof next === "function" ? next(current) : next;
        if (candidate.revision !== current.revision)
          throw new Error(
            "The inventory changed. Review your changes and try again.",
          );
        const saved = await api.save(pruneDiagramViews(candidate));
        if (epoch !== generation.current) throw new Error("LOCKED");
        dataRef.current = saved;
        setData(saved);
        return saved;
      });
    saveTail.current = operation;
    return operation;
  }
  async function saveDiagram(env: string, view: DiagramView) {
    await save((current) => ({
      ...current,
      diagram_views: {
        ...current.diagram_views,
        [env]: mergeDiagramGeometry(current.diagram_views[env], view),
      },
    }));
  }
  useEffect(() => {
    setSelectedIds((old) => {
      const next = new Set(
        [...old].filter((id) =>
          data?.components.some(
            (c) => c.id === id && c.environment_id === environment,
          ),
        ),
      );
      return next.size === old.size ? old : next;
    });
  }, [data, environment]);
  function toggleSelection(id: string) {
    setSelectedIds((old) => {
      const next = new Set(old);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  function navigate(id: string) {
    setSelectedIds(new Set());
    setBulkOpen(false);
    setRelationsOpen(false);
    setGroupDialog(null);
    setEnvironment(id);
    setPage("environment");
    setFilters(emptyFilters());
    setSelected(null);
    setHighlight("");
    setError("");
  }
  async function launch(id: string) {
    setError("");
    try {
      await api.launch(id);
      notify("Launch sent to your system.");
    } catch (e) {
      report(e);
    }
  }
  async function scanConfigs() {
    setScanning(true);
    setError("");
    const epoch = generation.current;
    try {
      const result = await api.scan();
      if (epoch === generation.current) {
        setScan(result);
        setPicked(new Set());
        setImportEnvironment(environment || data?.environments[0]?.id || "");
      }
    } catch (e) {
      report(e);
    } finally {
      setScanning(false);
    }
  }
  async function loadBackup(file: File | undefined) {
    if (!file) return;
    if (file.size > 17 * 1024 * 1024) {
      report("Backup exceeds 17 MB.");
      return;
    }
    if (file.name.toLowerCase().endsWith(".age")) {
      setPasswordDialog({ file });
      return;
    }
    const epoch = generation.current;
    try {
      if (file.size > 16 * 1024 * 1024)
        throw new Error("Backup must be smaller than 16 MB.");
      const text = await file.text();
      const value = file.name.toLowerCase().endsWith(".json")
        ? JSON.parse(text)
        : parseYaml(text, { maxAliasCount: 25 });
      const parsed = parseBackup(value);
      if (epoch === generation.current) setBackup(parsed);
    } catch (e) {
      report(e);
    }
  }
  const current = data?.environments.find((e) => e.id === environment),
    component = data?.components.find((c) => c.id === selected);
  const visible =
    data && current
      ? filteredComponents(data, current.id, filters).sort((a, b) => {
          const values = (c: Component) =>
            sort === "name"
              ? c.name
              : sort === "type"
                ? typeOf(data, c).name
                : sort === "criticality"
                  ? String(
                      (
                        { low: 1, medium: 2, high: 3 } as Record<string, number>
                      )[criticalityOf(c)] || 0,
                    )
                  : summaryOf(c);
          return (
            values(a).localeCompare(values(b), undefined, { numeric: true }) *
            (descending ? -1 : 1)
          );
        })
      : [];
  const sortBy = (column: string) => {
    if (sort === column) setDescending(!descending);
    else {
      setSort(column);
      setDescending(false);
    }
  };
  const deleteSelected = () => {
    if (!data || !component) return;
    const c = component;
    setConfirmation({
      title: `Delete ${c.name}?`,
      description:
        "This removes the component and all its relationships from your inventory. Infrastructure itself is never changed.",
      label: "Delete component",
      run: async () => {
        await save(removeComponent(data, c.id));
        setSelected(null);
        notify("Component deleted.");
      },
    });
  };
  if (!data)
    return (
      <div className="unlock-screen">
        <div className="unlock-brand">
          <Logo />
          <span>OpsPortal</span>
        </div>
        <div className="unlock-orbit" />
        <div className="unlock-card">
          <div className="fingerprint">
            <Fingerprint size={48} strokeWidth={1.25} />
          </div>
          <span className="eyebrow">YOUR INFRASTRUCTURE. YOUR MACHINE.</span>
          <h1>
            A private place for
            <br />
            everything you run.
          </h1>
          <p>
            Unlock your infrastructure knowledge base
            <br />
            with your system account.
          </p>
          <button
            className="primary unlock-button"
            onClick={unlock}
            disabled={busy}
          >
            <Fingerprint size={18} />
            {busy
              ? "Waiting for authentication…"
              : api.demo
                ? "Explore demo inventory"
                : "Unlock OpsPortal"}
            <ArrowRight size={17} />
          </button>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="unlock-caption">
            <ShieldCheck size={14} />
            {api.demo
              ? "Demo · example data in memory only"
              : "System authentication · encrypted local storage"}
          </div>
        </div>
        <div className="unlock-footer">
          <span>
            <span className="status-dot" /> Local-first. Always private.
          </span>
          <span>
            macOS + Linux <span className="muted">/</span> v0.1.0
          </span>
        </div>
      </div>
    );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button
          className="brand"
          onClick={() => {
            setPage("home");
            setSelected(null);
          }}
        >
          <Logo />
          <span>
            OpsPortal<small>PERSONAL INFRASTRUCTURE</small>
          </span>
        </button>
        <button className="quick-search" onClick={() => setPalette(true)}>
          <Search size={15} />
          <span>Quick search</span>
          <kbd>⌘ K</kbd>
        </button>
        <div className="nav-label">WORKSPACE</div>
        <nav>
          <button
            className={page === "home" ? "nav-item active" : "nav-item"}
            onClick={() => {
              setPage("home");
              setSelected(null);
            }}
          >
            <LayoutGrid size={17} />
            Overview
          </button>
          <button
            className={page === "imports" ? "nav-item active" : "nav-item"}
            onClick={() => {
              setPage("imports");
              setSelected(null);
            }}
          >
            <FileUp size={17} />
            Import assist<span className="nav-chip">LOCAL</span>
          </button>
        </nav>
        <div className="nav-label env-label">
          ENVIRONMENTS
          <button
            aria-label="New environment"
            onClick={() => setEditor({ kind: "environment", value: null })}
          >
            <Plus size={15} />
          </button>
        </div>
        <nav className="environment-nav">
          {data.environments.map((e) => (
            <button
              key={e.id}
              className={
                page === "environment" && e.id === environment
                  ? "nav-item active"
                  : "nav-item"
              }
              onClick={() => navigate(e.id)}
              style={{ paddingLeft: e.parent_id ? 28 : 12 }}
            >
              <span className="env-dot" style={{ background: e.color }} />
              <span>{e.name}</span>
              <span className="nav-count">
                {
                  data.components.filter((c) => c.environment_id === e.id)
                    .length
                }
              </span>
            </button>
          ))}
          {!data.environments.length && (
            <p className="nav-empty">
              Your environments will
              <br />
              appear here.
            </p>
          )}
        </nav>
        <div className="sidebar-bottom">
          <div className="local-card">
            <ShieldCheck size={17} />
            <div>
              {api.demo ? "Demo workspace" : "Private workspace"}
              <small>
                {api.demo
                  ? "Example data · not persisted"
                  : "Stored on this device only"}
              </small>
            </div>
            <span className="status-dot" />
          </div>
          <button
            className={page === "settings" ? "nav-item active" : "nav-item"}
            onClick={() => {
              setPage("settings");
              setSelected(null);
            }}
          >
            <Settings2 size={17} />
            Settings
          </button>
          <button
            className="nav-item"
            onClick={() => {
              clear();
              void api.lock().catch(report);
            }}
          >
            <LockKeyhole size={17} />
            Lock workspace<kbd>⇧ ⌘ L</kbd>
          </button>
          <div className="sidebar-version">
            OpsPortal <span>v0.1.0</span>
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumbs">
            <FolderOpen size={15} />
            <span>Workspace</span>
            <ChevronRight size={13} />
            <strong>
              {page === "home"
                ? "Overview"
                : page === "imports"
                  ? "Import assist"
                  : page === "settings"
                    ? "Settings"
                    : current?.name || "Environment"}
            </strong>
          </div>
          <div className="topbar-right">
            <span className="offline-badge">
              <span className="status-dot" />
              {api.demo ? "DEMO · IN MEMORY" : "OFFLINE WORKSPACE"}
            </span>
            <span className="top-divider" />
            <button
              className="icon-button"
              aria-label="Keyboard shortcuts and help"
              onClick={() => setHelp(true)}
            >
              <CircleHelp size={17} />
            </button>
          </div>
        </header>
        {error && (
          <div className="error-banner" role="alert">
            {error}
            <button aria-label="Dismiss error" onClick={() => setError("")}>
              <X size={16} />
            </button>
          </div>
        )}
        <main
          className={
            page === "environment"
              ? "main-content environment-content"
              : "main-content"
          }
        >
          {page === "home" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">YOUR PERSONAL CONTROL ROOM</div>
                  <h1>
                    Infrastructure, in focus<span className="accent">.</span>
                  </h1>
                  <p>
                    Know what runs where. See how it connects. Get there in a
                    click.
                  </p>
                </div>
                <button
                  className="primary"
                  onClick={() =>
                    setEditor({ kind: "environment", value: null })
                  }
                >
                  <Plus size={17} />
                  New environment
                </button>
              </div>
              <div className="stats-grid">
                <Stat
                  label="Environments"
                  value={data.environments.length}
                  icon={<LayoutGrid size={19} />}
                  note="Your infrastructure spaces"
                />
                <Stat
                  label="Components"
                  value={data.components.length}
                  icon={<Icon name="boxes" size={19} />}
                  note={`${data.component_types.length} flexible component types`}
                />
                <Stat
                  label="Relationships"
                  value={data.relationships.length}
                  icon={<Link2 size={19} />}
                  note="Connections that give context"
                />
                <Stat
                  label="Internet-facing"
                  value={
                    data.components.filter(
                      (c) => c.properties.internet_facing === true,
                    ).length
                  }
                  icon={<Globe2 size={19} />}
                  note="Marked as public endpoints"
                />
              </div>
              <div className="section-heading environments-heading">
                <h2>
                  Your environments{" "}
                  <span className="count-badge">
                    {data.environments.length}
                  </span>
                </h2>
                <span className="subtle">
                  A place for every part of your infrastructure
                </span>
              </div>
              {data.environments.length ? (
                <div className="environment-grid">
                  {data.environments.map((e) => {
                    const cs = data.components.filter(
                      (c) => c.environment_id === e.id,
                    );
                    const types = data.component_types.filter((t) =>
                      cs.some((c) => c.component_type_id === t.id),
                    );
                    const cross = data.relationships.filter((r) => {
                      const a = data.components.find(
                          (c) => c.id === r.source_component_id,
                        ),
                        b = data.components.find(
                          (c) => c.id === r.target_component_id,
                        );
                      return (
                        a &&
                        b &&
                        a.environment_id !== b.environment_id &&
                        (a.environment_id === e.id || b.environment_id === e.id)
                      );
                    });
                    return (
                      <article
                        key={e.id}
                        className="environment-card"
                        style={
                          { "--env-color": e.color } as React.CSSProperties
                        }
                      >
                        <div className="card-top">
                          <span
                            className="environment-icon"
                            style={{ color: e.color }}
                          >
                            <Icon name={e.icon} size={25} />
                          </span>
                          <button
                            className="icon-button card-edit"
                            aria-label={`Edit ${e.name}`}
                            onClick={() =>
                              setEditor({ kind: "environment", value: e })
                            }
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            className="card-arrow"
                            aria-label={`Open ${e.name}`}
                            onClick={() => navigate(e.id)}
                          >
                            <ArrowUpRight size={21} />
                          </button>
                        </div>
                        <button
                          className="card-title"
                          onClick={() => navigate(e.id)}
                        >
                          {e.name}
                        </button>
                        {e.parent_id && (
                          <small className="parent-note">
                            Inside{" "}
                            {
                              data.environments.find(
                                (p) => p.id === e.parent_id,
                              )?.name
                            }
                          </small>
                        )}
                        <p>
                          {e.description ||
                            "Your next infrastructure space. Add components to start mapping it out."}
                        </p>
                        <div className="type-chips">
                          {types.slice(0, 4).map((t) => (
                            <span key={t.id} style={{ color: t.color }}>
                              <Icon name={t.icon} size={12} />
                              {t.name}
                            </span>
                          ))}
                          {!types.length && (
                            <span className="muted">
                              Ready for your first component
                            </span>
                          )}
                          {types.length > 4 && <span>+{types.length - 4}</span>}
                        </div>
                        <div className="card-footer">
                          <span>
                            <Icon name="box" size={14} />
                            <strong>{cs.length}</strong> components
                          </span>
                          <span title="Cross-environment relationships">
                            <Link2 size={14} />
                            {cross.length} cross-links
                          </span>
                        </div>
                      </article>
                    );
                  })}
                  <button
                    className="new-environment-card"
                    onClick={() =>
                      setEditor({ kind: "environment", value: null })
                    }
                  >
                    <span>
                      <Plus size={24} />
                    </span>
                    <strong>Make room for more</strong>
                    <small>Add an environment</small>
                  </button>
                </div>
              ) : (
                <Empty title="Start with an environment" icon="building">
                  <p>
                    Give your infrastructure a home, then add the pieces that
                    make it work.
                  </p>
                  <button
                    className="primary"
                    onClick={() =>
                      setEditor({ kind: "environment", value: null })
                    }
                  >
                    <Plus size={16} />
                    Create your first environment
                  </button>
                </Empty>
              )}
              <div className="import-callout">
                <div className="callout-icon">
                  <Terminal size={23} />
                </div>
                <div>
                  <h3>Your config files already know a few things.</h3>
                  <p>
                    Bring in hosts from SSH and contexts from Kubernetes. You
                    choose what gets added.
                  </p>
                </div>
                <button
                  className="secondary"
                  onClick={() => setPage("imports")}
                >
                  Explore import assist
                  <ArrowRight size={16} />
                </button>
              </div>
              <div className="home-footnote">
                <ShieldCheck size={14} /> Your infrastructure stays yours. No
                sync, no telemetry, no background discovery.
              </div>
            </>
          )}
          {page === "environment" && current && (
            <>
              <div className="page-heading env-heading">
                <div>
                  <div className="eyebrow">
                    <span
                      className="env-dot"
                      style={{ background: current.color }}
                    />
                    ENVIRONMENT
                  </div>
                  <h1>
                    {current.name}
                    <button
                      className="icon-button"
                      aria-label="Edit environment"
                      onClick={() =>
                        setEditor({ kind: "environment", value: current })
                      }
                    >
                      <Pencil size={17} />
                    </button>
                  </h1>
                  <p>
                    {current.description ||
                      "Add components and document how they connect."}
                  </p>
                </div>
                <button
                  className="primary"
                  onClick={() => setEditor({ kind: "component", value: null })}
                >
                  <Plus size={17} />
                  Add component
                </button>
              </div>
              <div className="environment-summary">
                <span>
                  <Icon name="box" size={14} />
                  {
                    data.components.filter(
                      (c) => c.environment_id === current.id,
                    ).length
                  }{" "}
                  components
                </span>
                <span>
                  <Link2 size={14} />
                  {
                    data.relationships.filter((r) =>
                      data.components.some(
                        (c) =>
                          c.environment_id === current.id &&
                          (c.id === r.source_component_id ||
                            c.id === r.target_component_id),
                      ),
                    ).length
                  }{" "}
                  relationships
                </span>
                <span className="critical-text">
                  <span className="tiny-dot" />
                  {
                    data.components.filter(
                      (c) =>
                        c.environment_id === current.id &&
                        criticalityOf(c) === "high",
                    ).length
                  }{" "}
                  critical
                </span>
                <button
                  className="text-button danger-subtle"
                  onClick={() =>
                    setConfirmation({
                      title: `Delete ${current.name}?`,
                      description:
                        "This deletes the environment, its components, and their relationships. Move or delete nested environments first.",
                      label: "Delete environment",
                      run: async () => {
                        await save(removeEnvironment(data, current.id));
                        setPage("home");
                        setSelected(null);
                      },
                    })
                  }
                >
                  Delete environment
                </button>
              </div>
              <div className="view-bar">
                <div className="view-tabs">
                  <button
                    className={view === "list" ? "selected" : ""}
                    onClick={() => setView("list")}
                  >
                    <List size={16} />
                    List view
                  </button>
                  <button
                    className={view === "diagram" ? "selected" : ""}
                    onClick={() => setView("diagram")}
                  >
                    <Network size={16} />
                    Diagram view
                  </button>
                </div>
                <span className="subtle">
                  {visible.length} components shown
                </span>
              </div>
              <div className="filter-bar">
                <div className="search-input">
                  <Search size={16} />
                  <input
                    aria-label="Search components"
                    placeholder="Search components…"
                    value={filters.search}
                    onChange={(e) =>
                      setFilters({ ...filters, search: e.target.value })
                    }
                  />
                </div>
                <select
                  aria-label="Filter by component type"
                  value={filters.type}
                  onChange={(e) =>
                    setFilters({ ...filters, type: e.target.value })
                  }
                >
                  <option value="">All types</option>
                  {data.component_types.map((t) => (
                    <option value={t.id} key={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Filter by criticality"
                  value={filters.criticality}
                  onChange={(e) =>
                    setFilters({ ...filters, criticality: e.target.value })
                  }
                >
                  <option value="">All criticality</option>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
                <button
                  className={
                    filters.internet ? "filter-toggle enabled" : "filter-toggle"
                  }
                  aria-pressed={filters.internet}
                  onClick={() =>
                    setFilters({ ...filters, internet: !filters.internet })
                  }
                >
                  <Globe2 size={14} />
                  Internet-facing
                </button>
                <button
                  className={
                    filters.cross ? "filter-toggle enabled" : "filter-toggle"
                  }
                  aria-pressed={filters.cross}
                  onClick={() =>
                    setFilters({ ...filters, cross: !filters.cross })
                  }
                >
                  <Link2 size={14} />
                  Cross-links
                </button>
                {Object.values(filters).some(Boolean) && (
                  <button
                    className="icon-button"
                    title="Reset filters"
                    aria-label="Reset filters"
                    onClick={() => setFilters(emptyFilters())}
                  >
                    <X size={16} />
                  </button>
                )}
              </div>
              {selectedIds.size > 0 && (
                <div
                  className="selection-toolbar"
                  role="region"
                  aria-label="Selected components"
                >
                  <strong>{selectedIds.size} selected</strong>
                  <span>
                    {
                      [...selectedIds].filter(
                        (id) => !visible.some((c) => c.id === id),
                      ).length
                    }{" "}
                    hidden by filters
                  </span>
                  <button
                    className="secondary"
                    onClick={() => setBulkOpen(true)}
                  >
                    Edit selected
                  </button>
                  <button
                    className="secondary"
                    onClick={() => setRelationsOpen(true)}
                  >
                    Link selected
                  </button>
                  <button
                    className="secondary"
                    onClick={() => setGroupDialog({ id: null })}
                  >
                    Group selected
                  </button>
                  <button
                    className="danger-subtle"
                    onClick={() => {
                      const ids = new Set(selectedIds),
                        count = data.relationships.filter(
                          (r) =>
                            ids.has(r.source_component_id) ||
                            ids.has(r.target_component_id),
                        ).length;
                      setConfirmation({
                        title: `Delete ${ids.size} components?`,
                        description: `Delete ${data.components
                          .filter((c) => ids.has(c.id))
                          .map((c) => c.name)
                          .join(
                            ", ",
                          )}. Also removes ${count} incident relationships and their diagram memberships.`,
                        label: "Delete selected",
                        run: async () => {
                          await save({
                            ...data,
                            components: data.components.filter(
                              (c) => !ids.has(c.id),
                            ),
                            relationships: data.relationships.filter(
                              (r) =>
                                !ids.has(r.source_component_id) &&
                                !ids.has(r.target_component_id),
                            ),
                          });
                          setSelectedIds(new Set());
                          setSelected(null);
                          notify("Selected components deleted.");
                        },
                      });
                    }}
                  >
                    Delete selected
                  </button>
                  <button
                    className="text-button"
                    onClick={() => setSelectedIds(new Set())}
                  >
                    Clear selection
                  </button>
                </div>
              )}
              <div className="inventory-area">
                {view === "list" ? (
                  visible.length ? (
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>
                              <input
                                type="checkbox"
                                aria-label="Select all visible components"
                                checked={
                                  visible.length > 0 &&
                                  visible.every((c) => selectedIds.has(c.id))
                                }
                                ref={(node) => {
                                  if (node)
                                    node.indeterminate =
                                      visible.some((c) =>
                                        selectedIds.has(c.id),
                                      ) &&
                                      !visible.every((c) =>
                                        selectedIds.has(c.id),
                                      );
                                }}
                                onChange={(e) =>
                                  setSelectedIds((old) => {
                                    const next = new Set(old);
                                    visible.forEach((c) =>
                                      e.target.checked
                                        ? next.add(c.id)
                                        : next.delete(c.id),
                                    );
                                    return next;
                                  })
                                }
                              />
                            </th>
                            {[
                              ["name", "COMPONENT"],
                              ["type", "TYPE"],
                              ["endpoint", "ENDPOINT"],
                              ["criticality", "CRITICALITY"],
                            ].map(([key, label]) => (
                              <th
                                key={key}
                                aria-sort={
                                  sort === key
                                    ? descending
                                      ? "descending"
                                      : "ascending"
                                    : "none"
                                }
                              >
                                <button onClick={() => sortBy(key)}>
                                  {label}
                                  <ArrowDownUp size={11} />
                                </button>
                              </th>
                            ))}
                            <th>EXPOSURE</th>
                            <th>
                              <span className="sr-only">Actions</span>
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {visible.map((c) => {
                            const t = typeOf(data, c),
                              action = actionOf(data, c);
                            return (
                              <tr
                                key={c.id}
                                className={
                                  selectedIds.has(c.id)
                                    ? "selected-row"
                                    : selected === c.id
                                      ? "focused-row"
                                      : ""
                                }
                              >
                                <td>
                                  <input
                                    type="checkbox"
                                    aria-label={`Select ${c.name}`}
                                    checked={selectedIds.has(c.id)}
                                    onChange={() => toggleSelection(c.id)}
                                  />
                                </td>
                                <td>
                                  <button
                                    className="component-name"
                                    onClick={() => setSelected(c.id)}
                                  >
                                    <span
                                      className="type-icon"
                                      style={{
                                        color: t.color,
                                        background: `${t.color}12`,
                                      }}
                                    >
                                      <Icon name={t.icon} />
                                    </span>
                                    <span>
                                      <strong>{c.name}</strong>
                                      <small>
                                        {versionOf(c) || "No version recorded"}
                                      </small>
                                    </span>
                                  </button>
                                </td>
                                <td>
                                  <span
                                    className="type-pill"
                                    style={{ color: t.color }}
                                  >
                                    {t.name}
                                  </span>
                                </td>
                                <td className="endpoint-cell">
                                  {summaryOf(c)}
                                </td>
                                <td>
                                  <Criticality value={criticalityOf(c)} />
                                </td>
                                <td>
                                  {c.properties.internet_facing === true ? (
                                    <span className="public-badge">
                                      <ArrowUpRight size={13} />
                                      Public
                                    </span>
                                  ) : (
                                    <span className="private-badge">
                                      {c.properties.internet_facing === false
                                        ? "Private"
                                        : "Not set"}
                                    </span>
                                  )}
                                </td>
                                <td>
                                  <button
                                    className="row-launch"
                                    disabled={
                                      !action ||
                                      action.action_type === "none" ||
                                      action.action_type === "custom_command"
                                    }
                                    aria-label={`Launch ${c.name}`}
                                    title={
                                      action?.action_type === "ssh_terminal"
                                        ? "Open SSH terminal"
                                        : "Open in browser"
                                    }
                                    onClick={() => void launch(c.id)}
                                  >
                                    {action?.action_type === "ssh_terminal" ? (
                                      <Terminal size={16} />
                                    ) : (
                                      <ExternalLink size={16} />
                                    )}
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      <div className="table-footer">
                        <span>
                          {visible.length} components · stored locally
                        </span>
                        <span>
                          Click a component to inspect its details{" "}
                          <ChevronRight size={13} />
                        </span>
                      </div>
                    </div>
                  ) : (
                    <Empty
                      title={
                        data.components.some(
                          (c) => c.environment_id === current.id,
                        )
                          ? "No matching components"
                          : "An empty space, ready to connect"
                      }
                    >
                      <p>
                        {data.components.some(
                          (c) => c.environment_id === current.id,
                        )
                          ? "Try changing your search or filters."
                          : "Add a server, domain, cluster, or anything else you run."}
                      </p>
                      <button
                        className="secondary"
                        onClick={() =>
                          data.components.some(
                            (c) => c.environment_id === current.id,
                          )
                            ? setFilters(emptyFilters())
                            : setEditor({ kind: "component", value: null })
                        }
                      >
                        {data.components.some(
                          (c) => c.environment_id === current.id,
                        )
                          ? "Reset filters"
                          : "Add component"}
                      </button>
                    </Empty>
                  )
                ) : (
                  <>
                    <div className="diagram-toolbar">
                      <div className="graph-legend">
                        {data.component_types
                          .filter((t) =>
                            data.components.some(
                              (c) => c.component_type_id === t.id,
                            ),
                          )
                          .map((t) => (
                            <span key={t.id}>
                              <span
                                className="env-dot"
                                style={{ background: t.color }}
                              />
                              {t.name}
                            </span>
                          ))}
                      </div>
                      <select
                        aria-label="Highlight component type"
                        value={highlight}
                        onChange={(e) => setHighlight(e.target.value)}
                      >
                        <option value="">Highlight a type</option>
                        {data.component_types.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    {visible.length ? (
                      <Graph
                        data={data}
                        environment={current.id}
                        filters={filters}
                        highlight={highlight}
                        selected={selected}
                        selectedIds={selectedIds}
                        onEditGroup={(id) => setGroupDialog({ id })}
                        onSelection={(ids) =>
                          setSelectedIds((old) =>
                            old.size === ids.size &&
                            [...old].every((id) => ids.has(id))
                              ? old
                              : ids,
                          )
                        }
                        onSave={(view) => saveDiagram(environment, view)}
                        onSelect={setSelected}
                        onLaunch={(id) => void launch(id)}
                        onNavigate={navigate}
                      />
                    ) : (
                      <Empty title="No components to map">
                        <p>Add components or clear the current filters.</p>
                      </Empty>
                    )}
                  </>
                )}
              </div>
            </>
          )}
          {page === "imports" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">A HEAD START, FROM YOUR MACHINE</div>
                  <h1>
                    Import assist<span className="accent">.</span>
                  </h1>
                  <p>
                    Your local configs, turned into a useful starting point.
                  </p>
                </div>
                <button
                  className="primary"
                  onClick={() => void scanConfigs()}
                  disabled={scanning}
                >
                  <Search size={16} />
                  {scanning
                    ? "Reading configs…"
                    : scan
                      ? "Read configs again"
                      : "Read local configs"}
                </button>
              </div>
              <div className="source-cards">
                <div className="source-card">
                  <Terminal size={24} />
                  <div>
                    <h3>SSH hosts</h3>
                    <code>~/.ssh/config</code>
                    <p>Literal host aliases and connection metadata.</p>
                  </div>
                  <span className="read-only">READ ONLY</span>
                </div>
                <div className="source-card">
                  <Icon name="boxes" size={24} />
                  <div>
                    <h3>Kubernetes contexts</h3>
                    <code>~/.kube/config</code>
                    <p>Contexts, namespaces, and cluster endpoints.</p>
                  </div>
                  <span className="read-only">READ ONLY</span>
                </div>
              </div>
              <div className="info-note">
                <ShieldCheck size={18} />
                <span>
                  Source files are never modified. No private keys, tokens,
                  certificates, or credential plugins are imported. SSH
                  configuration rules are applied by OpenSSH when you launch a
                  host.
                </span>
              </div>
              {scan ? (
                <>
                  <div className="section-heading">
                    <h2>
                      Suggestions{" "}
                      <span className="count-badge">
                        {scan.suggestions.length}
                      </span>
                    </h2>
                    <button
                      className="text-button"
                      onClick={() =>
                        setPicked(
                          picked.size
                            ? new Set()
                            : new Set(
                                scan.suggestions
                                  .filter(
                                    (s) =>
                                      data.component_types.some(
                                        (t) => t.id === s.component_type_id,
                                      ) &&
                                      ["new", "update"].includes(
                                        importMatch(data, s, importEnvironment)
                                          .kind,
                                      ),
                                  )
                                  .map((s) => s.id),
                              ),
                        )
                      }
                    >
                      {picked.size ? "Deselect all" : "Select new and matched"}
                    </button>
                  </div>
                  {scan.warnings.map((w, i) => (
                    <p className="warning-note" key={i}>
                      {w}
                    </p>
                  ))}
                  {scan.suggestions.length ? (
                    <div className="suggestions">
                      {scan.suggestions.map((s) => {
                        const match = importMatch(data, s, importEnvironment),
                          exists = match.kind === "existing",
                          missing = !data.component_types.some(
                            (t) => t.id === s.component_type_id,
                          );
                        return (
                          <label className="suggestion" key={s.id}>
                            <input
                              type="checkbox"
                              disabled={exists || missing}
                              checked={picked.has(s.id) && !exists && !missing}
                              onChange={(e) =>
                                setPicked((old) => {
                                  const next = new Set(old);
                                  e.target.checked
                                    ? next.add(s.id)
                                    : next.delete(s.id);
                                  return next;
                                })
                              }
                            />
                            <Icon
                              name={
                                s.component_type_id === "server"
                                  ? "server"
                                  : "boxes"
                              }
                              size={21}
                            />
                            <span>
                              <strong>{s.name}</strong>
                              <small>
                                {String(
                                  s.properties.hostname ||
                                    s.properties.kube_context ||
                                    "",
                                )}
                              </small>
                            </span>
                            <code>{s.source}</code>
                            {exists && (
                              <span className="read-only">ALREADY ADDED</span>
                            )}
                            {!exists && match.kind !== "new" && (
                              <span className="read-only">
                                {match.kind === "update"
                                  ? "ALIAS UPDATE"
                                  : "REVIEW MATCH"}
                              </span>
                            )}
                            {missing && (
                              <span className="warning-note">
                                Restore the {s.component_type_id} type to import
                              </span>
                            )}
                          </label>
                        );
                      })}
                    </div>
                  ) : (
                    <Empty title="No suggestions found">
                      <p>
                        Add literal SSH hosts or Kubernetes contexts to your
                        config files, then read them again.
                      </p>
                    </Empty>
                  )}
                  <div className="import-footer">
                    <label>
                      Add to environment
                      <select
                        value={importEnvironment}
                        onChange={(e) => {
                          setImportEnvironment(e.target.value);
                          setPicked(new Set());
                        }}
                      >
                        <option value="">Choose environment</option>
                        {data.environments.map((e) => (
                          <option key={e.id} value={e.id}>
                            {e.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    {!data.environments.length && (
                      <button
                        className="secondary"
                        onClick={() =>
                          setEditor({ kind: "environment", value: null })
                        }
                      >
                        Create environment
                      </button>
                    )}
                    <button
                      className="primary"
                      disabled={!picked.size || !importEnvironment || busy}
                      onClick={() => setImportReview(true)}
                    >
                      <Plus size={16} />
                      Review {picked.size || "selected"} suggestions
                    </button>
                  </div>
                </>
              ) : (
                <Empty icon="server" title="Your configs stay in your control">
                  <p>
                    Read local files to see suggestions.
                    <br />
                    Nothing is added until you select it and confirm.
                  </p>
                </Empty>
              )}
            </>
          )}
          {page === "settings" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">MAKE IT YOURS</div>
                  <h1>
                    Workspace settings<span className="accent">.</span>
                  </h1>
                  <p>Shape your inventory around the way you work.</p>
                </div>
              </div>
              <section className="settings-section">
                <div className="section-heading">
                  <div>
                    <h2>Component types</h2>
                    <p className="subtle">
                      Define your own building blocks, fields, and launch
                      actions.
                    </p>
                  </div>
                  <button
                    className="secondary"
                    onClick={() => setEditor({ kind: "type", value: null })}
                  >
                    <Plus size={16} />
                    New type
                  </button>
                </div>
                <div className="types-list">
                  {data.component_types.map((t) => (
                    <div className="type-setting" key={t.id}>
                      <span
                        className="type-icon"
                        style={{ color: t.color, background: `${t.color}15` }}
                      >
                        <Icon name={t.icon} />
                      </span>
                      <div>
                        <strong>{t.name}</strong>
                        <small>
                          {t.fields.length} fields ·{" "}
                          {t.launch_action?.action_type.replaceAll("_", " ") ||
                            "No launch action"}
                        </small>
                      </div>
                      <button
                        className="icon-button"
                        aria-label={`Edit ${t.name} type`}
                        onClick={() => setEditor({ kind: "type", value: t })}
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        className="icon-button"
                        disabled={data.components.some(
                          (c) => c.component_type_id === t.id,
                        )}
                        title="Types in use cannot be deleted"
                        aria-label={`Delete ${t.name} type`}
                        onClick={() =>
                          setConfirmation({
                            title: `Delete ${t.name} type?`,
                            description:
                              "This type is not used by any components.",
                            label: "Delete type",
                            run: async () => {
                              await save({
                                ...data,
                                component_types: data.component_types.filter(
                                  (x) => x.id !== t.id,
                                ),
                              });
                            },
                          })
                        }
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  ))}
                </div>
              </section>
              <section className="settings-section">
                <h2>Security & launches</h2>
                <div className="setting-row">
                  <div>
                    <strong>Auto-lock after inactivity</strong>
                    <p>
                      Closes the database and clears the workspace. A fresh
                      system challenge is required.
                    </p>
                  </div>
                  <select
                    aria-label="Auto-lock timeout"
                    value={data.settings.auto_lock_minutes}
                    onChange={(e) =>
                      void save({
                        ...data,
                        settings: {
                          ...data.settings,
                          auto_lock_minutes: Number(e.target.value),
                        },
                      }).catch(report)
                    }
                  >
                    {Array.from(
                      new Set([
                        1,
                        5,
                        15,
                        30,
                        60,
                        120,
                        data.settings.auto_lock_minutes,
                      ]),
                    )
                      .sort((a, b) => a - b)
                      .map((n) => (
                        <option key={n} value={n}>
                          {n} {n === 1 ? "minute" : "minutes"}
                        </option>
                      ))}
                  </select>
                </div>
                <div className="setting-row">
                  <div>
                    <strong>macOS terminal preference</strong>
                    <p>
                      Automatic prefers iTerm2 when installed. Linux uses
                      $TERMINAL or an available terminal.
                    </p>
                  </div>
                  <select
                    aria-label="Preferred terminal"
                    value={data.settings.terminal}
                    onChange={(e) =>
                      void save({
                        ...data,
                        settings: {
                          ...data.settings,
                          terminal: e.target.value,
                        },
                      }).catch(report)
                    }
                  >
                    <option value="auto">Automatic</option>
                    <option value="terminal">Terminal.app</option>
                    <option value="iterm">iTerm2</option>
                  </select>
                </div>
                <div className="info-note">
                  <ShieldCheck size={18} />
                  <span>
                    {api.demo
                      ? "This preview uses disposable example data in memory. Native authentication and encrypted storage are not available in a browser."
                      : "Your database key is kept in the OS key store and retrieved only after system authentication. Password and biometric prompts are handled by your operating system."}
                  </span>
                </div>
              </section>
              <section className="settings-section">
                <h2>Backup & restore</h2>
                <p className="subtle">
                  Password-encrypted backups. Legacy JSON/YAML files can still
                  be imported.
                </p>
                <div className="backup-actions">
                  <button
                    className="secondary"
                    onClick={() => setPasswordDialog({})}
                  >
                    <Download size={16} /> Export encrypted backup
                  </button>
                  <label className="secondary file-button">
                    <Upload size={16} />
                    Import backup
                    <input
                      aria-label="Import backup file"
                      type="file"
                      accept=".age,.json,.yaml,.yml"
                      onChange={(e) => {
                        void loadBackup(e.target.files?.[0]);
                        e.target.value = "";
                      }}
                    />
                  </label>
                </div>
              </section>
              <div className="home-footnote">
                <LockKeyhole size={14} /> Credentials and arbitrary command
                execution are outside v1. Reference existing SSH identity files
                by path.
              </div>
            </>
          )}
        </main>
      </div>
      {importReview && data && scan && (
        <ImportReview
          data={data}
          suggestions={scan.suggestions.filter((s) => picked.has(s.id))}
          environment={importEnvironment}
          onSave={async (next) => {
            await save(next);
            setPicked(new Set());
            notify("Import applied.");
            navigate(importEnvironment);
          }}
          onClose={() => setImportReview(false)}
        />
      )}
      {groupDialog && (
        <GroupEditor
          data={data}
          environment={environment}
          value={
            data.diagram_views[environment]?.groups.find(
              (g) => g.id === groupDialog.id,
            ) || null
          }
          selected={selectedIds}
          onClose={() => setGroupDialog(null)}
          onSave={async (group) => {
            await save((current) => {
              const view = current.diagram_views[environment] || {
                nodes: {},
                groups: [],
              };
              return {
                ...current,
                diagram_views: {
                  ...current.diagram_views,
                  [environment]: {
                    ...view,
                    groups: [
                      ...view.groups.filter((g) => g.id !== group.id),
                      group,
                    ],
                  },
                },
              };
            });
          }}
          onDelete={async () => {
            await save((current) => {
              const view = current.diagram_views[environment];
              return {
                ...current,
                diagram_views: {
                  ...current.diagram_views,
                  [environment]: {
                    ...view,
                    groups: view.groups.filter((g) => g.id !== groupDialog.id),
                  },
                },
              };
            });
          }}
        />
      )}
      {relationsOpen && (
        <RelationBatchEditor
          data={data}
          ids={selectedIds}
          onSave={save}
          onClose={() => setRelationsOpen(false)}
        />
      )}
      {bulkOpen && (
        <BulkEditor
          data={data}
          ids={selectedIds}
          onSave={save}
          onClose={() => setBulkOpen(false)}
        />
      )}
      {component && (
        <Detail
          data={data}
          component={component}
          onClose={() => setSelected(null)}
          onEdit={() => setEditor({ kind: "component", value: component })}
          onDelete={deleteSelected}
          onLaunch={() => void launch(component.id)}
          onSelect={setSelected}
          onNavigate={navigate}
        />
      )}
      {editor?.kind === "environment" && (
        <EnvironmentEditor
          data={data}
          value={editor.value}
          onClose={() => setEditor(null)}
          onSave={async (v) => {
            await save({
              ...data,
              environments: editor.value
                ? data.environments.map((e) => (e.id === v.id ? v : e))
                : [...data.environments, v],
            });
            notify("Environment saved.");
          }}
        />
      )}
      {editor?.kind === "component" && (
        <ComponentEditor
          data={data}
          environment={environment}
          value={editor.value}
          onClose={() => setEditor(null)}
          onSave={async (v, rels) => {
            await save({
              ...data,
              components: editor.value
                ? data.components.map((c) => (c.id === v.id ? v : c))
                : [...data.components, v],
              relationships: [
                ...data.relationships.filter(
                  (r) => r.source_component_id !== v.id,
                ),
                ...rels,
              ],
            });
            notify("Component saved.");
          }}
        />
      )}
      {editor?.kind === "type" && (
        <TypeEditor
          value={editor.value}
          onClose={() => setEditor(null)}
          onSave={async (v) => {
            await save({
              ...data,
              component_types: editor.value
                ? data.component_types.map((t) => (t.id === v.id ? v : t))
                : [...data.component_types, v],
            });
            notify("Component type saved.");
          }}
        />
      )}
      {confirmation && (
        <Confirm
          key={confirmation.title}
          value={confirmation}
          onClose={() => setConfirmation(null)}
          onError={report}
        />
      )}
      {passwordDialog && (
        <BackupPassword
          restoring={!!passwordDialog.file}
          onClose={() => {
            backupGeneration.current++;
            setPasswordDialog(null);
          }}
          onSubmit={async (password) => {
            const epoch = generation.current,
              operation = backupGeneration.current;
            if (passwordDialog.file) {
              const bytes = Array.from(
                new Uint8Array(await passwordDialog.file.arrayBuffer()),
              );
              const restored = await api.decryptBackup(bytes, password);
              if (
                epoch !== generation.current ||
                operation !== backupGeneration.current
              )
                throw new Error("Backup cancelled");
              setBackup(restored);
            } else {
              const bytes = await api.exportBackup(password);
              if (
                epoch !== generation.current ||
                operation !== backupGeneration.current
              )
                throw new Error("Backup cancelled");
              const url = URL.createObjectURL(
                new Blob([new Uint8Array(bytes)], {
                  type: "application/octet-stream",
                }),
              );
              const a = document.createElement("a");
              a.href = url;
              a.download = `opsportal-${new Date().toISOString().slice(0, 10)}.json.age`;
              a.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
              notify("Encrypted backup prepared for download.");
            }
          }}
        />
      )}
      {backup && (
        <Modal title="Restore this inventory?" onClose={() => setBackup(null)}>
          <p>
            This replaces the current inventory. Export a backup of your current
            data before continuing.
          </p>
          <div className="restore-summary">
            <span>
              <strong>{backup.environments.length}</strong> environments
            </span>
            <span>
              <strong>{backup.components.length}</strong> components
            </span>
            <span>
              <strong>{backup.relationships.length}</strong> relationships
            </span>
          </div>
          <p className="subtle">
            The backup is validated before it is saved. Restoring never launches
            actions or contacts infrastructure.
          </p>
          <footer className="modal-footer">
            <button className="secondary" onClick={() => setBackup(null)}>
              Cancel
            </button>
            <button
              className="primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await save({ ...backup, revision: data.revision });
                  setBackup(null);
                  setSelected(null);
                  setPage("home");
                  notify("Inventory restored.");
                } catch (e) {
                  report(e);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Replace inventory
            </button>
          </footer>
        </Modal>
      )}
      {palette && (
        <Modal
          title="Jump to anything"
          onClose={() => {
            setPalette(false);
            setQuery("");
          }}
        >
          <div className="search-input palette-search">
            <Search size={18} />
            <input
              autoFocus
              aria-label="Search workspace"
              placeholder="Find an environment or component…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <kbd>ESC</kbd>
          </div>
          <div className="palette-results">
            {data.environments
              .filter((e) => e.name.toLowerCase().includes(query.toLowerCase()))
              .map((e) => (
                <button
                  key={e.id}
                  onClick={() => {
                    navigate(e.id);
                    setPalette(false);
                    setQuery("");
                  }}
                >
                  <Icon name={e.icon} />
                  <span>
                    {e.name}
                    <small>Environment</small>
                  </span>
                  <ArrowRight size={16} />
                </button>
              ))}
            {data.components
              .filter((c) =>
                `${c.name} ${summaryOf(c)}`
                  .toLowerCase()
                  .includes(query.toLowerCase()),
              )
              .slice(0, 30)
              .map((c) => (
                <button
                  key={c.id}
                  onClick={() => {
                    navigate(c.environment_id);
                    setSelected(c.id);
                    setPalette(false);
                    setQuery("");
                  }}
                >
                  <Icon name={typeOf(data, c).icon} />
                  <span>
                    {c.name}
                    <small>
                      {
                        data.environments.find((e) => e.id === c.environment_id)
                          ?.name
                      }{" "}
                      · {typeOf(data, c).name}
                    </small>
                  </span>
                  <ChevronRight size={16} />
                </button>
              ))}
            {query &&
              !data.environments.some((e) =>
                e.name.toLowerCase().includes(query.toLowerCase()),
              ) &&
              !data.components.some((c) =>
                `${c.name} ${summaryOf(c)}`
                  .toLowerCase()
                  .includes(query.toLowerCase()),
              ) && (
                <p className="subtle">
                  No results. Try another name or endpoint.
                </p>
              )}
          </div>
        </Modal>
      )}
      {help && (
        <Modal title="A few useful shortcuts" onClose={() => setHelp(false)}>
          <div className="shortcut">
            <span>Search your workspace</span>
            <kbd>⌘ / Ctrl K</kbd>
          </div>
          <div className="shortcut">
            <span>Lock immediately</span>
            <kbd>⇧ ⌘ / Ctrl L</kbd>
          </div>
          <div className="shortcut">
            <span>Close a dialog</span>
            <kbd>Esc</kbd>
          </div>
          <p className="subtle">
            In the diagram, click a node for details, double-click to launch, or
            click a dashed edge to visit the connected environment. Use list
            view for full keyboard access.
          </p>
          <p className="subtle">
            Linux authentication requires the bundled polkit policy, a desktop
            authentication agent, and an unlocked Secret Service. Fingerprint
            support depends on your distro’s PAM configuration; password
            authentication must remain enabled.
          </p>
        </Modal>
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          {toast}
        </div>
      )}
    </div>
  );
}
function Logo() {
  return (
    <span className="logo">
      <svg
        width="29"
        height="29"
        viewBox="0 0 32 32"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="m5 9 11-6 11 6v14l-11 6-11-6V9Z"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <path
          d="m5 9 11 7 11-7M16 16v13"
          stroke="currentColor"
          strokeWidth="1.8"
        />
        <circle cx="16" cy="16" r="2" fill="currentColor" />
      </svg>
    </span>
  );
}
function Stat({
  label,
  value,
  icon,
  note,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  note: string;
}) {
  return (
    <div className="stat-card">
      <div>
        <span>{label}</span>
        {icon}
      </div>
      <strong>{value.toString().padStart(2, "0")}</strong>
      <small>{note}</small>
    </div>
  );
}
function Criticality({ value }: { value: string }) {
  return (
    <span className={`criticality ${value}`}>
      <span className="tiny-dot" />
      {value}
    </span>
  );
}
function Confirm({
  value,
  onClose,
  onError,
}: {
  value: Confirmation;
  onClose: () => void;
  onError: (e: unknown) => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <Modal title={value.title} onClose={onClose}>
      <p>{value.description}</p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <footer className="modal-footer">
        <button className="secondary" onClick={onClose}>
          Cancel
        </button>
        <button
          className={value.label.startsWith("Delete") ? "danger" : "primary"}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await value.run();
              onClose();
            } catch (e) {
              if (String(e).includes("LOCKED")) onError(e);
              else setError(String(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Working…" : value.label}
        </button>
      </footer>
    </Modal>
  );
}
function Detail({
  data,
  component: c,
  onClose,
  onEdit,
  onDelete,
  onLaunch,
  onSelect,
  onNavigate,
}: {
  data: Inventory;
  component: Component;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onLaunch: () => void;
  onSelect: (id: string) => void;
  onNavigate: (id: string) => void;
}) {
  const t = typeOf(data, c),
    action = actionOf(data, c),
    env = data.environments.find((e) => e.id === c.environment_id);
  const [preview, setPreview] = useState("");
  useEffect(() => {
    let disposed = false;
    setPreview("");
    api
      .preview(c.id)
      .then((s) => {
        if (!disposed) setPreview(s);
      })
      .catch((e) => {
        if (!disposed) setPreview(String(e));
      });
    return () => {
      disposed = true;
    };
  }, [c, data.revision]);
  const rels = data.relationships.filter(
    (r) => r.source_component_id === c.id || r.target_component_id === c.id,
  );
  return (
    <aside className="detail-panel" aria-label="Component details">
      <div className="detail-top">
        <span className="eyebrow">COMPONENT DETAILS</span>
        <button
          className="icon-button"
          aria-label="Close details"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </div>
      <div className="detail-scroll">
        <span
          className="detail-icon"
          style={{ color: t.color, background: `${t.color}15` }}
        >
          <Icon name={t.icon} size={29} />
        </span>
        <h2>{c.name}</h2>
        <div className="detail-meta">
          <span style={{ color: t.color }}>{t.name}</span>
          <span>·</span>
          <button onClick={() => onNavigate(c.environment_id)}>
            {env?.name}
            <ArrowUpRight size={12} />
          </button>
        </div>
        <div className="detail-badges">
          <Criticality value={criticalityOf(c)} />
          {c.properties.internet_facing === true && (
            <span className="public-badge">
              <Globe2 size={12} />
              Internet-facing
            </span>
          )}
        </div>
        <div className="detail-actions">
          <button
            className="primary"
            disabled={
              !action || ["none", "custom_command"].includes(action.action_type)
            }
            onClick={onLaunch}
          >
            {action?.action_type === "ssh_terminal" ? (
              <Terminal size={16} />
            ) : (
              <ExternalLink size={16} />
            )}{" "}
            {action?.action_type === "ssh_terminal"
              ? "Open terminal"
              : action?.action_type === "open_url"
                ? "Open in browser"
                : "No launch action"}
          </button>
          <button
            className="secondary"
            aria-label="Edit component"
            onClick={onEdit}
          >
            <Pencil size={16} />
          </button>
        </div>
        {action && action.action_type !== "none" && (
          <code className="launch-preview">
            {preview || "Resolving action…"}
          </code>
        )}
        <div className="section-label">PROPERTIES</div>
        <dl className="properties">
          {Object.entries(c.properties)
            .filter(
              ([k]) => !["notes", "criticality", "internet_facing"].includes(k),
            )
            .map(([key, value]) => (
              <div key={key}>
                <dt>
                  {t.fields.find((f) => f.key === key)?.label ||
                    key.replaceAll("_", " ")}
                </dt>
                <dd>
                  {value === null
                    ? "Not set"
                    : typeof value === "boolean"
                      ? value
                        ? "Yes"
                        : "No"
                      : String(value)}
                </dd>
              </div>
            ))}
        </dl>
        {c.properties.notes && (
          <>
            <div className="section-label">NOTES & RUNBOOK</div>
            <div className="notes">{String(c.properties.notes)}</div>
          </>
        )}
        <div className="section-heading">
          <span className="section-label">RELATIONSHIPS</span>
          <span className="count-badge">{rels.length}</span>
        </div>
        <div className="detail-relations">
          {rels.map((r) => {
            const outgoing = r.source_component_id === c.id,
              other = data.components.find(
                (x) =>
                  x.id ===
                  (outgoing ? r.target_component_id : r.source_component_id),
              );
            if (!other) return null;
            const cross = other.environment_id !== c.environment_id;
            return (
              <button key={r.id} onClick={() => onSelect(other.id)}>
                <span
                  className={
                    cross ? "relationship-icon cross" : "relationship-icon"
                  }
                >
                  <Link2 size={15} />
                </span>
                <span>
                  <small>
                    {outgoing ? "→" : "←"}{" "}
                    {r.label || r.relation_type.replaceAll("_", " ")}
                  </small>
                  <strong>{other.name}</strong>
                  {cross && (
                    <small className="accent">
                      {
                        data.environments.find(
                          (e) => e.id === other.environment_id,
                        )?.name
                      }{" "}
                      ↗
                    </small>
                  )}
                </span>
                <ChevronRight size={14} />
              </button>
            );
          })}
          {!rels.length && (
            <p className="subtle">
              No relationships yet. Edit this component to connect it to
              another.
            </p>
          )}
        </div>
        <div className="updated-at">
          Last edited{" "}
          {c.updated_at
            ? new Date(c.updated_at).toLocaleDateString()
            : "not recorded"}
        </div>
        <button className="text-button danger-subtle" onClick={onDelete}>
          <Trash2 size={14} />
          Delete component
        </button>
      </div>
    </aside>
  );
}
