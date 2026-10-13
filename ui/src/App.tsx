import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type FormEvent,
} from "react";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  CheckCheck,
  ChevronRight,
  CircleHelp,
  Database,
  FlaskConical,
  FolderOpen,
  GitBranch,
  History,
  Layers3,
  LayoutDashboard,
  Link2,
  Loader2,
  MessageSquare,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import {
  api,
  apiFetch,
  setToken,
  date,
  pretty,
  argv,
  episode,
  type Row,
  type AppState,
} from "./api";

type Modal = {
  kind: string;
  id?: string;
  row?: Row;
  revision?: string;
  task?: Row;
  candidate?: Row;
  readiness?: Row;
  split?: string;
};
type Props = {
  data: AppState;
  run: (action: string, payload?: Row, message?: string) => Promise<Row | null>;
  open: (modal: Modal) => void;
  refresh: () => Promise<void>;
  busy: boolean;
};
const statusNames: Record<string, string> = {
  blocked: "Preparación pendiente",
  pending: "Sin valorar",
  correct: "Correcta",
  incorrect: "Incorrecta",
  queued: "En cola",
  running: "En curso",
  succeeded: "Completado",
  completed: "Completado",
  cancelled: "Cancelado",
  failed: "Falló",
  interrupted: "Interrumpido",
  proposed: "Propuesto",
  evaluating: "En evaluación",
  evaluated: "Evaluado",
  passed: "Mejora demostrada",
  discarded: "Descartado",
  stale: "Reevaluar",
  inconclusive: "No concluyente",
  accepted: "Adoptado",
  active: "Activo",
  promoted: "Adoptado",
  unknown: "Sin cierre detectado",
  suggested: "Cierre detectado",
};
const vocabulary: Record<string, string> = {
  rule: "Regla",
  skill: "Skill",
  tool: "Herramienta",
  domain: "Dominio",
  project: "Proyecto",
  general: "General",
  origin: "Origen",
  holdout: "Transferencia",
  regression: "Regresión",
};
const term = (value: string) => vocabulary[value] || value;
function Status({ value }: { value: string }) {
  return (
    <Badge
      variant="outline"
      className={
        "pill " +
        ([
          "passed",
          "succeeded",
          "accepted",
          "active",
          "correct",
          "promoted",
          "completed",
        ].includes(value)
          ? "good"
          : ["failed", "incorrect", "discarded"].includes(value)
            ? "bad"
            : ["pending", "inconclusive", "stale", "interrupted"].includes(
                  value,
                )
              ? "warn"
              : ["running", "evaluating", "queued"].includes(value)
                ? "purple"
                : "")
      }
    >
      {statusNames[value] || value}
    </Badge>
  );
}
function TasksStatus({ task }: { task: Row }) {
  return (
    <div className="btn-wrap">
      <span className={"pill " + (task.completed ? "good" : "warn")}>
        {task.completed ? "Completada" : "Sin completar"}
      </span>
      {task.completed && <Status value={task.label} />}
      {task.proposal && !task.completed && (
        <span className="pill purple">Propuesta</span>
      )}
    </div>
  );
}
function Panel({
  title,
  caption,
  action,
  children,
  className = "",
}: {
  title?: string;
  caption?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={"panel gap-0 py-0 " + className}>
      {title && (
        <div className="panel-heading">
          <div>
            <h2 className="text-sm font-semibold">{title}</h2>
            {caption && <p className="meta mt-1">{caption}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </Card>
  );
}
function Heading({ title, actions }: { title: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
      <h1 className="page-title">{title}</h1>
      {actions && <div className="btn-wrap">{actions}</div>}
    </div>
  );
}
function Empty({
  title,
  text,
  action,
}: {
  title: string;
  text: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Layers3 size={20} />
      </div>
      <h3 className="text-sm font-medium mb-2">{title}</h3>
      <p className="muted text-xs leading-6 mb-5">{text}</p>
      {action}
    </div>
  );
}
function Notice({
  children,
  tone = "",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return <div className={"notice " + tone}>{children}</div>;
}
function Code({ value }: { value: any }) {
  return (
    <pre className="code-block">
      {typeof value === "string" ? value : pretty(value)}
    </pre>
  );
}
function Field({
  label,
  name,
  initial = "",
  hint,
  type = "text",
  required = false,
  children,
}: {
  label: string;
  name?: string;
  initial?: any;
  hint?: string;
  type?: string;
  required?: boolean;
  children?: ReactNode;
}) {
  const id = "field-" + (name || label.replace(/\W/g, ""));
  return (
    <div>
      <label className="form-label" htmlFor={id}>
        {label}
      </label>
      {children ||
        (type === "textarea" ? (
          <Textarea
            id={id}
            name={name}
            defaultValue={initial}
            required={required}
            aria-describedby={hint ? id + "-hint" : undefined}
            rows={4}
          />
        ) : (
          <Input
            id={id}
            name={name}
            type={type}
            step={type === "number" ? "any" : undefined}
            defaultValue={initial}
            required={required}
            aria-describedby={hint ? id + "-hint" : undefined}
          />
        ))}
      {hint && (
        <p id={id + "-hint"} className="form-help">
          {hint}
        </p>
      )}
    </div>
  );
}
function Choice({
  label,
  name,
  initial,
  options,
  disabled = false,
  hint,
}: {
  label: string;
  name: string;
  initial?: string;
  options: [string, string][];
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <Field label={label} name={name} hint={hint}>
      <select
        id={"field-" + name}
        className="native-select"
        name={name}
        defaultValue={initial}
        disabled={disabled}
        aria-describedby={hint ? "field-" + name + "-hint" : undefined}
      >
        {options.map(([value, text]) => (
          <option value={value} key={value}>
            {text}
          </option>
        ))}
      </select>
    </Field>
  );
}
function Form({
  onSave,
  children,
  className = "field-group",
}: {
  onSave: (values: Row, form: FormData) => Promise<any>;
  children: ReactNode;
  className?: string;
}) {
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (saving) return;
    const fd = new FormData(e.currentTarget);
    setSaving(true);
    setError("");
    try {
      await onSave(Object.fromEntries(fd), fd);
    } catch (e) {
      setError(String((e as Error).message));
    } finally {
      setSaving(false);
    }
  }
  return (
    <form onSubmit={submit} className={className}>
      {error && <Notice tone="error">{error}</Notice>}
      <fieldset disabled={saving} className="contents">
        {children}
      </fieldset>
      {saving && (
        <span className="flex gap-2 text-xs muted">
          <Loader2 size={14} className="animate-spin" />
          Guardando…
        </span>
      )}
    </form>
  );
}
function Paginator({
  page,
  setPage,
  total,
  size = 20,
}: {
  page: number;
  setPage: (n: number) => void;
  total: number;
  size?: number;
}) {
  const pages = Math.max(1, Math.ceil(total / size));
  return (
    <div className="pagination">
      <span>
        {total} resultados · página {Math.min(page + 1, pages)} de {pages}
      </span>
      <div className="flex gap-1">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Página anterior"
          disabled={!page}
          onClick={() => setPage(page - 1)}
        >
          <ArrowLeft />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Página siguiente"
          disabled={page + 1 >= pages}
          onClick={() => setPage(page + 1)}
        >
          <ArrowRight />
        </Button>
      </div>
    </div>
  );
}
function active(data: AppState, id: string) {
  return !!data.versions
    .find((v) => v.id === data.active_version)
    ?.members?.some(
      (m: Row | string) => (typeof m === "string" ? m : m.candidate_id) === id,
    );
}
function JobRows({
  data,
  run,
  open,
}: Pick<Props, "data" | "run"> & { open?: Props["open"] }) {
  return (
    <div>
      {data.jobs.slice(0, 12).map((j) => {
        const progress =
          typeof j.progress === "object" && j.progress ? j.progress : {};
        const detail =
          j.error ||
          (j.status === "succeeded"
            ? "Finalizado · " + date(j.updated)
            : typeof j.progress === "string"
              ? j.progress
              : progress.message ||
                progress.phase ||
                progress.status ||
                (j.status === "blocked"
                  ? "Faltan requisitos antes de evaluar."
                  : ""));
        const candidate = data.candidates.find(
          (c) =>
            c.id ===
            (j.subject ||
              j.target_id ||
              j.target ||
              progress.readiness?.candidate_id),
        );
        return (
          <div
            key={j.id}
            className="flex justify-between gap-3 px-5 py-4 border-b border-border last:border-0"
          >
            <div className="min-w-0">
              <div className="text-xs font-medium mb-1">
                {(
                  {
                    scan: "Capturar conversaciones",
                    propose_tasks: "Proponer tareas de una conversación",
                    derive: "Extraer aprendizaje",
                    evaluate: "Evaluar candidato",
                    case: "Validar caso reproducible",
                    example: "Preparar ejemplo HTTP",
                  } as Row
                )[j.kind] || j.kind}
              </div>
              <p className="meta break-words line-clamp-3">{detail}</p>
            </div>
            <div className="flex flex-col items-end gap-2 shrink-0">
              <Status value={j.status} />
              {["queued", "running"].includes(j.status) ? (
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() =>
                    run("job.cancel", { id: j.id }, "Cancelación solicitada.")
                  }
                >
                  Cancelar
                </Button>
              ) : j.status === "blocked" ? (
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() =>
                    open?.(
                      candidate
                        ? { kind: "candidate", row: candidate }
                        : { kind: "page", id: "learning" },
                    )
                  }
                >
                  Preparar
                </Button>
              ) : (
                ["failed", "interrupted", "cancelled"].includes(j.status) && (
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() =>
                      run(
                        "job.retry",
                        { id: j.id },
                        "Solicitud de reintento procesada.",
                      )
                    }
                  >
                    Reintentar
                  </Button>
                )
              )}
              {j.kind === "propose_tasks" && j.status === "succeeded" && (
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() =>
                    open?.({
                      kind: "session",
                      id: j.subject,
                      revision: j.payload?.expected_revision,
                    })
                  }
                >
                  Revisar tareas
                </Button>
              )}
            </div>
          </div>
        );
      })}
      {!data.jobs.length && (
        <Empty
          title="Sin trabajos pendientes"
          text="Las capturas y evaluaciones aparecerán aquí con su progreso."
        />
      )}
    </div>
  );
}

