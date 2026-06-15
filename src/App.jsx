import { useEffect, useMemo, useRef, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import planData from "./data/finanzierungsplan20260614.json";
import { calcMindestliquiditaet, calcMonthlyPersonnel, calcYearlyPersonnel, deriveRoleStartMonth } from "./lib/personnel.js";
import {
  calcMonthlySachkosten,
  calcReserveMonthly,
  calcYearlyPerHeadCost,
  calcYearlyReserveCost,
  isPerHeadItem,
} from "./lib/sachkosten.js";
import {
  cacheScenariosLocally,
  fetchScenarios,
  readLegacyLocalScenarios,
  saveScenarios,
  sortScenarioNames,
} from "./lib/scenarioStore.js";
import { readAppPreference, sessionAuthorKey, writeAppPreference } from "./lib/storage.js";

const MONTHS = 48;
const currencyFormatter = new Intl.NumberFormat("de-CH", {
  style: "currency",
  currency: "CHF",
  maximumFractionDigits: 0,
});
const numberFormatter = new Intl.NumberFormat("de-CH");
const axisCurrencyFormatter = (value) => numberFormatter.format(Math.round(value));

const yearByMonth = (month) => {
  return Math.min(4, Math.ceil(month / 12));
};

const RESERVE_CHF = 100_000;

const clampPercent = (value) => Math.min(100, Math.max(0, value));
const clampNumber = (value) => (Number.isNaN(value) ? 0 : value);
/** Seed-Zufluss ist immer bei Planstart (Monat 0). */
const SEED_MONAT = 0;
const clampSeriesAMonat = (value) => Math.min(MONTHS, Math.max(1, clampNumber(value)));

function LabeledNumberInput({ label, value, onChange, step = 1, min = 0, max, helpText }) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  return (
    <label className="grid gap-2">
      <span className="text-sm font-semibold text-black">{label}</span>
      <input
        type="number"
        className="w-full border-2 border-black bg-white px-3 py-2 text-sm font-semibold text-black transition-shadow hover:shadow-[2px_2px_0px_#000] focus:bg-[#fafafa] focus:outline-none"
        value={draft}
        step={step}
        min={min}
        max={max}
        onChange={(event) => {
          const raw = event.target.value;
          setDraft(raw);
          if (raw === "") return;
          onChange(clampNumber(Number(raw)));
        }}
        onBlur={() => {
          if (draft === "") {
            setDraft("0");
            onChange(0);
          }
        }}
      />
      {helpText && <span className="text-xs text-gray-600 font-mono -mt-1">{helpText}</span>}
    </label>
  );
}

function LabeledSliderInput({ label, value, onChange, min = 0, max = 1000, step = 1 }) {
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between text-sm">
        <span className="font-semibold text-black">{label}</span>
        <span className="font-semibold text-black">{numberFormatter.format(value)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(clampNumber(Number(event.target.value)))}
        className="w-full accent-[#FF6B6B]"
      />
    </div>
  );
}

const formatArrMio = (arr) => (arr / 1_000_000).toFixed(2);

const calcArrSplit = (briefingMrr, monitorMrr) => {
  const totalMrr = briefingMrr + monitorMrr;
  if (totalMrr <= 0) {
    return { briefingPct: 0, monitorPct: 0, totalArr: 0 };
  }
  return {
    briefingPct: Math.round((briefingMrr / totalMrr) * 100),
    monitorPct: Math.round((monitorMrr / totalMrr) * 100),
    totalArr: totalMrr * 12,
  };
};

const buildUmsatzAbsatzplanungPlain = ({
  d,
  numberFormatter,
  currencyFormatter,
}) => `9.3 Umsatz- & Absatzplanung

Die Umsatzgenerierung erfolgt primär über wiederkehrende B2B-Lizenzerlöse (ARR) mit jährlicher Vorauszahlung.

Seed-Phase (Jahr 1 bis ${d.seriesAYear}):
- Premium-Briefings: Erreichen von ${numberFormatter.format(Math.round(d.seedBriefingActive))} aktiven Lizenzen über ca. ${d.seedBriefingAccounts} B2B-Accounts zu einem rabattierten Einstiegspreis von CHF ${numberFormatter.format(d.seedBriefingPriceAnnual)} pro Lizenz/Jahr.
- Monitor: Erreichen von ${numberFormatter.format(Math.round(d.seedMonitorActive))} aktiven Lizenzen zum Preis von CHF ${numberFormatter.format(d.monitorPriceAnnual)} pro Lizenz/Jahr.
- ARR-Ziel: CHF ${formatArrMio(d.seedArr)} Mio., zu ${d.seedArrBriefingPct} Prozent aus Premium-Briefings und zu ${d.seedArrMonitorPct} Prozent aus Monitor.

Series A-Phase (Jahr ${d.seriesAStartYear} bis 3):
- Premium-Briefings: Schrittweise Harmonisierung auf den regulären Zielpreis von CHF ${numberFormatter.format(d.targetBriefingPriceAnnual)} pro Lizenz/Jahr. Durch die Erschliessung neuer Themen-Nischen (vertikale Skalierung) steigt das Absatzvolumen auf ${numberFormatter.format(d.briefingSoldY3)} Lizenzen. Ende Jahr 2 sind ${numberFormatter.format(Math.round(d.briefingActiveY2))} Lizenzen aktiv. Ende Jahr 3 sind ${numberFormatter.format(Math.round(d.briefingActiveY3))} Lizenzen aktiv.
- Monitor: Das Absatzvolumen steigt auf ${numberFormatter.format(d.monitorSoldY3)} Lizenzen zum Preis von CHF ${numberFormatter.format(d.monitorPriceAnnual)} pro Lizenz/Jahr. Ende Jahr 2 sind ${numberFormatter.format(Math.round(d.monitorActiveY2))} Lizenzen aktiv. Ende Jahr 3 sind ${numberFormatter.format(Math.round(d.monitorActiveY3))} Lizenzen aktiv.
- ARR-Ziel: CHF ${formatArrMio(d.seriesAArr)} Mio., zu ${d.seriesAArrBriefingPct} Prozent aus Premium-Briefings und zu ${d.seriesAArrMonitorPct} Prozent aus Monitor.

Zusatz-Umsätze:
- Ab dem 1. Geschäftsjahr steuern exklusive, limitierte B2B-Sponsoringfenster planbar CHF ${numberFormatter.format(d.sponsoringY1Annual)} pro Jahr bei. Ab dem 2. Geschäftsjahr sind es ${numberFormatter.format(d.sponsoringY2Annual)} CHF pro Jahr.
- Anker-Kunde: Akquise eines Kunden im Monat ${d.ankerStartMonat > 0 ? d.ankerStartMonat : "—"} mit einer Spezialdienstleistung von ${d.ankerMonthly > 0 ? currencyFormatter.format(d.ankerMonthly) : "—"} pro Monat.`;

const buildInvestitionsplanPlain = ({ seedBetrag, seriesABetrag, numberFormatter }) => `9.1 Investitionsplan

Die Investitionen von Attaché konzentrieren sich in der Aufbauphase konsequent auf den technologischen Vorsprung und den Ausbau des proprietären Moats. Mit fortschreitender Finanzierung verschiebt sich der Fokus vom Produktlaunch hin zu Sales und Skalierung der Erlösströme Premium-Briefings, Monitor und Anker-Kunden-Lösungen.

* Pre-Seed- & Seed-Investitionen (Produkt & Core-Tech): Überführung der Prototypen („Seismo“ und „Magnitu“) in den Live-Betrieb, Launch des Gratis Briefings und Premium-Briefings (Bezahlprodukt), Aufbau der Monitor-Plattform (Investitionsvolumen: CHF ${numberFormatter.format(seedBetrag)}).
* Series A: Skalierung von Premium-Briefings und Monitor, Härtung der technischen Infrastruktur für Enterprise-Angebote (Anker-Kunde), redaktionelle Konsolidierung und Ausbau des Vertriebs (Investitionsvolumen: CHF ${numberFormatter.format(seriesABetrag)}).`;

const formatActiveLicensesPlain = (point, numberFormatter) => {
  if (!point) return "—";
  return `${numberFormatter.format(Math.round(point.aktiveBriefing))} Premium-Briefings, ${numberFormatter.format(Math.round(point.aktiveMonitor))} Monitor, ${numberFormatter.format(Math.round(point.aktiveAnker))} Anker-Kunde (gesamt ${numberFormatter.format(Math.round(point.aktiveKunden))} Lizenzen aktiv)`;
};

const buildBreakEvenAnalysePlain = ({
  breakEvenYearBaseline,
  breakEvenMonatBaseline,
  breakEvenPointBaseline,
  breakEvenYearTotal,
  breakEvenMonatTotal,
  breakEvenPointTotal,
  dummyData,
  seriesAMonat,
  spezialtopf,
  numberFormatter,
}) => {
  const baselineLine =
    breakEvenMonatBaseline != null
      ? `Ohne Monitor/Anker (Baseline): im ${breakEvenYearBaseline}. Geschäftsjahr (Monat ${breakEvenMonatBaseline}) bei ${formatActiveLicensesPlain(breakEvenPointBaseline, numberFormatter)}.`
      : "Ohne Monitor/Anker (Baseline): innerhalb von 48 Monaten nicht erreicht.";
  const totalLine =
    breakEvenMonatTotal != null
      ? `Mit Monitor/Anker (Gesamtmodell): im ${breakEvenYearTotal}. Geschäftsjahr (Monat ${breakEvenMonatTotal}) bei ${formatActiveLicensesPlain(breakEvenPointTotal, numberFormatter)}.`
      : "Mit Monitor/Anker (Gesamtmodell): innerhalb von 48 Monaten nicht erreicht.";

  return `9.10 Break-Even-Analyse & Szenarien

Die Gewinnschwelle (operativer Break-Even: Einnahmen ≥ Personal + Sachkosten + Spezialtopf, ohne Gewinnsteuer) wird plangemäss wie folgt erreicht:

* ${baselineLine}
* ${totalLine}

Die Series A-Finanzierung dient danach als Wachstumsbeschleuniger, um die Profitabilität auf internationaler Ebene zu replizieren.

Zur Absicherung wurden drei Szenarien modelliert:

* Base Case (Erwarteter Verlauf): Erreichen des Schweizer Break-Even nach ${dummyData.baseCaseMonths} Monaten (Gesamtmodell). Erfolgreiches Series A-Closing im Monat ${seriesAMonat} und anschliessender internationaler Rollout mit einer Ziel-EBIT-Marge von ${dummyData.ebitMargeY3} % im Jahr 3.
* Best Case (Skalierungs-Turbo): Extrem hohe Marktdurchdringung im ersten Jahr über direkte B2B2B-Verbandsrahmenverträge (Low CAC). Der Schweizer Markt trägt sich bereits nach ${dummyData.bestCaseMonths} Monaten selbst. Die Series A-Runde kann zu einer deutlich höheren Unternehmensbewertung als ursprünglich veranschlagt durchgeführt werden.
* Worst Case (Verzögerte Expansion): Der Schweizer Markteintritt benötigt aufgrund von Spardruck in der Verwaltung ${dummyData.worstCaseMonths} Monate länger bis zur Profitabilität. Das Series A-Closing verschiebt sich nach hinten. Der verlängerte Runway wird durch das gestaffelte Abrufen einer im Gesellschaftervertrag verankerten Meilenstein-Tranche der Seed-Investoren in Höhe von CHF ${numberFormatter.format(spezialtopf)} überbrückt.`;
};

const Highlight = ({ children }) => (
  <span className="bg-[#FFE600] text-black font-bold px-1 border border-black">{children}</span>
);

function KPI({ title, value, helpText }) {
  return (
    <div className="border-2 border-black bg-white p-4 transition-shadow hover:shadow-[2px_2px_0px_#000]">
      <p className="text-xs font-normal text-black">{title}</p>
      <p className="mt-1 text-lg font-bold text-black">{value}</p>
      <p className="mt-1 text-xs font-normal text-black">{helpText}</p>
    </div>
  );
}

