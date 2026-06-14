const GITHUB_OWNER = "hektopascal2026";
const GITHUB_REPO = "modell3";
const SCENARIOS_PATH = "public/scenarios/scenarios.json";
const GITHUB_BRANCH = "main";
const LOCAL_CACHE_KEY = "hekto3_scenarios_cache";

const rawUrl = () =>
  `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/${GITHUB_BRANCH}/${SCENARIOS_PATH}`;

const apiUrl = () =>
  `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${SCENARIOS_PATH}`;

const githubHeaders = (token) => ({
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
});

const encodeBase64Utf8 = (text) => {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
};

const normalizePayload = (payload) => {
  if (!payload || typeof payload !== "object") return { scenarios: {} };
  if (payload.scenarios && typeof payload.scenarios === "object") {
    return { scenarios: payload.scenarios, meta: payload._meta ?? null };
  }
  return { scenarios: payload, meta: null };
};

export const cacheScenariosLocally = (scenarios) => {
  try {
    localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify(scenarios));
  } catch {
    // ignore quota errors
  }
};

export const readLocalScenarioCache = () => {
  try {
    const raw = localStorage.getItem(LOCAL_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
};

export const readLegacyLocalScenarios = () => {
  try {
    const raw = localStorage.getItem("hekto3_templates");
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
};

/** Load scenarios: remote GitHub file → local cache → legacy localStorage. */
export async function fetchScenarios() {
  try {
    const response = await fetch(`${rawUrl()}?t=${Date.now()}`, { cache: "no-store" });
    if (response.ok) {
      const payload = await response.json();
      const { scenarios, meta } = normalizePayload(payload);
      cacheScenariosLocally(scenarios);
      return { scenarios, meta, source: "remote" };
    }
  } catch {
    // fall through to cache
  }

  const cached = readLocalScenarioCache();
  if (Object.keys(cached).length > 0) {
    return { scenarios: cached, meta: null, source: "cache" };
  }

  const legacy = readLegacyLocalScenarios();
  if (Object.keys(legacy).length > 0) {
    cacheScenariosLocally(legacy);
    return { scenarios: legacy, meta: null, source: "legacy" };
  }

  return { scenarios: {}, meta: null, source: "empty" };
}

export async function saveScenarios(scenarios, { authorName = "unbekannt" } = {}) {
  const token = import.meta.env.VITE_GITHUB_SCENARIO_TOKEN;
  if (!token) {
    throw new Error(
      "GitHub-Token fehlt. Bitte VITE_GITHUB_SCENARIO_TOKEN in .env.local setzen (repo-Schreibrecht)."
    );
  }

  const payload = {
    _meta: {
      updatedAt: new Date().toISOString(),
      updatedBy: authorName,
    },
    scenarios,
  };

  const body = JSON.stringify(payload, null, 2);
  let sha;

  const existing = await fetch(apiUrl(), { headers: githubHeaders(token) });
  if (existing.ok) {
    const file = await existing.json();
    sha = file.sha;
  } else if (existing.status !== 404) {
    const err = await existing.json().catch(() => ({}));
    throw new Error(err.message ?? `GitHub API Fehler (${existing.status})`);
  }

  const putResponse = await fetch(apiUrl(), {
    method: "PUT",
    headers: {
      ...githubHeaders(token),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: `Szenarien aktualisiert (${authorName})`,
      content: encodeBase64Utf8(body),
      branch: GITHUB_BRANCH,
      ...(sha ? { sha } : {}),
    }),
  });

  if (!putResponse.ok) {
    const err = await putResponse.json().catch(() => ({}));
    throw new Error(err.message ?? `Speichern fehlgeschlagen (${putResponse.status})`);
  }

  cacheScenariosLocally(scenarios);
  return payload._meta;
}

export const sortScenarioNames = (scenarios) =>
  Object.keys(scenarios).sort((a, b) => a.localeCompare(b, "de-CH"));
