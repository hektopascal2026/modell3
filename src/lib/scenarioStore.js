import { appStorageKey } from "./storage.js";

const GITHUB_OWNER = "hektopascal2026";
const GITHUB_REPO = "modell3";
const SCENARIOS_PATH = "public/scenarios/scenarios.json";
const GITHUB_BRANCH = "main";
const localCacheKey = () => appStorageKey("scenarios_cache");

const SCENARIO_API_URL = import.meta.env.VITE_SCENARIO_API_URL?.trim() ?? "";
const SCENARIO_API_KEY = import.meta.env.VITE_SCENARIO_API_KEY?.trim() ?? "";
const GITHUB_TOKEN = import.meta.env.VITE_GITHUB_SCENARIO_TOKEN?.trim() ?? "";

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

/** Hosting-API (PHP auf Shared Hosting) — URL aus Env oder relativ zu BASE_URL. */
export const resolveScenarioApiUrl = () => {
  if (SCENARIO_API_URL) {
    if (/^https?:\/\//i.test(SCENARIO_API_URL)) return SCENARIO_API_URL;
    return new URL(SCENARIO_API_URL, window.location.origin).href;
  }
  const base = import.meta.env.BASE_URL ?? "/";
  return new URL("api/scenarios.php", window.location.origin + base).href;
};

const staticScenariosUrl = () => {
  const base = import.meta.env.BASE_URL ?? "/";
  return new URL("scenarios/scenarios.json", window.location.origin + base).href;
};

const hostingApiHeaders = (withAuth = false) => ({
  Accept: "application/json",
  ...(withAuth && SCENARIO_API_KEY ? { "X-Scenario-Key": SCENARIO_API_KEY } : {}),
});

const buildScenarioPayload = (scenarios, authorName) => ({
  _meta: {
    updatedAt: new Date().toISOString(),
    updatedBy: authorName,
  },
  scenarios,
});

export const cacheScenariosLocally = (scenarios) => {
  try {
    localStorage.setItem(localCacheKey(), JSON.stringify(scenarios));
  } catch {
    // ignore quota errors
  }
};

export const readLocalScenarioCache = () => {
  try {
    const raw = localStorage.getItem(localCacheKey());
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

async function tryFetchJson(url, options = {}) {
  const response = await fetch(`${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}`, {
    cache: "no-store",
    ...options,
  });
  if (!response.ok) return null;
  const payload = await response.json();
  return normalizePayload(payload);
}

async function saveScenariosViaHosting(scenarios, authorName) {
  if (!SCENARIO_API_KEY) {
    throw new Error("Hosting-API-Key fehlt (VITE_SCENARIO_API_KEY beim Build setzen).");
  }

  const payload = buildScenarioPayload(scenarios, authorName);
  const response = await fetch(resolveScenarioApiUrl(), {
    method: "POST",
    headers: {
      ...hostingApiHeaders(true),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error ?? `Hosting-Speichern fehlgeschlagen (${response.status})`);
  }

  cacheScenariosLocally(scenarios);
  return payload._meta;
}

async function saveScenariosViaGitHub(scenarios, authorName) {
  if (!GITHUB_TOKEN) {
    throw new Error(
      "GitHub-Token fehlt. Bitte VITE_GITHUB_SCENARIO_TOKEN in .env.local setzen (repo-Schreibrecht)."
    );
  }

  const payload = buildScenarioPayload(scenarios, authorName);
  const body = JSON.stringify(payload, null, 2);
  let sha;

  const existing = await fetch(apiUrl(), { headers: githubHeaders(GITHUB_TOKEN) });
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
      ...githubHeaders(GITHUB_TOKEN),
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

/** Load scenarios: Hosting-API → static JSON → GitHub → local cache → legacy. */
export async function fetchScenarios() {
  const sources = [
    { url: resolveScenarioApiUrl(), source: "hosting-api" },
    { url: staticScenariosUrl(), source: "static" },
    { url: rawUrl(), source: "remote" },
  ];

  for (const { url, source } of sources) {
    try {
      const normalized = await tryFetchJson(url);
      if (normalized) {
        cacheScenariosLocally(normalized.scenarios);
        return { ...normalized, source };
      }
    } catch {
      // try next source
    }
  }

  const cached = readLocalScenarioCache();
  if (Object.keys(cached).length > 0) {
    return { scenarios: cached, meta: null, source: "cache" };
  }

  const basePath = (import.meta.env.BASE_URL ?? "/").replace(/^\/+|\/+$/g, "");
  if (basePath === "modell3") {
    const legacy = readLegacyLocalScenarios();
    if (Object.keys(legacy).length > 0) {
      cacheScenariosLocally(legacy);
      return { scenarios: legacy, meta: null, source: "legacy" };
    }
  }

  return { scenarios: {}, meta: null, source: "empty" };
}

export async function saveScenarios(scenarios, { authorName = "unbekannt" } = {}) {
  const attempts = [];

  if (SCENARIO_API_KEY) {
    try {
      return await saveScenariosViaHosting(scenarios, authorName);
    } catch (error) {
      attempts.push(error);
    }
  }

  if (GITHUB_TOKEN) {
    try {
      return await saveScenariosViaGitHub(scenarios, authorName);
    } catch (error) {
      attempts.push(error);
    }
  }

  if (attempts.length > 0) {
    throw attempts[attempts.length - 1];
  }

  throw new Error(
    "Kein Speicher-Backend konfiguriert. VITE_SCENARIO_API_KEY (Shared Hosting) oder VITE_GITHUB_SCENARIO_TOKEN (Dev) setzen."
  );
}

export const sortScenarioNames = (scenarios) =>
  Object.keys(scenarios).sort((a, b) => a.localeCompare(b, "de-CH"));