function SplitKPI({ title, helpText, entries }) {
  return (
    <div className="border-2 border-black bg-white p-4 transition-shadow hover:shadow-[2px_2px_0px_#000]">
      <p className="text-xs font-normal text-black">{title}</p>
      <div className="mt-2 space-y-1.5">
        {entries.map((entry) => (
          <div key={entry.label} className="flex items-start justify-between gap-2 text-sm">
            <span className="text-xs text-gray-700 leading-snug">{entry.label}</span>
            <span className="font-bold text-black text-right leading-snug">{entry.value}</span>
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs font-normal text-black">{helpText}</p>
    </div>
  );
}

const normalizeSachkosten = (items) =>
  items.map((item) => ({
    ...item,
    costY4: item.costY4 ?? item.costY3 ?? 0,
  }));

const DEFAULT_ROLES = planData.roles.map((r) => ({
  ...r,
  monthsY4: r.monthsY4 ?? r.monthsY3 ?? 0,
  startMonth: r.startMonth ?? deriveRoleStartMonth(r),
}));

const DEFAULT_SACHKOSTEN = normalizeSachkosten(planData.sachkosten);

const DEFAULTS = {
  seedBetrag: 1000000,
  seriesABetrag: 0,
  seriesAMonat: 12,
  preSeedAfondPerdu: 100000,
  preSeedBridge: 50000,
  neueKundenJ1: 40,
  neueKundenJ2: 80,
  neueKundenJ3: 120,
  neueKundenJ4: 120,
  preisJ1: 60,
  preisAbJ2: 80,
  preisAbJ3: 100,
  verlaengerungNachJ1: 85,
  verlaengerungNachJ2: 90,
  verlaengerungNachJ3: 92,
  sponsoringJahr1: 0,
  sponsoringJahr2: 10000,
  sponsoringJahr3: 10000,
  sponsoringJahr4: 10000,
  monitorStartMonat: 0,
  monitorNeueLizenzenProMonat: 0,
  monitorPreisProLizenz: 0,
  ankerStartMonat: 0,
  ankerPreisProLizenz: 0,
  ankerAnzahlLizenzen: 0,
  roles: DEFAULT_ROLES,
  sachkostenItems: DEFAULT_SACHKOSTEN,
  sozialabgabenProzent: 16.0,
  gewinnsteuerRate: 18.0,
  spezialtopf: 0,
};

function App() {
  const scenariosHydrated = useRef(false);
  const [activeTab, setActiveTab] = useState("inputs"); // "inputs" | "calc" | "charts"
  const [seedBetrag, setSeedBetrag] = useState(DEFAULTS.seedBetrag);
  const [seriesABetrag, setSeriesABetrag] = useState(DEFAULTS.seriesABetrag);
  const [seriesAMonat, setSeriesAMonat] = useState(DEFAULTS.seriesAMonat);
  const [preSeedAfondPerdu, setPreSeedAfondPerdu] = useState(DEFAULTS.preSeedAfondPerdu);
  const [preSeedBridge, setPreSeedBridge] = useState(DEFAULTS.preSeedBridge);

  const startkapital = seedBetrag;

  const [neueKundenJ1, setNeueKundenJ1] = useState(DEFAULTS.neueKundenJ1);
  const [neueKundenJ2, setNeueKundenJ2] = useState(DEFAULTS.neueKundenJ2);
  const [neueKundenJ3, setNeueKundenJ3] = useState(DEFAULTS.neueKundenJ3);
  const [neueKundenJ4, setNeueKundenJ4] = useState(DEFAULTS.neueKundenJ4);
  const [preisJ1, setPreisJ1] = useState(DEFAULTS.preisJ1);
  const [preisAbJ2, setPreisAbJ2] = useState(DEFAULTS.preisAbJ2);
  const [preisAbJ3, setPreisAbJ3] = useState(DEFAULTS.preisAbJ3);
  const [verlaengerungNachJ1, setVerlaengerungNachJ1] = useState(DEFAULTS.verlaengerungNachJ1);
  const [verlaengerungNachJ2, setVerlaengerungNachJ2] = useState(DEFAULTS.verlaengerungNachJ2);
  const [verlaengerungNachJ3, setVerlaengerungNachJ3] = useState(DEFAULTS.verlaengerungNachJ3);
  const [sponsoringJahr1, setSponsoringJahr1] = useState(DEFAULTS.sponsoringJahr1);
  const [sponsoringJahr2, setSponsoringJahr2] = useState(DEFAULTS.sponsoringJahr2);
  const [sponsoringJahr3, setSponsoringJahr3] = useState(DEFAULTS.sponsoringJahr3);
  const [sponsoringJahr4, setSponsoringJahr4] = useState(DEFAULTS.sponsoringJahr4);
  const [monitorStartMonat, setMonitorStartMonat] = useState(DEFAULTS.monitorStartMonat);
  const [monitorNeueLizenzenProMonat, setMonitorNeueLizenzenProMonat] = useState(
    DEFAULTS.monitorNeueLizenzenProMonat
  );
  const [monitorPreisProLizenz, setMonitorPreisProLizenz] = useState(DEFAULTS.monitorPreisProLizenz);
  const [ankerStartMonat, setAnkerStartMonat] = useState(DEFAULTS.ankerStartMonat);
  const [ankerPreisProLizenz, setAnkerPreisProLizenz] = useState(DEFAULTS.ankerPreisProLizenz);
  const [ankerAnzahlLizenzen, setAnkerAnzahlLizenzen] = useState(DEFAULTS.ankerAnzahlLizenzen);

  const [roles, setRoles] = useState(DEFAULTS.roles);
  const [sachkostenItems, setSachkostenItems] = useState(DEFAULTS.sachkostenItems);
  const [sozialabgabenProzent, setSozialabgabenProzent] = useState(DEFAULTS.sozialabgabenProzent);
  const [gewinnsteuerRate, setGewinnsteuerRate] = useState(DEFAULTS.gewinnsteuerRate);
  const [spezialtopf, setSpezialtopf] = useState(DEFAULTS.spezialtopf);

  const [scenarioMap, setScenarioMap] = useState({});
  const [selectedScenario, setSelectedScenario] = useState("");
  const [scenariosLoading, setScenariosLoading] = useState(true);
  const [scenariosSaving, setScenariosSaving] = useState(false);
  const [scenarioMeta, setScenarioMeta] = useState(null);
  const [scenarioSource, setScenarioSource] = useState("");

  const scenarioNames = useMemo(() => sortScenarioNames(scenarioMap), [scenarioMap]);

  const reserveItem = useMemo(() => sachkostenItems.find((i) => i.id === "sach-23"), [sachkostenItems]);

  const updateRole = (id, field, value) => {
    setRoles((prev) =>
      prev.map((role) => {
        if (role.id !== id) return role;
        const next = { ...role, [field]: value };
        if (field === "monthsY3") next.monthsY4 = value;
        if (field === "monthsY1" || field === "monthsY2" || field === "monthsY3" || field === "monthsY4") {
          next.startMonth = deriveRoleStartMonth(next);
        }
        return next;
      })
    );
  };

  const updateSachkosten = (id, field, value) => {
    setSachkostenItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        const next = { ...item, [field]: value };
        if (field === "costY3") next.costY4 = value;
        return next;
      })
    );
  };

  const collectScenarioSnapshot = () => ({
    seedBetrag,
    seedMonat: SEED_MONAT,
    seriesABetrag,
    seriesAMonat,
    preSeedAfondPerdu,
    preSeedBridge,
    neueKundenJ1,
    neueKundenJ2,
    neueKundenJ3,
    neueKundenJ4,
    preisJ1,
    preisAbJ2,
    preisAbJ3,
    verlaengerungNachJ1,
    verlaengerungNachJ2,
    verlaengerungNachJ3,
    sponsoringJahr1,
    sponsoringJahr2,
    sponsoringJahr3,
    sponsoringJahr4,
    monitorStartMonat,
    monitorNeueLizenzenProMonat,
    monitorPreisProLizenz,
    ankerStartMonat,
    ankerPreisProLizenz,
    ankerAnzahlLizenzen,
    roles,
    sachkostenItems,
    sozialabgabenProzent,
    gewinnsteuerRate,
    spezialtopf,
    savedAt: new Date().toISOString(),
  });

  const applyScenarioSnapshot = (data) => {
    if (data.seedBetrag !== undefined) setSeedBetrag(data.seedBetrag);
    if (data.seriesABetrag !== undefined) setSeriesABetrag(data.seriesABetrag);
    if (data.seriesAMonat !== undefined) setSeriesAMonat(clampSeriesAMonat(data.seriesAMonat));
    if (data.preSeedAfondPerdu !== undefined) setPreSeedAfondPerdu(data.preSeedAfondPerdu);
    if (data.preSeedBridge !== undefined) setPreSeedBridge(data.preSeedBridge);
    if (data.neueKundenJ1 !== undefined) setNeueKundenJ1(data.neueKundenJ1);
    if (data.neueKundenJ2 !== undefined) setNeueKundenJ2(data.neueKundenJ2);
    if (data.neueKundenJ3 !== undefined) setNeueKundenJ3(data.neueKundenJ3);
    if (data.neueKundenJ4 !== undefined) setNeueKundenJ4(data.neueKundenJ4);
    if (data.preisJ1 !== undefined) setPreisJ1(data.preisJ1);
    if (data.preisAbJ2 !== undefined) setPreisAbJ2(data.preisAbJ2);
    if (data.preisAbJ3 !== undefined) setPreisAbJ3(data.preisAbJ3);
    if (data.verlaengerungNachJ1 !== undefined) setVerlaengerungNachJ1(data.verlaengerungNachJ1);
    if (data.verlaengerungNachJ2 !== undefined) setVerlaengerungNachJ2(data.verlaengerungNachJ2);
    if (data.verlaengerungNachJ3 !== undefined) setVerlaengerungNachJ3(data.verlaengerungNachJ3);
    if (data.sponsoringJahr1 !== undefined) setSponsoringJahr1(data.sponsoringJahr1);
    if (data.sponsoringJahr2 !== undefined) setSponsoringJahr2(data.sponsoringJahr2);
    if (data.sponsoringJahr3 !== undefined) setSponsoringJahr3(data.sponsoringJahr3);
    if (data.sponsoringJahr4 !== undefined) setSponsoringJahr4(data.sponsoringJahr4);
    if (data.monitorStartMonat !== undefined) setMonitorStartMonat(data.monitorStartMonat);
    if (data.monitorNeueLizenzenProMonat !== undefined) setMonitorNeueLizenzenProMonat(data.monitorNeueLizenzenProMonat);
    if (data.monitorPreisProLizenz !== undefined) setMonitorPreisProLizenz(data.monitorPreisProLizenz);
    if (data.ankerStartMonat !== undefined) setAnkerStartMonat(data.ankerStartMonat);
    if (data.ankerPreisProLizenz !== undefined) setAnkerPreisProLizenz(data.ankerPreisProLizenz);
    if (data.ankerAnzahlLizenzen !== undefined) setAnkerAnzahlLizenzen(data.ankerAnzahlLizenzen);
    if (data.roles !== undefined) setRoles(data.roles);
    if (data.sachkostenItems !== undefined) setSachkostenItems(normalizeSachkosten(data.sachkostenItems));
    if (data.sozialabgabenProzent !== undefined) setSozialabgabenProzent(data.sozialabgabenProzent);
    if (data.gewinnsteuerRate !== undefined) setGewinnsteuerRate(data.gewinnsteuerRate);
    if (data.spezialtopf !== undefined) setSpezialtopf(data.spezialtopf);
  };

  const refreshScenarios = async ({ hydrate = false } = {}) => {
    setScenariosLoading(true);
    try {
      const { scenarios, meta, source } = await fetchScenarios();
      setScenarioMap(scenarios);
      setScenarioMeta(meta);
      setScenarioSource(source);

      if (hydrate && !scenariosHydrated.current) {
        scenariosHydrated.current = true;
        const savedName = readAppPreference("selectedScenario", "");
        const nameToLoad =
          (savedName && scenarios[savedName] && savedName) || (scenarios.Standard ? "Standard" : null);
        if (nameToLoad) {
          applyScenarioSnapshot(scenarios[nameToLoad]);
          setSelectedScenario(nameToLoad);
        }
      } else if (selectedScenario && !scenarios[selectedScenario]) {
        setSelectedScenario("");
      }
    } finally {
      setScenariosLoading(false);
    }
  };

  useEffect(() => {
    refreshScenarios({ hydrate: true });
  }, []);

  const persistScenario = async (name, snapshot) => {
    const nextMap = { ...scenarioMap, [name]: snapshot };
    let authorName = sessionStorage.getItem(sessionAuthorKey());
    if (!authorName) {
      authorName = window.prompt("Dein Name (einmalig, für Protokoll):", "")?.trim() || "unbekannt";
      sessionStorage.setItem(sessionAuthorKey(), authorName);
    }
    setScenariosSaving(true);
    try {
      const meta = await saveScenarios(nextMap, { authorName });
      setScenarioMap(nextMap);
      setScenarioMeta(meta);
      setScenarioSource("remote");
      setSelectedScenario(name);
      writeAppPreference("selectedScenario", name);
      return true;
    } finally {
      setScenariosSaving(false);
    }
  };

  const handleSaveScenario = async () => {
    let name = selectedScenario;
    if (!name) {
      name = window.prompt("Name für neues Szenario:", "Szenario 1")?.trim();
    }
    if (!name) return;

    try {
      await persistScenario(name, collectScenarioSnapshot());
      alert(`Szenario «${name}» gespeichert (für alle Geräte).`);
    } catch (error) {
      cacheScenariosLocally({ ...scenarioMap, [name]: collectScenarioSnapshot() });
      alert(`${error.message}\n\nLokal zwischengespeichert — Remote-Sync fehlgeschlagen.`);
    }
  };

  const handleSaveScenarioAsNew = async () => {
    const name = window.prompt("Name für neues Szenario:", "Szenario 1")?.trim();
    if (!name) return;
    if (scenarioMap[name] && !window.confirm(`«${name}» existiert bereits. Überschreiben?`)) return;

    try {
      await persistScenario(name, collectScenarioSnapshot());
      alert(`Szenario «${name}» gespeichert (für alle Geräte).`);
    } catch (error) {
      alert(error.message);
    }
  };

  const handleLoadScenario = () => {
    if (!selectedScenario) {
      alert("Bitte zuerst ein Szenario im Dropdown wählen.");
      return;
    }
    const data = scenarioMap[selectedScenario];
    if (!data) {
      alert("Szenario nicht gefunden.");
      return;
    }
    applyScenarioSnapshot(data);
    writeAppPreference("selectedScenario", selectedScenario);
  };

  const handleMigrateLegacyScenarios = async () => {
    const legacy = readLegacyLocalScenarios();
    const names = Object.keys(legacy);
    if (names.length === 0) {
      alert("Keine lokalen Alt-Szenarien (hekto3_templates) gefunden.");
      return;
    }
    if (!window.confirm(`${names.length} lokale Szenarien remote speichern?`)) return;

    const merged = { ...scenarioMap, ...legacy };
    try {
      const authorName = window.prompt("Dein Name:", "")?.trim() || "migration";
      setScenariosSaving(true);
      const meta = await saveScenarios(merged, { authorName });
      setScenarioMap(merged);
      setScenarioMeta(meta);
      setScenarioSource("remote");
      alert("Lokale Szenarien migriert.");
    } catch (error) {
      alert(error.message);
    } finally {
      setScenariosSaving(false);
    }
  };

  const handleReset = () => {
    setSeedBetrag(DEFAULTS.seedBetrag);
    setSeriesABetrag(DEFAULTS.seriesABetrag);
    setSeriesAMonat(DEFAULTS.seriesAMonat);
    setPreSeedAfondPerdu(DEFAULTS.preSeedAfondPerdu);
    setPreSeedBridge(DEFAULTS.preSeedBridge);
    setNeueKundenJ1(DEFAULTS.neueKundenJ1);
    setNeueKundenJ2(DEFAULTS.neueKundenJ2);
    setNeueKundenJ3(DEFAULTS.neueKundenJ3);
    setNeueKundenJ4(DEFAULTS.neueKundenJ4);
    setPreisJ1(DEFAULTS.preisJ1);
    setPreisAbJ2(DEFAULTS.preisAbJ2);
    setPreisAbJ3(DEFAULTS.preisAbJ3);
    setVerlaengerungNachJ1(DEFAULTS.verlaengerungNachJ1);
    setVerlaengerungNachJ2(DEFAULTS.verlaengerungNachJ2);
    setVerlaengerungNachJ3(DEFAULTS.verlaengerungNachJ3);
    setSponsoringJahr1(DEFAULTS.sponsoringJahr1);
    setSponsoringJahr2(DEFAULTS.sponsoringJahr2);
    setSponsoringJahr3(DEFAULTS.sponsoringJahr3);
    setSponsoringJahr4(DEFAULTS.sponsoringJahr4);
    setMonitorStartMonat(DEFAULTS.monitorStartMonat);
    setMonitorNeueLizenzenProMonat(DEFAULTS.monitorNeueLizenzenProMonat);
    setMonitorPreisProLizenz(DEFAULTS.monitorPreisProLizenz);
    setAnkerStartMonat(DEFAULTS.ankerStartMonat);
    setAnkerPreisProLizenz(DEFAULTS.ankerPreisProLizenz);
    setAnkerAnzahlLizenzen(DEFAULTS.ankerAnzahlLizenzen);
    setRoles(DEFAULTS.roles);
    setSachkostenItems(DEFAULTS.sachkostenItems);
    setSozialabgabenProzent(DEFAULTS.sozialabgabenProzent);
    setGewinnsteuerRate(DEFAULTS.gewinnsteuerRate);
    setSpezialtopf(DEFAULTS.spezialtopf);
    setSelectedScenario("");
    writeAppPreference("selectedScenario", "");
  };

  const simulation = useMemo(() => {
    const sponsoringByYear = (year) =>
      year === 1 ? sponsoringJahr1 : year === 2 ? sponsoringJahr2 : year === 3 ? sponsoringJahr3 : sponsoringJahr4;
    const renew1 = clampPercent(verlaengerungNachJ1) / 100;
    const renew2 = clampPercent(verlaengerungNachJ2) / 100;
    const renew3 = clampPercent(verlaengerungNachJ3) / 100;

    const points = [];
    const personalkostenByMonth = new Array(MONTHS + 1).fill(0);
    const briefingCohorts = [];
    const monitorCohorts = [];
    let cashbestandTotal = startkapital;
    let cashbestandBaseline = startkapital;
    let verkaufteAbosBriefing = 0;
    let verkaufteAbosMonitor = 0;
    let verkaufteAbosAnker = 0;

    const briefingPreisNachAlter = (age) => {
      if (age < 12) return preisJ1;
      if (age < 24) return preisAbJ2;
      return preisAbJ3;
    };

    for (let month = 1; month <= MONTHS; month += 1) {
      let fundingInflow = 0;
      if (seriesAMonat === month) fundingInflow += seriesABetrag;

      const year = yearByMonth(month);
      const neueBriefing =
        year === 1 ? neueKundenJ1 : year === 2 ? neueKundenJ2 : year === 3 ? neueKundenJ3 : neueKundenJ4;
      const sponsoringProMonat = sponsoringByYear(year);
      let briefingCashInflow = 0;
      let monitorCashInflow = 0;

      for (let i = 0; i < briefingCohorts.length; i += 1) {
        briefingCohorts[i].age += 1;
        if (briefingCohorts[i].age === 12) {
          briefingCohorts[i].size *= renew1;
          briefingCashInflow += briefingCohorts[i].size * preisAbJ2 * 12;
        }
        if (briefingCohorts[i].age === 24) {
          briefingCohorts[i].size *= renew2;
          briefingCashInflow += briefingCohorts[i].size * preisAbJ3 * 12;
        }
        if (briefingCohorts[i].age === 36) {
          briefingCohorts[i].size *= renew3;
          briefingCashInflow += briefingCohorts[i].size * preisAbJ3 * 12;
        }
      }

      briefingCashInflow += neueBriefing * preisJ1 * 12;
      briefingCohorts.push({ size: neueBriefing, age: 0 });
      verkaufteAbosBriefing += neueBriefing;

      const neueMonitor =
        monitorStartMonat > 0 && month >= monitorStartMonat ? monitorNeueLizenzenProMonat : 0;

      for (let i = 0; i < monitorCohorts.length; i += 1) {
        monitorCohorts[i].age += 1;
        if (monitorCohorts[i].age === 12 || monitorCohorts[i].age === 24 || monitorCohorts[i].age === 36) {
          monitorCohorts[i].size *= renew1;
          monitorCashInflow += monitorCohorts[i].size * monitorPreisProLizenz * 12;
        }
      }

      if (neueMonitor > 0) {
        monitorCashInflow += neueMonitor * monitorPreisProLizenz * 12;
        monitorCohorts.push({ size: neueMonitor, age: 0 });
        verkaufteAbosMonitor += neueMonitor;
      }

      const aktiveBriefing = briefingCohorts.reduce((sum, cohort) => sum + cohort.size, 0);
      const aktiveMonitor = monitorCohorts.reduce((sum, cohort) => sum + cohort.size, 0);
      const aktiveAnker =
        ankerStartMonat > 0 && month >= ankerStartMonat ? ankerAnzahlLizenzen : 0;
      if (month === ankerStartMonat && ankerStartMonat > 0 && ankerAnzahlLizenzen > 0) {
        verkaufteAbosAnker += ankerAnzahlLizenzen;
      }

      const umsatzBriefing = briefingCohorts.reduce(
        (sum, cohort) => sum + cohort.size * briefingPreisNachAlter(cohort.age),
        0
      );
      const umsatzMonitor = monitorCohorts.reduce(
        (sum, cohort) => sum + cohort.size * monitorPreisProLizenz,
        0
      );
      const umsatzAnker = aktiveAnker * ankerPreisProLizenz;

      const baselineGesamteinnahmen = umsatzBriefing + sponsoringProMonat;
      const gesamteinnahmen = baselineGesamteinnahmen + umsatzMonitor + umsatzAnker;

      const baselineCashwirksameEinnahmen = briefingCashInflow + sponsoringProMonat;
      const cashwirksameEinnahmen = baselineCashwirksameEinnahmen + monitorCashInflow + umsatzAnker;

      const personnel = calcMonthlyPersonnel(roles, month, sozialabgabenProzent);
      const { total: sachkostenBase, breakdown } = calcMonthlySachkosten(sachkostenItems, month, {
        headSum: personnel.headSum,
      });
      const reserve = calcReserveMonthly(sachkostenItems, month, reserveItem, breakdown);
      const sachkosten = sachkostenBase + reserve;
      const aufwandOhneGewinnsteuer = personnel.personalkosten + sachkosten;

      const baselineEbita = baselineGesamteinnahmen - aufwandOhneGewinnsteuer;
      const totalEbita = gesamteinnahmen - aufwandOhneGewinnsteuer;
      const baselineGewinnsteuer = baselineEbita > 0 ? baselineEbita * (gewinnsteuerRate / 100) : 0;
      const gewinnsteuer = totalEbita > 0 ? totalEbita * (gewinnsteuerRate / 100) : 0;

      personalkostenByMonth[month] = personnel.personalkosten;
      const spezialtopfKosten = month <= 36 ? spezialtopf / 36 : 0;
      const baselineGesamtausgaben = aufwandOhneGewinnsteuer + baselineGewinnsteuer + spezialtopfKosten;
      const gesamtausgaben = aufwandOhneGewinnsteuer + gewinnsteuer + spezialtopfKosten;

      cashbestandBaseline += baselineCashwirksameEinnahmen - baselineGesamtausgaben + fundingInflow;
      cashbestandTotal += cashwirksameEinnahmen - gesamtausgaben + fundingInflow;

      points.push({
        month,
        year,
        aktiveBriefing: Math.max(0, aktiveBriefing),
        aktiveMonitor: Math.max(0, aktiveMonitor),
        aktiveAnker: Math.max(0, aktiveAnker),
        aktiveKunden: Math.max(0, aktiveBriefing + aktiveMonitor + aktiveAnker),
        umsatzLizenzen: umsatzBriefing,
        umsatzMonitor,
        umsatzAnker,
        baselineGesamteinnahmen,
        gesamteinnahmen,
        baselineCashwirksameEinnahmen,
        cashwirksameEinnahmen,
        baselineGesamtausgaben,
        gesamtausgaben,
        bruttolohn: personnel.bruttolohn,
        sozialabgaben: personnel.sozialabgaben,
        personalkosten: personnel.personalkosten,
        sachkosten,
        baselineGewinnsteuer,
        gewinnsteuer,
        fteSum: personnel.fteSum,
        headSum: personnel.headSum,
        spezialtopfKosten,
        fundingInflow,
        sponsoringProMonat,
        baselineOperativeAusgaben: personnel.personalkosten + sachkosten + spezialtopfKosten,
        baselineCashbestand: cashbestandBaseline,
        cashbestand: cashbestandTotal,
        verkaufteAbosBriefing,
        verkaufteAbosMonitor,
        verkaufteAbosAnker,
      });
    }

    for (let i = 0; i < points.length; i += 1) {
      const m = points[i].month;
      const { personalkosten3Monate, mindestliquiditaet } = calcMindestliquiditaet(personalkostenByMonth, m, RESERVE_CHF);
      points[i].mindestliquiditaet = mindestliquiditaet;
      points[i].personalkosten3Monate = personalkosten3Monate;
      points[i].baselineLiquiditaetspuffer = points[i].baselineCashbestand - mindestliquiditaet;
      points[i].liquiditaetspuffer = points[i].cashbestand - mindestliquiditaet;
      points[i].deltaEinnahmen = points[i].umsatzMonitor + points[i].umsatzAnker;
      points[i].deltaCashbestand = points[i].cashbestand - points[i].baselineCashbestand;
      points[i].deltaLiquiditaetspuffer = points[i].liquiditaetspuffer - points[i].baselineLiquiditaetspuffer;
    }

    return points;
  }, [
    roles,
    sachkostenItems,
    reserveItem,
    sozialabgabenProzent,
    gewinnsteuerRate,
    spezialtopf,
    neueKundenJ1,
    neueKundenJ2,
    neueKundenJ3,
    neueKundenJ4,
    preisAbJ2,
    preisAbJ3,
    preisJ1,
    sponsoringJahr1,
    sponsoringJahr2,
    sponsoringJahr3,
    sponsoringJahr4,
    monitorStartMonat,
    monitorNeueLizenzenProMonat,
    monitorPreisProLizenz,
    ankerStartMonat,
    ankerPreisProLizenz,
    ankerAnzahlLizenzen,
    seedBetrag,
    seriesABetrag,
    seriesAMonat,
    startkapital,
    verlaengerungNachJ1,
    verlaengerungNachJ2,
    verlaengerungNachJ3,
  ]);

  const month48 = simulation[simulation.length - 1];
  const month36 = simulation[35] ?? month48;

  const breakEvenMonatBaseline = useMemo(() => {
    const hit = simulation.find(
      (p) => p.baselineGesamteinnahmen >= p.personalkosten + p.sachkosten + p.spezialtopfKosten
    );
    return hit ? hit.month : null;
  }, [simulation]);

  const breakEvenMonatTotal = useMemo(() => {
    const hit = simulation.find(
      (p) => p.gesamteinnahmen >= p.personalkosten + p.sachkosten + p.spezialtopfKosten
    );
    return hit ? hit.month : null;
  }, [simulation]);

  const breakEvenMonat = breakEvenMonatTotal;
  const breakEvenPointBaseline =
    breakEvenMonatBaseline != null ? simulation[breakEvenMonatBaseline - 1] : null;
  const breakEvenPointTotal = breakEvenMonatTotal != null ? simulation[breakEvenMonatTotal - 1] : null;
  const breakEvenPoint = breakEvenPointTotal;

  const ersteFloorVerletzung = useMemo(() => {
    const hit = simulation.find((p) => p.liquiditaetspuffer < 0);
    return hit ? hit.month : null;
  }, [simulation]);

  const runwayMonate = useMemo(() => {
    if (startkapital < 0) return 0;
    const firstNegative = simulation.find((point) => point.cashbestand < 0);
    return firstNegative ? firstNegative.month : "48+";
  }, [simulation, startkapital]);

  const kapitalAnalyse = useMemo(() => {
    const minPuffer = Math.min(...simulation.map((p) => p.liquiditaetspuffer));
    const minPufferBaseline = Math.min(...simulation.map((p) => p.baselineLiquiditaetspuffer));
    const erforderlichesStartkapital = Math.max(0, startkapital - minPuffer);
    const erforderlichesStartkapitalBaseline = Math.max(0, startkapital - minPufferBaseline);
    const chartData = simulation.map((p) => ({
      ...p,
      startkapitalBeiTouchInMonat: Math.max(0, startkapital - p.liquiditaetspuffer),
      erforderlichesStartkapital,
    }));
    return {
      minPuffer,
      minPufferBaseline,
      erforderlichesStartkapital,
      erforderlichesStartkapitalBaseline,
      chartData,
    };
  }, [simulation, startkapital]);

  const gewinnjahrEbt = useMemo(() => {
    const ebtByYear = simulation.reduce((acc, point) => {
      const ebtMonat = point.gesamteinnahmen - point.gesamtausgaben;
      acc[point.year] = (acc[point.year] ?? 0) + ebtMonat;
      return acc;
    }, {});
    const firstProfitableYear = [1, 2, 3, 4].find((year) => (ebtByYear[year] ?? 0) > 0);
    return {
      year: firstProfitableYear ?? null,
      ebt: firstProfitableYear ? ebtByYear[firstProfitableYear] : null,
    };
  }, [simulation]);

  const calcDetails = useMemo(() => {
    const renewRate1 = clampPercent(verlaengerungNachJ1) / 100;
    const renewRate2 = clampPercent(verlaengerungNachJ2) / 100;

    const y1_sold = neueKundenJ1 * 12;
    const y1_rev = y1_sold * preisJ1 * 12;

    const y2_renew_count = y1_sold * renewRate1;
    const y2_renew_rev = y2_renew_count * preisAbJ2 * 12;
    const y2_new_sold = neueKundenJ2 * 12;
    const y2_new_rev = y2_new_sold * preisJ1 * 12;
    const y2_total_rev = y2_renew_rev + y2_new_rev;

    const y3_renew_orig_count = y2_renew_count * renewRate2;
    const y3_renew_orig_rev = y3_renew_orig_count * preisAbJ3 * 12;
    const y3_renew_y2_count = y2_new_sold * renewRate1;
    const y3_renew_y2_rev = y3_renew_y2_count * preisAbJ2 * 12;
    const y3_new_sold = neueKundenJ3 * 12;
    const y3_new_rev = y3_new_sold * preisJ1 * 12;
    const y3_total_rev = y3_renew_orig_rev + y3_renew_y2_rev + y3_new_rev;

    return {
      y1_sold,
      y1_rev,
      y2_renew_count,
      y2_renew_rev,
      y2_new_sold,
      y2_new_rev,
      y2_total_rev,
      y3_renew_orig_count,
      y3_renew_orig_rev,
      y3_renew_y2_count,
      y3_renew_y2_rev,
      y3_new_sold,
      y3_new_rev,
      y3_total_rev,
    };
  }, [
    neueKundenJ1,
    neueKundenJ2,
    neueKundenJ3,
    preisJ1,
    preisAbJ2,
    preisAbJ3,
    verlaengerungNachJ1,
    verlaengerungNachJ2,
  ]);

  const monitorCalcDetails = useMemo(() => {
    if (monitorStartMonat <= 0 || monitorNeueLizenzenProMonat <= 0 || monitorPreisProLizenz <= 0) {
      return { active: false };
    }
    const years = [1, 2, 3].map((y) => {
      const startM = (y - 1) * 12 + 1;
      const endM = y * 12;
      const yearPoints = simulation.filter((p) => p.month >= startM && p.month <= endM);
      const soldBeforeYear = startM > 1 ? (simulation[startM - 2]?.verkaufteAbosMonitor ?? 0) : 0;
      const soldInYear = (simulation[endM - 1]?.verkaufteAbosMonitor ?? 0) - soldBeforeYear;
      const umsatzJahr = yearPoints.reduce((sum, p) => sum + p.umsatzMonitor, 0);
      const endPoint = simulation[endM - 1];
      return {
        year: y,
        soldInYear,
        umsatzJahr,
        endActive: endPoint?.aktiveMonitor ?? 0,
        endMrr: endPoint?.umsatzMonitor ?? 0,
      };
    });
    return {
      active: true,
      startMonat: monitorStartMonat,
      neueProMonat: monitorNeueLizenzenProMonat,
      preis: monitorPreisProLizenz,
      years,
    };
  }, [simulation, monitorStartMonat, monitorNeueLizenzenProMonat, monitorPreisProLizenz]);

  const ankerCalcDetails = useMemo(() => {
    if (ankerStartMonat <= 0 || ankerAnzahlLizenzen <= 0 || ankerPreisProLizenz <= 0) {
      return { active: false };
    }
    const monatsMrr = ankerAnzahlLizenzen * ankerPreisProLizenz;
    const years = [1, 2, 3].map((y) => {
      const startM = (y - 1) * 12 + 1;
      const endM = y * 12;
      const yearPoints = simulation.filter((p) => p.month >= startM && p.month <= endM);
      const monthsActive =
        ankerStartMonat > endM ? 0 : ankerStartMonat <= startM ? 12 : endM - ankerStartMonat + 1;
      const umsatzJahr = yearPoints.reduce((sum, p) => sum + p.umsatzAnker, 0);
      return {
        year: y,
        monthsActive,
        umsatzJahr,
        endMrr: simulation[endM - 1]?.umsatzAnker ?? 0,
      };
    });
    return {
      active: true,
      startMonat: ankerStartMonat,
      lizenzen: ankerAnzahlLizenzen,
      preis: ankerPreisProLizenz,
      monatsMrr,
      years,
    };
  }, [simulation, ankerStartMonat, ankerAnzahlLizenzen, ankerPreisProLizenz]);

  const kennzahlen = useMemo(() => {
    const years = [1, 2, 3];
    const results = years.map((y) => {
      const startM = (y - 1) * 12 + 1;
      const endM = y * 12;
      const yearPoints = simulation.filter((p) => p.month >= startM && p.month <= endM);

      const lastMonthPoint = simulation[endM - 1] || yearPoints[yearPoints.length - 1];
      const arr = lastMonthPoint
        ? (lastMonthPoint.umsatzLizenzen + lastMonthPoint.umsatzMonitor + lastMonthPoint.umsatzAnker) * 12
        : 0;

      const betriebskosten = yearPoints.reduce(
        (sum, p) => sum + p.personalkosten + p.sachkosten + p.spezialtopfKosten,
        0
      );
      const gesamtausgaben = yearPoints.reduce((sum, p) => sum + p.gesamtausgaben, 0);

      const gesamteinnahmen = yearPoints.reduce((sum, p) => sum + p.gesamteinnahmen, 0);
      const ebitan = gesamteinnahmen - betriebskosten;
      const bruttomarge = gesamteinnahmen > 0 ? (ebitan / gesamteinnahmen) * 100 : 0;

      const totalBurn = yearPoints.reduce((sum, p) => sum + Math.max(0, p.gesamtausgaben - p.cashwirksameEinnahmen), 0);
      const avgBurnRate = totalBurn / 12;

      let runwayVal = "Profitabel";
      const remainingSimulation = simulation.slice(endM);
      const firstNeg = remainingSimulation.find((p) => p.cashbestand < 0);
      if (firstNeg) {
        runwayVal = `${firstNeg.month - endM} Mt.`;
      } else {
        const lastPoint = simulation[simulation.length - 1];
        if (lastPoint && lastPoint.cashbestand < 0) {
          runwayVal = "Insolvent";
        } else {
          const lastM = yearPoints[yearPoints.length - 1];
          if (lastM && lastM.gesamtausgaben > lastM.cashwirksameEinnahmen) {
            const currentCash = lastMonthPoint ? lastMonthPoint.cashbestand : 0;
            const currentBurn = lastM.gesamtausgaben - lastM.cashwirksameEinnahmen;
            if (currentBurn > 0) {
              const estRunway = Math.round(currentCash / currentBurn);
              runwayVal = estRunway > 48 ? "48+" : `${estRunway} Mt.`;
            }
          }
        }
      }

      const kapitalbedarf = Math.max(0, -ebitan);

      return {
        year: y,
        arr,
        betriebskosten,
        gesamtausgaben,
        ebitan,
        bruttomarge,
        avgBurnRate,
        runway: runwayVal,
        kapitalbedarf,
      };
    });

    const totalKapitalbedarf = results.reduce((sum, r) => sum + r.kapitalbedarf, 0);

    return { results, totalKapitalbedarf };
  }, [simulation]);

  const formatLicenseSplit = (point) => {
    if (!point) return "—";
    return `Briefing ${numberFormatter.format(Math.round(point.aktiveBriefing))} · Monitor ${numberFormatter.format(Math.round(point.aktiveMonitor))} · Anker ${numberFormatter.format(Math.round(point.aktiveAnker))}`;
  };

  const formatAboSplit = (point) => {
    if (!point) return "—";
    return `Briefing ${numberFormatter.format(point.verkaufteAbosBriefing)} · Monitor ${numberFormatter.format(point.verkaufteAbosMonitor)} · Anker ${numberFormatter.format(point.verkaufteAbosAnker)}`;
  };

  const erforderlichesKapitalTotal = Math.max(0, seedBetrag + seriesABetrag - kapitalAnalyse.minPuffer);
  const erforderlichesKapitalBaseline = Math.max(
    0,
    seedBetrag + seriesABetrag - kapitalAnalyse.minPufferBaseline
  );

  const guvData = useMemo(() => {
    const years = [1, 2, 3];
    const results = {};

    years.forEach((y) => {
      const yearPoints = simulation.filter((p) => p.year === y);

      let umsatzLizenzen = 0;
      let umsatzMonitor = 0;
      let umsatzAnker = 0;
      let sponsoring = 0;
      let personal = 0;
      let sachkosten = 0;
      let gewinnsteuer = 0;
      let spezial = 0;

      yearPoints.forEach((p) => {
        umsatzLizenzen += p.umsatzLizenzen;
        umsatzMonitor += p.umsatzMonitor;
        umsatzAnker += p.umsatzAnker;
        sponsoring += p.sponsoringProMonat;
        personal += p.personalkosten;
        sachkosten += p.sachkosten;
        gewinnsteuer += p.gewinnsteuer;
        spezial += p.spezialtopfKosten;
      });

      const itItem = sachkostenItems.find((i) => i.id === "sach-12");
      const werbItem = sachkostenItems.find((i) => i.id === "sach-2");
      const grafItem = sachkostenItems.find((i) => i.id === "sach-3");
      const itW = itItem ? (itItem[`costY${y}`] ?? itItem.costY3 ?? 0) : 0;
      const mktW = (werbItem ? (werbItem[`costY${y}`] ?? 0) : 0) + (grafItem ? (grafItem[`costY${y}`] ?? 0) : 0);
      const totalW = sachkostenItems
        .filter((i) => i.id !== "sach-23")
        .reduce((sum, i) => sum + (i[`costY${y}`] ?? i.costY3 ?? 0), 0);

      const tech = totalW > 0 ? sachkosten * (itW / totalW) : 0;
      const marketing = totalW > 0 ? sachkosten * (mktW / totalW) : 0;
      const admin = sachkosten - tech - marketing + spezial;

      const gesamtertrag = umsatzLizenzen + umsatzMonitor + umsatzAnker + sponsoring;
      const ebitda = gesamtertrag - personal - tech - marketing - admin;
      const abschreibungen = 0;
      const ebit = ebitda - abschreibungen;
      const steuern = gewinnsteuer;
      const reingewinn = ebit - steuern;

      results[y] = {
        umsatzLizenzen,
        umsatzMonitor,
        umsatzAnker,
        sponsoring,
        gesamtertrag,
        personal,
        tech,
        marketing,
        admin,
        ebitda,
        abschreibungen,
        ebit,
        steuern,
        reingewinn,
      };
    });

    return results;
  }, [simulation, sachkostenItems]);

  const headcountByYear = useMemo(() => {
    const headSumAtMonth = (m) => calcMonthlyPersonnel(roles, m, sozialabgabenProzent).headSum;
    return [1, 2, 3].map((year) => {
      const startM = (year - 1) * 12 + 1;
      const endM = year * 12;
      let sum = 0;
      for (let m = startM; m <= endM; m += 1) sum += headSumAtMonth(m);
      return { year, avg: sum / 12, end: headSumAtMonth(endM) };
    });
  }, [roles, sozialabgabenProzent]);

  const perHeadAnnualCosts = useMemo(() => {
    const headSumAtMonth = (m) => calcMonthlyPersonnel(roles, m, sozialabgabenProzent).headSum;
    const map = {};
    sachkostenItems.filter(isPerHeadItem).forEach((item) => {
      [1, 2, 3].forEach((year) => {
        map[`${item.id}-y${year}`] = calcYearlyPerHeadCost(sachkostenItems, item.id, year, headSumAtMonth);
      });
    });
    return map;
  }, [roles, sachkostenItems, sozialabgabenProzent]);

  const reserveAnnualCosts = useMemo(() => {
    if (!reserveItem) return {};
    const headSumAtMonth = (m) => calcMonthlyPersonnel(roles, m, sozialabgabenProzent).headSum;
    const map = {};
    [1, 2, 3].forEach((year) => {
      map[`y${year}`] = calcYearlyReserveCost(sachkostenItems, year, headSumAtMonth, reserveItem);
    });
    return map;
  }, [roles, sachkostenItems, sozialabgabenProzent, reserveItem]);

  const costValidation = useMemo(() => {
    const years = [1, 2, 3];
    return years.map((y) => {
      const personal = calcYearlyPersonnel(roles, y, sozialabgabenProzent);
      const excelPersonal = planData.summary[`personalY${y}`];
      return {
        year: y,
        personal,
        excelPersonal,
        personalDelta: personal - excelPersonal,
      };
    });
  }, [roles, sozialabgabenProzent]);

  const dummyData = useMemo(() => {
    // 1. Ratio
    const totalPers = simulation.reduce((sum, p) => sum + p.personalkosten, 0);
    const totalSach = simulation.reduce(
      (sum, p) => sum + p.sachkosten + p.gewinnsteuer + p.spezialtopfKosten,
      0
    );
    const persRatio = totalPers + totalSach > 0 ? Math.round((totalPers / (totalPers + totalSach)) * 100) : 80;
    const sachRatio = 100 - persRatio;

    // 2. FTE values
    const fteSeed = roles.reduce((sum, role) => sum + (role.monthsY1 > 0 ? role.fte : 0), 0);
    const fteSeriesA = roles.reduce((sum, role) => sum + (role.monthsY3 > 0 ? role.fte : 0), 0);
    const avgSalary =
      roles.length > 0
        ? Math.round(roles.reduce((sum, r) => sum + r.salaryMonth, 0) / roles.length)
        : 10000;

    // 3. Series A Year
    const seriesAYear = Math.floor((seriesAMonat - 1) / 12) + 1;
    const seriesAStartYear = seriesAYear + 1;

    // 4. Lizenzen & ARR (Seed = vor Series A, Series A = Ende Jahr 3)
    const seedPoint = simulation[seriesAMonat - 1];
    const y2Point = simulation[23];
    const y3Point = simulation[35];
    const seedBriefingMrr = seedPoint?.umsatzLizenzen ?? 0;
    const seedMonitorMrr = seedPoint?.umsatzMonitor ?? 0;
    const seedArrSplit = calcArrSplit(seedBriefingMrr, seedMonitorMrr);
    const seriesABriefingMrr = y3Point?.umsatzLizenzen ?? 0;
    const seriesAMonitorMrr = y3Point?.umsatzMonitor ?? 0;
    const seriesAArrSplit = calcArrSplit(seriesABriefingMrr, seriesAMonitorMrr);

    const seedActiveLizenzen = seedPoint?.aktiveKunden ?? 0;
    const seedAccounts = Math.round(seedActiveLizenzen / 5);
    const seriesAActiveLizenzen = y3Point?.aktiveKunden ?? 0;
    const seedARR = seedArrSplit.totalArr;
    const seriesAARR = seriesAArrSplit.totalArr;

    // 6. Sponsoring
    const sponsoringStartYear = sponsoringJahr1 > 0 ? 1 : sponsoringJahr2 > 0 ? 2 : sponsoringJahr3 > 0 ? 3 : sponsoringJahr4 > 0 ? 4 : 2;
    const sponsoringAmountPerYear = (sponsoringStartYear === 1 ? sponsoringJahr1 : sponsoringStartYear === 2 ? sponsoringJahr2 : sponsoringStartYear === 3 ? sponsoringJahr3 : sponsoringJahr4) * 12;

    // 7. Quarter names
    const getQuarterOnly = (m) => "Q" + (Math.floor(((m === 0 ? 1 : m) - 1) % 12 / 3) + 1);
    const seedQuarter = getQuarterOnly(SEED_MONAT);
    const seriesAQuarter = getQuarterOnly(seriesAMonat);

    // 8. Break even
    const breakEvenYear = breakEvenMonat != null ? yearByMonth(breakEvenMonat) : 3;

    // 9. EBIT Marge Year 3
    const y3Guv = guvData[3] || { ebit: 0, gesamtertrag: 0 };
    const ebitMargeY3 = y3Guv.gesamtertrag > 0 ? Math.round((y3Guv.ebit / y3Guv.gesamtertrag) * 100) : 0;

    // 10. Best / Worst case months
    const baseCaseMonths = breakEvenMonat != null ? breakEvenMonat : 34;
    const bestCaseMonths = Math.max(1, baseCaseMonths - 6);
    const worstCaseMonths = Math.max(1, baseCaseMonths + 6);

    return {
      persRatio,
      sachRatio,
      fteSeed,
      fteSeriesA,
      seriesAYear,
      seriesAStartYear,
      seedActiveLizenzen,
      seedAccounts,
      seriesAActiveLizenzen,
      seedARR,
      seriesAARR,
      seedBriefingActive: seedPoint?.aktiveBriefing ?? 0,
      seedBriefingAccounts: Math.round((seedPoint?.aktiveBriefing ?? 0) / 5),
      seedMonitorActive: seedPoint?.aktiveMonitor ?? 0,
      seedArr: seedARR,
      seedArrBriefingPct: seedArrSplit.briefingPct,
      seedArrMonitorPct: seedArrSplit.monitorPct,
      briefingActiveY2: y2Point?.aktiveBriefing ?? 0,
      briefingActiveY3: y3Point?.aktiveBriefing ?? 0,
      briefingSoldY3: y3Point?.verkaufteAbosBriefing ?? 0,
      monitorActiveY2: y2Point?.aktiveMonitor ?? 0,
      monitorActiveY3: y3Point?.aktiveMonitor ?? 0,
      monitorSoldY3: y3Point?.verkaufteAbosMonitor ?? 0,
      seriesAArr: seriesAARR,
      seriesAArrBriefingPct: seriesAArrSplit.briefingPct,
      seriesAArrMonitorPct: seriesAArrSplit.monitorPct,
      seedBriefingPriceAnnual: preisJ1 * 12,
      targetBriefingPriceAnnual: preisAbJ3 * 12,
      monitorPriceAnnual: monitorPreisProLizenz * 12,
      sponsoringY1Annual: sponsoringJahr1 * 12,
      sponsoringY2Annual: sponsoringJahr2 * 12,
      ankerStartMonat,
      ankerMonthly: ankerAnzahlLizenzen * ankerPreisProLizenz,
      sponsoringStartYear,
      sponsoringAmountPerYear,
      seedQuarter,
      seriesAQuarter,
      breakEvenYear,
      ebitMargeY3,
      baseCaseMonths,
      bestCaseMonths,
      worstCaseMonths,
      avgSalary,
    };
  }, [
    simulation,
    guvData,
    roles,
    seriesAMonat,
    sponsoringJahr1,
    sponsoringJahr2,
    sponsoringJahr3,
    sponsoringJahr4,
    breakEvenMonat,
    preisJ1,
    preisAbJ3,
    monitorPreisProLizenz,
    ankerStartMonat,
    ankerAnzahlLizenzen,
    ankerPreisProLizenz,
  ]);

  const handleCopyText = () => {
    const text = `9. Finanzplan (Zahlenteil)

Die finanzielle Planung von Attaché spiegelt ein hochskalierbares, technologiegestütztes B2B-Geschäftsmodell wider. Um das Marktpotenzial der Executive Intelligence in der Schweiz zu beweisen und die Plattform anschliessend zum break Even zu skalieren, ist die Finanzierungsstruktur in drei Phasen unterteilt: Pre-Seed (Validierung), Seed (Markteintritt & Break-even) und Series A (Konsolidierung).

${buildInvestitionsplanPlain({ seedBetrag, seriesABetrag, numberFormatter })}

9.2 Betriebskostenplanung (Kostenstruktur / OpEx)

Die betrieblichen Aufwendungen (OpEx) sind durch die Struktur des wissensbasierten Dienstleistungsmodells geprägt. Das strategische Verhältnis zwischen Personal- und Sachkosten ist langfristig auf ${dummyData.persRatio} % / ${dummyData.sachRatio} % optimiert, da die Technologie den manuellen Skalierungsaufwand massiv abfedert.

* Personalaufwand: Bildet den grössten Kostenblock. ${roles.length} Rollen mit individuellen Salären (Ø CHF ${numberFormatter.format(dummyData.avgSalary)}/Monat). Das Team umfasst planmässig ${dummyData.fteSeed.toFixed(1)} FTE in der Seed-Phase und ${dummyData.fteSeriesA.toFixed(1)} FTE nach Series A.
* Technologie- & Serverkosten: Beinhaltet hocheffizientes Hosting sowie die SaaS-Gebühren für das CRM- und Auslieferungssystem (Postmark, Statamic). Veranschlagt sind CHF ${numberFormatter.format(sachkostenItems.find((i) => i.id === "sach-12")?.unitMonth ?? 3000)} pro Monat.
* Vertrieb & horizontales Wachstum: Budgets Series A für das B2B-Enterprise-Sales-Team. Nach der Series A steigen die variablen Marketing- und Vertriebskosten auf CHF ${numberFormatter.format(sachkostenItems.find((i) => i.id === "sach-2")?.costY3 ?? 42000)} jährlich, um den horizontalen Rollout voranzutreiben.

${buildUmsatzAbsatzplanungPlain({ d: dummyData, numberFormatter, currencyFormatter })}

9.4 Plan-Gewinn- & Verlustrechnung (GuV)

Die folgende Tabelle zeigt die konsolidierte Erfolgsrechnung inklusive der Expansionsphase nach der Series A:

Position (in CHF) | Geschäftsjahr 1 (Seed) | Geschäftsjahr 2${dummyData.breakEvenYear === 2 ? " (Break-even)" : ""} | Geschäftsjahr 3${dummyData.breakEvenYear === 3 ? " (Break-even)" : ""}${dummyData.seriesAYear === 3 ? " (Series A)" : ""}
------------------|------------------------|--------------------------------|-------------------------
Umsatzerlöse Premium-Briefings | ${numberFormatter.format(Math.round(guvData[1].umsatzLizenzen))} | ${numberFormatter.format(Math.round(guvData[2].umsatzLizenzen))} | ${numberFormatter.format(Math.round(guvData[3].umsatzLizenzen))}
Umsatzerlöse Monitor | ${numberFormatter.format(Math.round(guvData[1].umsatzMonitor))} | ${numberFormatter.format(Math.round(guvData[2].umsatzMonitor))} | ${numberFormatter.format(Math.round(guvData[3].umsatzMonitor))}
Umsatzerlöse Anker-Kunde | ${numberFormatter.format(Math.round(guvData[1].umsatzAnker))} | ${numberFormatter.format(Math.round(guvData[2].umsatzAnker))} | ${numberFormatter.format(Math.round(guvData[3].umsatzAnker))}
Erlöse B2B-Sponsoring / Events | ${numberFormatter.format(Math.round(guvData[1].sponsoring))} | ${numberFormatter.format(Math.round(guvData[2].sponsoring))} | ${numberFormatter.format(Math.round(guvData[3].sponsoring))}
Gesamtertrag | ${numberFormatter.format(Math.round(guvData[1].gesamtertrag))} | ${numberFormatter.format(Math.round(guvData[2].gesamtertrag))} | ${numberFormatter.format(Math.round(guvData[3].gesamtertrag))}
- Personalaufwand (inkl. Sozialleistungen) | ${numberFormatter.format(Math.round(guvData[1].personal))} | ${numberFormatter.format(Math.round(guvData[2].personal))} | ${numberFormatter.format(Math.round(guvData[3].personal))}
- Technischer Betriebsaufwand (Server/SaaS) | ${numberFormatter.format(Math.round(guvData[1].tech))} | ${numberFormatter.format(Math.round(guvData[2].tech))} | ${numberFormatter.format(Math.round(guvData[3].tech))}
- Vertriebs- und Marketingkosten | ${numberFormatter.format(Math.round(guvData[1].marketing))} | ${numberFormatter.format(Math.round(guvData[2].marketing))} | ${numberFormatter.format(Math.round(guvData[3].marketing))}
- Allgemeine Verwaltung / Legal & Treuhand | ${numberFormatter.format(Math.round(guvData[1].admin))} | ${numberFormatter.format(Math.round(guvData[2].admin))} | ${numberFormatter.format(Math.round(guvData[3].admin))}
EBITDA | ${numberFormatter.format(Math.round(guvData[1].ebitda))} | ${numberFormatter.format(Math.round(guvData[2].ebitda))} | ${numberFormatter.format(Math.round(guvData[3].ebitda))}
- Abschreibungen (Technologie/Hardware) | ${numberFormatter.format(Math.round(guvData[1].abschreibungen))} | ${numberFormatter.format(Math.round(guvData[2].abschreibungen))} | ${numberFormatter.format(Math.round(guvData[3].abschreibungen))}
EBIT | ${numberFormatter.format(Math.round(guvData[1].ebit))} | ${numberFormatter.format(Math.round(guvData[2].ebit))} | ${numberFormatter.format(Math.round(guvData[3].ebit))}
- Steuern | ${numberFormatter.format(Math.round(guvData[1].steuern))} | ${numberFormatter.format(Math.round(guvData[2].steuern))} | ${numberFormatter.format(Math.round(guvData[3].steuern))}
Unternehmensergebnis (Reingewinn) | ${numberFormatter.format(Math.round(guvData[1].reingewinn))} | ${numberFormatter.format(Math.round(guvData[2].reingewinn))} | ${numberFormatter.format(Math.round(guvData[3].reingewinn))}

9.5 Liquiditätsplan (Cashflow-Rechnung)

Der Liquiditätsplan überwacht den Cash-Burn und stellt sicher, dass die Expansionsschritte jederzeit durch Finanzierungs-Cashflows gedeckt sind.

* Seed-Zufluss: Der erste grosse Meilenstein erfolgt durch das Closing der Seed-Runde im Quartal ${dummyData.seedQuarter} in Höhe von CHF ${(seedBetrag / 1000000).toLocaleString('de-CH')} Mio., was den operativen Markteintritt in der Schweiz vollständig absichert.
* Series A-Zufluss: Zur Beschleunigung des internationalen Wachstums und zum Ausbau der On-Demand-Infrastruktur fließt im Quartal ${dummyData.seriesAQuarter} des ${dummyData.seriesAYear}. Geschäftsjahres die Series A-Runde in Höhe von CHF ${(seriesABetrag / 1000000).toLocaleString('de-CH')} Mio. zu.
* SaaS-Hebel & Runway: Dank der jährlichen Upfront-Zahlungen der B2B-Kunden profitiert Attaché von einem stark positiven Working Capital. Der kumulierte Cash-Bestand sinkt zu keinem Zeitpunkt unter die kritische Grenze von ${dummyData.baseCaseMonths >= 10 ? 3 : 2} Monaten operativer Fixkosten.

9.6 Kapitalbedarfs- und Finanzierungsplan

Der Gesamtkapitalbedarf bis zum Erreichen der globalen Profitabilität ist in drei klare Finanzierungstranchen unterteilt:

1. Pre-Seed-Runde (Abgeschlossen): CHF ${numberFormatter.format(preSeedAfondPerdu)} als à-fond-perdu-Anschubfinanzierung für die Marktforschung durch Medienunternehmer sowie ein Wandeldarlehen (Bridge) von CHF ${numberFormatter.format(preSeedBridge)} für das MVP-Prototyping.
2. Seed-Finanzierungsrunde (Aktuelle Phase): Einwerbung von mindestens CHF ${(seedBetrag / 1000000).toFixed(1)} Mio. bis CHF ${(seedBetrag / 1000000 * 1.5).toFixed(1)} Mio. zur Absicherung des Runways bis zum Schweizer Break-even. Abgabe von 20 % der Anteile am Gründungs-Cap-Table.
3. Series A-Runde (In Vorbereitung): Geplante Aufnahme von CHF ${(seriesABetrag / 1000000).toFixed(1)} Mio. im Geschäftsjahr ${dummyData.seriesAYear}, initiiert durch institutionelle B2B-SaaS- und Growth-Investoren, um die Internationalisierungsachse zu finanzieren.
4. Option Pool (ESOP): Reservierung von 10 % der Anteile zur langfristigen Incentivierung von Schlüsselpositionen (CTO, Head of Sales, Lead-Analysten).

${buildBreakEvenAnalysePlain({
  breakEvenYearBaseline: breakEvenMonatBaseline != null ? yearByMonth(breakEvenMonatBaseline) : null,
  breakEvenMonatBaseline,
  breakEvenPointBaseline,
  breakEvenYearTotal: breakEvenMonatTotal != null ? yearByMonth(breakEvenMonatTotal) : null,
  breakEvenMonatTotal,
  breakEvenPointTotal,
  dummyData,
  seriesAMonat,
  spezialtopf,
  numberFormatter,
})}`;

    navigator.clipboard.writeText(text).then(() => {
      alert("Text erfolgreich kopiert!");
    }).catch(err => {
      console.error("Kopieren fehlgeschlagen: ", err);
    });
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[1400px] flex-col gap-4 p-4 2xl:px-8">
      {/* Header */}
      <header className="flex flex-col gap-3 border-2 border-black bg-white p-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-[20px] font-bold text-black">Finanzmodell Hektopascal — Modell 3</h1>
          <p className="text-xs font-normal text-black mt-1">Rollenbasierte Planung · 48 Monate (CHF) · Stand 13.06.2026</p>
          {scenarioMeta?.updatedAt && (
            <p className="text-[10px] text-gray-500 mt-1 font-mono">
              Szenarien: {scenarioMeta.updatedBy ?? "—"} · {new Date(scenarioMeta.updatedAt).toLocaleString("de-CH")}
              {scenarioSource ? ` · Quelle: ${scenarioSource}` : ""}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1 min-w-[200px]">
            <span className="text-[10px] font-bold uppercase text-black">Szenario</span>
            <select
              className="border-2 border-black bg-white px-2 py-2 text-sm font-semibold text-black"
              value={selectedScenario}
              onChange={(event) => setSelectedScenario(event.target.value)}
              disabled={scenariosLoading}
            >
              <option value="">— Szenario wählen —</option>
              {scenarioNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={handleLoadScenario}
            disabled={!selectedScenario || scenariosLoading}
            className="border-2 border-black bg-white px-3 py-2 text-sm font-bold text-black transition-shadow hover:shadow-[2px_2px_0px_#000] active:translate-y-[1px] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            title="Ausgewähltes Szenario laden"
          >
            Laden
          </button>
          <button
            type="button"
            onClick={handleSaveScenario}
            disabled={scenariosSaving}
            className="border-2 border-black bg-[#FF6B6B] px-3 py-2 text-sm font-bold text-black transition-shadow hover:shadow-[2px_2px_0px_#000] active:translate-y-[1px] cursor-pointer disabled:opacity-40"
            title={selectedScenario ? "Ausgewähltes Szenario überschreiben" : "Neues Szenario speichern"}
          >
            {scenariosSaving ? "Speichert…" : "Speichern"}
          </button>
          <button
            type="button"
            onClick={handleSaveScenarioAsNew}
            disabled={scenariosSaving}
            className="border-2 border-black bg-white px-3 py-2 text-sm font-bold text-black transition-shadow hover:shadow-[2px_2px_0px_#000] active:translate-y-[1px] cursor-pointer disabled:opacity-40"
            title="Unter neuem Namen speichern"
          >
            Neu…
          </button>
          <button
            type="button"
            onClick={() => refreshScenarios({ hydrate: false })}
            disabled={scenariosLoading}
            className="border-2 border-black bg-white px-3 py-2 text-sm font-bold text-black transition-shadow hover:shadow-[2px_2px_0px_#000] active:translate-y-[1px] cursor-pointer disabled:opacity-40"
            title="Szenarien vom Server neu laden"
          >
            ↻
          </button>
          {Object.keys(readLegacyLocalScenarios()).length > 0 && (
            <button
              type="button"
              onClick={handleMigrateLegacyScenarios}
              className="border-2 border-black bg-yellow-100 px-3 py-2 text-xs font-bold text-black"
              title="Alte lokale Szenarien ins Repo hochladen"
            >
              Lokal → Cloud
            </button>
          )}
          <button
            type="button"
            onClick={handleReset}
            className="border-2 border-black bg-white px-3 py-2 text-sm font-bold text-black transition-shadow hover:shadow-[2px_2px_0px_#000] active:translate-y-[1px] cursor-pointer"
            title="Alle Werte auf Standard zurücksetzen"
          >
            Reset
          </button>
        </div>
      </header>

      {/* KPIs Grid */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SplitKPI
          title="Break-even (operativ)"
          entries={[
            {
              label: "Ohne Monitor/Anker",
              value: breakEvenMonatBaseline != null ? `ab Monat ${breakEvenMonatBaseline}` : "—",
            },
            {
              label: "Mit Monitor/Anker",
              value: breakEvenMonatTotal != null ? `ab Monat ${breakEvenMonatTotal}` : "—",
            },
          ]}
          helpText="Erster Monat mit Einnahmen ≥ operativen Ausgaben (ohne Gewinnsteuer)."
        />
        <SplitKPI
          title="Aktive Lizenzen bei Break-even"
          entries={[
            {
              label: `Ohne Monitor/Anker${breakEvenMonatBaseline != null ? ` (Monat ${breakEvenMonatBaseline})` : ""}`,
              value: formatLicenseSplit(breakEvenPointBaseline),
            },
            {
              label: `Mit Monitor/Anker${breakEvenMonatTotal != null ? ` (Monat ${breakEvenMonatTotal})` : ""}`,
              value: formatLicenseSplit(breakEvenPointTotal),
            },
          ]}
          helpText="Lizenzbestand nach Briefing, Monitor und Anker-Kunde im jeweiligen Break-even-Monat."
        />
        <SplitKPI
          title="Total verkaufte Abos bei Break-even"
          entries={[
            {
              label: `Ohne Monitor/Anker${breakEvenMonatBaseline != null ? ` (Monat ${breakEvenMonatBaseline})` : ""}`,
              value: formatAboSplit(breakEvenPointBaseline),
            },
            {
              label: `Mit Monitor/Anker${breakEvenMonatTotal != null ? ` (Monat ${breakEvenMonatTotal})` : ""}`,
              value: formatAboSplit(breakEvenPointTotal),
            },
          ]}
          helpText="Kumulierte verkaufte Abonnements bis zum jeweiligen Break-even-Monat."
        />
        <SplitKPI
          title="Erforderliches Kapital (Seed + Series A)"
          entries={[
            {
              label: "Ohne Monitor/Anker",
              value: currencyFormatter.format(erforderlichesKapitalBaseline),
            },
            {
              label: "Mit Monitor/Anker",
              value: currencyFormatter.format(erforderlichesKapitalTotal),
            },
          ]}
          helpText="Benötigtes Kapital, um eine Unterschreitung des Liquiditätspuffers zu verhindern."
        />
      </div>

      <aside className="border-2 border-black bg-[#FAFAFA] px-4 py-3 text-[11px] leading-relaxed text-gray-800">
        <p className="font-bold text-black text-xs mb-2">Modellannahmen</p>
        <ol className="list-decimal space-y-1.5 pl-4">
          <li>
            <strong>Planstart (Monat 0):</strong> Betriebsaufnahme der AG. Das Modell simuliert ab diesem Zeitpunkt über 48 Monate.
          </li>
          <li>
            <strong>Pre-Seed & Bridge (vor Monat 0):</strong>{" "}
            {currencyFormatter.format(preSeedAfondPerdu)} à-fond-perdu und{" "}
            {currencyFormatter.format(preSeedBridge)} Bridge-Wandeldarlehen — reine Dokumentation der abgeschlossenen
            Vor-Gründungsphase, <strong>ohne Einfluss</strong> auf Cash, KPIs und Simulation.
          </li>
          <li>
            <strong>Finanzierungszuflüsse im Modell:</strong> Seed bei Monat 0 (Startkapital), Series A im eingestellten
            Monat ≥ 1.
          </li>
          <li>
            <strong>KPI «Ohne / Mit Monitor/Anker»:</strong> «Ohne» = Premium-Briefings + Sponsoring (Baseline). «Mit» =
            Gesamtmodell inkl. optionaler Monitor- und Anker-Kunde-Erlöse (Standardwerte 0 = identisch).
          </li>
          <li>
            <strong>Operativer Break-even:</strong> erster Monat mit Einnahmen ≥ Personal + Sachkosten + Spezialtopf
            (ohne Gewinnsteuer).
          </li>
          <li>
            <strong>Erforderliches Kapital:</strong> Seed + Series A abzüglich tiefstem Liquiditätspuffer über den
            Planungshorizont (100&apos;000 CHF Reserve + 3 Monate Personalkosten inkl. Sozialabgaben).
          </li>
          <li>
            <strong>Speichern & Laden:</strong> Eingaben werden nicht mehr im Browser zwischengespeichert (kein
            Überschreiben durch andere Pfade wie /modell3/). Beim Start wird «Standard» vom Server geladen, falls
            vorhanden. Änderungen mit <strong>Speichern</strong> ins Szenario schreiben; andere Szenarien mit{" "}
            <strong>Laden</strong> holen.
          </li>
        </ol>
      </aside>

      {/* Tab Switcher */}
      <div className="flex border-2 border-black bg-white">
        <button
          type="button"
          className={`flex-1 py-3 text-sm font-bold border-r-2 border-black transition-colors ${
            activeTab === "inputs" ? "bg-[#FF6B6B] text-black" : "bg-white text-black hover:bg-[#F5F5F5]"
          }`}
          onClick={() => setActiveTab("inputs")}
        >
          Eingaben (Treiber)
        </button>
        <button
          type="button"
          className={`flex-1 py-3 text-sm font-bold border-r-2 border-black transition-colors ${
            activeTab === "calc" ? "bg-[#FF6B6B] text-black" : "bg-white text-black hover:bg-[#F5F5F5]"
          }`}
          onClick={() => setActiveTab("calc")}
        >
          Berechnung
        </button>
        <button
          type="button"
          className={`flex-1 py-3 text-sm font-bold border-r-2 border-black transition-colors ${
            activeTab === "kennzahlen" ? "bg-[#FF6B6B] text-black" : "bg-white text-black hover:bg-[#F5F5F5]"
          }`}
          onClick={() => setActiveTab("kennzahlen")}
        >
          Kennzahlen
        </button>
        <button
          type="button"
          className={`flex-1 py-3 text-sm font-bold border-r-2 border-black transition-colors ${
            activeTab === "charts" ? "bg-[#FF6B6B] text-black" : "bg-white text-black hover:bg-[#F5F5F5]"
          }`}
          onClick={() => setActiveTab("charts")}
        >
          Visualisierungen
        </button>
        <button
          type="button"
          className={`flex-1 py-3 text-sm font-bold transition-colors ${
            activeTab === "dummy" ? "bg-[#FF6B6B] text-black" : "bg-white text-black hover:bg-[#F5F5F5]"
          }`}
          onClick={() => setActiveTab("dummy")}
        >
          Dummy
        </button>
      </div>

      {/* Tab Content */}
      {activeTab === "inputs" && (
        <div className="grid gap-4">
          <div className="grid gap-4 md:grid-cols-2">
          {/* Card 1: Einnahmen-Treiber */}
          <article className="border-2 border-black bg-white p-6 transition-shadow hover:shadow-[2px_2px_0px_#000]">
            <h2 className="text-[18px] font-bold text-black border-b-2 border-black pb-2 mb-4">Einnahmen-Treiber</h2>
            <div className="grid gap-4">
              <div className="border-2 border-black bg-[#F5F5F5] p-3 space-y-3">
                <span className="text-xs font-bold text-black uppercase block">Finanzierungsrunden / Funding</span>
                
                <div className="grid grid-cols-2 gap-3 border border-black p-2 bg-white">
                  <div className="flex flex-col gap-1">
                    <span className="text-xs font-semibold text-black">Pre-Seed à-fond-perdu (CHF)</span>
                    <input
                      type="number"
                      className="w-full border-2 border-black bg-white px-2 py-1 text-sm font-semibold text-black transition-shadow hover:shadow-[1px_1px_0px_#000] focus:outline-none"
                      value={preSeedAfondPerdu}
                      step={10000}
                      onChange={(event) => setPreSeedAfondPerdu(clampNumber(Number(event.target.value)))}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-xs font-semibold text-black">Pre-Seed Bridge (CHF)</span>
                    <input
                      type="number"
                      className="w-full border-2 border-black bg-white px-2 py-1 text-sm font-semibold text-black transition-shadow hover:shadow-[1px_1px_0px_#000] focus:outline-none"
                      value={preSeedBridge}
                      step={10000}
                      onChange={(event) => setPreSeedBridge(clampNumber(Number(event.target.value)))}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 border border-black p-2 bg-white">
                  <div className="flex flex-col gap-1">
                    <span className="text-xs font-semibold text-black">Seed Runde (CHF)</span>
                    <input
                      type="number"
                      className="w-full border-2 border-black bg-white px-2 py-1 text-sm font-semibold text-black transition-shadow hover:shadow-[1px_1px_0px_#000] focus:outline-none"
                      value={seedBetrag}
                      step={50000}
                      onChange={(event) => setSeedBetrag(clampNumber(Number(event.target.value)))}
                    />
                  </div>
                  <div className="flex flex-col gap-1 justify-end">
                    <span className="text-xs font-semibold text-black">Seed Zufluss</span>
                    <span className="border-2 border-black bg-[#F5F5F5] px-2 py-1 text-sm font-semibold text-black">
                      Monat 0 (Start)
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 border border-black p-2 bg-white">
                  <div className="flex flex-col gap-1">
                    <span className="text-xs font-semibold text-black">Series A Runde (CHF)</span>
                    <input
                      type="number"
                      className="w-full border-2 border-black bg-white px-2 py-1 text-sm font-semibold text-black transition-shadow hover:shadow-[1px_1px_0px_#000] focus:outline-none"
                      value={seriesABetrag}
                      step={100000}
                      onChange={(event) => setSeriesABetrag(clampNumber(Number(event.target.value)))}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-xs font-semibold text-black">Series A Monat</span>
                    <input
                      type="number"
                      className="w-full border-2 border-black bg-white px-2 py-1 text-sm font-semibold text-black transition-shadow hover:shadow-[1px_1px_0px_#000] focus:outline-none"
                      value={seriesAMonat}
                      min={1}
                      max={48}
                      onChange={(event) => setSeriesAMonat(clampSeriesAMonat(Number(event.target.value)))}
                    />
                  </div>
                </div>
              </div>
              <div className="border-2 border-black bg-[#F5F5F5] p-3 space-y-3">
                <span className="text-xs font-bold text-black uppercase block">Premium-Briefings</span>
                <LabeledSliderInput label="Neue Lizenzen/Monat Jahr 1" value={neueKundenJ1} onChange={setNeueKundenJ1} max={300} />
                <LabeledSliderInput label="Neue Lizenzen/Monat Jahr 2" value={neueKundenJ2} onChange={setNeueKundenJ2} max={300} />
                <LabeledSliderInput label="Neue Lizenzen/Monat Jahr 3" value={neueKundenJ3} onChange={setNeueKundenJ3} max={300} />
                <LabeledSliderInput label="Neue Lizenzen/Monat Jahr 4" value={neueKundenJ4} onChange={setNeueKundenJ4} max={300} />
                <LabeledNumberInput label="Preis pro Lizenz Jahr 1 (CHF)" value={preisJ1} onChange={setPreisJ1} step={5} />
                <LabeledNumberInput label="Preis pro Lizenz ab Jahr 2 (CHF)" value={preisAbJ2} onChange={setPreisAbJ2} step={5} />
                <LabeledNumberInput label="Preis pro Lizenz ab Jahr 3 (CHF)" value={preisAbJ3} onChange={setPreisAbJ3} step={5} />
                <div className="grid gap-3">
                  <span className="text-sm font-semibold text-black">Verlängerungsraten nach Vertragsjahr</span>
                  {[
                    ["nach 1 Jahr", verlaengerungNachJ1, setVerlaengerungNachJ1],
                    ["nach 2 Jahren", verlaengerungNachJ2, setVerlaengerungNachJ2],
                    ["nach 3 Jahren", verlaengerungNachJ3, setVerlaengerungNachJ3],
                  ].map(([label, val, setter]) => (
                    <div key={label} className="grid gap-1">
                      <div className="flex justify-between text-xs text-black">
                        <span>Verlängerung {label}</span>
                        <span className="font-semibold text-black">{clampPercent(val).toFixed(1)}%</span>
                      </div>
                      <input
                        type="range"
                        min={30}
                        max={100}
                        step={0.1}
                        value={val}
                        onChange={(event) => setter(clampPercent(clampNumber(Number(event.target.value))))}
                        className="w-full accent-[#FF6B6B]"
                      />
                    </div>
                  ))}
                </div>
              </div>
              <div className="border-2 border-black bg-[#F5F5F5] p-3 space-y-3">
                <span className="text-xs font-bold text-black uppercase block">Monitor</span>
                <LabeledNumberInput
                  label="Start im Monat"
                  value={monitorStartMonat}
                  onChange={setMonitorStartMonat}
                  min={0}
                  max={48}
                  step={1}
                />
                <LabeledNumberInput
                  label="Neue Lizenzen pro Monat"
                  value={monitorNeueLizenzenProMonat}
                  onChange={setMonitorNeueLizenzenProMonat}
                  step={1}
                />
                <LabeledNumberInput
                  label="Preis pro Lizenz (CHF)"
                  value={monitorPreisProLizenz}
                  onChange={setMonitorPreisProLizenz}
                  step={5}
                  helpText="Jahrespreis upfront · Churn = Verlängerung nach Jahr 1 (alle 12 Mon.)"
                />
              </div>
              <div className="border-2 border-black bg-[#F5F5F5] p-3 space-y-3">
                <span className="text-xs font-bold text-black uppercase block">Anker-Kunde</span>
                <LabeledNumberInput
                  label="Start im Monat"
                  value={ankerStartMonat}
                  onChange={setAnkerStartMonat}
                  min={0}
                  max={48}
                  step={1}
                />
                <LabeledNumberInput
                  label="Anzahl Lizenzen"
                  value={ankerAnzahlLizenzen}
                  onChange={setAnkerAnzahlLizenzen}
                  step={1}
                />
                <LabeledNumberInput
                  label="Preis pro Lizenz pro Monat (CHF)"
                  value={ankerPreisProLizenz}
                  onChange={setAnkerPreisProLizenz}
                  step={5}
                  helpText="Monatlicher Umsatz = Anzahl × Preis ab Startmonat."
                />
              </div>
              <LabeledNumberInput
                label="Sponsoring/Monat Jahr 1 (CHF)"
                value={sponsoringJahr1}
                onChange={setSponsoringJahr1}
                step={1000}
              />
              <LabeledNumberInput
                label="Sponsoring/Monat Jahr 2 (CHF)"
                value={sponsoringJahr2}
                onChange={setSponsoringJahr2}
                step={1000}
              />
              <LabeledNumberInput
                label="Sponsoring/Monat Jahr 3 (CHF)"
                value={sponsoringJahr3}
                onChange={setSponsoringJahr3}
                step={1000}
              />
              <LabeledNumberInput
                label="Sponsoring/Monat Jahr 4 (CHF)"
                value={sponsoringJahr4}
                onChange={setSponsoringJahr4}
                step={1000}
              />
            </div>
          </article>

          {/* Card 2: Personalplan */}
          <article className="border-2 border-black bg-white p-6 transition-shadow hover:shadow-[2px_2px_0px_#000]">
            <h2 className="text-[18px] font-bold text-black border-b-2 border-black pb-2 mb-2">Personalplan</h2>
            <p className="text-xs text-gray-600 mb-4">17 Rollen · Heads → Headcount · Spesen/Telko pro Kopf</p>
            <div className="grid grid-cols-3 gap-2 mb-2">
              {headcountByYear.map((h) => (
                <div key={h.year} className="border border-black p-2 bg-[#F5F5F5] text-xs">
                  <span className="font-bold">GJ{h.year} Headcount</span>
                  <div className="font-mono">Ø {h.avg.toFixed(1)} · Ende {h.end}</div>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-2 mb-4">
              {costValidation.map((v) => (
                <div key={v.year} className="border border-black p-2 bg-[#F5F5F5] text-xs">
                  <span className="font-bold">GJ{v.year} Personal</span>
                  <div className="font-mono">{currencyFormatter.format(Math.round(v.personal))}</div>
                  <div className={Math.abs(v.personalDelta) < 5000 ? "text-green-700" : "text-amber-700"}>
                    Δ Excel: {v.personalDelta >= 0 ? "+" : ""}{currencyFormatter.format(Math.round(v.personalDelta))}
                  </div>
                </div>
              ))}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left font-mono text-[11px] border-collapse min-w-[900px]">
                <thead>
                  <tr className="border-b-2 border-black bg-[#F5F5F5]">
                    <th className="p-2 border-r border-black font-bold">Position</th>
                    <th className="p-2 border-r border-black font-bold">Detail</th>
                    <th className="p-2 border-r border-black font-bold w-20">Salär/Mt.</th>
                    <th className="p-2 border-r border-black font-bold w-12">Heads</th>
                    <th className="p-2 border-r border-black font-bold w-14">FTE</th>
                    <th className="p-2 border-r border-black font-bold w-16">Start</th>
                    <th className="p-2 border-r border-black font-bold w-14">Mt.GJ1</th>
                    <th className="p-2 border-r border-black font-bold w-14">Mt.GJ2</th>
                    <th className="p-2 font-bold w-14">Mt.GJ3</th>
                  </tr>
                </thead>
                <tbody>
                  {roles.map((role) => (
                    <tr key={role.id} className="border-b border-black hover:bg-[#FAF9F6]">
                      <td className="p-1 border-r border-black font-sans text-[10px]">{role.position}</td>
                      <td className="p-1 border-r border-black font-sans text-[10px]">{role.detail}</td>
                      {[
                        ["salaryMonth", 500],
                        ["head", 1],
                        ["fte", 0.1],
                        ["startMonth", 1],
                        ["monthsY1", 1],
                        ["monthsY2", 1],
                        ["monthsY3", 1],
                      ].map(([field, step]) => (
                        <td key={field} className="p-0.5 border-r border-black">
                          <input
                            type="number"
                            className="w-full border border-black bg-white px-1 py-0.5 text-[11px] font-semibold"
                            value={role[field] ?? 0}
                            step={step}
                            min={0}
                            onChange={(e) => updateRole(role.id, field, clampNumber(Number(e.target.value)))}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 grid gap-1 border-2 border-black p-3 bg-[#F5F5F5]">
              <div className="flex justify-between text-sm">
                <span className="font-bold uppercase text-xs">Sozialleistungen AG (%)</span>
                <span className="font-semibold">{clampPercent(sozialabgabenProzent).toFixed(1)}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={25}
                step={0.5}
                value={sozialabgabenProzent}
                onChange={(e) => setSozialabgabenProzent(clampPercent(clampNumber(Number(e.target.value))))}
                className="w-full accent-[#FF6B6B]"
              />
            </div>
          </article>
          </div>

          {/* Sachkosten — volle Breite, GJ1–GJ3 */}
          <article className="border-2 border-black bg-white p-6 transition-shadow hover:shadow-[2px_2px_0px_#000]">
            <h2 className="text-[18px] font-bold text-black border-b-2 border-black pb-2 mb-2">Sach- und Dienstleistungsaufwand</h2>
            <p className="text-xs text-gray-600 mb-4">Jahresbeträge in CHF pro GJ · GJ4 = GJ3 · Gewinnsteuer dynamisch bei positivem Ergebnis</p>
            <div className="overflow-x-auto">
              <table className="w-full text-left font-mono text-[11px] border-collapse min-w-[800px]">
                <thead>
                  <tr className="border-b-2 border-black bg-[#F5F5F5]">
                    <th className="p-2 border-r border-black font-bold">Position</th>
                    <th className="p-2 border-r border-black font-bold w-28">GJ1 (CHF)</th>
                    <th className="p-2 border-r border-black font-bold w-28">GJ2 (CHF)</th>
                    <th className="p-2 border-r border-black font-bold w-28">GJ3 (CHF)</th>
                    <th className="p-2 border-r border-black font-bold w-28 text-gray-500">GJ4 (=GJ3)</th>
                    <th className="p-2 font-bold">Typ</th>
                  </tr>
                </thead>
                <tbody>
                  {sachkostenItems.filter((i) => i.id !== "sach-23").map((item) => (
                    <tr key={item.id} className="border-b border-black hover:bg-[#FAF9F6]">
                      <td className="p-2 border-r border-black font-sans">
                        <span className="font-semibold text-xs block">{item.position}</span>
                        <span className="text-[10px] text-gray-500">{item.detail}</span>
                        {isPerHeadItem(item) && (
                          <label className="flex items-center gap-1 mt-1 text-[10px]">
                            <span>CHF/PAX/Mt.</span>
                            <input
                              type="number"
                              className="w-16 border border-black bg-white px-1 py-0.5 text-[11px] font-semibold"
                              value={item.ratePerHead ?? 0}
                              step={10}
                              min={0}
                              onChange={(e) => updateSachkosten(item.id, "ratePerHead", clampNumber(Number(e.target.value)))}
                            />
                          </label>
                        )}
                      </td>
                      {isPerHeadItem(item) ? (
                        <>
                          {[1, 2, 3].map((year) => (
                            <td key={year} className="p-2 border-r border-black text-right font-semibold bg-[#F8F4FF]">
                              {numberFormatter.format(Math.round(perHeadAnnualCosts[`${item.id}-y${year}`] ?? 0))}
                            </td>
                          ))}
                          <td className="p-2 border-r border-black text-right text-gray-500 font-semibold bg-[#F8F4FF]">
                            {numberFormatter.format(Math.round(perHeadAnnualCosts[`${item.id}-y3`] ?? 0))}
                          </td>
                        </>
                      ) : (
                        <>
                          {["costY1", "costY2", "costY3"].map((field) => (
                            <td key={field} className="p-1 border-r border-black">
                              <input
                                type="number"
                                className="w-full border border-black bg-white px-2 py-1 text-[11px] font-semibold"
                                value={item[field] ?? 0}
                                step={500}
                                min={0}
                                onChange={(e) => updateSachkosten(item.id, field, clampNumber(Number(e.target.value)))}
                              />
                            </td>
                          ))}
                          <td className="p-2 border-r border-black text-right text-gray-500 font-semibold">
                            {numberFormatter.format(item.costY4 ?? item.costY3 ?? 0)}
                          </td>
                        </>
                      )}
                      <td className="p-2 text-[10px] uppercase font-bold text-center">
                        {isPerHeadItem(item) ? (
                          <span className="text-purple-700">perHead</span>
                        ) : (
                          item.type ?? "—"
                        )}
                      </td>
                    </tr>
                  ))}
                  {reserveItem && (
                    <tr className="border-b-2 border-black bg-[#FFF9E6]">
                      <td className="p-2 border-r border-black font-sans">
                        <span className="font-semibold text-xs block">{reserveItem.position}</span>
                        <span className="text-[10px] text-gray-500">{reserveItem.detail}</span>
                      </td>
                      {[1, 2, 3].map((year) => (
                        <td key={year} className="p-2 border-r border-black text-right font-semibold bg-[#FFF3CC]">
                          {numberFormatter.format(Math.round(reserveAnnualCosts[`y${year}`] ?? 0))}
                        </td>
                      ))}
                      <td className="p-2 border-r border-black text-right text-gray-500 font-semibold bg-[#FFF3CC]">
                        {numberFormatter.format(Math.round(reserveAnnualCosts.y3 ?? 0))}
                      </td>
                      <td className="p-2 text-center">
                        <label className="inline-flex items-center gap-1 text-[10px] font-bold uppercase">
                          <input
                            type="number"
                            className="w-14 border border-black bg-white px-1 py-0.5 text-[11px] font-semibold text-center"
                            value={Math.round((reserveItem.unitMonth ?? 0.1) * 1000) / 10}
                            step={0.5}
                            min={0}
                            max={100}
                            onChange={(e) =>
                              updateSachkosten(
                                reserveItem.id,
                                "unitMonth",
                                clampPercent(clampNumber(Number(e.target.value))) / 100
                              )
                            }
                          />
                          <span>%</span>
                        </label>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-4">
              <div className="grid gap-1 border-2 border-black p-3 bg-[#F5F5F5]">
                <div className="flex justify-between text-sm">
                  <span className="font-bold uppercase text-xs">Gewinnsteuer (%)</span>
                  <span className="font-semibold">{gewinnsteuerRate.toFixed(1)}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={30}
                  step={0.5}
                  value={gewinnsteuerRate}
                  onChange={(e) => setGewinnsteuerRate(clampNumber(Number(e.target.value)))}
                  className="w-full accent-[#FF6B6B]"
                />
                <span className="text-[10px] text-gray-500">Nur bei positivem Monatsergebnis · Kapitalsteuer fix in GJ-Spalten</span>
              </div>
              <LabeledNumberInput
                label="Spezialtopf / Einmaliger Puffer (CHF)"
                value={spezialtopf}
                onChange={setSpezialtopf}
                step={5000}
                helpText="Gleichmässig über 36 Monate verteilt."
              />
            </div>
          </article>
        </div>
      )}

      {activeTab === "charts" && (
        <div className="space-y-4">
          <article className="border-2 border-black bg-white p-4 transition-shadow hover:shadow-[2px_2px_0px_#000]">
            <h2 className="text-[16px] font-bold text-black">Lizenzwachstum</h2>
            <p className="text-sm font-normal text-black">
              Aktive Lizenzen nach Briefing, Monitor und Anker-Kunde über 48 Monate. Gestrichelte Vertikallinien:
              operativer Break-even ohne Monitor/Anker (grau) und mit Gesamtmodell (grün), sofern sie auseinanderfallen.
            </p>
            <div className="mt-4 h-[28rem] 2xl:h-[32rem]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={simulation} margin={{ top: 12, right: 12, left: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#cfcfcf" />
                  <XAxis
                    dataKey="month"
                    tick={{ fontSize: 14, fill: "#000000" }}
                    label={{ value: "Monat", position: "insideBottom", offset: -4 }}
                    minTickGap={18}
                  />
                  <YAxis tick={{ fontSize: 14, fill: "#000000" }} width={56} />
                  {breakEvenMonatBaseline != null && (
                    <ReferenceLine
                      x={breakEvenMonatBaseline}
                      stroke={
                        breakEvenMonatTotal != null && breakEvenMonatTotal !== breakEvenMonatBaseline
                          ? "#888888"
                          : "#00aa00"
                      }
                      strokeDasharray="4 4"
                      label={{
                        value:
                          breakEvenMonatTotal != null && breakEvenMonatTotal !== breakEvenMonatBaseline
                            ? "BE ohne Monitor/Anker"
                            : "Break-even",
                        position: "insideTopLeft",
                        fill:
                          breakEvenMonatTotal != null && breakEvenMonatTotal !== breakEvenMonatBaseline
                            ? "#666666"
                            : "#00aa00",
                        fontSize: 11,
                      }}
                    />
                  )}
                  {breakEvenMonatTotal != null &&
                    breakEvenMonatBaseline !== breakEvenMonatTotal && (
                      <ReferenceLine
                        x={breakEvenMonatTotal}
                        stroke="#00aa00"
                        strokeDasharray="4 4"
                        label={{
                          value: "BE gesamt",
                          position: "insideTopRight",
                          fill: "#00aa00",
                          fontSize: 12,
                        }}
                      />
                    )}
                  <Tooltip
                    formatter={(value) => numberFormatter.format(Math.round(value))}
                    labelFormatter={(label) => `Monat ${label}`}
                  />
                  <Legend wrapperStyle={{ fontSize: 14, fontWeight: 600, color: "#000000" }} />
                  <Line
                    type="monotone"
                    dataKey="aktiveBriefing"
                    name="Briefing"
                    stroke="#FF6B6B"
                    strokeWidth={2.5}
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="aktiveMonitor"
                    name="Monitor"
                    stroke="#4A90D9"
                    strokeWidth={2}
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="aktiveAnker"
                    name="Anker-Kunde"
                    stroke="#9B59B6"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </article>

          <article className="border-2 border-black bg-white p-4 transition-shadow hover:shadow-[2px_2px_0px_#000]">
            <h2 className="text-[16px] font-bold text-black">Finanzen & Liquidität</h2>
            <p className="text-sm font-normal text-black">
              Einnahmen, Ausgaben, Cashbestand und Mindestliquidität (100&apos;000 CHF + Personalkosten der nächsten 3 Monate inkl. Sozialabgaben). Baseline ohne Monitor/Anker-Kunde. Die grüne Linie markiert Break-even (Einnahmen = Ausgaben).
            </p>
            <div className="mt-4 h-[34rem] 2xl:h-[38rem]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={simulation} margin={{ top: 12, right: 26, left: 10, bottom: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#cfcfcf" />
                  <XAxis dataKey="month" tick={{ fontSize: 14, fill: "#000000" }} minTickGap={18} />
                  <YAxis
                    yAxisId="left"
                    tick={{ fontSize: 14, fill: "#000000" }}
                    tickFormatter={axisCurrencyFormatter}
                    width={84}
                    label={{ value: "Einnahmen/Ausgaben (CHF)", angle: -90, position: "insideLeft", fill: "#000000", fontSize: 12 }}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    tick={{ fontSize: 14, fill: "#000000" }}
                    tickFormatter={axisCurrencyFormatter}
                    width={92}
                    label={{ value: "Cash/Floor (CHF)", angle: 90, position: "insideRight", fill: "#000000", fontSize: 12 }}
                  />
                  {breakEvenMonatBaseline != null && (
                    <ReferenceLine
                      x={breakEvenMonatBaseline}
                      yAxisId="left"
                      stroke="#00aa00"
                      strokeDasharray="4 4"
                      label={{ value: "Break-even", position: "insideTopRight", fill: "#00aa00", fontSize: 12 }}
                    />
                  )}
                  <Tooltip
                    formatter={(value, name) => [currencyFormatter.format(value), name]}
                    labelFormatter={(label) => `Monat ${label}`}
                  />
                  <Legend wrapperStyle={{ fontSize: 14, fontWeight: 600, color: "#000000" }} />
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="baselineGesamteinnahmen"
                    name="Einnahmen"
                    stroke="#00aa00"
                    strokeWidth={2}
                    dot={false}
                  />
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="baselineOperativeAusgaben"
                    name="Ausgaben (operativ)"
                    stroke="#FF2C2C"
                    strokeWidth={2}
                    dot={false}
                  />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="baselineCashbestand"
                    name="Cashbestand"
                    stroke="#000000"
                    strokeWidth={2.5}
                    dot={false}
                  />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="mindestliquiditaet"
                    name="Mindestliquidität"
                    stroke="#ff9900"
                    strokeWidth={2}
                    strokeDasharray="6 4"
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </article>

          <article className="border-2 border-black bg-white p-4 transition-shadow hover:shadow-[2px_2px_0px_#000]">
            <h2 className="text-[16px] font-bold text-black">Zusatzeffekt Monitor & Anker-Kunde</h2>
            <p className="text-sm font-normal text-black">
              Mehrwert gegenüber der Baseline: zusätzliche Einnahmen und Cashbestand (inkl. Mehr-Gewinnsteuer). Der Liquiditätspuffer verbessert sich um denselben Betrag, da der Floor nur vom Personal abhängt.
            </p>
            <div className="mt-4 h-[28rem] 2xl:h-[32rem]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={simulation} margin={{ top: 12, right: 26, left: 10, bottom: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#cfcfcf" />
                  <XAxis dataKey="month" tick={{ fontSize: 14, fill: "#000000" }} minTickGap={18} />
                  <YAxis
                    yAxisId="left"
                    tick={{ fontSize: 14, fill: "#000000" }}
                    tickFormatter={axisCurrencyFormatter}
                    width={84}
                    label={{ value: "Mehr-Einnahmen (CHF)", angle: -90, position: "insideLeft", fill: "#000000", fontSize: 12 }}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    tick={{ fontSize: 14, fill: "#000000" }}
                    tickFormatter={axisCurrencyFormatter}
                    width={92}
                    label={{ value: "Mehr-Cash/Puffer (CHF)", angle: 90, position: "insideRight", fill: "#000000", fontSize: 12 }}
                  />
                  {breakEvenMonatTotal != null && (
                    <ReferenceLine
                      x={breakEvenMonatTotal}
                      yAxisId="left"
                      stroke="#00aa00"
                      strokeDasharray="4 4"
                      label={{ value: "BE gesamt", position: "insideTopRight", fill: "#00aa00", fontSize: 12 }}
                    />
                  )}
                  <Tooltip
                    formatter={(value, name) => [currencyFormatter.format(value), name]}
                    labelFormatter={(label) => `Monat ${label}`}
                  />
                  <Legend wrapperStyle={{ fontSize: 14, fontWeight: 600, color: "#000000" }} />
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="deltaEinnahmen"
                    name="Mehr-Einnahmen"
                    stroke="#90EE90"
                    strokeWidth={2.5}
                    dot={false}
                  />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="deltaCashbestand"
                    name="Mehr-Cash / Liquiditätspuffer"
                    stroke="#87CEEB"
                    strokeWidth={2.5}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </article>

          <article className="border-2 border-black bg-white p-4 transition-shadow hover:shadow-[2px_2px_0px_#000]">
            <h2 className="text-[16px] font-bold text-black">Kapitalbedarf bei Floor-Touch</h2>
            <p className="text-sm font-normal text-black">
              Zeigt, welches Startkapital nötig wäre, um die Mindestliquidität genau in einem bestimmten Monat zu berühren.
            </p>
            <div className="mt-4 h-[30rem] 2xl:h-[34rem]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={kapitalAnalyse.chartData} margin={{ top: 12, right: 26, left: 10, bottom: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#cfcfcf" />
                  <XAxis dataKey="month" tick={{ fontSize: 14, fill: "#000000" }} minTickGap={18} />
                  <YAxis
                    tick={{ fontSize: 14, fill: "#000000" }}
                    tickFormatter={axisCurrencyFormatter}
                    width={100}
                    label={{ value: "Startkapital (CHF)", angle: -90, position: "insideLeft", fill: "#000000", fontSize: 12 }}
                  />
                  <Tooltip
                    formatter={(value, name) => [currencyFormatter.format(value), name]}
                    labelFormatter={(label) => `Monat ${label}`}
                  />
                  <Legend wrapperStyle={{ fontSize: 14, fontWeight: 600, color: "#000000" }} />
                  <Line
                    type="monotone"
                    dataKey="startkapitalBeiTouchInMonat"
                    name="Startkapital bei Touch in Monat"
                    stroke="#FF6B6B"
                    strokeWidth={2}
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="erforderlichesStartkapital"
                    name="Minimal nötiges Startkapital"
                    stroke="#000000"
                    strokeDasharray="6 4"
                    strokeWidth={2.2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </article>
        </div>
      )}

      {activeTab === "calc" && (
        <div className="space-y-4">
          {/* Premium-Briefings Year 1 */}
          <article className="border-2 border-black bg-white p-6 transition-shadow hover:shadow-[2px_2px_0px_#000]">
            <h2 className="text-[18px] font-bold text-black border-b-2 border-black pb-2 mb-1">Premium-Briefings — Jahr 1</h2>
            <p className="text-xs text-gray-600 mb-4">Jahrespreis upfront · gestaffelte Preise ab Vertragsjahr 2/3</p>
            <p className="text-sm font-normal text-black mb-4">
              Im ersten Jahr verkaufen wir <strong>{neueKundenJ1}</strong> neue Lizenzen pro Monat à <strong>{preisJ1} CHF</strong>.
            </p>
            <div className="grid gap-3 bg-[#F5F5F5] border-2 border-black p-4 font-mono text-sm text-black">
              <div>
                <span className="font-semibold text-gray-600">Verkaufte Lizenzen:</span>
                <div className="text-[16px] font-bold mt-1">
                  {neueKundenJ1} Lizenzen/Monat * 12 Monate = {numberFormatter.format(calcDetails.y1_sold)} Lizenzen
                </div>
              </div>
              <hr className="border-black border-dashed" />
              <div>
                <span className="font-semibold text-gray-600">Einnahmen (upfront):</span>
                <div className="text-[16px] font-bold mt-1 text-[#00aa00]">
                  {numberFormatter.format(calcDetails.y1_sold)} Lizenzen * {preisJ1} CHF * 12 Monate = {currencyFormatter.format(calcDetails.y1_rev)}
                </div>
              </div>
              <hr className="border-black border-dashed" />
              <div>
                <span className="font-semibold text-gray-600">ARR (Annual Recurring Revenue) am Ende von Jahr 1:</span>
                <div className="text-[16px] font-bold mt-1 text-blue-600">
                  MRR (Monat 12): {currencyFormatter.format(calcDetails.y1_rev / 12)} / Monat<br />
                  ARR (MRR * 12): {currencyFormatter.format(calcDetails.y1_rev)} / Jahr
                </div>
              </div>
            </div>
          </article>

          {/* Premium-Briefings Year 2 */}
          <article className="border-2 border-black bg-white p-6 transition-shadow hover:shadow-[2px_2px_0px_#000]">
            <h2 className="text-[18px] font-bold text-black border-b-2 border-black pb-2 mb-1">Premium-Briefings — Jahr 2</h2>
            <p className="text-xs text-gray-600 mb-4">Verlängerungen Bestandslizenzen + Neugeschäft</p>
            <p className="text-sm font-normal text-black mb-4">
              Bestandslizenzen aus Jahr 1 verlängern zu <strong>{verlaengerungNachJ1}%</strong> zum Preis von <strong>{preisAbJ2} CHF</strong>.<br />
              Neue Lizenzen im Jahr 2 (<strong>{neueKundenJ2}</strong>/Monat) zahlen den Erstjahr-Preis von <strong>{preisJ1} CHF</strong>.
            </p>
            <div className="space-y-4">
              {/* Old customers */}
              <div className="grid gap-3 bg-[#F5F5F5] border-2 border-black p-4 font-mono text-sm text-black">
                <span className="font-bold text-xs uppercase text-gray-600">A) Verlängerung Bestandslizenzen (Jahr 1)</span>
                <div>
                  <span className="font-semibold text-gray-600">Verlängerte Lizenzen:</span>
                  <div className="text-[15px] font-semibold mt-1">
                    {numberFormatter.format(calcDetails.y1_sold)} Lizenzen * {verlaengerungNachJ1}% = {numberFormatter.format(Math.round(calcDetails.y2_renew_count))} Lizenzen
                  </div>
                </div>
                <div>
                  <span className="font-semibold text-gray-600">Einnahmen:</span>
                  <div className="text-[15px] font-semibold mt-1 text-[#00aa00]">
                    {numberFormatter.format(Math.round(calcDetails.y2_renew_count))} Lizenzen * {preisAbJ2} CHF * 12 Monate = {currencyFormatter.format(calcDetails.y2_renew_rev)}
                  </div>
                </div>
              </div>

              {/* New customers */}
              <div className="grid gap-3 bg-[#F5F5F5] border-2 border-black p-4 font-mono text-sm text-black">
                <span className="font-bold text-xs uppercase text-gray-600">B) Neue Lizenzen Jahr 2</span>
                <div>
                  <span className="font-semibold text-gray-600">Verkaufte Lizenzen:</span>
                  <div className="text-[15px] font-semibold mt-1">
                    {neueKundenJ2} Lizenzen/Monat * 12 Monate = {numberFormatter.format(calcDetails.y2_new_sold)} Lizenzen
                  </div>
                </div>
                <div>
                  <span className="font-semibold text-gray-600">Einnahmen:</span>
                  <div className="text-[15px] font-semibold mt-1 text-[#00aa00]">
                    {numberFormatter.format(calcDetails.y2_new_sold)} Lizenzen * {preisJ1} CHF * 12 Monate = {currencyFormatter.format(calcDetails.y2_new_rev)}
                  </div>
                </div>
              </div>

              {/* Year 2 Total */}
              <div className="bg-black text-white p-4 font-mono text-sm border-2 border-black flex justify-between items-center">
                <span className="font-bold">Gesamteinnahmen Jahr 2:</span>
                <span className="text-[18px] font-bold text-[#4ade80]">
                  {currencyFormatter.format(calcDetails.y2_total_rev)}
                </span>
              </div>

              {/* Year 2 ARR */}
              <div className="bg-[#EBF4FF] border-2 border-black p-4 font-mono text-sm text-black">
                <span className="font-bold text-xs uppercase text-gray-600">ARR (Annual Recurring Revenue) am Ende von Jahr 2</span>
                <div className="mt-2 space-y-1">
                  <div>MRR Bestandslizenzen: {currencyFormatter.format(calcDetails.y2_renew_rev / 12)} / Monat</div>
                  <div>MRR neue Lizenzen: {currencyFormatter.format(calcDetails.y2_new_rev / 12)} / Monat</div>
                  <div className="font-bold border-t border-black pt-1 mt-1">
                    Gesamt-MRR (Monat 24): {currencyFormatter.format(calcDetails.y2_total_rev / 12)} / Monat
                  </div>
                  <div className="font-bold text-blue-600 text-[15px] mt-1">
                    Gesamt-ARR (MRR * 12): {currencyFormatter.format(calcDetails.y2_total_rev)} / Jahr
                  </div>
                </div>
              </div>
            </div>
          </article>

          {/* Premium-Briefings Year 3 */}
          <article className="border-2 border-black bg-white p-6 transition-shadow hover:shadow-[2px_2px_0px_#000]">
            <h2 className="text-[18px] font-bold text-black border-b-2 border-black pb-2 mb-1">Premium-Briefings — Jahr 3</h2>
            <p className="text-xs text-gray-600 mb-4">Zweite/dritte Verlängerungswelle + Neugeschäft</p>
            <p className="text-sm font-normal text-black mb-4">
              Lizenzen aus Jahr 1 verlängern ein zweites Mal zu <strong>{verlaengerungNachJ2}%</strong> zum Preis von <strong>{preisAbJ3} CHF</strong>.<br />
              Lizenzen aus Jahr 2 verlängern das erste Mal zu <strong>{verlaengerungNachJ1}%</strong> zum Preis von <strong>{preisAbJ2} CHF</strong>.<br />
              Neue Lizenzen im Jahr 3 (<strong>{neueKundenJ3}</strong>/Monat) zahlen den Erstjahr-Preis von <strong>{preisJ1} CHF</strong>.
            </p>
            <div className="space-y-4">
              {/* Original cohort renewal */}
              <div className="grid gap-3 bg-[#F5F5F5] border-2 border-black p-4 font-mono text-sm text-black">
                <span className="font-bold text-xs uppercase text-gray-600">A) Zweite Verlängerung (Originallizenzen Jahr 1)</span>
                <div>
                  <span className="font-semibold text-gray-600">Verlängerte Lizenzen:</span>
                  <div className="text-[15px] font-semibold mt-1">
                    {numberFormatter.format(Math.round(calcDetails.y2_renew_count))} Lizenzen * {verlaengerungNachJ2}% = {numberFormatter.format(Math.round(calcDetails.y3_renew_orig_count))} Lizenzen
                  </div>
                </div>
                <div>
                  <span className="font-semibold text-gray-600">Einnahmen:</span>
                  <div className="text-[15px] font-semibold mt-1 text-[#00aa00]">
                    {numberFormatter.format(Math.round(calcDetails.y3_renew_orig_count))} Lizenzen * {preisAbJ3} CHF * 12 Monate = {currencyFormatter.format(calcDetails.y3_renew_orig_rev)}
                  </div>
                </div>
              </div>

              {/* Year 2 cohort renewal */}
              <div className="grid gap-3 bg-[#F5F5F5] border-2 border-black p-4 font-mono text-sm text-black">
                <span className="font-bold text-xs uppercase text-gray-600">B) Erste Verlängerung (Lizenzen Jahr 2)</span>
                <div>
                  <span className="font-semibold text-gray-600">Verlängerte Lizenzen:</span>
                  <div className="text-[15px] font-semibold mt-1">
                    {numberFormatter.format(calcDetails.y2_new_sold)} Lizenzen * {verlaengerungNachJ1}% = {numberFormatter.format(Math.round(calcDetails.y3_renew_y2_count))} Lizenzen
                  </div>
                </div>
                <div>
                  <span className="font-semibold text-gray-600">Einnahmen:</span>
                  <div className="text-[15px] font-semibold mt-1 text-[#00aa00]">
                    {numberFormatter.format(Math.round(calcDetails.y3_renew_y2_count))} Lizenzen * {preisAbJ2} CHF * 12 Monate = {currencyFormatter.format(calcDetails.y3_renew_y2_rev)}
                  </div>
                </div>
              </div>

              {/* New customers */}
              <div className="grid gap-3 bg-[#F5F5F5] border-2 border-black p-4 font-mono text-sm text-black">
                <span className="font-bold text-xs uppercase text-gray-600">C) Neue Lizenzen Jahr 3</span>
                <div>
                  <span className="font-semibold text-gray-600">Verkaufte Lizenzen:</span>
                  <div className="text-[15px] font-semibold mt-1">
                    {neueKundenJ3} Lizenzen/Monat * 12 Monate = {numberFormatter.format(calcDetails.y3_new_sold)} Lizenzen
                  </div>
                </div>
                <div>
                  <span className="font-semibold text-gray-600">Einnahmen:</span>
                  <div className="text-[15px] font-semibold mt-1 text-[#00aa00]">
                    {numberFormatter.format(calcDetails.y3_new_sold)} Lizenzen * {preisJ1} CHF * 12 Monate = {currencyFormatter.format(calcDetails.y3_new_rev)}
                  </div>
                </div>
              </div>

              {/* Year 3 Total */}
              <div className="bg-black text-white p-4 font-mono text-sm border-2 border-black flex justify-between items-center">
                <span className="font-bold">Gesamteinnahmen Jahr 3:</span>
                <span className="text-[18px] font-bold text-[#4ade80]">
                  {currencyFormatter.format(calcDetails.y3_total_rev)}
                </span>
              </div>

              {/* Year 3 ARR */}
              <div className="bg-[#EBF4FF] border-2 border-black p-4 font-mono text-sm text-black">
                <span className="font-bold text-xs uppercase text-gray-600">ARR (Annual Recurring Revenue) am Ende von Jahr 3</span>
                <div className="mt-2 space-y-1">
                  <div>MRR Originallizenzen (Jahr 1): {currencyFormatter.format(calcDetails.y3_renew_orig_rev / 12)} / Monat</div>
                  <div>MRR Bestandslizenzen (Jahr 2): {currencyFormatter.format(calcDetails.y3_renew_y2_rev / 12)} / Monat</div>
                  <div>MRR neue Lizenzen (Jahr 3): {currencyFormatter.format(calcDetails.y3_new_rev / 12)} / Monat</div>
                  <div className="font-bold border-t border-black pt-1 mt-1">
                    Gesamt-MRR (Monat 36): {currencyFormatter.format(calcDetails.y3_total_rev / 12)} / Monat
                  </div>
                  <div className="font-bold text-blue-600 text-[15px] mt-1">
                    Gesamt-ARR (MRR * 12): {currencyFormatter.format(calcDetails.y3_total_rev)} / Jahr
                  </div>
                </div>
              </div>
            </div>
          </article>

          {/* Monitor */}
          <article className="border-2 border-black bg-white p-6 transition-shadow hover:shadow-[2px_2px_0px_#000]">
            <h2 className="text-[18px] font-bold text-black border-b-2 border-black pb-2 mb-1">Monitor</h2>
            <p className="text-xs text-gray-600 mb-4">
              Jahrespreis upfront · fester Preis · Churn = Verlängerung nach Jahr 1 ({clampPercent(verlaengerungNachJ1).toFixed(1)} %) alle 12 Monate
            </p>
            {!monitorCalcDetails.active ? (
              <div className="bg-[#F5F5F5] border-2 border-black p-4 text-sm text-gray-600">
                Deaktiviert (Start Monat, neue Lizenzen/Monat oder Preis = 0). Kein Einfluss auf Baseline-KPIs.
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-black">
                  Ab Monat <strong>{monitorCalcDetails.startMonat}</strong> werden{" "}
                  <strong>{monitorCalcDetails.neueProMonat}</strong> neue Lizenzen/Monat à{" "}
                  <strong>{monitorCalcDetails.preis} CHF</strong> verkauft (Upfront = Preis × 12).
                </p>
                {monitorCalcDetails.years.map((y) => (
                  <div
                    key={y.year}
                    className="grid gap-3 bg-[#F5F5F5] border-2 border-black p-4 font-mono text-sm text-black"
                  >
                    <span className="font-bold text-xs uppercase text-gray-600">Geschäftsjahr {y.year}</span>
                    <div>
                      <span className="font-semibold text-gray-600">Neu verkaufte Lizenzen im Jahr:</span>
                      <div className="text-[15px] font-semibold mt-1">{numberFormatter.format(y.soldInYear)}</div>
                    </div>
                    <div>
                      <span className="font-semibold text-gray-600">Summe MRR-Umsatz (GuV, 12 Monate):</span>
                      <div className="text-[15px] font-semibold mt-1 text-[#00aa00]">
                        {currencyFormatter.format(y.umsatzJahr)}
                      </div>
                    </div>
                    <div>
                      <span className="font-semibold text-gray-600">Stand Ende GJ{y.year}:</span>
                      <div className="text-[15px] font-semibold mt-1">
                        {numberFormatter.format(Math.round(y.endActive))} aktive Lizenzen · MRR{" "}
                        {currencyFormatter.format(y.endMrr)} / Monat · ARR{" "}
                        {currencyFormatter.format(y.endMrr * 12)} / Jahr
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </article>

          {/* Anker-Kunde */}
          <article className="border-2 border-black bg-white p-6 transition-shadow hover:shadow-[2px_2px_0px_#000]">
            <h2 className="text-[18px] font-bold text-black border-b-2 border-black pb-2 mb-1">Anker-Kunde</h2>
            <p className="text-xs text-gray-600 mb-4">Monatlicher Umsatz · kein Upfront · Cash = GuV</p>
            {!ankerCalcDetails.active ? (
              <div className="bg-[#F5F5F5] border-2 border-black p-4 text-sm text-gray-600">
                Deaktiviert (Start Monat, Anzahl Lizenzen oder Preis = 0). Kein Einfluss auf Baseline-KPIs.
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-black">
                  Ab Monat <strong>{ankerCalcDetails.startMonat}</strong>:{" "}
                  <strong>{ankerCalcDetails.lizenzen}</strong> Lizenzen ×{" "}
                  <strong>{ankerCalcDetails.preis} CHF</strong>/Monat ={" "}
                  <strong>{currencyFormatter.format(ankerCalcDetails.monatsMrr)}</strong> MRR (monatlich wiederkehrend).
                </p>
                <div className="grid gap-3 bg-[#F5F5F5] border-2 border-black p-4 font-mono text-sm text-black">
                  <div>
                    <span className="font-semibold text-gray-600">Verkaufte Lizenzen (einmalig bei Start):</span>
                    <div className="text-[15px] font-semibold mt-1">
                      {numberFormatter.format(ankerCalcDetails.lizenzen)} Lizenzen
                    </div>
                  </div>
                  <div>
                    <span className="font-semibold text-gray-600">Monatlicher Umsatz & Cash ab Start:</span>
                    <div className="text-[15px] font-semibold mt-1 text-[#00aa00]">
                      {currencyFormatter.format(ankerCalcDetails.monatsMrr)} / Monat
                    </div>
                  </div>
                </div>
                {ankerCalcDetails.years.map((y) => (
                  <div
                    key={y.year}
                    className="grid gap-3 bg-[#F5F5F5] border-2 border-black p-4 font-mono text-sm text-black"
                  >
                    <span className="font-bold text-xs uppercase text-gray-600">Geschäftsjahr {y.year}</span>
                    <div>
                      <span className="font-semibold text-gray-600">Monate mit Umsatz:</span>
                      <div className="text-[15px] font-semibold mt-1">{y.monthsActive} von 12</div>
                    </div>
                    <div>
                      <span className="font-semibold text-gray-600">Summe MRR-Umsatz (GuV):</span>
                      <div className="text-[15px] font-semibold mt-1 text-[#00aa00]">
                        {currencyFormatter.format(y.umsatzJahr)}
                      </div>
                    </div>
                    {y.endMrr > 0 && (
                      <div>
                        <span className="font-semibold text-gray-600">MRR Ende GJ{y.year}:</span>
                        <div className="text-[15px] font-semibold mt-1">
                          {currencyFormatter.format(y.endMrr)} / Monat · ARR {currencyFormatter.format(y.endMrr * 12)} / Jahr
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </article>

          {/* Break-even Card */}
          <article className="border-2 border-black bg-white p-6 transition-shadow hover:shadow-[2px_2px_0px_#000]">
            <h2 className="text-[18px] font-bold text-black border-b-2 border-black pb-2 mb-4">Break-even (operativ)</h2>
            <p className="text-sm font-normal text-black mb-4">
              Gesamtmodell (Premium-Briefings + Monitor + Anker-Kunde + Sponsoring). Operativer Break-Even: Einnahmen ≥
              Personal + Sachkosten + Spezialtopf (ohne Gewinnsteuer).
            </p>

            {breakEvenMonatTotal != null && breakEvenPointTotal != null ? (
              <div className="grid gap-3 bg-[#F5F5F5] border-2 border-black p-4 font-mono text-sm text-black">
                <div className="text-[16px] font-bold text-[#00aa00] mb-2">
                  Mit Monitor/Anker: Monat {breakEvenMonatTotal} (Jahr {breakEvenPointTotal.year})
                </div>
                {breakEvenMonatBaseline != null && breakEvenMonatBaseline !== breakEvenMonatTotal && (
                  <div className="text-sm font-semibold text-gray-700">
                    Ohne Monitor/Anker (Baseline): Monat {breakEvenMonatBaseline}
                  </div>
                )}
                <div>
                  <span className="font-semibold text-gray-600">Monatliche Einnahmen in Monat {breakEvenMonatTotal}:</span>
                  <div className="pl-4 mt-1">
                    Premium-Briefings (MRR): {currencyFormatter.format(breakEvenPointTotal.umsatzLizenzen)} / Monat<br />
                    Monitor (MRR): {currencyFormatter.format(breakEvenPointTotal.umsatzMonitor)} / Monat<br />
                    Anker-Kunde (MRR): {currencyFormatter.format(breakEvenPointTotal.umsatzAnker)} / Monat<br />
                    Sponsoring: {currencyFormatter.format(breakEvenPointTotal.sponsoringProMonat)} / Monat<br />
                    <span className="font-bold">Gesamteinnahmen: {currencyFormatter.format(breakEvenPointTotal.gesamteinnahmen)} / Monat</span>
                  </div>
                </div>
                <hr className="border-black border-dashed" />
                <div>
                  <span className="font-semibold text-gray-600">Monatliche Ausgaben in Monat {breakEvenMonatTotal}:</span>
                  <div className="pl-4 mt-1 space-y-1">
                    <div>
                      <span className="font-semibold">Personalkosten gesamt:</span> {currencyFormatter.format(breakEvenPointTotal.personalkosten)} / Monat
                      <div className="text-[12px] text-gray-600 pl-4 border-l-2 border-black ml-1 mt-0.5 font-mono">
                        Bruttolöhne: {currencyFormatter.format(breakEvenPointTotal.bruttolohn)} / Monat<br />
                        Sozialabgaben & Vorsorge ({clampPercent(sozialabgabenProzent).toFixed(1)}%): {currencyFormatter.format(breakEvenPointTotal.sozialabgaben)} / Monat
                      </div>
                    </div>
                    <div>Sachkosten: {currencyFormatter.format(breakEvenPointTotal.sachkosten)} / Monat</div>
                    {breakEvenPointTotal.gewinnsteuer > 0 && (
                      <div>Gewinnsteuer: {currencyFormatter.format(breakEvenPointTotal.gewinnsteuer)} / Monat</div>
                    )}
                    {breakEvenPointTotal.spezialtopfKosten > 0 && (
                      <div className="text-[12px] text-gray-600 pl-4 border-l-2 border-black ml-1 mt-0.5 font-mono">
                        Spezialtopf-Tranche: {currencyFormatter.format(breakEvenPointTotal.spezialtopfKosten)} / Monat (bis Monat 36)
                      </div>
                    )}
                    <div className="font-bold pt-1 mt-1 border-t border-black">Gesamtausgaben: {currencyFormatter.format(breakEvenPointTotal.gesamtausgaben)} / Monat</div>
                  </div>
                </div>
                <hr className="border-black border-dashed" />
                <div className="font-bold text-[#00aa00] text-[15px]">
                  Netto-Ergebnis (Einnahmen − operative Ausgaben): +{currencyFormatter.format(
                    breakEvenPointTotal.gesamteinnahmen - breakEvenPointTotal.personalkosten - breakEvenPointTotal.sachkosten - breakEvenPointTotal.spezialtopfKosten
                  )} / Monat
                </div>
              </div>
            ) : breakEvenMonatBaseline != null && breakEvenPointBaseline != null ? (
              <div className="grid gap-3 bg-[#F5F5F5] border-2 border-black p-4 font-mono text-sm text-black">
                <div className="text-[16px] font-bold text-[#00aa00] mb-2">
                  Nur Baseline (ohne Monitor/Anker): Monat {breakEvenMonatBaseline} (Jahr {breakEvenPointBaseline.year})
                </div>
                <p className="text-sm text-gray-700">
                  Mit aktiviertem Monitor/Anker kein Gesamt-Break-even innerhalb von 48 Monaten — Baseline erreicht operativen Break-even in Monat {breakEvenMonatBaseline}.
                </p>
              </div>
            ) : (
              <div className="bg-[#FFF0F0] border-2 border-black p-4 font-mono text-sm text-red-600 font-bold">
                Kein Break-Even innerhalb der 48 Monate mit den aktuellen Parametern.
              </div>
            )}
          </article>
        </div>
      )}

      {activeTab === "kennzahlen" && (
        <div className="space-y-4">
          {/* Kapitalbedarf Header Card */}
          <article className="border-2 border-black bg-white p-6 transition-shadow hover:shadow-[2px_2px_0px_#000]">
            <h2 className="text-[20px] font-bold text-black border-b-2 border-black pb-2 mb-4">Finanzkennzahlen</h2>
            <div className="text-lg font-bold text-[#FF6B6B] bg-red-50 border-2 border-black p-4 inline-block">
              Wir rechnen mit einem Kapitalbedarf von rund {currencyFormatter.format(kennzahlen.totalKapitalbedarf)} (GJ 1 - GJ 3)
            </div>
          </article>

          {/* Table Card */}
          <article className="border-2 border-black bg-white p-6 transition-shadow hover:shadow-[2px_2px_0px_#000]">
            <div className="overflow-x-auto">
              <table className="w-full text-left font-sans border-collapse">
                <thead>
                  <tr className="border-b-2 border-black bg-[#F5F5F5] text-black text-sm">
                    <th className="p-3 border-r-2 border-black font-bold">Kennzahl</th>
                    <th className="p-3 border-r-2 border-black font-bold text-center w-1/4">GJ 1</th>
                    <th className="p-3 border-r-2 border-black font-bold text-center w-1/4">GJ 2</th>
                    <th className="p-3 font-bold text-center w-1/4">GJ 3</th>
                  </tr>
                </thead>
                <tbody className="font-mono text-sm">
                  {/* ARR Row */}
                  <tr className="border-b-2 border-black hover:bg-[#FAF9F6]">
                    <td className="p-3 border-r-2 border-black font-sans font-semibold">ARR</td>
                    {kennzahlen.results.map((r) => (
                      <td key={r.year} className="p-3 border-r-2 last:border-r-0 border-black text-center font-bold text-blue-600">
                        {currencyFormatter.format(r.arr)}
                      </td>
                    ))}
                  </tr>
                  {/* Betriebskosten Row */}
                  <tr className="border-b border-black hover:bg-[#FAF9F6]">
                    <td className="p-3 border-r-2 border-black font-sans font-semibold">Betriebskosten</td>
                    {kennzahlen.results.map((r) => (
                      <td key={r.year} className="p-3 border-r-2 last:border-r-0 border-black text-center text-red-600">
                        {currencyFormatter.format(r.betriebskosten)}
                      </td>
                    ))}
                  </tr>
                  {/* Gesamtausgaben Row */}
                  <tr className="border-b-2 border-black hover:bg-[#FAF9F6]">
                    <td className="p-3 border-r-2 border-black font-sans font-semibold">Gesamtausgaben</td>
                    {kennzahlen.results.map((r) => (
                      <td key={r.year} className="p-3 border-r-2 last:border-r-0 border-black text-center text-red-600">
                        {currencyFormatter.format(r.gesamtausgaben)}
                      </td>
                    ))}
                  </tr>
                  {/* EBITA Row */}
                  <tr className="border-b-2 border-black hover:bg-[#FAF9F6]">
                    <td className="p-3 border-r-2 border-black font-sans font-semibold">EBITA</td>
                    {kennzahlen.results.map((r) => (
                      <td key={r.year} className={`p-3 border-r-2 last:border-r-0 border-black text-center font-bold ${r.ebitan >= 0 ? "text-green-600" : "text-red-600"}`}>
                        {currencyFormatter.format(r.ebitan)}
                      </td>
                    ))}
                  </tr>
                  {/* Bruttomarge Row */}
                  <tr className="border-b-2 border-black hover:bg-[#FAF9F6]">
                    <td className="p-3 border-r-2 border-black font-sans font-semibold">Bruttomarge (inkl. PersKo)</td>
                    {kennzahlen.results.map((r) => (
                      <td key={r.year} className={`p-3 border-r-2 last:border-r-0 border-black text-center font-bold ${r.bruttomarge >= 0 ? "text-green-600" : "text-red-600"}`}>
                        {r.bruttomarge.toFixed(2)}%
                      </td>
                    ))}
                  </tr>
                  {/* Net Burn Rate Row */}
                  <tr className="border-b-2 border-black hover:bg-[#FAF9F6]">
                    <td className="p-3 border-r-2 border-black font-sans font-semibold">Net Burn Rate pro Mt.</td>
                    {kennzahlen.results.map((r) => (
                      <td key={r.year} className="p-3 border-r-2 last:border-r-0 border-black text-center font-semibold">
                        {r.avgBurnRate <= 0 ? (
                          <span className="text-green-600 bg-green-50 px-1 border border-green-600 uppercase text-xs">Profitabel</span>
                        ) : (
                          `${currencyFormatter.format(r.avgBurnRate)} / Monat`
                        )}
                      </td>
                    ))}
                  </tr>
                  {/* Cash Runway Row */}
                  <tr className="border-b-2 border-black hover:bg-[#FAF9F6]">
                    <td className="p-3 border-r-2 border-black font-sans font-semibold">Cash Runway</td>
                    {kennzahlen.results.map((r) => (
                      <td key={r.year} className="p-3 border-r-2 last:border-r-0 border-black text-center font-bold">
                        {r.runway === "Profitabel" ? (
                          <span className="text-green-600 bg-green-50 px-1 border border-green-600 uppercase text-xs">Profitabel</span>
                        ) : (
                          r.runway
                        )}
                      </td>
                    ))}
                  </tr>
                  {/* Kapitalbedarf Row */}
                  <tr className="hover:bg-[#FAF9F6]">
                    <td className="p-3 border-r-2 border-black font-sans font-semibold">Kapitalbedarf</td>
                    {kennzahlen.results.map((r) => (
                      <td key={r.year} className={`p-3 border-r-2 last:border-r-0 border-black text-center font-bold ${r.kapitalbedarf > 0 ? "text-red-600" : "text-green-600"}`}>
                        {currencyFormatter.format(r.kapitalbedarf)}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="mt-4 border-t border-black pt-3 text-[11px] leading-relaxed text-gray-800">
              <strong>Betriebskosten</strong> = Personal (inkl. Sozialabgaben) + Sachkosten + Spezialtopf — operativ,{" "}
              <strong>ohne Gewinnsteuer</strong>. <strong>Gesamtausgaben</strong> = Betriebskosten + Gewinnsteuer (nur
              bei positivem Monatsergebnis). <strong>EBITA</strong> = Jahres-Gesamteinnahmen − Betriebskosten.
              Net Burn und Cash Runway basieren auf cashwirksamen Einnahmen gegenüber den Gesamtausgaben.
            </p>
          </article>

          {/* Explanation Section */}
          <article className="border-2 border-black bg-[#F5F5F5] p-6 transition-shadow hover:shadow-[2px_2px_0px_#000]">
            <h3 className="text-[16px] font-bold text-black border-b-2 border-black pb-1 mb-3">Erklärung der Kennzahlen</h3>
            <div className="grid gap-4 md:grid-cols-2 text-sm text-black">
              <div className="space-y-3">
                <div>
                  <span className="font-bold block">ARR (Annual Recurring Revenue)</span>
                  <span className="text-xs text-gray-700 leading-tight font-mono">
                    Lizenzumsatz des letzten Monats des jeweiligen Jahres mal 12.
                  </span>
                </div>
                <div>
                  <span className="font-bold block">Betriebskosten</span>
                  <span className="text-xs text-gray-700 leading-tight font-mono">
                    Summe Personal (inkl. Sozialabgaben), Sachkosten und Spezialtopf — ohne Gewinnsteuer.
                  </span>
                </div>
                <div>
                  <span className="font-bold block">Gesamtausgaben</span>
                  <span className="text-xs text-gray-700 leading-tight font-mono">
                    Betriebskosten plus Gewinnsteuer in profitablen Monaten.
                  </span>
                </div>
                <div>
                  <span className="font-bold block">EBITA</span>
                  <span className="text-xs text-gray-700 leading-tight font-mono">
                    Operatives Jahresergebnis vor Gewinnsteuer: Gesamteinnahmen minus Betriebskosten.
                  </span>
                </div>
              </div>
              <div className="space-y-3">
                <div>
                  <span className="font-bold block">Bruttomarge (inkl. PersKo)</span>
                  <span className="text-xs text-gray-700 leading-tight font-mono">
                    Das prozentuale Verhältnis von EBITA zu den Gesamteinnahmen: (EBITA / Gesamteinnahmen) * 100% für das jeweilige Jahr.
                  </span>
                </div>
                <div>
                  <span className="font-bold block">Net Burn Rate pro Mt.</span>
                  <span className="text-xs text-gray-700 leading-tight font-mono">
                    Durchschnittlicher monatlicher operativer Cash-Abfluss (Ausgaben minus cashwirksame Einnahmen). Ist der Cashflow positiv, gilt es als "Profitabel".
                  </span>
                </div>
                <div>
                  <span className="font-bold block">Cash Runway</span>
                  <span className="text-xs text-gray-700 leading-tight font-mono">
                    Anzahl Monate ab Ende des jeweiligen Jahres, bis der Cashbestand unter 0 fällt (basierend auf dem weiteren Verlauf der Simulation). Bei dauerhaft positivem Cashbestand wird "Profitabel" angezeigt.
                  </span>
                </div>
                <div>
                  <span className="font-bold block">Kapitalbedarf</span>
                  <span className="text-xs text-gray-700 leading-tight font-mono">
                    Der operative Fehlbetrag (negatives EBITA) des jeweiligen Jahres, der durch Kapitalzufuhr gedeckt werden muss.
                  </span>
                </div>
              </div>
            </div>
          </article>
        </div>
      )}

      {activeTab === "dummy" && (
        <div className="space-y-6">
          <article className="border-2 border-black bg-white p-8 hover:shadow-[4px_4px_0px_#000] transition-shadow duration-200">
            <div className="flex justify-between items-center border-b-4 border-black pb-2 mb-6">
              <h2 className="text-[24px] font-bold text-black uppercase tracking-wider">
                9. Finanzplan (Zahlenteil)
              </h2>
              <button
                type="button"
                onClick={handleCopyText}
                className="border-2 border-black bg-white px-3 py-1.5 text-xs font-bold text-black transition-shadow hover:shadow-[2px_2px_0px_#000] active:translate-y-[1px] cursor-pointer flex items-center gap-1.5"
                title="Gesamtes Kapitel als Text kopieren"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 7.5V6.108c0-1.135.845-2.098 1.976-2.192.373-.03.748-.057 1.123-.08M15.75 18H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08M15.75 18.75v-1.875a3.375 3.375 0 00-3.375-3.375h-1.5a1.125 1.125 0 01-1.125-1.125v-1.5A3.375 3.375 0 006.375 7.5H5.25m11.9-3.664A2.251 2.251 0 0015 2.25h-1.5a2.251 2.251 0 00-2.15 1.586m5.8 0c.065.21.1.433.1.664v.75h-6V4.5c0-.231.035-.454.1-.664M6.75 7.5H4.875c-.621 0-1.125.504-1.125 1.125v12c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V16.5a9 9 0 00-9-9z" />
                </svg>
                Text kopieren
              </button>
            </div>
            <p className="text-sm text-black leading-relaxed mb-6 font-sans">
              Die finanzielle Planung von Attaché spiegelt ein hochskalierbares, technologiegestütztes B2B-Geschäftsmodell wider. Um das Marktpotenzial der Executive Intelligence in der Schweiz zu beweisen und die Plattform anschliessend zum break Even zu skalieren, ist die Finanzierungsstruktur in drei Phasen unterteilt: <strong>Pre-Seed</strong> (Validierung), <strong>Seed</strong> (Markteintritt & Break-even) und <strong>Series A</strong> (Konsolidierung).
            </p>

            <h3 className="text-[18px] font-bold text-black border-b-2 border-black pb-1 mb-4">
              9.1 Investitionsplan
            </h3>
            <p className="text-sm text-black leading-relaxed mb-4">
              Die Investitionen von Attaché konzentrieren sich in der Aufbauphase konsequent auf den technologischen Vorsprung und den Ausbau des proprietären Moats. Mit fortschreitender Finanzierung verschiebt sich der Fokus vom Produktlaunch hin zu Sales und Skalierung der Erlösströme Premium-Briefings, Monitor und Anker-Kunden-Lösungen.
            </p>
            <ul className="list-disc pl-5 mb-6 text-sm text-black space-y-2">
              <li>
                <strong>Pre-Seed- & Seed-Investitionen (Produkt & Core-Tech):</strong> Überführung der Prototypen („Seismo“ und „Magnitu“) in den Live-Betrieb, Launch des Gratis Briefings und Premium-Briefings (Bezahlprodukt), Aufbau der Monitor-Plattform (Investitionsvolumen: CHF <Highlight>{numberFormatter.format(seedBetrag)}</Highlight>).
              </li>
              <li>
                <strong>Series A:</strong> Skalierung von Premium-Briefings und Monitor, Härtung der technischen Infrastruktur für Enterprise-Angebote (Anker-Kunde), redaktionelle Konsolidierung und Ausbau des Vertriebs (Investitionsvolumen: CHF <Highlight>{numberFormatter.format(seriesABetrag)}</Highlight>).
              </li>
            </ul>

            <h3 className="text-[18px] font-bold text-black border-b-2 border-black pb-1 mb-4">
              9.2 Betriebskostenplanung (Kostenstruktur / OpEx)
            </h3>
            <p className="text-sm text-black leading-relaxed mb-4">
              Die betrieblichen Aufwendungen (OpEx) sind durch die Struktur des wissensbasierten Dienstleistungsmodells geprägt. Das strategische Verhältnis zwischen Personal- und Sachkosten ist langfristig auf <span className="bg-[#FFE600] text-black font-bold px-1 border border-black">{dummyData.persRatio} % / {dummyData.sachRatio} %</span> optimiert, da die Technologie den manuellen Skalierungsaufwand massiv abfedert.
            </p>
            <ul className="list-disc pl-5 mb-6 text-sm text-black space-y-2">
              <li>
                <strong>Personalaufwand:</strong> Bildet den grössten Kostenblock. {roles.length} Rollen mit individuellen Salären (Ø CHF <span className="bg-[#FFE600] text-black font-bold px-1 border border-black">{numberFormatter.format(dummyData.avgSalary)}</span>/Monat). Das Team umfasst planmässig <span className="bg-[#FFE600] text-black font-bold px-1 border border-black">{dummyData.fteSeed.toFixed(1)}</span> FTE in der Seed-Phase und <span className="bg-[#FFE600] text-black font-bold px-1 border border-black">{dummyData.fteSeriesA.toFixed(1)}</span> FTE nach Series A.
              </li>
              <li>
                <strong>Technologie- & Serverkosten:</strong> Beinhaltet hocheffizientes Hosting sowie die SaaS-Gebühren für das CRM- und Auslieferungssystem (Postmark, Statamic). Veranschlagt sind CHF <span className="bg-[#FFE600] text-black font-bold px-1 border border-black">{numberFormatter.format(sachkostenItems.find((i) => i.id === "sach-12")?.unitMonth ?? 3000)}</span> pro Monat.
              </li>
              <li>
                <strong>Vertrieb & horizontales Wachstum:</strong> Budgets Series A für das B2B-Enterprise-Sales-Team. Nach der Series A steigen die variablen Marketing- und Vertriebskosten auf CHF <span className="bg-[#FFE600] text-black font-bold px-1 border border-black">{numberFormatter.format(sachkostenItems.find((i) => i.id === "sach-2")?.costY3 ?? 42000)}</span> jährlich, um den horizontalen Rollout voranzutreiben.
              </li>
            </ul>

            <h3 className="text-[18px] font-bold text-black border-b-2 border-black pb-1 mb-4">
              9.3 Umsatz- & Absatzplanung
            </h3>
            <p className="text-sm text-black leading-relaxed mb-4">
              Die Umsatzgenerierung erfolgt primär über wiederkehrende B2B-Lizenzerlöse (ARR) mit jährlicher Vorauszahlung.
            </p>
            <div className="mb-6 space-y-4 text-sm text-black">
              <div>
                <p className="font-bold mb-2">
                  Seed-Phase (Jahr <Highlight>1</Highlight> bis <Highlight>{dummyData.seriesAYear}</Highlight>)
                </p>
                <ul className="list-disc pl-5 space-y-2">
                  <li>
                    <strong>Premium-Briefings:</strong> Erreichen von{" "}
                    <Highlight>{numberFormatter.format(Math.round(dummyData.seedBriefingActive))}</Highlight> aktiven Lizenzen
                    über ca. <Highlight>{dummyData.seedBriefingAccounts}</Highlight> B2B-Accounts zu einem rabattierten
                    Einstiegspreis von CHF <Highlight>{numberFormatter.format(dummyData.seedBriefingPriceAnnual)}</Highlight> pro
                    Lizenz/Jahr.
                  </li>
                  <li>
                    <strong>Monitor:</strong> Erreichen von{" "}
                    <Highlight>{numberFormatter.format(Math.round(dummyData.seedMonitorActive))}</Highlight> aktiven Lizenzen zum
                    Preis von CHF <Highlight>{numberFormatter.format(dummyData.monitorPriceAnnual)}</Highlight> pro Lizenz/Jahr.
                  </li>
                  <li>
                    <strong>ARR-Ziel:</strong> CHF <Highlight>{formatArrMio(dummyData.seedArr)}</Highlight> Mio., zu{" "}
                    <Highlight>{dummyData.seedArrBriefingPct}</Highlight> Prozent aus Premium-Briefings und zu{" "}
                    <Highlight>{dummyData.seedArrMonitorPct}</Highlight> Prozent aus Monitor.
                  </li>
                </ul>
              </div>
              <div>
                <p className="font-bold mb-2">
                  Series A-Phase (Jahr <Highlight>{dummyData.seriesAStartYear}</Highlight> bis <Highlight>3</Highlight>)
                </p>
                <ul className="list-disc pl-5 space-y-2">
                  <li>
                    <strong>Premium-Briefings:</strong> Schrittweise Harmonisierung auf den regulären Zielpreis von CHF{" "}
                    <Highlight>{numberFormatter.format(dummyData.targetBriefingPriceAnnual)}</Highlight> pro Lizenz/Jahr. Durch die
                    Erschliessung neuer Themen-Nischen (vertikale Skalierung) steigt das Absatzvolumen auf{" "}
                    <Highlight>{numberFormatter.format(dummyData.briefingSoldY3)}</Highlight> Lizenzen. Ende Jahr 2 sind{" "}
                    <Highlight>{numberFormatter.format(Math.round(dummyData.briefingActiveY2))}</Highlight> Lizenzen aktiv. Ende Jahr
                    3 sind <Highlight>{numberFormatter.format(Math.round(dummyData.briefingActiveY3))}</Highlight> Lizenzen aktiv.
                  </li>
                  <li>
                    <strong>Monitor:</strong> Das Absatzvolumen steigt auf{" "}
                    <Highlight>{numberFormatter.format(dummyData.monitorSoldY3)}</Highlight> Lizenzen zum Preis von CHF{" "}
                    <Highlight>{numberFormatter.format(dummyData.monitorPriceAnnual)}</Highlight> pro Lizenz/Jahr. Ende Jahr 2 sind{" "}
                    <Highlight>{numberFormatter.format(Math.round(dummyData.monitorActiveY2))}</Highlight> Lizenzen aktiv. Ende Jahr
                    3 sind <Highlight>{numberFormatter.format(Math.round(dummyData.monitorActiveY3))}</Highlight> Lizenzen aktiv.
                  </li>
                  <li>
                    <strong>ARR-Ziel:</strong> CHF <Highlight>{formatArrMio(dummyData.seriesAArr)}</Highlight> Mio., zu{" "}
                    <Highlight>{dummyData.seriesAArrBriefingPct}</Highlight> Prozent aus Premium-Briefings und zu{" "}
                    <Highlight>{dummyData.seriesAArrMonitorPct}</Highlight> Prozent aus Monitor.
                  </li>
                </ul>
              </div>
              <div>
                <p className="font-bold mb-2">Zusatz-Umsätze</p>
                <ul className="list-disc pl-5 space-y-2">
                  <li>
                    Ab dem 1. Geschäftsjahr steuern exklusive, limitierte B2B-Sponsoringfenster planbar CHF{" "}
                    <Highlight>{numberFormatter.format(dummyData.sponsoringY1Annual)}</Highlight> pro Jahr bei. Ab dem 2.
                    Geschäftsjahr sind es <Highlight>{numberFormatter.format(dummyData.sponsoringY2Annual)}</Highlight> CHF pro Jahr.
                  </li>
                  <li>
                    <strong>Anker-Kunde:</strong> Akquise eines Kunden im Monat{" "}
                    <Highlight>{dummyData.ankerStartMonat > 0 ? dummyData.ankerStartMonat : "—"}</Highlight> mit einer
                    Spezialdienstleistung von{" "}
                    <Highlight>
                      {dummyData.ankerMonthly > 0 ? currencyFormatter.format(dummyData.ankerMonthly) : "—"}
                    </Highlight>{" "}
                    pro Monat.
                  </li>
                </ul>
              </div>
            </div>

            <h3 className="text-[18px] font-bold text-black border-b-2 border-black pb-1 mb-4">
              9.4 Plan-Gewinn- & Verlustrechnung (GuV)
            </h3>
            <p className="text-sm text-black leading-relaxed mb-4">
              Die folgende Tabelle zeigt die konsolidierte Erfolgsrechnung inklusive der Expansionsphase nach der Series A:
            </p>
            <div className="overflow-x-auto border-2 border-black mb-6">
              <table className="w-full text-left font-sans border-collapse">
                <thead>
                  <tr className="border-b-2 border-black bg-[#F5F5F5] text-black text-xs font-bold uppercase">
                    <th className="p-2 border-r-2 border-black">Position (in CHF)</th>
                    <th className="p-2 border-r-2 border-black text-center">Geschäftsjahr 1 (Seed)</th>
                    <th className="p-2 border-r-2 border-black text-center">Geschäftsjahr 2{dummyData.breakEvenYear === 2 ? " (Break-even)" : ""}</th>
                    <th className="p-2 text-center">Geschäftsjahr 3{dummyData.breakEvenYear === 3 ? " (Break-even)" : ""}{dummyData.seriesAYear === 3 ? " (Series A)" : ""}</th>
                  </tr>
                </thead>
                <tbody className="font-mono text-xs text-black">
                  <tr className="border-b border-black hover:bg-[#FAF9F6] font-sans">
                    <td className="p-2 border-r-2 border-black font-bold">Umsatzerlöse Premium-Briefings</td>
                    <td className="p-2 border-r-2 border-black text-center font-bold text-blue-600 bg-yellow-50">{numberFormatter.format(Math.round(guvData[1].umsatzLizenzen))}</td>
                    <td className="p-2 border-r-2 border-black text-center font-bold text-blue-600 bg-yellow-50">{numberFormatter.format(Math.round(guvData[2].umsatzLizenzen))}</td>
                    <td className="p-2 text-center font-bold text-blue-600 bg-yellow-50">{numberFormatter.format(Math.round(guvData[3].umsatzLizenzen))}</td>
                  </tr>
                  <tr className="border-b border-black hover:bg-[#FAF9F6]">
                    <td className="p-2 border-r-2 border-black">Umsatzerlöse Monitor</td>
                    <td className="p-2 border-r-2 border-black text-center bg-yellow-50">{numberFormatter.format(Math.round(guvData[1].umsatzMonitor))}</td>
                    <td className="p-2 border-r-2 border-black text-center bg-yellow-50">{numberFormatter.format(Math.round(guvData[2].umsatzMonitor))}</td>
                    <td className="p-2 text-center bg-yellow-50">{numberFormatter.format(Math.round(guvData[3].umsatzMonitor))}</td>
                  </tr>
                  <tr className="border-b border-black hover:bg-[#FAF9F6]">
                    <td className="p-2 border-r-2 border-black">Umsatzerlöse Anker-Kunde</td>
                    <td className="p-2 border-r-2 border-black text-center bg-yellow-50">{numberFormatter.format(Math.round(guvData[1].umsatzAnker))}</td>
                    <td className="p-2 border-r-2 border-black text-center bg-yellow-50">{numberFormatter.format(Math.round(guvData[2].umsatzAnker))}</td>
                    <td className="p-2 text-center bg-yellow-50">{numberFormatter.format(Math.round(guvData[3].umsatzAnker))}</td>
                  </tr>
                  <tr className="border-b border-black hover:bg-[#FAF9F6]">
                    <td className="p-2 border-r-2 border-black">Erlöse B2B-Sponsoring / Events</td>
                    <td className="p-2 border-r-2 border-black text-center bg-yellow-50">{numberFormatter.format(Math.round(guvData[1].sponsoring))}</td>
                    <td className="p-2 border-r-2 border-black text-center bg-yellow-50">{numberFormatter.format(Math.round(guvData[2].sponsoring))}</td>
                    <td className="p-2 text-center bg-yellow-50">{numberFormatter.format(Math.round(guvData[3].sponsoring))}</td>
                  </tr>
                  <tr className="border-b-2 border-black hover:bg-[#FAF9F6] font-sans font-bold bg-[#F9F9F9]">
                    <td className="p-2 border-r-2 border-black">Gesamtertrag</td>
                    <td className="p-2 border-r-2 border-black text-center bg-yellow-100">{numberFormatter.format(Math.round(guvData[1].gesamtertrag))}</td>
                    <td className="p-2 border-r-2 border-black text-center bg-yellow-100">{numberFormatter.format(Math.round(guvData[2].gesamtertrag))}</td>
                    <td className="p-2 text-center bg-yellow-100">{numberFormatter.format(Math.round(guvData[3].gesamtertrag))}</td>
                  </tr>
                  <tr className="border-b border-black hover:bg-[#FAF9F6]">
                    <td className="p-2 border-r-2 border-black">- Personalaufwand (inkl. Sozialleistungen)</td>
                    <td className="p-2 border-r-2 border-black text-center bg-yellow-50">{numberFormatter.format(Math.round(guvData[1].personal))}</td>
                    <td className="p-2 border-r-2 border-black text-center bg-yellow-50">{numberFormatter.format(Math.round(guvData[2].personal))}</td>
                    <td className="p-2 text-center bg-yellow-50">{numberFormatter.format(Math.round(guvData[3].personal))}</td>
                  </tr>
                  <tr className="border-b border-black hover:bg-[#FAF9F6]">
                    <td className="p-2 border-r-2 border-black">- Technischer Betriebsaufwand (Server/SaaS)</td>
                    <td className="p-2 border-r-2 border-black text-center bg-yellow-50">{numberFormatter.format(Math.round(guvData[1].tech))}</td>
                    <td className="p-2 border-r-2 border-black text-center bg-yellow-50">{numberFormatter.format(Math.round(guvData[2].tech))}</td>
                    <td className="p-2 text-center bg-yellow-50">{numberFormatter.format(Math.round(guvData[3].tech))}</td>
                  </tr>
                  <tr className="border-b border-black hover:bg-[#FAF9F6]">
                    <td className="p-2 border-r-2 border-black">- Vertriebs- und Marketingkosten</td>
                    <td className="p-2 border-r-2 border-black text-center bg-yellow-50">{numberFormatter.format(Math.round(guvData[1].marketing))}</td>
                    <td className="p-2 border-r-2 border-black text-center bg-yellow-50">{numberFormatter.format(Math.round(guvData[2].marketing))}</td>
                    <td className="p-2 text-center bg-yellow-50">{numberFormatter.format(Math.round(guvData[3].marketing))}</td>
                  </tr>
                  <tr className="border-b-2 border-black hover:bg-[#FAF9F6]">
                    <td className="p-2 border-r-2 border-black">- Allgemeine Verwaltung / Legal & Treuhand</td>
                    <td className="p-2 border-r-2 border-black text-center bg-yellow-50">{numberFormatter.format(Math.round(guvData[1].admin))}</td>
                    <td className="p-2 border-r-2 border-black text-center bg-yellow-50">{numberFormatter.format(Math.round(guvData[2].admin))}</td>
                    <td className="p-2 text-center bg-yellow-50">{numberFormatter.format(Math.round(guvData[3].admin))}</td>
                  </tr>
                  <tr className="border-b-2 border-black hover:bg-[#FAF9F6] font-sans font-bold bg-[#F9F9F9]">
                    <td className="p-2 border-r-2 border-black">EBITDA</td>
                    <td className="p-2 border-r-2 border-black text-center bg-yellow-100">{numberFormatter.format(Math.round(guvData[1].ebitda))}</td>
                    <td className="p-2 border-r-2 border-black text-center bg-yellow-100">{numberFormatter.format(Math.round(guvData[2].ebitda))}</td>
                    <td className="p-2 text-center bg-yellow-100">{numberFormatter.format(Math.round(guvData[3].ebitda))}</td>
                  </tr>
                  <tr className="border-b border-black hover:bg-[#FAF9F6]">
                    <td className="p-2 border-r-2 border-black">- Abschreibungen (Technologie/Hardware)</td>
                    <td className="p-2 border-r-2 border-black text-center bg-yellow-50">{numberFormatter.format(Math.round(guvData[1].abschreibungen))}</td>
                    <td className="p-2 border-r-2 border-black text-center bg-yellow-50">{numberFormatter.format(Math.round(guvData[2].abschreibungen))}</td>
                    <td className="p-2 text-center bg-yellow-50">{numberFormatter.format(Math.round(guvData[3].abschreibungen))}</td>
                  </tr>
                  <tr className="border-b-2 border-black hover:bg-[#FAF9F6] font-sans font-bold bg-[#F9F9F9]">
                    <td className="p-2 border-r-2 border-black">EBIT</td>
                    <td className="p-2 border-r-2 border-black text-center bg-yellow-100">{numberFormatter.format(Math.round(guvData[1].ebit))}</td>
                    <td className="p-2 border-r-2 border-black text-center bg-yellow-100">{numberFormatter.format(Math.round(guvData[2].ebit))}</td>
                    <td className="p-2 text-center bg-yellow-100">{numberFormatter.format(Math.round(guvData[3].ebit))}</td>
                  </tr>
                  <tr className="border-b border-black hover:bg-[#FAF9F6]">
                    <td className="p-2 border-r-2 border-black">- Steuern</td>
                    <td className="p-2 border-r-2 border-black text-center bg-yellow-50">{numberFormatter.format(Math.round(guvData[1].steuern))}</td>
                    <td className="p-2 border-r-2 border-black text-center bg-yellow-50">{numberFormatter.format(Math.round(guvData[2].steuern))}</td>
                    <td className="p-2 text-center bg-yellow-50">{numberFormatter.format(Math.round(guvData[3].steuern))}</td>
                  </tr>
                  <tr className="hover:bg-[#FAF9F6] font-sans font-bold bg-[#FFF2A3]">
                    <td className="p-2 border-r-2 border-black">Unternehmensergebnis (Reingewinn)</td>
                    <td className="p-2 border-r-2 border-black text-center bg-yellow-100">{numberFormatter.format(Math.round(guvData[1].reingewinn))}</td>
                    <td className="p-2 border-r-2 border-black text-center bg-yellow-100">{numberFormatter.format(Math.round(guvData[2].reingewinn))}</td>
                    <td className="p-2 text-center bg-yellow-100">{numberFormatter.format(Math.round(guvData[3].reingewinn))}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <h3 className="text-[18px] font-bold text-black border-b-2 border-black pb-1 mb-4">
              9.5 Liquiditätsplan (Cashflow-Rechnung)
            </h3>
            <p className="text-sm text-black leading-relaxed mb-4">
              Der Liquiditätsplan überwacht den Cash-Burn und stellt sicher, dass die Expansionsschritte jederzeit durch Finanzierungs-Cashflows gedeckt sind.
            </p>
            <ul className="list-disc pl-5 mb-6 text-sm text-black space-y-2">
              <li>
                <strong>Seed-Zufluss:</strong> Der erste grosse Meilenstein erfolgt durch das Closing der Seed-Runde im Quartal <span className="bg-[#FFE600] text-black font-bold px-1 border border-black">{dummyData.seedQuarter}</span> in Höhe von CHF <span className="bg-[#FFE600] text-black font-bold px-1 border border-black">{(seedBetrag / 1000000).toLocaleString('de-CH')}</span> Mio., was den operativen Markteintritt in der Schweiz vollständig absichert.
              </li>
              <li>
                <strong>Series A-Zufluss:</strong> Zur Beschleunigung des internationalen Wachstums und zum Ausbau der On-Demand-Infrastruktur fließt im Quartal <span className="bg-[#FFE600] text-black font-bold px-1 border border-black">{dummyData.seriesAQuarter}</span> des <span className="bg-[#FFE600] text-black font-bold px-1 border border-black">{dummyData.seriesAYear}</span>. Geschäftsjahres die Series A-Runde in Höhe von CHF <span className="bg-[#FFE600] text-black font-bold px-1 border border-black">{(seriesABetrag / 1000000).toLocaleString('de-CH')}</span> Mio. zu.
              </li>
              <li>
                <strong>SaaS-Hebel & Runway:</strong> Dank der jährlichen Upfront-Zahlungen der B2B-Kunden profitiert Attaché von einem stark positiven Working Capital. Der kumulierte Cash-Bestand sinkt zu keinem Zeitpunkt unter die kritische Grenze von <span className="bg-[#FFE600] text-black font-bold px-1 border border-black">{dummyData.baseCaseMonths >= 10 ? 3 : 2}</span> Monaten operativer Fixkosten.
              </li>
            </ul>

            <h3 className="text-[18px] font-bold text-black border-b-2 border-black pb-1 mb-4">
              9.6 Kapitalbedarfs- und Finanzierungsplan
            </h3>
            <p className="text-sm text-black leading-relaxed mb-4">
              Der Gesamtkapitalbedarf bis zum Erreichen der globalen Profitabilität ist in drei klare Finanzierungstranchen unterteilt:
            </p>
            <ol className="list-decimal pl-5 mb-6 text-sm text-black space-y-2">
              <li>
                <strong>Pre-Seed-Runde (Abgeschlossen):</strong> CHF <span className="bg-[#FFE600] text-black font-bold px-1 border border-black">{numberFormatter.format(preSeedAfondPerdu)}</span> als <em>à-fond-perdu</em>-Anschubfinanzierung für die Marktforschung durch Medienunternehmer sowie ein Wandeldarlehen (Bridge) von CHF <span className="bg-[#FFE600] text-black font-bold px-1 border border-black">{numberFormatter.format(preSeedBridge)}</span> für das MVP-Prototyping.
              </li>
              <li>
                <strong>Seed-Finanzierungsrunde (Aktuelle Phase):</strong> Einwerbung von mindestens CHF <span className="bg-[#FFE600] text-black font-bold px-1 border border-black">{(seedBetrag / 1000000).toFixed(1)}</span> Mio. bis CHF <span className="bg-[#FFE600] text-black font-bold px-1 border border-black">{(seedBetrag / 1000000 * 1.5).toFixed(1)}</span> Mio. zur Absicherung des Runways bis zum Schweizer Break-even. Abgabe von <span className="bg-[#FFE600] text-black font-bold px-1 border border-black">20</span> % der Anteile am Gründungs-Cap-Table.
              </li>
              <li>
                <strong>Series A-Runde (In Vorbereitung):</strong> Geplante Aufnahme von CHF <span className="bg-[#FFE600] text-black font-bold px-1 border border-black">{(seriesABetrag / 1000000).toFixed(1)}</span> Mio. im Geschäftsjahr <span className="bg-[#FFE600] text-black font-bold px-1 border border-black">{dummyData.seriesAYear}</span>, initiiert durch institutionelle B2B-SaaS- und Growth-Investoren, um die Internationalisierungsachse zu finanzieren.
              </li>
              <li>
                <strong>Option Pool (ESOP):</strong> Reservierung von <span className="bg-[#FFE600] text-black font-bold px-1 border border-black">10</span> % der Anteile zur langfristigen Incentivierung von Schlüsselpositionen (CTO, Head of Sales, Lead-Analysten).
              </li>
            </ol>

            <h3 className="text-[18px] font-bold text-black border-b-2 border-black pb-1 mb-4">
              9.10 Break-Even-Analyse & Szenarien
            </h3>
            <p className="text-sm text-black leading-relaxed mb-4">
              Die Gewinnschwelle (operativer Break-Even: Einnahmen ≥ Personal + Sachkosten + Spezialtopf, ohne Gewinnsteuer) wird plangemäss wie folgt erreicht:
            </p>
            <ul className="list-disc pl-5 mb-4 text-sm text-black space-y-2">
              <li>
                <strong>Ohne Monitor/Anker (Baseline):</strong>{" "}
                {breakEvenMonatBaseline != null && breakEvenPointBaseline != null ? (
                  <>
                    im <Highlight>{yearByMonth(breakEvenMonatBaseline)}.</Highlight> Geschäftsjahr (Monat{" "}
                    <Highlight>{breakEvenMonatBaseline}</Highlight>) bei{" "}
                    <Highlight>{numberFormatter.format(Math.round(breakEvenPointBaseline.aktiveBriefing))}</Highlight> Premium-Briefings,{" "}
                    <Highlight>{numberFormatter.format(Math.round(breakEvenPointBaseline.aktiveMonitor))}</Highlight> Monitor,{" "}
                    <Highlight>{numberFormatter.format(Math.round(breakEvenPointBaseline.aktiveAnker))}</Highlight> Anker-Kunde (gesamt{" "}
                    <Highlight>{numberFormatter.format(Math.round(breakEvenPointBaseline.aktiveKunden))}</Highlight> Lizenzen aktiv).
                  </>
                ) : (
                  <>innerhalb von 48 Monaten nicht erreicht.</>
                )}
              </li>
              <li>
                <strong>Mit Monitor/Anker (Gesamtmodell):</strong>{" "}
                {breakEvenMonatTotal != null && breakEvenPointTotal != null ? (
                  <>
                    im <Highlight>{yearByMonth(breakEvenMonatTotal)}.</Highlight> Geschäftsjahr (Monat{" "}
                    <Highlight>{breakEvenMonatTotal}</Highlight>) bei{" "}
                    <Highlight>{numberFormatter.format(Math.round(breakEvenPointTotal.aktiveBriefing))}</Highlight> Premium-Briefings,{" "}
                    <Highlight>{numberFormatter.format(Math.round(breakEvenPointTotal.aktiveMonitor))}</Highlight> Monitor,{" "}
                    <Highlight>{numberFormatter.format(Math.round(breakEvenPointTotal.aktiveAnker))}</Highlight> Anker-Kunde (gesamt{" "}
                    <Highlight>{numberFormatter.format(Math.round(breakEvenPointTotal.aktiveKunden))}</Highlight> Lizenzen aktiv).
                  </>
                ) : (
                  <>innerhalb von 48 Monaten nicht erreicht.</>
                )}
              </li>
            </ul>
            <p className="text-sm text-black leading-relaxed mb-4">
              Die Series A-Finanzierung dient danach als Wachstumsbeschleuniger, um die Profitabilität auf internationaler Ebene zu replizieren.
            </p>
            <p className="text-sm text-black leading-relaxed mb-4">
              Zur Absicherung wurden drei Szenarien modelliert:
            </p>
            <ul className="list-disc pl-5 text-sm text-black space-y-2">
              <li>
                <strong>Base Case (Erwarteter Verlauf):</strong> Erreichen des Schweizer Break-Even nach <Highlight>{dummyData.baseCaseMonths}</Highlight> Monaten (Gesamtmodell). Erfolgreiches Series A-Closing im Monat <Highlight>{seriesAMonat}</Highlight> und anschliessender internationaler Rollout mit einer Ziel-EBIT-Marge von <Highlight>{dummyData.ebitMargeY3}</Highlight> % im Jahr <Highlight>3</Highlight>.
              </li>
              <li>
                <strong>Best Case (Skalierungs-Turbo):</strong> Extrem hohe Marktdurchdringung im ersten Jahr über direkte B2B2B-Verbandsrahmenverträge (Low CAC). Der Schweizer Markt trägt sich bereits nach <span className="bg-[#FFE600] text-black font-bold px-1 border border-black">{dummyData.bestCaseMonths}</span> Monaten selbst. Die Series A-Runde kann zu einer deutlich höheren Unternehmensbewertung als ursprünglich veranschlagt durchgeführt werden.
              </li>
              <li>
                <strong>Worst Case (Verzögerte Expansion):</strong> Der Schweizer Markteintritt benötigt aufgrund von Spardruck in der Verwaltung <span className="bg-[#FFE600] text-black font-bold px-1 border border-black">{dummyData.worstCaseMonths}</span> Monate länger bis zur Profitabilität. Das Series A-Closing verschiebt sich nach hinten. Der verlängerte Runway wird durch das gestaffelte Abrufen einer im Gesellschaftervertrag verankerten Meilenstein-Tranche der Seed-Investoren in Höhe von CHF <span className="bg-[#FFE600] text-black font-bold px-1 border border-black">{numberFormatter.format(spezialtopf)}</span> überbrückt.
              </li>
            </ul>
          </article>
        </div>
      )}

      {/* Footnotes */}
      <article className="border-2 border-black bg-[#F5F5F5] p-4">
        <h2 className="text-[16px] font-bold text-black">Fussnoten</h2>
        <div className="mt-3 space-y-3 text-sm text-black">
          <div>
            <p className="font-semibold">Anmerkungen</p>
            <p>
              <span className="font-semibold">Liquiditäts-Floor:</span> Im Modell ist der Floor
              <span className="font-semibold"> 100&apos;000 CHF + Personalkosten der nächsten 3 Monate</span> ab jeweiligem Monat
              (Bruttolohn + Sozialabgaben, nur dann aktive Rollen). Sachkosten sind dabei nicht enthalten.
            </p>
            <p>
              <span className="font-semibold">Preislogik:</span> Lizenzen zahlen im ersten Vertragsjahr den Jahr-1-Preis, im zweiten
              Vertragsjahr den Preis ab Jahr 2 und ab dem dritten Vertragsjahr den Preis ab Jahr 3.
            </p>
          </div>
          <div>
            <p className="font-semibold">Vereinfachungen</p>
            <p>
              <span className="font-semibold">Sachkosten:</span> Pro GJ als Jahresbetrag editierbar (GJ1–GJ3). GJ4 = GJ3.
              Kapitalsteuer fix in der Sachkosten-Tabelle; Gewinnsteuer dynamisch bei positivem Monatsergebnis.
            </p>
            <p>
              <span className="font-semibold">Kein Blended ARPU:</span> Das Modell nutzt feste Preise je Kohortenalter statt eines
              gemischten Durchschnittspreises.
            </p>
            <p>
              <span className="font-semibold">Unsterbliche Kohorten:</span> Kündigungen passieren nur zu Verlängerungszeitpunkten
              (12/24/36 Monate), nicht laufend unter dem Jahr.
            </p>
            <p>
              <span className="font-semibold">Cashflow vs. MRR:</span> Cash nutzt Annual Upfront (Jahreszahlung sofort), MRR zeigt
              den monatlichen Umsatz. Beides kann daher bewusst auseinanderlaufen.
            </p>
          </div>
        </div>
      </article>
    </main>
  );
}

export default App;