function SessionTable({
  rows,
  data,
  open,
  onTasks,
}: {
  rows: Row[];
  data: AppState;
  open: Props["open"];
  onTasks?: (s: Row) => void;
}) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>Conversación</th>
            <th>Última actividad</th>
            <th>Tareas</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.id}>
              <td className="max-w-[460px]">
                <div className="text-[13px] font-medium line-clamp-2 mb-1">
                  {s.title}
                </div>
                <div className="meta truncate" title={s.path}>
                  {data.sources.find((x) => x.id === s.source_id)?.adapter} ·{" "}
                  {String(s.path || "")
                    .split(/[\\/]/)
                    .pop()}
                </div>
                <div className="meta">
                  ID {s.id.slice(-8)} · captura{" "}
                  {date(s.captured_at || s.updated)}
                </div>
              </td>
              <td className="whitespace-nowrap text-xs muted">
                {date(s.activity_at || s.updated)}
              </td>
              <td>
                <span className="pill">
                  {s.task_count ??
                    data.episodes.filter((e) => e.session_id === s.id).length}
                </span>
              </td>
              <td>
                <div className="btn-wrap table-actions">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => open({ kind: "session", id: s.id })}
                  >
                    Organizar tareas
                  </Button>
                  {onTasks && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onTasks(s)}
                    >
                      Ver tareas
                    </Button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function Dashboard(p: Props) {
  const { data, open, run } = p;
  const accepted =
    data.versions.find((v) => v.id === data.active_version)?.members?.length ||
    0;
  return (
    <>
      <Heading
        title="Resumen"
        actions={
          <Button onClick={() => open({ kind: "source" })}>
            <Plus />
            Conectar fuente
          </Button>
        }
      />
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        {[
          [
            MessageSquare,
            "Conversaciones",
            data.total_sessions || data.sessions.length,
          ],
          [
            CheckCheck,
            "Tareas completadas",
            data.episodes.filter((e) => e.completed).length,
          ],
          [Sparkles, "Aprendizajes", data.candidates.length],
          [GitBranch, "Mejoras activas", accepted],
        ].map(([Icon, label, note]: any) => (
          <div className="stat-card" key={label}>
            <div className="flex justify-between items-center muted text-xs">
              {label}
              <Icon size={16} className="text-violet-400" />
            </div>
            <div className="stat-number">{note}</div>
          </div>
        ))}
      </div>
      <div className="grid xl:grid-cols-[1.6fr_1fr] gap-5">
        <div className="space-y-5">
          <Panel
            title="Conversaciones recientes"
            action={
              <Button
                variant="ghost"
                size="sm"
                onClick={() => open({ kind: "page", id: "conversations" })}
              >
                Ver todas
                <ArrowUpRight />
              </Button>
            }
          >
            {data.sessions.length ? (
              <SessionTable
                rows={data.sessions.slice(0, 5)}
                data={data}
                open={open}
              />
            ) : (
              <Empty
                title="Sin conversaciones"
                text="Conecta una carpeta de sesiones para empezar."
                action={
                  <Button onClick={() => open({ kind: "source" })}>
                    Conectar fuente
                  </Button>
                }
              />
            )}
          </Panel>
          <Panel>
            <div className="panel-content flex items-center gap-5">
              <div className="hidden sm:grid size-12 place-items-center rounded-xl bg-violet-500/10 text-violet-400">
                <FlaskConical />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-semibold mb-1">Ejemplo HTTP</h3>
              </div>
              <Button
                variant="outline"
                onClick={() =>
                  run("example", {}, "Preparación del ejemplo en cola.")
                }
              >
                Preparar ejemplo
              </Button>
            </div>
          </Panel>
        </div>
        <Panel title="Actividad">
          <JobRows data={data} run={run} open={open} />
        </Panel>
      </div>
    </>
  );
}
function Conversations(p: Props) {
  const [query, setQuery] = useState(""),
    [period, setPeriod] = useState("all"),
    [source, setSource] = useState(""),
    [page, setPage] = useState(0),
    [taskPage, setTaskPage] = useState(0),
    [filter, setFilter] = useState("all"),
    [selected, setSelected] = useState<Row | null>(null),
    [tasks, setTasks] = useState<Row[]>([]),
    [tab, setTab] = useState("sessions"),
    [error, setError] = useState("");
  const { data, open } = p;
  const today = new Date();
  const boundary =
    new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() /
    1000;
  const rows = data.sessions.filter((s) => {
    const t = s.activity_at || s.updated;
    return (
      (!query ||
        (s.title + " " + s.path + " " + s.id)
          .toLowerCase()
          .includes(query.toLowerCase())) &&
      (!source || source === s.source_id) &&
      (period === "all" ||
        (period === "today" && t >= boundary) ||
        (period === "yesterday" && t >= boundary - 86400 && t < boundary) ||
        (period === "week" && t >= boundary - 6 * 86400))
    );
  });
  const allTasks = selected
    ? tasks.map((t) => data.episodes.find((e) => e.id === t.id) || t)
    : data.episodes;
  const shownTasks = allTasks.filter(
    (e) =>
      filter === "all" ||
      (filter === "incomplete" && !e.completed) ||
      (filter === "pending" && e.completed && e.label === "pending") ||
      e.label === filter,
  );
  const cp = Math.min(page, Math.max(0, Math.ceil(rows.length / 25) - 1)),
    tp = Math.min(taskPage, Math.max(0, Math.ceil(shownTasks.length / 20) - 1));
  async function loadTasks(s: Row) {
    setError("");
    try {
      const result = await api(
        "/api/episodes?session_id=" + encodeURIComponent(s.id),
      );
      setTasks(result.episodes.map(episode));
      setSelected(s);
      setTab("tasks");
      setTaskPage(0);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <>
      <Heading
        title="Conversaciones y tareas"
        actions={
          <Button
            variant="outline"
            disabled={!p.data.config.capture}
            onClick={() => p.run("scan", {}, "Captura solicitada.")}
          >
            <RefreshCw />
            Capturar ahora
          </Button>
        }
      />
      {error && <Notice tone="error">{error}</Notice>}
      <Tabs value={tab} onValueChange={(v) => setTab(String(v))}>
        <TabsList className="mb-5">
          <TabsTrigger value="sessions">
            <MessageSquare size={14} />
            Conversaciones{" "}
            <span className="ml-1 opacity-50">
              {data.total_sessions || data.sessions.length}
            </span>
          </TabsTrigger>
          <TabsTrigger value="tasks">
            <CheckCheck size={14} />
            Tareas <span className="ml-1 opacity-50">{allTasks.length}</span>
          </TabsTrigger>
        </TabsList>
        <TabsContent value="sessions">
          <div className="flex flex-wrap gap-3 mb-4">
            <div className="relative min-w-[220px] flex-1">
              <Search
                size={15}
                className="absolute top-2.5 left-3 text-zinc-500"
              />
              <Input
                className="pl-9"
                aria-label="Buscar conversación"
                placeholder="Buscar por título, archivo o ID…"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(0);
                }}
              />
            </div>
            <select
              className="native-select !w-auto"
              aria-label="Fecha de actividad"
              value={period}
              onChange={(e) => {
                setPeriod(e.target.value);
                setPage(0);
              }}
            >
              <option value="all">Cualquier fecha</option>
              <option value="today">Hoy</option>
              <option value="yesterday">Ayer</option>
              <option value="week">Últimos 7 días</option>
            </select>
            <select
              className="native-select !w-auto max-w-[260px]"
              aria-label="Fuente"
              value={source}
              onChange={(e) => {
                setSource(e.target.value);
                setPage(0);
              }}
            >
              <option value="">Todas las fuentes</option>
              {data.sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.adapter} · {s.path.split("/").slice(-2).join("/")}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <p className="meta">
              Actividad original ·{" "}
              {Intl.DateTimeFormat().resolvedOptions().timeZone}
            </p>
            <div className="btn-wrap">
              <Button
                variant={period === "today" ? "secondary" : "ghost"}
                size="xs"
                onClick={() => {
                  setPeriod("today");
                  setPage(0);
                }}
              >
                Hoy
              </Button>
              <Button
                variant={period === "yesterday" ? "secondary" : "ghost"}
                size="xs"
                onClick={() => {
                  setPeriod("yesterday");
                  setPage(0);
                }}
              >
                Ayer
              </Button>
              <Button
                variant="ghost"
                size="xs"
                onClick={() => {
                  setQuery("");
                  setPeriod("all");
                  setSource("");
                  setPage(0);
                }}
              >
                Quitar filtros
              </Button>
            </div>
          </div>
          {(data.total_sessions || 0) > data.sessions.length && (
            <div className="mb-4">
              <Notice tone="warning">
                Mostrando las {data.sessions.length} conversaciones más
                recientes de {data.total_sessions}. Los filtros se aplican a
                esta selección.
              </Notice>
            </div>
          )}
          <Panel>
            {rows.length ? (
              <>
                <SessionTable
                  rows={rows.slice(cp * 25, (cp + 1) * 25)}
                  data={data}
                  open={open}
                  onTasks={loadTasks}
                />
                <Paginator
                  page={cp}
                  setPage={setPage}
                  total={rows.length}
                  size={25}
                />
              </>
            ) : (
              <Empty
                title={
                  data.sessions.length
                    ? "Sin coincidencias"
                    : "Sin conversaciones"
                }
                text={
                  data.sessions.length
                    ? "Prueba otros filtros."
                    : "Conecta una fuente y captura sus sesiones."
                }
                action={
                  data.sessions.length ? (
                    <Button
                      variant="outline"
                      onClick={() => {
                        setQuery("");
                        setPeriod("all");
                        setSource("");
                      }}
                    >
                      Quitar filtros
                    </Button>
                  ) : (
                    <Button
                      onClick={() => open({ kind: "page", id: "sources" })}
                    >
                      Ver fuentes
                    </Button>
                  )
                }
              />
            )}
          </Panel>
        </TabsContent>
        <TabsContent value="tasks">
          {selected && (
            <div className="flex items-center justify-between gap-3 mb-4">
              <p className="text-xs muted max-w-[650px] line-clamp-2">
                {selected.title}
              </p>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelected(null)}
              >
                Todas las conversaciones
                <X size={13} />
              </Button>
            </div>
          )}
          <div className="btn-wrap mb-4">
            {[
              ["all", "Todas"],
              ["incomplete", "Sin completar"],
              ["pending", "Sin valorar"],
              ["correct", "Correctas"],
              ["incorrect", "Incorrectas"],
            ].map(([value, label]) => (
              <Button
                key={value}
                variant={filter === value ? "secondary" : "ghost"}
                size="sm"
                onClick={() => {
                  setFilter(value);
                  setTaskPage(0);
                }}
              >
                {label}
              </Button>
            ))}
          </div>
          <Panel>
            {shownTasks.length ? (
              <>
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Tarea</th>
                        <th>Estado</th>
                        <th>Casos</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {shownTasks.slice(tp * 20, (tp + 1) * 20).map((e) => (
                        <tr key={e.id}>
                          <td className="max-w-[440px]">
                            <div className="font-medium line-clamp-2 mb-1">
                              {e.title}
                            </div>
                            <span className="meta">
                              Eventos {e.first_event}–{e.last_event} ·{" "}
                              {e.revision.slice(-8)}
                            </span>
                          </td>
                          <td>
                            <TasksStatus task={e} />
                          </td>
                          <td>{(e.cases || []).length}</td>
                          <td>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                open({ kind: "task", row: episode(e) })
                              }
                            >
                              Revisar tarea
                              <ChevronRight />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Paginator
                  page={tp}
                  setPage={setTaskPage}
                  total={shownTasks.length}
                />
              </>
            ) : (
              <Empty
                title="Sin tareas"
                text="Abre una conversación para proponer o crear tareas."
                action={
                  <Button variant="outline" onClick={() => setTab("sessions")}>
                    Ver conversaciones
                  </Button>
                }
              />
            )}
          </Panel>
        </TabsContent>
      </Tabs>
    </>
  );
}
function Sources(p: Props) {
  const c = p.data.capture_status || {};
  return (
    <>
      <Heading
        title="Fuentes conectadas"
        actions={
          <>
            <Button variant="outline" onClick={() => p.run("source.discover", {}, "Fuentes detectadas en este equipo.")}>
              <Search /> Detectar fuentes
            </Button>
            <Button
              variant="outline"
              disabled={!p.data.config.capture}
              onClick={() => p.run("scan", {}, "Captura solicitada.")}
            >
              <RefreshCw />
              Escanear ahora
            </Button>
            <Button onClick={() => p.open({ kind: "source" })}>
              <Plus />
              Añadir fuente
            </Button>
          </>
        }
      />
      <div className="grid lg:grid-cols-[1.6fr_1fr] gap-5">
        <Panel
          title="Carpetas y archivos"
          caption={`${p.data.sources.length} fuentes registradas`}
        >
          {p.data.sources.length ? (
            p.data.sources.map((s) => (
              <div
                className="flex items-start gap-4 justify-between p-5 border-b last:border-0"
                key={s.id}
              >
                <div className="flex gap-3 min-w-0">
                  <FolderOpen
                    size={18}
                    className="text-violet-400 shrink-0 mt-0.5"
                  />
                  <div>
                    <div className="font-medium text-xs break-all mb-1">
                      {s.path}
                    </div>
                    <p className="meta">
                      {s.adapter} · {date(s.created)}
                    </p>
                    {s.error && (
                      <p className="text-xs text-rose-400 mt-2 break-words">
                        {s.error === "source_byte_limit"
                          ? "Archivo mayor que el límite configurado. Aumenta Tamaño máximo de fuente."
                          : s.error}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <Button variant="ghost" size="sm" onClick={() => p.open({kind: "source", row: s})} aria-label={"Cambiar ruta de " + s.path}>
                    <FolderOpen /> Cambiar ruta
                  </Button>
                  <Status value={s.enabled ? "active" : "Pausada"} />
                  <Switch
                    checked={!!s.enabled}
                    aria-label={(s.enabled ? "Pausar " : "Activar ") + s.path}
                    onCheckedChange={(enabled) =>
                      p.run(
                        "source.toggle",
                        { id: s.id, enabled },
                        "Fuente actualizada.",
                      )
                    }
                  />
                </div>
              </div>
            ))
          ) : (
            <Empty
              title="Sin fuentes"
              text="Admite Codex, Claude Code, Pi, OMP y archivos JSONL canónicos."
              action={
                <Button onClick={() => p.open({ kind: "source" })}>
                  Añadir fuente
                </Button>
              }
            />
          )}
        </Panel>
        <div className="space-y-5">
          <Panel title="Última captura">
            <div className="panel-content">
              <div className="grid grid-cols-3 gap-3 mb-5">
                {[
                  ["Archivos", c.files || 0],
                  ["Cambios", c.changed || 0],
                  ["Errores", c.errors || 0],
                ].map(([l, v]) => (
                  <div key={l} className="rounded-lg border p-3">
                    <div className="meta">{l}</div>
                    <div className="text-xl mt-2">{v}</div>
                  </div>
                ))}
              </div>
              {c.limited && (
                <Notice tone="warning">
                  Se alcanzó el presupuesto de tiempo o archivos. Puedes ampliar
                  los límites en Configuración.
                </Notice>
              )}
              {c.error && <Notice tone="error">{c.error}</Notice>}
              {(c.issues || []).slice(0, 20).map((i: Row, n: number) => (
                <div className="border-t pt-3 mt-3" key={n}>
                  <p className="text-xs break-all">{i.file_name || "Fuente"}</p>
                  <p className="meta">
                    {i.reason === "source_byte_limit"
                      ? "Archivo excede el límite configurado; aumenta Tamaño máximo de fuente."
                      : i.reason === "source_changed_retryable"
                        ? "El archivo sigue creciendo; se reintentará la captura."
                        : i.reason === "source_unavailable"
                          ? "La fuente no está disponible."
                          : "No se pudo capturar este registro. Revisa el archivo y su formato."}
                  </p>
                </div>
              ))}
              {(c.issues || []).length > 20 && (
                <p className="meta mt-3">
                  Se muestran 20 de {c.issues.length} incidencias.
                </p>
              )}
            </div>
          </Panel>
          {!p.data.config.capture && (
            <Notice tone="warning">
              Captura pausada.
              <Button
                variant="link"
                size="sm"
                onClick={() => p.open({ kind: "page", id: "settings" })}
              >
                Activar en Configuración
              </Button>
            </Notice>
          )}
        </div>
      </div>
    </>
  );
}
function Learning(p: Props) {
  return (
    <>
      <Heading title="Aprendizajes" />
      <div className="grid xl:grid-cols-[1.6fr_1fr] gap-5">
        <Panel title="Propuestas">
          {p.data.candidates.length ? (
            <div>
              {p.data.candidates.map((c) => (
                <div key={c.id} className="p-5 border-b last:border-0">
                  <div className="flex justify-between gap-4">
                    <div className="min-w-0">
                      <div className="btn-wrap mb-3">
                        <Status value={c.status} />
                        <span className="pill">{term(c.spec.kind)}</span>
                        <span className="pill">{c.spec.domain}</span>
                        {active(p.data, c.id) && (
                          <span className="pill good">En el arnés activo</span>
                        )}
                      </div>
                      <h3 className="text-sm font-medium mb-2">
                        {c.spec.name || c.spec.title}
                      </h3>
                      <p className="text-xs muted leading-6 line-clamp-3">
                        {c.spec.description || c.spec.rationale}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => p.open({ kind: "candidate", row: c })}
                    >
                      Inspeccionar
                      <ArrowUpRight />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <Empty
              title="Sin aprendizajes"
              text="Completa y valora una tarea para extraer un aprendizaje."
              action={
                <Button
                  variant="outline"
                  onClick={() => p.open({ kind: "page", id: "conversations" })}
                >
                  Revisar tareas
                </Button>
              }
            />
          )}
        </Panel>
        <div className="space-y-5">
          <Panel title="Versiones del arnés">
            {p.data.versions.map((v) => (
              <div
                key={v.id}
                className="p-5 border-b last:border-0 flex justify-between items-start gap-3"
              >
                <div>
                  <h3 className="text-xs font-medium mb-2">
                    {v.id === "initial" ? "Arnés inicial" : v.id}
                  </h3>
                  <p className="meta">
                    {v.members?.length || 0} capacidades · {date(v.created)}
                  </p>
                  <p className="meta mt-1">{v.reason}</p>
                </div>
                {p.data.active_version === v.id ? (
                  <Status value="active" />
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      p.run(
                        "rollback",
                        { version_id: v.id },
                        "Versión restaurada; historial conservado.",
                      )
                    }
                  >
                    <History />
                    Restaurar
                  </Button>
                )}
              </div>
            ))}
          </Panel>
        </div>
      </div>
    </>
  );
}
function Experiments(p: Props) {
  return (
    <>
      <Heading
        title="Experimentos"
        actions={
          <Button onClick={() => p.open({ kind: "case-create" })}>
            <Plus />
            Crear caso
          </Button>
        }
      />
      <div className="grid xl:grid-cols-[1.7fr_1fr] gap-5">
        <div className="space-y-5">
          <Panel
            title="Experimentos"
            caption={`${p.data.experiments.length} comparaciones registradas`}
          >
            {p.data.experiments.length ? (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Aprendizaje</th>
                      <th>Estado</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {p.data.experiments.map((e) => (
                      <tr key={e.id}>
                        <td>
                          <div className="font-medium mb-1">
                            {p.data.candidates.find(
                              (c) => c.id === e.candidate_id,
                            )?.spec?.name || e.candidate_id}
                          </div>
                          <div className="meta">{date(e.created)}</div>
                        </td>
                        <td>
                          <Status value={e.status} />
                        </td>
                        <td>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              p.open({ kind: "experiment", row: e })
                            }
                          >
                            Ver resultados
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty
                title="Sin experimentos"
                text="Abre un aprendizaje para preparar su evaluación."
                action={
                  <Button
                    variant="outline"
                    onClick={() => p.open({ kind: "page", id: "learning" })}
                  >
                    Ver aprendizajes
                  </Button>
                }
              />
            )}
          </Panel>
          <Panel title="Actividad y trabajos">
            <JobRows data={p.data} run={p.run} open={p.open} />
          </Panel>
        </div>
        <Panel
          title="Casos reproducibles"
          caption={`${p.data.cases.length} snapshots verificados`}
        >
          {p.data.cases.length ? (
            p.data.cases.map((c) => (
              <div
                key={c.id}
                className="p-5 border-b last:border-0 flex justify-between gap-3"
              >
                <div>
                  <h3 className="text-xs font-medium leading-5 mb-2">
                    {c.title}
                  </h3>
                  <div className="btn-wrap">
                    <span className="pill">{term(c.split)}</span>
                    <span className="meta">{c.domain}</span>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => p.open({ kind: "case", row: c })}
                >
                  Ver
                </Button>
              </div>
            ))
          ) : (
            <Empty
              title="Sin casos"
              text="Añade un proyecto inicial y sus verificadores."
            />
          )}
        </Panel>
      </div>
    </>
  );
}
function AgentSettings({ name, config }: { name: string; config: Row }) {
  const [kind, setKind] = useState(
    config?.kind || (name === "provider" ? "pi" : "codex"),
  );
  const [command, setCommand] = useState(
    JSON.stringify(config?.command || [kind === "pi" ? "pi" : "codex"]),
  );
  const [model, setModel] = useState(
    config?.model || (kind === "pi" ? "gpt-6.1-sol" : ""),
  );
  const [provider, setProvider] = useState(
    config?.provider || (kind === "pi" ? "openai-codex" : ""),
  );
  return (
    <div className="step-section">
      <h3 className="text-sm font-semibold mb-2">
        {name === "provider" ? "Agente de análisis" : "Agente de evaluación"}
      </h3>
      <div className="grid md:grid-cols-2 gap-4">
        <Field name={name + "_kind"} label="Agente">
          <select
            id={"field-" + name + "_kind"}
            className="native-select"
            name={name + "_kind"}
            value={kind}
            onChange={(event) => {
              const next = event.target.value;
              setKind(next);
              if (next !== "command") {
                setCommand(JSON.stringify([next]));
                if (next === "pi") {
                  if (!model) setModel("gpt-6.1-sol");
                  if (!provider) setProvider("openai-codex");
                }
              }
            }}
          >
            <option value="pi">Pi</option>
            <option value="codex">Codex CLI</option>
            <option value="command">Comando externo</option>
          </select>
        </Field>
        <Field name={name + "_model"} label="Modelo">
          <Input
            id={"field-" + name + "_model"}
            name={name + "_model"}
            value={model}
            onChange={(event) => setModel(event.target.value)}
            placeholder="gpt-6.1-sol"
          />
        </Field>
        <Choice
          name={name + "_reasoning"}
          label="Razonamiento (Pi)"
          initial={config?.reasoning || "medium"}
          disabled={kind !== "pi"}
          options={[
            ["off", "Desactivado"],
            ["minimal", "Mínimo"],
            ["low", "Bajo"],
            ["medium", "Medio"],
            ["high", "Alto"],
            ["xhigh", "Muy alto"],
            ["max", "Máximo"],
          ]}
        />
        <Field
          name={name + "_provider"}
          label="Proveedor de Pi"
          hint={kind === "pi" ? "Autentica tu cuenta en Pi." : undefined}
        >
          <Input
            id={"field-" + name + "_provider"}
            name={name + "_provider"}
            value={provider}
            onChange={(event) => setProvider(event.target.value)}
            disabled={kind !== "pi"}
          />
        </Field>
        <Field
          name={name + "_timeout"}
          label="Tiempo máximo por llamada (segundos)"
          type="number"
          initial={config?.timeout || 180}
        />
      </div>
      <details
        className="mt-3"
        open={kind === "command" ? true : undefined}
        onInvalidCapture={(event) => {
          event.currentTarget.open = true;
        }}
      >
        <summary>Comando de ejecución</summary>
        <Field
          name={name + "_command"}
          label="Argumentos JSON"
          hint="Sin shell ni claves. Autentica el agente por separado."
        >
          <Input
            name={name + "_command"}
            id={"field-" + name + "_command"}
            value={command}
            onChange={(event) => setCommand(event.target.value)}
            required
          />
        </Field>
      </details>
    </div>
  );
}
function Settings(p: Props) {
  const c = p.data.config;
  const numbers = [
    ["poll_seconds", "Intervalo de captura (segundos)"],
    [
      "task_idle_seconds",
      "Espera sin actividad para proponer tareas (segundos)",
    ],
    ["max_input_chars", "Caracteres por bloque de análisis"],
    ["max_source_bytes", "Tamaño máximo de fuente (bytes)"],
    ["max_files_per_scan", "Archivos por captura"],
    ["max_scan_seconds", "Tiempo máximo de captura (segundos)"],
    ["repetitions", "Repeticiones por caso"],
    ["max_calls", "Máximo de llamadas por experimento"],
    ["experiment_seconds", "Tiempo máximo del experimento (segundos)"],
    ["min_quality_gain", "Mejora mínima de calidad"],
    ["max_time_ratio", "Relación de tiempo máxima"],
    ["min_efficiency_gain", "Mejora mínima de eficiencia"],
  ];
  return (
    <>
      <Heading title="Configuración" />
      <div className="grid xl:grid-cols-[1.6fr_1fr] gap-5">
        <Panel title="Preferencias">
          <div className="panel-content">
            <Form
              onSave={async (v, fd) => {
                const cfg: Row = { auto_promote: false };
                for (const k of [
                  "capture",
                  "auto_tasks",
                  "auto_derive",
                  "auto_evaluate",
                ])
                  cfg[k] = fd.has(k);
                for (const [k] of numbers) cfg[k] = Number(v[k]);
                for (const k of ["provider", "replay"])
                  cfg[k] = {
                    ...c[k],
                    kind: v[k + "_kind"],
                    command: argv(v[k + "_command"]),
                    model: v[k + "_model"],
                    ...(v[k + "_kind"] === "pi"
                      ? {
                          reasoning: v[k + "_reasoning"],
                          provider:
                            v[k + "_provider"] ||
                            c[k]?.provider ||
                            "openai-codex",
                        }
                      : {}),
                    timeout: Number(v[k + "_timeout"]),
                  };
                await p.run(
                  "settings",
                  { config: cfg },
                  "Configuración guardada.",
                );
              }}
            >
              <div className="grid gap-5">
                {[
                  [
                    "capture",
                    "Captura automática",
                    "Lee periódicamente las fuentes habilitadas.",
                  ],
                  [
                    "auto_tasks",
                    "Proponer tareas automáticamente",
                    "Conversaciones nuevas o actualizadas · consume cuota.",
                  ],
                  [
                    "auto_derive",
                    "Extraer aprendizajes tras tu valoración",
                    "Tareas completadas y valoradas · consume cuota.",
                  ],
                  [
                    "auto_evaluate",
                    "Evaluar propuestas automáticamente",
                    "Con casos preparados · consume cuota.",
                  ],
                ].map(([k, t, h]) => (
                  <label
                    key={k}
                    className="flex items-start justify-between gap-5"
                  >
                    <span>
                      <strong className="text-sm font-medium">{t}</strong>
                      <span className="form-help block">{h}</span>
                    </span>
                    <Switch name={k} defaultChecked={!!c[k]} />
                  </label>
                ))}
              </div>
              {["provider", "replay"].map((k) => (
                <AgentSettings key={k} name={k} config={c[k]} />
              ))}
              <details className="disclosure">
                <summary>Límites de captura y evaluación</summary>
                <div className="grid md:grid-cols-2 gap-4">
                  {numbers.map(([k, l]) => (
                    <Field
                      key={k}
                      name={k}
                      label={l}
                      type="number"
                      initial={c[k] ?? (k === "task_idle_seconds" ? 120 : 0)}
                      hint={
                        k === "task_idle_seconds"
                          ? "Entre 15 y 86400 segundos."
                          : k === "max_source_bytes"
                            ? "Máximo admitido: 512 MB (512000000 bytes)."
                            : k === "max_input_chars"
                              ? "La evidencia completa se reparte en bloques."
                              : undefined
                      }
                    />
                  ))}
                </div>
              </details>
              <Button type="submit">Guardar configuración</Button>
            </Form>
          </div>
        </Panel>
        <div className="space-y-5">
          <Panel title="Estado del entorno">
            <div className="panel-content">
              <details>
                <summary>Ver diagnóstico</summary>
                <Code value={p.data.diagnostics} />
              </details>
            </div>
          </Panel>
          <Panel title="Respaldo">
            <div className="panel-content space-y-4">
              <p className="form-help">
                Sólo SQLite. Para un respaldo completo, copia también snapshots
                y artefactos.
              </p>
              <Button
                variant="outline"
                onClick={async () => {
                  const r = await p.run("backup", {}, "Copia creada.");
                  if (r) p.open({ kind: "info", row: r });
                }}
              >
                <Database />
                Respaldar base de datos
              </Button>
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}
function SessionEditor({ modal, p }: { modal: Modal; p: Props }) {
  const [s, setS] = useState<Row | null>(null),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(modal.revision || ""),
    [start, setStart] = useState(0),
    [end, setEnd] = useState(0),
    [title, setTitle] = useState(""),
    [page, setPage] = useState(0),
    [human, setHuman] = useState(true),
    [saved, setSaved] = useState("");
  const proposalJobs = p.data.jobs.filter(
    (j) =>
      j.kind === "propose_tasks" &&
      j.subject === modal.id &&
      (!s?.revision ||
        !j.payload?.expected_revision ||
        j.payload.expected_revision === s.revision),
  );
  const proposalBusy = proposalJobs.some((j) =>
    ["queued", "running"].includes(j.status),
  );
  const completedProposal = proposalJobs
    .filter((j) => j.status === "succeeded")
    .map((j) => j.id)
    .join(",");
  useEffect(() => {
    if (!s?.revision || !completedProposal) return;
    let current = true;
    api("/api/episodes?session_id=" + encodeURIComponent(modal.id!))
      .then((result) => {
        if (current)
          setS((previous) =>
            previous
              ? {
                  ...previous,
                  episodes: result.episodes
                    .filter((e: Row) => e.revision === previous.revision)
                    .map(episode),
                }
              : previous,
          );
      })
      .catch((e) => setError(e.message));
    return () => {
      current = false;
    };
  }, [completedProposal, s?.revision, modal.id]);
  useEffect(() => {
    let ok = true;
    setS(null);
    api(
      "/api/session?id=" +
        encodeURIComponent(modal.id!) +
        (revision ? "&revision=" + encodeURIComponent(revision) : ""),
    )
      .then((r) => {
        if (ok) {
          setS(r);
          setStart(0);
          setEnd(Math.max(0, r.events.length - 1));
          setPage(0);
        }
      })
      .catch((e) => setError(e.message));
    return () => {
      ok = false;
    };
  }, [modal.id, revision]);
  if (error) return <Notice tone="error">{error}</Notice>;
  if (!s) return <Loading />;
  const liveSession = p.data.sessions.find(
    (row) => row.id === s.id && row.revision === s.revision,
  );
  const receipt = liveSession?.task_proposal || s.task_proposal;
  const rows = s.events
    .map((e: Row, i: number) => ({ ...e, index: i }))
    .filter(
      (e: Row) => !human || ["user", "assistant", "human"].includes(e.role),
    );
  return (
    <div className="space-y-5">
      <div className="step-section">
        <h3 className="text-sm font-semibold mb-2">Proponer tareas</h3>
        <div className="btn-wrap">
          <Button
            disabled={proposalBusy || p.busy}
            onClick={() =>
              p.run(
                "session.propose_tasks",
                { id: s.id, expected_revision: s.revision },
                "Propuesta de tareas en cola.",
              )
            }
          >
            <Sparkles />
            {proposalBusy
              ? "Analizando conversación…"
              : "Proponer tareas con " +
                (p.data.config.provider?.kind === "pi"
                  ? "Pi"
                  : p.data.config.provider?.kind === "codex"
                    ? "Codex"
                    : "el agente")}
          </Button>
          <span className="meta">
            {p.data.config.provider?.model || "Modelo configurado"} ·{" "}
            {p.data.config.provider?.reasoning || "medium"} · consume cuota
          </span>
        </div>
        {p.data.config.auto_tasks && (
          <p className="form-help mt-3">
            Automático tras {p.data.config.task_idle_seconds ?? 120} s sin
            actividad.
          </p>
        )}
        {receipt && (
          <div className="rounded-lg border p-3 mt-4">
            <div className="btn-wrap">
              <span className="text-xs font-medium">Última propuesta</span>
              <Status value={receipt.status} />
              <span className="meta">
                {Array.isArray(receipt.created) ? receipt.created.length : 0}{" "}
                tareas nuevas ·{" "}
                {Array.isArray(receipt.skipped) ? receipt.skipped.length : 0}{" "}
                objetivos ya representados
              </span>
            </div>
            {receipt.progress?.total_chunks > 0 && (
              <p className="meta mt-2">
                Bloques analizados: {receipt.progress.completed_chunks} de{" "}
                {receipt.progress.total_chunks}
              </p>
            )}
            {receipt.error && (
              <p className="text-xs text-rose-300 mt-2">{receipt.error}</p>
            )}
            <p className="meta mt-2">
              {date(
                receipt.finished_at || receipt.updated_at || receipt.started_at,
              )}
            </p>
          </div>
        )}
        {!!proposalJobs.length && (
          <div className="mt-4">
            <JobRows
              data={{ ...p.data, jobs: proposalJobs.slice(0, 2) }}
              run={p.run}
              open={p.open}
            />
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-3 items-center">
        <label className="text-xs muted" htmlFor="revision">
          Revisión
        </label>
        <select
          id="revision"
          className="native-select flex-1 min-w-48"
          value={s.revision}
          onChange={(e) => setRevision(e.target.value)}
        >
          {s.revisions?.map((r: Row) => (
            <option key={r.id} value={r.id}>
              {date(r.created)} · {r.episode_count} tareas · {r.id.slice(0, 8)}
            </option>
          ))}
        </select>
        <Status value={s.completion || "unknown"} />
      </div>
      {!s.is_latest && (
        <Notice tone="warning">
          Revisión histórica. Selecciona otra fecha para ver una captura más
          reciente.
        </Notice>
      )}
      <div>
        <h3 className="text-sm font-semibold mb-3">Tareas de esta revisión</h3>
        {!s.episodes?.length && (
          <p className="text-sm muted">
            Pide una propuesta al agente o crea una tarea manualmente.
          </p>
        )}
      </div>
      {!!s.episodes?.length && (
        <div className="flex flex-wrap gap-2">
          {s.episodes.map((e: Row) => (
            <Button
              key={e.id}
              variant="outline"
              size="sm"
              onClick={() => p.open({ kind: "task", row: episode(e) })}
            >
              {e.title}
              <ChevronRight />
            </Button>
          ))}
        </div>
      )}
      {s.historical_episode_count > 0 && (
        <p className="meta">
          {s.historical_episode_count} tareas en otras revisiones.
        </p>
      )}
      <details className="disclosure">
        <summary>Mensajes y selección manual</summary>
        <div className="space-y-4 mt-4">
          <div className="sticky-selection">
            <div className="grid sm:grid-cols-[1fr_100px_100px] gap-3 mb-3">
              <label className="text-xs">
                Nombre de la tarea
                <Input
                  className="mt-2"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Por ejemplo, corregir la persistencia"
                />
              </label>
              <label className="text-xs">
                Inicio
                <Input
                  className="mt-2"
                  type="number"
                  min={1}
                  max={s.events.length}
                  value={start + 1}
                  onChange={(e) => setStart(Number(e.target.value) - 1)}
                />
              </label>
              <label className="text-xs">
                Fin
                <Input
                  className="mt-2"
                  type="number"
                  min={1}
                  max={s.events.length}
                  value={end + 1}
                  onChange={(e) => setEnd(Number(e.target.value) - 1)}
                />
              </label>
            </div>
            <div className="btn-wrap">
              <Button
                disabled={
                  !title.trim() ||
                  start < 0 ||
                  end < start ||
                  end >= s.events.length ||
                  p.busy
                }
                onClick={async () => {
                  const r = await p.run(
                    "episode.create",
                    {
                      session_id: s.id,
                      first_event: start,
                      last_event: end,
                      title: title.trim(),
                      expected_revision: s.revision,
                    },
                    "Tarea guardada.",
                  );
                  if (r) {
                    setSaved(
                      r.reused
                        ? "La tarea ya existía; se conservó su valoración."
                        : "Tarea guardada.",
                    );
                    setTitle("");
                    setS({
                      ...s,
                      episodes: [
                        ...(s.episodes || []).filter((e: Row) => e.id !== r.id),
                        episode(r),
                      ],
                    });
                  }
                }}
              >
                <Plus />
                Guardar tarea
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setStart(0);
                  setEnd(s.events.length - 1);
                }}
              >
                Toda la conversación
              </Button>
              <span className="meta">
                {Math.max(0, end - start + 1)} eventos seleccionados
              </span>
            </div>
            {saved && (
              <p className="text-xs text-emerald-300 mt-3" role="status">
                {saved}
              </p>
            )}
          </div>
          <label className="flex items-center gap-2 text-xs">
            <Checkbox
              checked={human}
              onCheckedChange={(v) => {
                setHuman(!!v);
                setPage(0);
              }}
            />
            Sólo mensajes humanos y del agente
          </label>
          <div className="space-y-3">
            {rows.slice(page * 25, (page + 1) * 25).map((e: Row) => (
              <article
                key={e.index}
                className={
                  "event-box " +
                  (e.index >= start && e.index <= end ? "chosen" : "")
                }
              >
                <div className="flex justify-between items-center gap-3 mb-3">
                  <div className="btn-wrap">
                    <span className="pill">{e.index + 1}</span>
                    <strong className="text-xs">
                      {e.role || e.type || "Evento"}
                    </strong>
                    <span className="meta">{date(e.timestamp)}</span>
                  </div>
                  <div className="btn-wrap">
                    <Button
                      variant="outline"
                      size="xs"
                      onClick={() => {
                        setStart(e.index);
                        if (end < e.index) setEnd(e.index);
                      }}
                    >
                      Inicio
                    </Button>
                    <Button
                      variant="outline"
                      size="xs"
                      onClick={() => {
                        setEnd(e.index);
                        if (start > e.index) setStart(e.index);
                      }}
                    >
                      Fin
                    </Button>
                  </div>
                </div>
                <div className="text-xs whitespace-pre-wrap break-words leading-6">
                  {String(
                    e.text || e.content || "Evento de herramienta sin texto.",
                  ).slice(0, 700)}
                </div>
                {String(e.text || "").length > 700 && (
                  <details>
                    <summary>Ver el mensaje</summary>
                    <Code value={e.text} />
                  </details>
                )}
                {e.event_text_truncated && (
                  <p className="meta mt-2">
                    Vista abreviada · evidencia completa guardada.
                  </p>
                )}
              </article>
            ))}
          </div>
          <Paginator
            page={page}
            setPage={setPage}
            total={rows.length}
            size={25}
          />
        </div>
      </details>
    </div>
  );
}
function TaskEditor({ modal, p }: { modal: Modal; p: Props }) {
  const initial = episode(modal.row!),
    task = p.data.episodes.find((e) => e.id === initial.id) || initial;
  const [local, setLocal] = useState<Row>(task);
  const e = { ...task, ...local };
  const [selected, setSelected] = useState<string[]>(e.cases || []);
  useEffect(() => {
    setLocal(task);
  }, [task.completed, task.label, task.origin, task.cases]);
  const linked = p.data.cases.filter((c) => selected.includes(c.id));
  const canExtract = e.completed && ["correct", "incorrect"].includes(e.label);
  return (
    <div className="space-y-5">
      <TasksStatus task={e} />
      <div className="text-xs muted">
        Eventos {e.first_event + 1}–{e.last_event + 1} · revisión{" "}
        {String(e.revision).slice(0, 12)}
      </div>
      <div className="step-section">
        <h3 className="text-sm font-semibold mb-2">1. Finalización</h3>
        <Button
          variant={e.completed ? "outline" : "default"}
          onClick={async () => {
            const r = await p.run(
              "episode.complete",
              { id: e.id, completed: !e.completed },
              e.completed
                ? "Tarea reabierta; valoración pendiente."
                : "Finalización confirmada. Ahora puedes valorar el resultado.",
            );
            if (r) setLocal(episode(r));
          }}
        >
          {e.completed ? "Reabrir tarea" : "Marcar tarea completada"}
        </Button>
        {e.completed && (
          <p className="form-help mt-3">
            Reabrir retira la valoración e invalida la evidencia pendiente.
          </p>
        )}
      </div>
      <div className="step-section">
        <h3 className="text-sm font-semibold mb-2">2. Resultado</h3>
        {!e.completed && (
          <Notice tone="warning">
            Confirma primero que la tarea está completada.
          </Notice>
        )}
        {e.completed && (
          <Form
            key={e.id + "-" + e.label}
            onSave={async (v) => {
              const r = await p.run(
                "episode.label",
                { id: e.id, label: v.label, feedback: v.feedback },
                "Valoración guardada.",
              );
              if (r) setLocal({ ...e, label: v.label, feedback: v.feedback });
            }}
          >
            <fieldset disabled={!e.completed} className="field-group">
              <Choice
                label="Valoración"
                name="label"
                initial={e.label}
                options={[
                  ["pending", "Pendiente de valoración"],
                  ["correct", "Correcta"],
                  ["incorrect", "Incorrecta"],
                ]}
              />
              <Field
                name="feedback"
                label="Qué funcionó o qué falló"
                initial={e.feedback || ""}
                type="textarea"
                hint="Incluye el resultado esperado si hubo un fallo."
              />
              {p.data.config.auto_derive && (
                <p className="form-help">
                  Guardar una valoración correcta o incorrecta inicia la
                  extracción y consume cuota.
                </p>
              )}
              <Button type="submit" variant="outline">
                Guardar valoración
              </Button>
            </fieldset>
          </Form>
        )}
      </div>
      <details className="disclosure" open={canExtract ? true : undefined}>
        <summary>Casos de evaluación · {selected.length}</summary>
        <div className="space-y-4 mt-4">
          <div>
            <div className="space-y-3 mb-4">
              {p.data.cases.map((c) => (
                <label className="flex items-start gap-3 text-xs" key={c.id}>
                  <Checkbox
                    checked={selected.includes(c.id)}
                    onCheckedChange={(v) =>
                      setSelected(
                        v
                          ? [...selected, c.id]
                          : selected.filter((id) => id !== c.id),
                      )
                    }
                  />
                  <span>
                    {c.title}
                    <span className="meta block">
                      {c.domain} · {term(c.split)}
                    </span>
                  </span>
                </label>
              ))}
            </div>
            <div className="btn-wrap">
              <Button
                variant="outline"
                onClick={async () => {
                  const r = await p.run(
                    "episode.cases",
                    { id: e.id, case_ids: selected },
                    "Casos vinculados.",
                  );
                  if (r) setLocal({ ...e, cases: selected });
                }}
              >
                Guardar selección
              </Button>
              <Button
                variant="ghost"
                onClick={() => p.open({ kind: "case-create", task: e })}
              >
                <Plus />
                Crear caso para esta tarea
              </Button>
            </div>
          </div>
          <details
            className="disclosure"
            open={
              linked.some((c) => c.split === "origin") && !e.origin
                ? true
                : undefined
            }
          >
            <summary>
              Estado inicial {e.origin ? "· vinculado" : "· sin confirmar"}
            </summary>
            <div className="field-group mt-4">
              {e.origin ? (
                <Notice tone="success">
                  Origen vinculado ·{" "}
                  {e.origin.provenance === "system_recorded"
                    ? "Registrado antes de ejecutar la tarea"
                    : "Confirmación humana del estado inicial"}
                  . {e.origin.note}
                </Notice>
              ) : (
                <Notice tone="warning">
                  Confirma el estado inicial para poder adoptar una mejora
                  evaluada.
                </Notice>
              )}
              <Form
                onSave={async (v, fd) => {
                  if (!fd.has("confirmed"))
                    throw Error(
                      "Debes confirmar expresamente el estado inicial.",
                    );
                  const r = await p.run(
                    "episode.origin",
                    {
                      id: e.id,
                      case_id: v.case_id,
                      confirmed_initial_state: true,
                      note: v.note,
                    },
                    "Origen vinculado con tu confirmación.",
                  );
                  if (r) setLocal({ ...e, origin: r.origin || r });
                }}
              >
                <Choice
                  name="case_id"
                  label="Caso de origen vinculado"
                  options={linked
                    .filter((c) => c.split === "origin")
                    .map((c) => [c.id, c.title])}
                />
                <Field
                  name="note"
                  label="Cómo sabes que es el estado inicial"
                  type="textarea"
                  required
                  hint="Por ejemplo, commit previo, copia conservada o registro de ejecución."
                />
                <label className="text-xs flex gap-3 items-start">
                  <Checkbox name="confirmed" />
                  Confirmo que este snapshot corresponde al estado inicial de
                  esta tarea. Es mi declaración, no una prueba automática.
                </label>
                <Button
                  type="submit"
                  variant="outline"
                  disabled={!linked.some((c) => c.split === "origin")}
                >
                  Vincular origen confirmado
                </Button>
              </Form>
            </div>
          </details>
        </div>
      </details>
      {canExtract && (
        <p className="form-help">
          Extraer aprendizaje usa el modelo configurado y consume cuota.
        </p>
      )}
      <div className="btn-wrap">
        {canExtract && (
          <Button
            disabled={p.busy}
            onClick={() =>
              p.run(
                "derive",
                { id: e.id },
                "Extracción de aprendizaje en cola.",
              )
            }
          >
            <Sparkles />
            Extraer aprendizaje {e.label === "incorrect" ? "preventivo" : ""}
          </Button>
        )}
        <Button
          variant="outline"
          onClick={() =>
            p.open({ kind: "session", id: e.session_id, revision: e.revision })
          }
        >
          Ver evidencia original
        </Button>
      </div>
    </div>
  );
}
function CaseForm({
  modal,
  p,
  close,
}: {
  modal: Modal;
  p: Props;
  close: () => void;
}) {
  const task = modal.task;
  const setup = modal.readiness?.setup || {};
  return (
    <div className="space-y-5">
      <Notice tone="warning">
        Los controles ejecutan comandos locales. Limítalos a {"{workspace}"}.
      </Notice>
      {task && (
        <p className="text-sm">
          Se vinculará a: <strong>{task.title}</strong>
        </p>
      )}
      <Form
        onSave={async (v) => {
          const payload: Row = {
            title: v.title,
            prompt: v.prompt,
            path: v.path,
            verifier_path: v.verifier_path,
            ref: v.ref || undefined,
            domain: v.domain,
            split: v.split,
            verify: argv(v.verify),
            positive_control:
              !v.positive_control.trim() || v.positive_control.trim() === "[]"
                ? []
                : argv(v.positive_control),
            negative_control: argv(v.negative_control),
          };
          if (task || modal.readiness?.episode_id) {
            payload.episode_id = task?.id || modal.readiness?.episode_id;
            payload.expected_revision =
              task?.revision || setup.expected_revision;
          }
          const r = await p.run(
            "case.create",
            payload,
            "Validación del snapshot y controles en cola. Consulta Experimentos.",
          );
          if (r) close();
        }}
      >
        <Field name="title" label="Nombre del caso" required />
        <Field
          name="prompt"
          label="Instrucción de la tarea"
          type="textarea"
          required
        />
        <div className="grid md:grid-cols-2 gap-4">
          <Field
            name="path"
            label="Directorio del proyecto inicial"
            initial={setup.project_path || ""}
            required
          />
          <Field
            name="verifier_path"
            label="Directorio externo del verificador"
            required
          />
          <Field name="ref" label="Referencia Git inicial (opcional)" />
          <Field
            name="domain"
            label="Dominio"
            initial={setup.domain || modal.candidate?.spec?.domain || ""}
            required
          />
        </div>
        <Choice
          name="split"
          label="Función del caso"
          initial={modal.split || "origin"}
          options={[
            ["origin", "Origen: objetivo original"],
            ["holdout", "Transferencia: un caso distinto"],
            ["regression", "Regresión: comportamiento existente"],
          ]}
        />
        <Field
          name="verify"
          label="Verificador · argumentos JSON"
          initial={'["{python}", "{verifier}/verify.py", "{workspace}"]'}
          required
        />
        <Field
          name="positive_control"
          label="Control positivo · argumentos JSON"
          initial=""
          hint="Prepara una solución correcta. Opcional si el estado inicial ya pasa."
        />
        <Field
          name="negative_control"
          label="Control negativo · argumentos JSON"
          hint="Introduce un fallo que el verificador debe rechazar."
          initial={
            '["{python}", "{verifier}/introduce_fault.py", "{workspace}"]'
          }
          required
        />
        <p className="form-help">
          Argumentos JSON, sin shell. Sustituye los scripts de ejemplo por los
          de tu proyecto.
        </p>
        <Button type="submit">
          <ShieldCheck />
          Validar y guardar caso
        </Button>
      </Form>
    </div>
  );
}
function CandidateEditor({ modal, p }: { modal: Modal; p: Props }) {
  const c = p.data.candidates.find((c) => c.id === modal.row?.id) || modal.row!;
  const [readiness, setReadiness] = useState<Row | null>(
      modal.readiness || null,
    ),
    [error, setError] = useState(""),
    [selected, setSelected] = useState<string[]>([]),
    [loading, setLoading] = useState(false);
  const task =
    p.data.episodes.find((e) => e.id === c.episode_id) ||
    (readiness?.episode ? episode(readiness.episode) : undefined);
  async function load() {
    setLoading(true);
    setError("");
    try {
      const r = await api(
        "/api/candidate/readiness?id=" + encodeURIComponent(c.id),
      );
      setReadiness(r);
      setSelected(r.selected_cases.map((x: Row) => x.id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, [c.id, p.data.cases.length, c.status]);
  async function download() {
    try {
      const r = await api("/api/action", {
        action: "export",
        candidate_id: c.id,
      });
      if (r.download || r.url) {
        const response = await apiFetch(r.download || r.url);
        if (!response.ok) throw Error("No se pudo descargar el paquete.");
        const url = URL.createObjectURL(await response.blob());
        const a = document.createElement("a");
        a.href = url;
        a.download = r.filename || "foundry-capability.zip";
        a.click();
        URL.revokeObjectURL(url);
      } else p.open({ kind: "info", row: r });
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const preventive = c.spec.preferred_variant === "preventive";
  return (
    <div className="space-y-5">
      <div className="btn-wrap">
        <Status value={c.status} />
        <span className="pill">{term(c.spec.kind)}</span>
        <span className="pill">{term(c.spec.scope)}</span>
        <span className="pill">{c.spec.domain}</span>
        {active(p.data, c.id) && <Status value="active" />}
      </div>
      <p className="text-sm muted leading-6">
        {c.spec.description || c.spec.rationale}
      </p>
      {preventive && (
        <Notice>
          Se evaluará la formulación preventiva porque la tarea fue incorrecta.
        </Notice>
      )}
      <Tabs defaultValue={preventive ? "preventive" : "positive"}>
        <TabsList>
          {(preventive
            ? ["preventive", "positive"]
            : ["positive", "preventive"]
          ).map((v) => (
            <TabsTrigger key={v} value={v}>
              Formulación {v === "positive" ? "positiva" : "preventiva"}
            </TabsTrigger>
          ))}
        </TabsList>
        {["positive", "preventive"].map((v) => (
          <TabsContent key={v} value={v}>
            <Code value={c.spec[v]?.instructions || c.spec[v]} />
            {c.spec[v]?.files?.map((f: Row) => (
              <details key={f.path}>
                <summary>{f.path}</summary>
                <Code value={f.content} />
              </details>
            ))}
          </TabsContent>
        ))}
      </Tabs>
      <div className="step-section">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div>
            <h3 className="text-sm font-semibold">Preparar evaluación</h3>
          </div>
          <Button size="sm" variant="ghost" disabled={loading} onClick={load}>
            <RefreshCw className={loading ? "animate-spin" : ""} />
            Revisar
          </Button>
        </div>
        {error && <Notice tone="error">{error}</Notice>}
        {!readiness && loading ? (
          <Loading />
        ) : (
          readiness && (
            <>
              <Notice tone={readiness.ready ? "success" : "warning"}>
                {readiness.ready
                  ? "Lista para evaluar."
                  : "Preparación pendiente."}
              </Notice>
              {readiness.blockers.map((b: Row, n: number) => (
                <div className="readiness-row" key={n}>
                  <CircleHelp
                    size={17}
                    className="text-amber-300 shrink-0 mt-0.5"
                  />
                  <p className="text-xs leading-6 flex-1">{b.message}</p>
                  {[
                    "complete_task",
                    "label_task",
                    "configure_origin",
                    "derive",
                  ].includes(b.action) &&
                    task && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => p.open({ kind: "task", row: task })}
                      >
                        Revisar tarea
                      </Button>
                    )}
                  {b.action === "settings" && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => p.open({ kind: "page", id: "settings" })}
                    >
                      Configurar
                    </Button>
                  )}
                  {["create_origin", "create_holdout"].includes(b.action) && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        p.open({
                          kind: "case-create",
                          task,
                          candidate: c,
                          readiness,
                          split:
                            b.action === "create_origin" ? "origin" : "holdout",
                        })
                      }
                    >
                      Crear caso
                    </Button>
                  )}
                </div>
              ))}
              {readiness.warnings?.map((w: Row, n: number) => (
                <p className="form-help my-3" key={n}>
                  {w.message || String(w)}
                </p>
              ))}
              <div className="grid sm:grid-cols-3 gap-3 my-5">
                {[
                  ["Casos seleccionados", readiness.selected_cases.length],
                  ["Llamadas iniciales", readiness.budget?.calls_first_variant],
                  ["Límite de llamadas", readiness.budget?.max_calls],
                ].map(([l, v]) => (
                  <div className="rounded-lg border p-3" key={l}>
                    <p className="meta">{l}</p>
                    <p className="text-lg mt-1">{v ?? "—"}</p>
                  </div>
                ))}
              </div>
              <h4 className="text-sm font-medium mb-3">Casos disponibles</h4>
              {readiness.available_cases.length ||
              readiness.selected_cases.length ? (
                <div className="space-y-3 mb-4">
                  {Array.from(
                    new Map(
                      [
                        ...readiness.selected_cases,
                        ...readiness.available_cases,
                      ].map((x: Row) => [x.id, x]),
                    ).values(),
                  ).map((x: Row) => (
                    <label
                      key={x.id}
                      className="flex gap-3 text-xs items-start"
                    >
                      <Checkbox
                        checked={selected.includes(x.id)}
                        onCheckedChange={(v) =>
                          setSelected(
                            v
                              ? [...selected, x.id]
                              : selected.filter((id) => id !== x.id),
                          )
                        }
                      />
                      <span>
                        {x.title}
                        <span className="meta block">
                          {x.domain} · {term(x.split)}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              ) : (
                <p className="text-xs muted mb-4">
                  Crea un caso de origen y otro de transferencia.
                </p>
              )}
              <div className="btn-wrap mb-4">
                <Button
                  variant="outline"
                  onClick={async () => {
                    const r = await p.run(
                      "candidate.setup",
                      { id: c.id, case_ids: selected },
                      "Casos seleccionados.",
                    );
                    if (r) setReadiness(r);
                  }}
                >
                  Guardar selección
                </Button>
                <Button
                  variant="ghost"
                  onClick={() =>
                    p.open({
                      kind: "case-create",
                      task,
                      candidate: c,
                      readiness,
                      split: "origin",
                    })
                  }
                >
                  <Plus />
                  Caso de origen
                </Button>
                <Button
                  variant="ghost"
                  onClick={() =>
                    p.open({
                      kind: "case-create",
                      task,
                      candidate: c,
                      readiness,
                      split: "holdout",
                    })
                  }
                >
                  <Plus />
                  Caso de transferencia
                </Button>
              </div>
              {!readiness.promotion?.origin_linked && (
                <Notice tone="warning">
                  La incorporación requiere vincular el estado inicial.{" "}
                  {task && (
                    <Button
                      size="sm"
                      variant="link"
                      onClick={() => p.open({ kind: "task", row: task })}
                    >
                      Confirmar origen desde la tarea
                    </Button>
                  )}
                </Notice>
              )}
              <p className="form-help mt-4">
                Esta comparación ejecuta el agente y consume cuota.
              </p>
              <Button
                className="mt-2"
                disabled={!readiness.ready || p.busy}
                onClick={async () => {
                  const r = await p.run("candidate.evaluate", { id: c.id });
                  if (r?.status === "setup_required") setReadiness(r.readiness);
                  else if (r?.job_id) {
                    await load();
                    p.open({ kind: "page", id: "experiments" });
                  }
                }}
              >
                <FlaskConical />
                Ejecutar comparación
              </Button>
            </>
          )
        )}
      </div>
      <details>
        <summary>Alcance, dominio y evidencias</summary>
        <Form
          onSave={async (v) => {
            await p.run(
              "candidate.scope",
              { id: c.id, scope: v.scope, domain: v.domain },
              "Alcance actualizado. La evidencia anterior deberá reevaluarse.",
            );
            await load();
          }}
        >
          <div className="grid sm:grid-cols-2 gap-4">
            <Field
              name="domain"
              label="Dominio"
              initial={c.spec.domain}
              required
            />
            <Choice
              name="scope"
              label="Alcance"
              initial={c.spec.scope}
              options={[
                ["project", "Proyecto"],
                ["domain", "Dominio"],
                ["general", "General"],
              ]}
            />
          </div>
          <Button
            type="submit"
            variant="outline"
            disabled={active(p.data, c.id) || c.status === "evaluating"}
          >
            Guardar alcance
          </Button>
        </Form>
        <Code value={c.spec.evidence || c.spec.source_revision} />
      </details>
      <div className="btn-wrap">
        <Button variant="outline" onClick={download}>
          <ArrowDownToLine />
          Exportar paquete
        </Button>
        {task && (
          <Button
            variant="ghost"
            onClick={() => p.open({ kind: "task", row: task })}
          >
            Tarea de origen
          </Button>
        )}
      </div>
    </div>
  );
}
function ExperimentDetail({ modal, p }: { modal: Modal; p: Props }) {
  const e =
      p.data.experiments.find((e) => e.id === modal.row?.id) || modal.row!,
    r = e.report || {},
    c = p.data.candidates.find((c) => c.id === e.candidate_id);
  const eligible =
    e.status === "passed" &&
    r.selected_variant &&
    r.replay_provenance?.promotion_eligible;
  const metric = (v: any) =>
    typeof v === "number" ? v.toFixed(3) : "No disponible";
  const duration =
    typeof r.started === "number" && typeof r.finished === "number"
      ? Math.max(0, r.finished - r.started)
      : null;
  const runs: Row[] = (r.attempts || []).flatMap(
    (attempt: Row) => attempt.runs || [],
  );
  const synthetic = runs.some((run: Row) => run.real_inference === false);
  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-base font-semibold">
          {c?.spec?.name || e.candidate_id}
        </h3>
        {c?.spec?.description && (
          <p className="text-sm muted leading-6 mt-2">{c.spec.description}</p>
        )}
        <p className="meta mt-3">
          {r.calls ?? 0} llamadas · Inicio: {date(r.started)} · Fin:{" "}
          {date(r.finished)}
          {duration !== null
            ? ` · Duración: ${duration < 60 ? duration.toFixed(1) + " s" : (duration / 60).toFixed(1) + " min"}`
            : ""}
        </p>
      </div>
      {synthetic && (
        <Notice tone="warning">
          Ejecución sintética: estos resultados no demuestran una mejora del
          modelo.
        </Notice>
      )}
      <div className="btn-wrap">
        <Status value={e.status} />
        {r.selected_variant && (
          <span className="pill">
            Formulación{" "}
            {r.selected_variant === "positive" ? "positiva" : "preventiva"}
          </span>
        )}
        {active(p.data, e.candidate_id) && <Status value="active" />}
      </div>
      <Notice
        tone={r.replay_provenance?.promotion_eligible ? "success" : "warning"}
      >
        {r.replay_provenance?.historical_fidelity === "system_recorded"
          ? "Estado inicial registrado por el sistema."
          : r.replay_provenance?.historical_fidelity === "human_attested"
            ? "Estado inicial confirmado por una persona, sin verificación automática."
            : "Caso reconstruido: sin evidencia del estado inicial histórico."}{" "}
        {r.replay_provenance?.reason}
      </Notice>
      {r.attempts?.map((a: Row, i: number) => (
        <Panel
          key={i}
          title={
            a.variant === "positive"
              ? "Formulación positiva"
              : "Formulación preventiva"
          }
          caption={`${a.summary?.paired_runs ?? 0} pares comparados`}
        >
          <div className="panel-content">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {[
                ["Calidad sin propuesta", a.summary?.baseline_quality],
                ["Calidad con propuesta", a.summary?.candidate_quality],
                ["Cambio de calidad", a.summary?.quality_gain],
                ["Relación de tiempo", a.summary?.time_ratio],
                ["Relación de tokens", a.summary?.token_ratio],
                ["Relación de turnos", a.summary?.turn_ratio],
              ].map(([l, v]) => (
                <div className="rounded-lg border p-3" key={l}>
                  <p className="meta">{l}</p>
                  <p className="text-lg mt-2">{metric(v)}</p>
                </div>
              ))}
            </div>
            <p className="form-help mt-3">
              Relación candidato / baseline: menos de 1 indica menor consumo.
            </p>
            {a.summary?.reasons?.map((reason: string, n: number) => (
              <p className="notice warning mt-3" key={n}>
                {reason}
              </p>
            ))}
            <details>
              <summary>Mediciones y controles</summary>
              <Code value={a} />
            </details>
          </div>
        </Panel>
      ))}
      <div className="step-section">
        <h3 className="text-sm font-semibold mb-3">3. Adoptar mejora</h3>
        <p className="text-xs muted mb-4">
          Tu aprobación activa esta mejora. Puedes restaurar una versión
          anterior.
        </p>
        <Button
          disabled={!eligible || active(p.data, e.candidate_id) || p.busy}
          onClick={() =>
            p.run(
              "candidate.promote",
              { id: e.candidate_id, experiment_id: e.id },
              "Mejora incorporada por tu aprobación.",
            )
          }
        >
          <CheckCheck />
          {active(p.data, e.candidate_id)
            ? "Ya está en el arnés activo"
            : "Incorporar mejora al arnés"}
        </Button>
        {!eligible && (
          <p className="form-help mt-3">
            Adopción bloqueada. Revisa los motivos y el estado inicial.
          </p>
        )}
      </div>
      {c && (
        <Button
          variant="outline"
          onClick={() => p.open({ kind: "candidate", row: c })}
        >
          Revisar aprendizaje
        </Button>
      )}
      <details>
        <summary>Informe completo</summary>
        <Code value={r} />
      </details>
    </div>
  );
}
function Loading() {
  return (
    <div className="space-y-4 p-4">
      <Skeleton className="h-6 w-1/2" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}
function ModalBody({
  modal,
  p,
  close,
}: {
  modal: Modal;
  p: Props;
  close: () => void;
}) {
  if (modal.kind === "session")
    return (
      <SessionEditor
        key={modal.id + "-" + modal.revision}
        modal={modal}
        p={p}
      />
    );
  if (modal.kind === "task")
    return <TaskEditor key={modal.row?.id} modal={modal} p={p} />;
  if (modal.kind === "candidate")
    return <CandidateEditor key={modal.row?.id} modal={modal} p={p} />;
  if (modal.kind === "experiment")
    return <ExperimentDetail modal={modal} p={p} />;
  if (modal.kind === "case-create")
    return <CaseForm modal={modal} p={p} close={close} />;
  if (modal.kind === "source")
    return (
      <Form
        onSave={async (v) => {
          const r = await p.run(
            modal.row ? "source.relink" : "source.add",
            { path: v.path, adapter: v.adapter, ...(modal.row ? {id: modal.row.id} : {}) },
            "Fuente conectada.",
          );
          if (r) close();
        }}
      >
        {!modal.row && <Choice
          name="adapter"
          label="Formato del agente"
          options={["codex", "claude", "pi", "omp", "canonical"].map((k) => [
            k,
            k,
          ])}
        />}
        <Field
          name="path"
          label="Ruta local"
          initial={modal.row?.path || ""}
          required
          hint="Carpeta de sesiones o archivo JSONL en este equipo."
        />
        <Button type="submit">
          <Link2 />
          Conectar fuente
        </Button>
      </Form>
    );
  return <Code value={modal.row} />;
}
const nav = [
  ["dashboard", "Vista general", LayoutDashboard],
  ["sources", "Fuentes", FolderOpen],
  ["conversations", "Conversaciones", MessageSquare],
  ["learning", "Aprendizajes", Sparkles],
  ["experiments", "Experimentos", FlaskConical],
  ["settings", "Configuración", Settings2],
] as const;
export default function App({ embedded = false, initialView = "dashboard", onNavigate }: { embedded?: boolean; initialView?: string; onNavigate?: (view: string) => void } = {}) {
  const [data, setData] = useState<AppState | null>(null),
    [page, setPageState] = useState(initialView),
    [modal, setModal] = useState<Modal | null>(null),
    [notice, setNotice] = useState<{
      text: string;
      error?: boolean;
      warning?: boolean;
    } | null>(null),
    [error, setError] = useState(""),
    [auth, setAuth] = useState(false),
    [busy, setBusy] = useState(false);
  const fetching = useRef<Promise<void> | null>(null);
  const refreshQueued = useRef(false);
  const mounted = useRef(true);
  const setPage = (value: string) => { setPageState(value); onNavigate?.(value); };
  useEffect(() => { setPageState(initialView); setModal(null); }, [initialView]);
  async function refresh() {
    if (fetching.current) {
      // A mutation can finish after the current snapshot started. Wait for a
      // subsequent snapshot before confirming that its state has refreshed.
      refreshQueued.current = true;
      return fetching.current;
    }
    const load = async () => {
      do {
        refreshQueued.current = false;
        try {
          const r = await api("/api/state");
          if (!mounted.current) return;
          r.episodes = r.episodes.map(episode);
          setData(r);
          setError("");
          setAuth(false);
        } catch (e) {
          if (!mounted.current) return;
          const msg = (e as Error).message;
          setError(msg);
          if (
            (e as Error & { status?: number }).status === 401 ||
            /401|token|autori/i.test(msg)
          )
            setAuth(true);
        }
      } while (refreshQueued.current && mounted.current);
    };
    fetching.current = load();
    try {
      await fetching.current;
    } finally {
      fetching.current = null;
    }
  }
  useEffect(() => {
    mounted.current = true;
    void refresh();
    const tick = () => {
      if (!document.hidden && !fetching.current) void refresh();
    };
    const t = setInterval(tick, 3000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      mounted.current = false;
      clearInterval(t);
      document.removeEventListener("visibilitychange", tick);
    };
  }, []);
  function open(m: Modal) {
    if (m.kind === "page") {
      setModal(null);
      setPage(m.id!);
    } else setModal(m);
  }
  async function run(action: string, payload: Row = {}, message?: string) {
    setBusy(true);
    setNotice(null);
    try {
      const r = await api("/api/action", { action, ...payload });
      await refresh();
      if (r.status === "setup_required" && r.readiness) {
        const candidate = data?.candidates.find(
          (c) => c.id === r.readiness.candidate_id,
        );
        setNotice({
          text: "Completa la preparación antes de evaluar.",
          warning: true,
        });
        if (candidate)
          setModal({
            kind: "candidate",
            row: candidate,
            readiness: r.readiness,
          });
      } else if (action === "episode.label" && r.job_id) {
        setNotice({
          text: "Valoración guardada · extracción en cola.",
        });
      } else if (message) setNotice({ text: message });
      return r;
    } catch (e) {
      setNotice({ text: (e as Error).message, error: true });
      return null;
    } finally {
      setBusy(false);
    }
  }
  const p: Props = { data: data!, run, open, refresh, busy };
  const title =
    modal?.kind === "session"
      ? "Tareas de la conversación"
      : modal?.kind === "task"
        ? modal.row?.title
        : modal?.kind === "candidate"
          ? modal.row?.spec?.name
          : modal?.kind === "experiment"
            ? "Resultados del experimento"
            : modal?.kind === "source"
              ? "Conectar una fuente"
              : modal?.kind === "case-create"
                ? "Preparar un caso reproducible"
                : modal?.kind === "case"
                  ? modal.row?.title
                  : "Resultado";
  return (
    <div className={embedded ? "app-shell foundry-embedded" : "app-shell"}>
      {!embedded && <aside className="sidebar">
        <div className="brand">
          <span className="brand-icon">
            <Layers3 size={19} />
          </span>
          <div>
            <div className="text-sm font-semibold tracking-tight">
              Conversation Foundry
            </div>
          </div>
        </div>
        <nav>
          {nav.map(([id, label, Icon]) => (
            <button
              key={id}
              className={"nav-button " + (page === id ? "selected" : "")}
              onClick={() => {
                setPage(id);
                setModal(null);
              }}
              aria-current={page === id ? "page" : undefined}
            >
              <Icon size={17} />
              {label}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer mt-auto p-5">
          <div className="flex items-center justify-between mt-5 text-xs muted">
            <span className="flex gap-2 items-center">
              <span className="pending-dot" />
              Entorno local
            </span>
            <span>v1.0</span>
          </div>
        </div>
      </aside>}
      <div className="main-shell">
        <header className="topbar">
          <div className="flex items-center gap-2 text-xs muted">
            <span>Foundry</span>
            <ChevronRight size={13} />
            <span className="text-zinc-200">
              {nav.find((n) => n[0] === page)?.[1]}
            </span>
          </div>
          <div className="btn-wrap">
            <span className="hidden sm:inline text-xs muted">
              {data?.config.capture ? "Captura activa" : "Captura pausada"}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => refresh()}
              aria-label="Actualizar datos"
            >
              <RefreshCw size={14} />
              <span className="hidden sm:inline">Actualizar</span>
            </Button>
          </div>
        </header>
        <main className="page-body">
          {auth ? (
            <div className="max-w-lg mx-auto mt-12">
              <Panel title="Conecta tu sesión local">
                <div className="panel-content">
                  <Notice>
                    Ejecuta conversation-foundry open o introduce tu token.
                  </Notice>
                  <Form
                    onSave={async (v) => {
                      setToken(v.token);
                      setNotice(null);
                      setError("");
                      await refresh();
                    }}
                  >
                    <Field
                      name="token"
                      label="Token de acceso local"
                      type="password"
                      required
                    />
                    <Button type="submit">Conectar</Button>
                  </Form>
                  {error && (
                    <p className="text-xs text-rose-300 mt-4">{error}</p>
                  )}
                </div>
              </Panel>
            </div>
          ) : !data ? (
            <>
              <Heading title="Conectando…" />
              {error ? (
                <Notice tone="error">
                  {error}
                  <Button className="ml-3" variant="outline" onClick={refresh}>
                    Reintentar
                  </Button>
                </Notice>
              ) : (
                <Loading />
              )}
            </>
          ) : (
            <>
              {error && <Notice tone="error">{error}</Notice>}
              {page === "dashboard" ? (
                <Dashboard {...p} />
              ) : page === "sources" ? (
                <Sources {...p} />
              ) : page === "conversations" ? (
                <Conversations {...p} />
              ) : page === "learning" ? (
                <Learning {...p} />
              ) : page === "experiments" ? (
                <Experiments {...p} />
              ) : (
                <Settings {...p} />
              )}
            </>
          )}
        </main>
      </div>
      <Dialog
        open={!!modal}
        onOpenChange={(v) => {
          if (!v) setModal(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          {notice?.error && (
            <div role="alert" className="notice error flex gap-4 items-start">
              <span className="flex-1">{notice.text}</span>
              <button aria-label="Cerrar aviso" onClick={() => setNotice(null)}><X size={16} /></button>
            </div>
          )}
          <div
            className="modal-body"
            key={modal?.kind + ":" + (modal?.id || modal?.row?.id || "")}
          >
            {modal && data && (
              <ModalBody modal={modal} p={p} close={() => setModal(null)} />
            )}
          </div>
        </DialogContent>
      </Dialog>
      {notice && !(modal && notice.error) && (
        <div
          role={notice.error ? "alert" : "status"}
          className={
            "toast notice " +
            (notice.error ? "error" : notice.warning ? "warning" : "success")
          }
        >
          <div className="flex gap-4 items-start">
            <span className="flex-1">{notice.text}</span>
            <button aria-label="Cerrar aviso" onClick={() => setNotice(null)}>
              <X size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
