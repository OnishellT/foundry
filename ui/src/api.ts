export type Row = Record<string, any>;
export type AppState = {
  config: Row;
  sources: Row[];
  sessions: Row[];
  episodes: Row[];
  candidates: Row[];
  cases: Row[];
  jobs: Row[];
  experiments: Row[];
  versions: Row[];
  active_version: string;
  diagnostics: Row;
  capture_status?: Row;
  total_sessions?: number;
};
const hash = new URLSearchParams(location.hash.slice(1));
if (hash.has("token") && !(window as any).__WORKBENCH__) {
  sessionStorage.setItem("foundry-token", hash.get("token") || "");
  history.replaceState(null, "", location.pathname + location.search);
}
export function setToken(token: string) {
  sessionStorage.setItem("foundry-token", token);
}
export function apiFetch(path: string, init: RequestInit = {}) {
  const unified = Boolean((window as any).__WORKBENCH__);
  return fetch(unified ? path.replace(/^\/api\//, "/api/foundry/") : path, {
    ...init,
    headers: { ...(!unified ? { "X-Foundry-Token": sessionStorage.getItem("foundry-token") || "" } : {}), ...init.headers },
  });
}
export async function api(path: string, body?: Row) {
  const response = await apiFetch(path, {
    method: body ? "POST" : "GET",
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let value;
  try {
    value = await response.json();
  } catch {
    throw Error(
      "El servidor no devolvió una respuesta válida. Comprueba el servicio local.",
    );
  }
  if (!response.ok || value.error)
    throw Object.assign(new Error(value.error || `Error ${response.status}`), {
      status: response.status,
    });
  return value;
}
export const date = (v: any) =>
  v
    ? new Date(Number(v) * 1000).toLocaleString("es", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "—";
export const pretty = (v: any) => JSON.stringify(v, null, 2);
export function argv(v: string) {
  let parsed;
  try {
    parsed = JSON.parse(v);
  } catch {
    throw Error(
      'El comando debe ser un array JSON, por ejemplo ["python3", "verify.py"].',
    );
  }
  if (
    !Array.isArray(parsed) ||
    !parsed.length ||
    parsed.some((x) => typeof x !== "string" || !x)
  )
    throw Error("Cada comando necesita una lista de argumentos de texto.");
  return parsed;
}
export function episode(e: Row): Row {
  return { ...e, cases: e.cases || JSON.parse(e.cases_json || "[]") };
}
