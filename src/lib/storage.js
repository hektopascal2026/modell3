/** localStorage-Präfix pro Deploy-Pfad (/modell3/, /modell4/, …) — keine Kollision auf gleicher Domain. */
export const appStoragePrefix = () => {
  const slug = (import.meta.env.BASE_URL ?? "/")
    .replace(/^\/+|\/+$/g, "")
    .replace(/\//g, "_");
  return slug ? `hekto_${slug}` : "hekto_root";
};

export const appStorageKey = (suffix) => `${appStoragePrefix()}_${suffix}`;

export const readAppPreference = (suffix, fallback = null) => {
  try {
    const raw = localStorage.getItem(appStorageKey(suffix));
    if (raw === null) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
};

export const writeAppPreference = (suffix, value) => {
  try {
    localStorage.setItem(appStorageKey(suffix), JSON.stringify(value));
  } catch {
    // ignore quota errors
  }
};

export const sessionAuthorKey = () => `${appStoragePrefix()}_author`;
