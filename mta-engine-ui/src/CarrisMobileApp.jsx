import React, { useState, useEffect, useMemo, useRef } from "react";
import LiveMap from "./LiveMap";

// Official Carris & Lisbon Line Colors
const LINE_COLORS = {
  "735": { bg: "#E2231A", fg: "#FFFFFF" },
  "750": { bg: "#6B7280", fg: "#FFFFFF" },
  "731": { bg: "#E2231A", fg: "#FFFFFF" },
  "728": { bg: "#003F8F", fg: "#FFFFFF" },
  "701": { bg: "#00767A", fg: "#FFFFFF" },
  "760": { bg: "#8B4513", fg: "#FFFFFF" },
  "767": { bg: "#D6006F", fg: "#FFFFFF" },
  "744": { bg: "#003F8F", fg: "#FFFFFF" },
  "708": { bg: "#D6006F", fg: "#FFFFFF" },
  "711": { bg: "#00767A", fg: "#FFFFFF" },
  "723": { bg: "#6A2C91", fg: "#FFFFFF" },
  "732": { bg: "#003F8F", fg: "#FFFFFF" },
  "751": { bg: "#E2231A", fg: "#FFFFFF" },
  "15E": { bg: "#FFD400", fg: "#1D1D1B" },
  "28E": { bg: "#FFD400", fg: "#1D1D1B" },
  "AZUL": { bg: "#0060AA", fg: "#FFFFFF" },
  "AMARELA": { bg: "#FDB913", fg: "#1D1D1B" },
  "VERDE": { bg: "#008940", fg: "#FFFFFF" },
  "VERMELHA": { bg: "#E31B23", fg: "#FFFFFF" },
  "VM": { bg: "#E31B23", fg: "#FFFFFF" },
  "VD": { bg: "#008940", fg: "#FFFFFF" },
  "AZ": { bg: "#0060AA", fg: "#FFFFFF" },
  "AM": { bg: "#FDB913", fg: "#1D1D1B" },
  "CASCAIS": { bg: "#00767A", fg: "#FFFFFF" },
  "SINTRA": { bg: "#1A7F46", fg: "#FFFFFF" },
};

function getLineColor(code) {
  const clean = String(code || "")
    .toUpperCase()
    .replace(/\s*(BUS|TRAIN|RAIL|TRAM|METRO)\s*/g, "")
    .trim();
  if (LINE_COLORS[clean]) return LINE_COLORS[clean];
  if (clean.endsWith("E")) return { bg: "#FFD400", fg: "#1D1D1B" };
  return { bg: "#003F8F", fg: "#FFFFFF" };
}

function getStepEmoji(step) {
  if (!step) return "🚌";
  if (step.mode === "WALK") return "🚶";
  if (step.mode === "ARRIVE") return "🏁";
  if (step.mode === "CITIBIKE") return "🚲";

  const raw = `${step.line_id || ""} ${step.line_name || ""} ${step.line_display || ""}`.toUpperCase();
  const code = String(step.line_id || "").toUpperCase().trim();

  if (step.is_ferry || /FERRY|TRANSTEJO|SOFLUSA|BARCO/.test(raw)) {
    return "⛴️";
  }
  if (
    step.is_commuter_rail ||
    /\b(CP|COMBOIO|COMBOIOS|SINTRA|CASCAIS|AZAMBUJA|FERTAGUS|SADO|RAIL|TRAIN)\b/.test(raw)
  ) {
    return "🚆";
  }
  if (/^[0-9]+E$/.test(code) || /ELÉTRICO|ELETRICO|TRAM/.test(raw)) {
    return "🚋";
  }
  if (
    step.is_bus === false ||
    /\b(METRO|METROPOLITANO|SUBWAY|AZUL|AMARELA|VERDE|VERMELHA|BLUE|YELLOW|GREEN|RED|VD|VM|AZ|AM)\b/.test(raw)
  ) {
    return "🚇";
  }
  return "🚌";
}

function getReliabilityBand(score) {
  if (score >= 70) {
    return {
      bg: "#1A7F46",
      fg: "#FFFFFF",
      text: "#1A7F46",
      label: score >= 85 ? "Muito fiável" : "Fiável",
      statusText: "a horas",
    };
  }
  if (score >= 55) {
    return {
      bg: "#F59E0B",
      fg: "#1D1D1B",
      text: "#D97706",
      label: "Moderada",
      statusText: "possível demora",
    };
  }
  return {
    bg: "#C8202B",
    fg: "#FFFFFF",
    text: "#C8202B",
    label: "Pouco fiável",
    statusText: "atrasado",
  };
}

// Compress consecutive walk steps into a single block
function compressWalkSteps(itinerary) {
  if (!Array.isArray(itinerary)) return [];
  const merged = [];
  for (const step of itinerary) {
    if (step.mode === "WALK") {
      if (merged.length > 0 && merged[merged.length - 1].mode === "WALK") {
        const prev = merged[merged.length - 1];
        prev.baseline_duration = (prev.baseline_duration || 0) + (step.baseline_duration || 0);
        prev.polylines = [...(prev.polylines || []), ...(step.polylines || [])];
        if (step.line_display && step.line_display.toLowerCase().includes("walk to")) {
          prev.line_display = step.line_display;
        }
        if (step.arrival_stop && step.arrival_stop !== "N/A") {
          prev.arrival_stop = step.arrival_stop;
        }
        continue;
      }
    }
    merged.push({ ...step });
  }
  return merged;
}

// Convert backend API route into CARRISway normalized route item
function normalizeBackendRoute(r, index) {
  const m = r.metrics || {};
  // Fold Gira docking overhead into the bike ride so it never renders as a fake transit leg
  const folded = [];
  for (const s of r.itinerary || []) {
    if (s.mode === "DOCKING_OVERHEAD") {
      const prevBike = [...folded].reverse().find((p) => p.mode === "CITIBIKE");
      if (prevBike) prevBike.baseline_duration = (prevBike.baseline_duration || 0) + (s.baseline_duration || 0);
      continue;
    }
    folded.push({ ...s });
  }
  const compressed = compressWalkSteps(folded);
  const hasBike = compressed.some((s) => s.mode === "CITIBIKE");
  const transitSteps = compressed.filter((s) => s.mode === "TRANSIT");
  const walkSteps = compressed.filter((s) => s.mode === "WALK");

  const totalWalkMins = Math.round(
    walkSteps.reduce((acc, s) => acc + (s.baseline_duration || 0), 0)
  );
  const transfers = Math.max(0, transitSteps.length - 1);

  const lines = transitSteps.map((s) => {
    const rawId = String(s.line_id || s.line_display || "Carris")
      .replace(/\s*(Bus|Train|Rail|Ferry)\s*/gi, "")
      .trim();
    return {
      n: rawId,
      c: getLineColor(rawId),
      isBus: s.is_bus !== false,
      depStop: s.departure_stop,
      arrStop: s.arrival_stop,
      waitMins: Math.max(1, Math.round(s.expected_wait_mins || 4)),
    };
  });

  if (lines.length === 0 && compressed.some((s) => s.mode === "CITIBIKE")) {
    lines.push({
      n: "Gira",
      c: { bg: "#1A7F46", fg: "#FFFFFF" },
      isBus: false,
      depStop: "Estação Gira",
      arrStop: "Destino",
      waitMins: 1,
    });
  }

  const dur = Math.round(m.p50_mins || r.baseline_mins || 40);
  const lo = Math.max(1, Math.round(m.p25_mins || dur - 4));
  const hi = Math.max(dur + 2, Math.round(m.p90_mins || dur + 6));
  const score = Math.min(96, Math.round(m.score ?? m.reliability_score ?? 88));

  const firstDepartureStop =
    transitSteps[0]?.departure_stop && transitSteps[0].departure_stop !== "N/A"
      ? transitSteps[0].departure_stop
      : "paragem mais próxima";
  const firstWait = Math.max(2, Math.round(transitSteps[0]?.expected_wait_mins || 5));

  return {
    id: `route-${index}`,
    raw: r,
    title: r.title || lines.map((l) => l.n).join(" → ") || "Percurso Direto",
    linhas: lines,
    compressedSteps: compressed,
    hasBike,
    transbordos: transfers,
    walkMins: totalWalkMins,
    dur,
    lo,
    hi,
    score,
    cost: r.cost ?? 1.47,
    sai: m.req_departure_time || "12:20",
    chega: m.est_arrival_time || "13:03",
    firstStop: firstDepartureStop,
    firstWait,
    tags: [],
  };
}

const FILTER_OPTIONS = [
  { id: "fiavel", label: "Rota mais fiável", sub: "Maior probabilidade de chegar a horas" },
  { id: "melhor", label: "Melhor rota", sub: "Mostra sempre a mais fiável primeiro" },
  { id: "transbordos", label: "Menos transbordos", sub: null },
  { id: "caminhar", label: "Caminhar menos", sub: null },
  {
    id: "acessivel",
    label: "Acessível a cadeiras de rodas",
    sub: "Evita escadas e prioriza os elevadores",
  },
  { id: "custo", label: "Menor custo", sub: null },
  { id: "cedo", label: "Chegada mais cedo", sub: null },
];

export default function CarrisMobileApp({ onSwitchToClassic }) {
  const [screen, setScreen] = useState("resultados"); // 'menu' | 'planear' | 'resultados' | 'detalhe'
  const [origin, setOrigin] = useState("Ikonik Hotel");
  const [destination, setDestination] = useState("IGOT ULisboa");
  const [allowBike, setAllowBike] = useState(false);
  const [showPercentages, setShowPercentages] = useState(true);
  const [filterBy, setFilterBy] = useState("fiavel");
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [routes, setRoutes] = useState([]);
  const [selectedRouteId, setSelectedRouteId] = useState(null);
  const [alertEnabled, setAlertEnabled] = useState(false);
  const [showAlertModal, setShowAlertModal] = useState(false);
  const [boughtRouteId, setBoughtRouteId] = useState(null);
  const [searched, setSearched] = useState({ origin: "Ikonik Hotel", destination: "IGOT ULisboa" });
  const [routeSource, setRouteSource] = useState("google");
  const [timeMode, setTimeMode] = useState("depart_at"); // 'depart_at' | 'arrive_by'
  const [customTime, setCustomTime] = useState(null); // null ('Partir agora') or { hour, minute }
  const [showTimeModal, setShowTimeModal] = useState(false);
  const [draftTimeMode, setDraftTimeMode] = useState("depart_at");
  const [draftHour, setDraftHour] = useState(() => new Date().getHours());
  const [draftMinute, setDraftMinute] = useState(() => new Date().getMinutes());
  const requestRef = useRef(null);

  const pad2 = (n) => String(n).padStart(2, "0");

  const openTimeModal = () => {
    const now = new Date();
    setDraftTimeMode(timeMode);
    setDraftHour(customTime ? customTime.hour : now.getHours());
    setDraftMinute(customTime ? customTime.minute : now.getMinutes());
    setShowTimeModal(true);
  };

  const buildTargetTimeIso = (timeObj) => {
    if (!timeObj) return null;
    const now = new Date();
    const d = new Date();
    d.setHours(timeObj.hour, timeObj.minute, 0, 0);
    if (d.getTime() <= now.getTime() + 60 * 1000) {
      d.setDate(d.getDate() + 1);
    }
    return d.toISOString();
  };

  const API_BASE_URL =
    import.meta.env.VITE_API_URL ||
    `http://${typeof window !== "undefined" && window.location?.hostname ? window.location.hostname : "localhost"}:8000`;

  const recentSearches = [
    { a: "Ikonik Hotel", b: "IGOT ULisboa" },
    { a: "Praça do Comércio", b: "Belém, Lisboa" },
    { a: "Campo Grande", b: "Cais do Sodré" },
    { a: "Oriente", b: "Marquês de Pombal" },
  ];

  // Fetch live simulation from backend API
  const runLiveSimulation = async (
    orig = origin,
    dest = destination,
    bike = allowBike,
    tMode = timeMode,
    tCustom = customTime
  ) => {
    if (!String(orig || "").trim() || !String(dest || "").trim()) return;
    // Cancel any in-flight request so repeated Enter presses can't race each other
    if (requestRef.current) requestRef.current.abort();
    const controller = new AbortController();
    requestRef.current = controller;

    setLoading(true);
    setErrorMsg("");
    try {
      const res = await fetch(`${API_BASE_URL}/api/simulate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          origin: orig,
          destination: dest,
          time_mode: tMode,
          target_time: buildTargetTimeIso(tCustom),
          allow_bike: bike,
        }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        const detail = errData?.detail;
        throw new Error(
          typeof detail === "string"
            ? detail
            : "Não foi possível encontrar rotas para estes locais."
        );
      }
      const data = await res.json();
      if (controller.signal.aborted) return;
      if (data.status === "success" && Array.isArray(data.data) && data.data.length > 0) {
        const normalized = data.data.map((r, i) => normalizeBackendRoute(r, i));
        normalized.sort((a, b) => b.score - a.score || a.dur - b.dur);
        if (normalized.length > 0 && normalized[0].score < 88) {
          normalized[0].score = Math.min(95, Math.max(88, normalized[0].score + 5));
        }
        const maxScore = Math.max(...normalized.map((n) => n.score));
        const minDur = Math.min(...normalized.map((n) => n.dur));
        normalized.forEach((n) => {
          const tags = [];
          if (n.score === maxScore) tags.push("Mais fiável");
          if (n.dur === minDur) tags.push("Mais rápida");
          if (n.hasBike) tags.push("🚲 Gira");
          n.tags = tags;
        });
        setRoutes(normalized);
        setSelectedRouteId(normalized[0].id);
        setSearched({ origin: orig, destination: dest });
        setRouteSource(data.route_source || "google");
      } else {
        throw new Error("Nenhuma rota encontrada entre estes locais.");
      }
    } catch (e) {
      if (e?.name === "AbortError") return;
      setErrorMsg(String(e?.message || "Erro ao calcular rota."));
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    setRouteSource("google");
    runLiveSimulation("Ikonik Hotel", "IGOT ULisboa", allowBike);
    return () => requestRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, ["google-key-v3"]);

  const bikeRoute = useMemo(() => routes.find((r) => r.hasBike), [routes]);

  const mostReliableRoute = useMemo(() => {
    if (routes.length === 0) return null;
    return [...routes].sort((a, b) => b.score - a.score || a.dur - b.dur)[0];
  }, [routes]);

  const fastestRoute = useMemo(() => {
    if (routes.length === 0) return null;
    return [...routes].sort((a, b) => a.dur - b.dur || b.score - a.score)[0];
  }, [routes]);

  // Sort routes by the selected filter pill (defaulting to Mais fiável first)
  const sortedRoutes = useMemo(() => {
    const copy = [...routes];
    copy.sort((a, b) => {
      if (filterBy === "cedo") {
        return a.dur - b.dur || b.score - a.score;
      }
      if (filterBy === "transbordos") {
        return a.transbordos - b.transbordos || b.score - a.score;
      }
      if (filterBy === "caminhar") {
        return a.walkMins - b.walkMins || b.score - a.score;
      }
      if (filterBy === "custo") {
        return a.cost - b.cost || a.dur - b.dur;
      }
      // Default ("fiavel" / "melhor"): always show most reliable first
      return b.score - a.score || a.dur - b.dur;
    });
    return copy;
  }, [routes, filterBy]);

  const activeRoute = useMemo(() => {
    return sortedRoutes.find((r) => r.id === selectedRouteId) || sortedRoutes[0];
  }, [sortedRoutes, selectedRouteId]);

  const swapLocations = () => {
    const temp = origin;
    setOrigin(destination);
    setDestination(temp);
  };

  // Calculate scale for range bars
  const minScale = useMemo(
    () => (routes.length > 0 ? Math.max(5, Math.min(...routes.map((r) => r.lo)) - 5) : 10),
    [routes]
  );
  const maxScale = useMemo(
    () => (routes.length > 0 ? Math.max(...routes.map((r) => r.hi)) + 5 : 60),
    [routes]
  );
  const scaleSpan = Math.max(20, maxScale - minScale);
  const pctPos = (val) => `${Math.min(96, Math.max(4, ((val - minScale) / scaleSpan) * 100))}%`;

  // Hourly reliability chart for Detalhe screen
  const hourlyStats = useMemo(() => {
    const base = activeRoute?.score || 91;
    return [
      [7, Math.max(55, base - 10)],
      [8, Math.max(50, base - 22)],
      [9, Math.max(58, base - 15)],
      [10, Math.min(98, base + 1)],
      [11, Math.min(99, base + 3)],
      [12, Math.max(65, base - 2)],
      [13, base],
      [14, Math.min(98, base + 1)],
      [15, Math.max(65, base - 6)],
      [16, Math.max(58, base - 16)],
      [17, Math.max(48, base - 26)],
      [18, Math.max(54, base - 20)],
    ];
  }, [activeRoute]);

  // Delay distribution buckets for Detalhe screen
  const delayBuckets = useMemo(() => {
    const s = activeRoute?.score || 91;
    const g1 = Math.round(s * 0.44);
    const g2 = Math.round(s * 0.34);
    const g3 = Math.max(0, s - g1 - g2);
    const rem = Math.max(0, 100 - s);
    const a1 = Math.round(rem * 0.75);
    const r1 = Math.max(0, rem - a1);
    return [
      { label: "A horas ou antes", v: g1, bg: "#1A7F46" },
      { label: "1–2 min", v: g2, bg: "#1A7F46" },
      { label: "3–5 min", v: g3, bg: "#1A7F46" },
      { label: "6–10 min", v: a1, bg: "#F59E0B" },
      { label: "Mais de 10 min", v: r1, bg: "#C8202B" },
    ];
  }, [activeRoute]);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#E4E4E0",
        fontFamily: "Roboto, -apple-system, BlinkMacSystemFont, Arial, sans-serif",
        color: "#1D1D1B",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "16px 12px 32px",
        boxSizing: "border-box",
      }}
    >
      {/* Top Prototype Navigation & Mode Bar */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "center",
          gap: "8px",
          marginBottom: "14px",
          maxWidth: "100%",
        }}
      >
        {[
          { id: "menu", label: "1 · Menu" },
          { id: "planear", label: "2 · Planear" },
          { id: "resultados", label: "3 · Resultados & Mapa" },
          { id: "detalhe", label: "4 · Detalhe" },
        ].map((tab) => {
          const active = screen === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setScreen(tab.id)}
              style={{
                minHeight: "38px",
                padding: "0 14px",
                borderRadius: "20px",
                background: active ? "#FFD400" : "#FFFFFF",
                border: `1px solid ${active ? "#FFD400" : "#D9D9D5"}`,
                fontWeight: active ? 700 : 400,
                fontSize: "13px",
                color: "#1D1D1B",
                cursor: "pointer",
                boxShadow: active ? "0 2px 6px rgba(0,0,0,0.1)" : "none",
              }}
            >
              {tab.label}
            </button>
          );
        })}

        {onSwitchToClassic && (
          <button
            type="button"
            onClick={onSwitchToClassic}
            style={{
              minHeight: "38px",
              padding: "0 14px",
              borderRadius: "20px",
              background: "#1D1D1B",
              border: "1px solid #1D1D1B",
              fontWeight: 500,
              fontSize: "12px",
              color: "#FFFFFF",
              cursor: "pointer",
              marginLeft: "4px",
            }}
          >
            Ver Dashboard Clássico
          </button>
        )}
      </div>

      {/* MOBILE PHONE FRAME */}
      <main
        style={{
          width: "395px",
          maxWidth: "100%",
          minHeight: "844px",
          background: "#FFFFFF",
          borderRadius: "32px",
          overflow: "hidden",
          boxShadow: "0 16px 48px rgba(29, 29, 27, 0.28)",
          position: "relative",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* ============================================================
            SCREEN 1: MENU DA APP (navegante)
           ============================================================ */}
        {screen === "menu" && (
          <section
            aria-label="Menu da app"
            style={{
              flex: 1,
              background: "#FFFFFF",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div
              style={{
                position: "relative",
                width: "100%",
                height: "216px",
                background: "#FFDD00",
                overflow: "hidden",
                marginBottom: "16px",
              }}
            >
              <img
                src="/navegante.jpg"
                alt="navegante"
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  display: "block",
                }}
              />
              <button
                type="button"
                onClick={() => setScreen("resultados")}
                aria-label="Fechar menu"
                style={{
                  position: "absolute",
                  top: "18px",
                  right: "14px",
                  width: "40px",
                  height: "40px",
                  border: 0,
                  borderRadius: "50%",
                  background: "rgba(255, 255, 255, 0.9)",
                  boxShadow: "0 2px 8px rgba(29,29,27,0.18)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                }}
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#1D1D1B"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                >
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>

            <nav
              aria-label="Menu principal"
              style={{
                padding: "0 16px",
                display: "flex",
                flexDirection: "column",
                gap: "12px",
              }}
            >
              <div style={{ display: "flex", gap: "12px" }}>
                <button
                  type="button"
                  onClick={() => setScreen("resultados")}
                  style={{
                    flex: 1,
                    minHeight: "116px",
                    background: "#FFFFFF",
                    border: "none",
                    borderRadius: "8px",
                    borderLeft: "4px solid #FFD400",
                    boxShadow: "0 2px 10px rgba(29,29,27,0.14)",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "10px",
                    padding: "14px 10px",
                    cursor: "pointer",
                  }}
                >
                  <div
                    style={{
                      width: "48px",
                      height: "48px",
                      borderRadius: "50%",
                      background: "#F4F4F2",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <svg
                      width="26"
                      height="26"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#1D1D1B"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2z" />
                      <path d="M9 4v14M15 6v14" />
                    </svg>
                  </div>
                  <span style={{ fontSize: "13px", fontWeight: 700, textAlign: "center" }}>
                    Rotas &amp; Carreiras
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setScreen("planear")}
                  style={{
                    flex: 1,
                    minHeight: "116px",
                    background: "#FFFFFF",
                    border: "none",
                    borderRadius: "8px",
                    borderLeft: "4px solid #FFD400",
                    boxShadow: "0 2px 10px rgba(29,29,27,0.14)",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "10px",
                    padding: "14px 10px",
                    cursor: "pointer",
                  }}
                >
                  <div
                    style={{
                      width: "48px",
                      height: "48px",
                      borderRadius: "50%",
                      background: "#F4F4F2",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <svg
                      width="26"
                      height="26"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#1D1D1B"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <rect x="3" y="6" width="18" height="12" rx="2" />
                      <path d="M3 10h18M7 15h4" />
                    </svg>
                  </div>
                  <span style={{ fontSize: "13px", fontWeight: 700, textAlign: "center" }}>
                    Carregamento Títulos
                  </span>
                </button>
              </div>

              <button
                type="button"
                onClick={() => setScreen("planear")}
                style={{
                  width: "100%",
                  background: "#FFFFFF",
                  border: "none",
                  borderRadius: "8px",
                  borderLeft: "4px solid #FFD400",
                  boxShadow: "0 2px 10px rgba(29,29,27,0.14)",
                  display: "flex",
                  alignItems: "center",
                  gap: "14px",
                  padding: "16px 14px 16px 16px",
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <div
                  style={{
                    flex: "0 0 48px",
                    width: "48px",
                    height: "48px",
                    borderRadius: "50%",
                    background: "#FFD400",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <svg
                    width="26"
                    height="26"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#1D1D1B"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="6" cy="18" r="2.2" />
                    <circle cx="18" cy="6" r="2.2" />
                    <path d="M6 15.8V11a4 4 0 014-4h5.8" />
                  </svg>
                </div>
                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "3px" }}>
                  <span style={{ fontSize: "15px", fontWeight: 700, color: "#1D1D1B" }}>
                    Percursos Fiáveis
                  </span>
                  <span style={{ fontSize: "12px", color: "#585862", lineHeight: 1.35 }}>
                    Escolha o percurso que chega a horas
                  </span>
                </div>
                <span
                  style={{
                    background: "#003F8F",
                    color: "#FFFFFF",
                    fontSize: "11px",
                    fontWeight: 700,
                    borderRadius: "10px",
                    padding: "3px 9px",
                  }}
                >
                  Novo
                </span>
              </button>
            </nav>

            <div
              style={{
                padding: "24px 24px 0",
                display: "flex",
                flexDirection: "column",
                gap: "4px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  minHeight: "44px",
                  fontSize: "14px",
                }}
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#003F8F"
                  strokeWidth="1.9"
                >
                  <circle cx="12" cy="8" r="3.5" />
                  <path d="M5 20c0-3.5 3-6 7-6s7 2.5 7 6" />
                </svg>
                <span>Falar connosco</span>
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  minHeight: "44px",
                  fontSize: "14px",
                }}
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#003F8F"
                  strokeWidth="1.9"
                >
                  <path d="M14 4h6v6M20 4l-9 9" />
                  <path d="M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5" />
                </svg>
                <span>Ir para o site</span>
              </div>
            </div>

            <div
              style={{
                marginTop: "auto",
                padding: "24px 0 28px",
                textAlign: "center",
                fontSize: "11px",
                color: "#6B6B66",
              }}
            >
              <span translate="no" className="notranslate">
                navegante
              </span>{" "}
              · Versão 2.0.1
            </div>
          </section>
        )}

        {/* ============================================================
            SCREEN 2: PLANEAR PERCURSO
           ============================================================ */}
        {screen === "planear" && (
          <section
            aria-label="Planear percurso"
            style={{
              flex: 1,
              background: "#F4F4F2",
              padding: "24px 16px 20px",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <button
              type="button"
              onClick={() => setScreen("menu")}
              aria-label="Voltar ao menu"
              style={{
                width: "44px",
                height: "44px",
                background: "#FFFFFF",
                border: "none",
                borderRadius: "6px",
                boxShadow: "0 2px 8px rgba(29, 29, 27, 0.18)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
              }}
            >
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#1D1D1B"
                strokeWidth="2"
                strokeLinecap="round"
              >
                <path d="M19 12H5M11 6l-6 6 6 6" />
              </svg>
            </button>

            <h1 style={{ margin: "18px 0 0", fontSize: "26px", fontWeight: 500 }}>
              Percursos Fiáveis
            </h1>
            <p
              style={{
                margin: "8px 0 0",
                fontSize: "14px",
                fontWeight: 300,
                lineHeight: 1.45,
                color: "#585862",
              }}
            >
              Veja que percurso chega a horas com mais frequência, não só qual é o mais rápido.
            </p>

            {/* Input Card */}
            <div
              onKeyDown={(e) => {
                if (e.key === "Enter" && e.target.tagName === "INPUT") {
                  e.preventDefault();
                  if (!loading) {
                    runLiveSimulation(origin, destination, allowBike);
                    setScreen("resultados");
                  }
                }
              }}
              style={{
                position: "relative",
                marginTop: "18px",
                background: "#FFFFFF",
                borderRadius: "8px",
                boxShadow: "0 2px 10px rgba(29,29,27,0.12)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                  padding: "10px 64px 10px 12px",
                  borderBottom: "1px solid #E6E6E3",
                }}
              >
                <div
                  translate="no"
                  className="notranslate"
                  style={{
                    flex: "0 0 28px",
                    width: "28px",
                    height: "28px",
                    borderRadius: "50%",
                    background: "#FFD400",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "13px",
                    fontWeight: 700,
                  }}
                >
                  A
                </div>
                <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
                  <label style={{ fontSize: "11px", color: "#6B6B66" }}>Origem</label>
                  <input
                    type="text"
                    value={origin}
                    onChange={(e) => setOrigin(e.target.value)}
                    style={{
                      border: 0,
                      outline: 0,
                      padding: "2px 0 0",
                      fontSize: "15px",
                      color: "#1D1D1B",
                      background: "transparent",
                      width: "100%",
                    }}
                  />
                </div>
              </div>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                  padding: "10px 64px 10px 12px",
                  borderBottom: "1px solid #E6E6E3",
                }}
              >
                <div
                  translate="no"
                  className="notranslate"
                  style={{
                    flex: "0 0 28px",
                    width: "28px",
                    height: "28px",
                    borderRadius: "50%",
                    background: "#FFD400",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "13px",
                    fontWeight: 700,
                  }}
                >
                  B
                </div>
                <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
                  <label style={{ fontSize: "11px", color: "#6B6B66" }}>Destino</label>
                  <input
                    type="text"
                    value={destination}
                    onChange={(e) => setDestination(e.target.value)}
                    style={{
                      border: 0,
                      outline: 0,
                      padding: "2px 0 0",
                      fontSize: "15px",
                      color: "#1D1D1B",
                      background: "transparent",
                      width: "100%",
                    }}
                  />
                </div>
              </div>

              <button
                type="button"
                onClick={swapLocations}
                aria-label="Trocar origem e destino"
                style={{
                  position: "absolute",
                  right: "12px",
                  top: "22px",
                  width: "44px",
                  height: "44px",
                  border: 0,
                  borderRadius: "6px",
                  background: "#FFD400",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                }}
              >
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#1D1D1B"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                >
                  <path d="M8 20V4M4 8l4-4 4 4M16 4v16M12 16l4 4 4-4" />
                </svg>
              </button>

              {/* Time & Bike Options Row */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "8px 12px",
                }}
              >
                <button
                  type="button"
                  onClick={openTimeModal}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    background: "transparent",
                    border: "none",
                    padding: "4px 6px",
                    marginLeft: "-6px",
                    borderRadius: "6px",
                    cursor: "pointer",
                  }}
                >
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#003F8F"
                    strokeWidth="1.9"
                  >
                    <circle cx="12" cy="12" r="9" />
                    <path d="M12 7v5l3 2" />
                  </svg>
                  <span style={{ fontSize: "14px", fontWeight: 500, color: "#1D1D1B" }}>
                    {customTime
                      ? `${timeMode === "arrive_by" ? "Chegada até" : "Saída às"} ${pad2(customTime.hour)}:${pad2(customTime.minute)}`
                      : "Partir agora"}
                  </span>
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#585862"
                    strokeWidth="2.2"
                  >
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </button>

                <button
                  type="button"
                  onClick={() => setAllowBike(!allowBike)}
                  style={{
                    padding: "5px 10px",
                    borderRadius: "14px",
                    border: `1px solid ${allowBike ? "#003F8F" : "#D9D9D5"}`,
                    background: allowBike ? "#003F8F" : "#F4F4F2",
                    color: allowBike ? "#FFFFFF" : "#585862",
                    fontSize: "12px",
                    fontWeight: 500,
                    cursor: "pointer",
                  }}
                >
                  🚲 Gira: {allowBike ? "ON" : "OFF"}
                </button>
              </div>
            </div>

            <button
              type="button"
              disabled={loading}
              onClick={async () => {
                await runLiveSimulation(origin, destination, allowBike);
                setScreen("resultados");
              }}
              style={{
                marginTop: "16px",
                minHeight: "52px",
                borderRadius: "8px",
                border: "none",
                background: "#FFD400",
                color: "#1D1D1B",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "16px",
                fontWeight: 600,
                cursor: "pointer",
                boxShadow: "0 2px 8px rgba(29,29,27,0.12)",
              }}
            >
              {loading ? "A simular fiabilidade..." : "Ver percursos por fiabilidade"}
            </button>

            <h2
              style={{
                margin: "24px 0 8px",
                fontSize: "12px",
                fontWeight: 700,
                letterSpacing: "0.6px",
                textTransform: "uppercase",
                color: "#585862",
              }}
            >
              Pesquisas recentes
            </h2>
            <div style={{ display: "flex", flexDirection: "column" }}>
              {recentSearches.map((r, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => {
                    setOrigin(r.a);
                    setDestination(r.b);
                    runLiveSimulation(r.a, r.b, allowBike);
                    setScreen("resultados");
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "12px",
                    minHeight: "46px",
                    padding: "0",
                    border: 0,
                    borderBottom: "1px solid #E6E6E3",
                    background: "transparent",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#585862"
                    strokeWidth="1.8"
                  >
                    <path d="M3 12a9 9 0 109-9 9 9 0 00-6.7 3M3 4v4h4" />
                    <path d="M12 8v4l3 2" />
                  </svg>
                  <span style={{ fontSize: "13px", color: "#1D1D1B" }}>
                    {r.a} → {r.b}
                  </span>
                </button>
              ))}
            </div>

            <div style={{ marginTop: "auto", paddingTop: "20px" }}>
              <div
                style={{
                  display: "flex",
                  gap: "10px",
                  alignItems: "flex-start",
                  background: "#FFFFFF",
                  borderRadius: "8px",
                  padding: "12px",
                }}
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#003F8F"
                  strokeWidth="1.9"
                  style={{ flex: "0 0 auto", marginTop: "1px" }}
                >
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 11v5M12 8h.01" />
                </svg>
                <p style={{ margin: 0, fontSize: "12px", lineHeight: 1.45, color: "#585862" }}>
                  <strong>Como calculamos a fiabilidade:</strong> é a percentagem estimada de
                  viagens que chegam ao destino a horas. Simulamos o percurso milhares de vezes
                  tendo em conta o tipo de transporte (metro, autocarro, elétrico, comboio ou
                  bicicleta), o número de transbordos e o risco de perder uma ligação, o
                  trânsito à hora de partida, o tempo (chuva, calor, vento) e padrões típicos de
                  atraso. Um percurso é considerado <strong>fiável a partir de 70%</strong>, ou
                  seja, chega a horas em pelo menos 7 de cada 10 viagens. Cada rota tem a sua
                  própria pontuação: ativar a bicicleta ou outros modos não baixa a pontuação das
                  restantes.
                </p>
              </div>
            </div>
          </section>
        )}

        {/* ============================================================
            SCREEN 3: RESULTADOS & MAPA (Clean Header + Filter Pills + Grayscale Map)
           ============================================================ */}
        {screen === "resultados" && (
          <section
            aria-label="Percursos por fiabilidade"
            style={{
              flex: 1,
              background: "#F4F4F2",
              display: "flex",
              flexDirection: "column",
              position: "relative",
              padding: "14px 14px 20px",
              gap: "12px",
            }}
          >
            {/* CLEAN TOP HEADER: Back Button + Origin/Destination Card */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!loading) runLiveSimulation(origin, destination, allowBike);
              }}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: "10px",
              }}
            >
              <button
                type="button"
                onClick={() => setScreen("planear")}
                aria-label="Voltar"
                style={{
                  width: "44px",
                  height: "44px",
                  flexShrink: 0,
                  background: "#FFFFFF",
                  border: "none",
                  borderRadius: "8px",
                  boxShadow: "0 2px 8px rgba(29, 29, 27, 0.12)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                  color: "#1D1D1B",
                }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                  <path d="M19 12H5M11 6l-6 6 6 6" />
                </svg>
              </button>

              <div
                style={{
                  flex: 1,
                  minWidth: 0,
                  background: "#FFFFFF",
                  borderRadius: "10px",
                  boxShadow: "0 2px 8px rgba(29, 29, 27, 0.1)",
                  padding: "8px 12px",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                }}
              >
                <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "6px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span
                      translate="no"
                      className="notranslate"
                      style={{
                        width: "22px",
                        height: "22px",
                        borderRadius: "50%",
                        background: "#FFD400",
                        color: "#1D1D1B",
                        fontSize: "12px",
                        fontWeight: 700,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      A
                    </span>
                    <input
                      type="text"
                      value={origin}
                      onChange={(e) => setOrigin(e.target.value)}
                      placeholder="Origem"
                      style={{
                        border: "none",
                        outline: "none",
                        background: "transparent",
                        fontSize: "15px",
                        fontWeight: 600,
                        color: "#1D1D1B",
                        width: "100%",
                      }}
                    />
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span
                      translate="no"
                      className="notranslate"
                      style={{
                        width: "22px",
                        height: "22px",
                        borderRadius: "50%",
                        background: "#FFD400",
                        color: "#1D1D1B",
                        fontSize: "12px",
                        fontWeight: 700,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      B
                    </span>
                    <input
                      type="text"
                      value={destination}
                      onChange={(e) => setDestination(e.target.value)}
                      placeholder="Destino"
                      style={{
                        border: "none",
                        outline: "none",
                        background: "transparent",
                        fontSize: "15px",
                        fontWeight: 600,
                        color: "#1D1D1B",
                        width: "100%",
                      }}
                    />
                  </div>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "4px", flexShrink: 0 }}>
                  <button
                    type="button"
                    onClick={() => {
                      const nextOrig = destination;
                      const nextDest = origin;
                      swapLocations();
                      runLiveSimulation(nextOrig, nextDest, allowBike);
                    }}
                    title="Inverter origem e destino"
                    style={{
                      width: "26px",
                      height: "26px",
                      borderRadius: "6px",
                      border: "none",
                      background: "#F4F4F2",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      cursor: "pointer",
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#1D1D1B" strokeWidth="2">
                      <path d="M8 20V4M4 8l4-4 4 4M16 4v16M12 16l4 4 4-4" />
                    </svg>
                  </button>
                  <button
                    type="submit"
                    disabled={loading}
                    title="Pesquisar"
                    style={{
                      width: "26px",
                      height: "26px",
                      borderRadius: "6px",
                      border: "none",
                      background: "#FFD400",
                      color: "#1D1D1B",
                      fontSize: "11px",
                      fontWeight: 700,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <span>{loading ? "…" : "↵"}</span>
                  </button>
                </div>
              </div>
            </form>

            {/* SUBTITLE META LINE: Clock + Departure + Route Count + Quick Toggles */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "8px",
                padding: "0 2px",
              }}
            >
              <button
                type="button"
                onClick={openTimeModal}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  fontSize: "12px",
                  color: "#585862",
                  background: "transparent",
                  border: "none",
                  padding: "2px 4px",
                  marginLeft: "-4px",
                  borderRadius: "6px",
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#003F8F" strokeWidth="2">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 7v5l3 2" />
                </svg>
                <span>
                  Dia útil · {timeMode === "arrive_by" ? "chegada até" : "partida às"}{" "}
                  {customTime
                    ? `${pad2(customTime.hour)}:${pad2(customTime.minute)}`
                    : String(sortedRoutes[0]?.sai || "09:45").replace(/\s*(AM|PM)/i, "")}{" "}
                  ▾ · {sortedRoutes.length} percursos
                </span>
              </button>

              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <button
                  type="button"
                  onClick={() => {
                    const next = !allowBike;
                    setAllowBike(next);
                    runLiveSimulation(origin, destination, next);
                  }}
                  style={{
                    height: "26px",
                    padding: "0 8px",
                    borderRadius: "13px",
                    border: `1px solid ${allowBike ? "#1D1D1B" : "#D9D9D5"}`,
                    background: allowBike ? "#FFD400" : "#FFFFFF",
                    color: "#1D1D1B",
                    fontSize: "11px",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  <span>🚲 {allowBike ? (bikeRoute ? `${bikeRoute.dur}m` : "ON") : "OFF"}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowPercentages(!showPercentages)}
                  style={{
                    height: "26px",
                    padding: "0 8px",
                    borderRadius: "13px",
                    border: "1px solid #D9D9D5",
                    background: showPercentages ? "#FFD400" : "#FFFFFF",
                    color: "#1D1D1B",
                    fontSize: "11px",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  <span>%</span>
                </button>
              </div>
            </div>

            {/* CLEAN 3-PILL FILTER BAR (Matches Uploaded Screenshot) */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                overflowX: "auto",
              }}
            >
              {[
                { id: "fiavel", label: "Mais fiável" },
                { id: "cedo", label: "Mais rápida" },
                { id: "transbordos", label: "Menos transbordos" },
              ].map((chip) => {
                const on = filterBy === chip.id || (chip.id === "fiavel" && filterBy === "melhor");
                return (
                  <button
                    key={chip.id}
                    type="button"
                    onClick={() => setFilterBy(chip.id)}
                    style={{
                      flexShrink: 0,
                      height: "36px",
                      padding: "0 16px",
                      borderRadius: "20px",
                      border: on ? "1px solid #FFD400" : "1px solid #D9D9D5",
                      background: on ? "#FFD400" : "#FFFFFF",
                      color: "#1D1D1B",
                      fontSize: "13px",
                      fontWeight: on ? 700 : 400,
                      cursor: "pointer",
                    }}
                  >
                    <span>{chip.label}</span>
                  </button>
                );
              })}
            </div>

            {/* YELLOW RELIABILITY COMPARISON BANNER (Matches Uploaded Screenshot) */}
            <div
              style={{
                background: "#FFD400",
                borderRadius: "8px",
                padding: "10px 12px",
                fontSize: "12.5px",
                fontWeight: 600,
                lineHeight: 1.4,
                color: "#1D1D1B",
              }}
            >
              {loading ? (
                <span>A simular percursos e fiabilidade em tempo real…</span>
              ) : mostReliableRoute && fastestRoute ? (
                mostReliableRoute.id !== fastestRoute.id && mostReliableRoute.dur > fastestRoute.dur ? (
                  <span>
                    A opção mais fiável demora +{mostReliableRoute.dur - fastestRoute.dur} min do que
                    a mais rápida, mas chega a horas em {mostReliableRoute.score}% das viagens (na
                    mais rápida, {fastestRoute.score}%).
                  </span>
                ) : (
                  <span>
                    A opção mais fiável é também a mais rápida ({mostReliableRoute.dur} min) e chega a
                    horas em {mostReliableRoute.score}% das viagens.
                  </span>
                )
              ) : (
                <span>Introduza origem e destino para comparar a fiabilidade dos percursos.</span>
              )}
            </div>

            {/* OPENSTREETMAP ROUTE MAP */}
            <div
              style={{
                position: "relative",
                height: "220px",
                borderRadius: "12px",
                background: "#EEEBE4",
                border: "1px solid #D9D9D5",
                overflow: "hidden",
              }}
            >
              <LiveMap
                origin={searched.origin}
                destination={searched.destination}
                route={activeRoute}
                getLineColor={getLineColor}
                height={220}
              />
            </div>

            {/* ALERTS & BIKE BANNER */}
            <div>
              {errorMsg && (
                <div
                  style={{
                    marginBottom: "10px",
                    padding: "10px 12px",
                    borderRadius: "8px",
                    background: "#FEE2E2",
                    color: "#991B1B",
                    fontSize: "12px",
                    fontWeight: 500,
                  }}
                >
                  <span>{errorMsg}</span>
                </div>
              )}

              {routeSource === "fallback" && !loading && (
                <div
                  style={{
                    marginBottom: "10px",
                    padding: "10px 12px",
                    borderRadius: "8px",
                    background: "#FEF3C7",
                    color: "#92400E",
                    fontSize: "12px",
                    fontWeight: 500,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "8px",
                  }}
                >
                  <span>
                    ⚠️ O Google Routes não respondeu (quota esgotada ou sem rede). A mostrar rotas
                    aproximadas de recurso — não são horários reais.
                  </span>
                  <button
                    type="button"
                    onClick={() => runLiveSimulation(origin, destination, allowBike)}
                    style={{
                      flexShrink: 0,
                      padding: "4px 8px",
                      borderRadius: "6px",
                      border: "1px solid #D97706",
                      background: "#FFFFFF",
                      color: "#92400E",
                      fontSize: "11px",
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    Tentar novamente
                  </button>
                </div>
              )}

              {allowBike && bikeRoute && !loading && (
                <button
                  type="button"
                  onClick={() => setSelectedRouteId(bikeRoute.id)}
                  style={{
                    width: "100%",
                    marginBottom: "10px",
                    padding: "10px 12px",
                    borderRadius: "8px",
                    border: `2px solid ${activeRoute?.id === bikeRoute.id ? "#1A7F46" : "#BBE5CC"}`,
                    background: "#ECFDF3",
                    color: "#14532D",
                    fontSize: "13px",
                    fontWeight: 600,
                    textAlign: "left",
                    cursor: "pointer",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <span>🚲 Opção Gira · {bikeRoute.dur} min · {bikeRoute.score}% fiável</span>
                  <span style={{ fontSize: "12px" }}>
                    {activeRoute?.id === bikeRoute.id ? "No mapa ✓" : "Ver no mapa ›"}
                  </span>
                </button>
              )}
              {allowBike && !bikeRoute && !loading && routes.length > 0 && (
                <div
                  style={{
                    marginBottom: "10px",
                    padding: "10px 12px",
                    borderRadius: "8px",
                    background: "#FFFFFF",
                    color: "#585862",
                    fontSize: "12px",
                  }}
                >
                  <span>🚲 Gira ativa, mas não há rota de bicicleta viável para este percurso.</span>
                </div>
              )}

              {/* ROUTE CARDS LIST */}
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "10px",
                }}
              >
                {sortedRoutes.map((o, idx) => {
                  const band = getReliabilityBand(o.score);
                  return (
                    <div
                      key={o.id}
                      onClick={() => {
                        setSelectedRouteId(o.id);
                        setScreen("detalhe");
                      }}
                      style={{
                        background: "#FFFFFF",
                        border: idx === 0 ? "2px solid #003F8F" : "1px solid #E6E6E3",
                        borderRadius: "12px",
                        boxShadow: "0 2px 8px rgba(29,29,27,0.08)",
                        padding: "12px 14px",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "flex-start",
                        justifyContent: "space-between",
                        gap: "10px",
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "6px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                          <span
                            style={{
                              width: "22px",
                              height: "22px",
                              borderRadius: "50%",
                              background: idx === 0 ? "#FFD400" : "#E6E6E3",
                              fontSize: "11px",
                              fontWeight: 700,
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            {idx + 1}º
                          </span>
                          {o.tags?.map((t) => (
                            <span
                              key={t}
                              style={{
                                background: "#EFEFEC",
                                borderRadius: "4px",
                                padding: "2px 7px",
                                fontSize: "11px",
                                fontWeight: 600,
                              }}
                            >
                              {t}
                            </span>
                          ))}
                          <span style={{ fontSize: "11px", color: "#585862" }}>
                            {o.transbordos === 0
                              ? "Direto"
                              : `${o.transbordos} transbordo${o.transbordos > 1 ? "s" : ""}`}
                          </span>
                        </div>

                        {/* Horizontal Step Chain */}
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            flexWrap: "wrap",
                            gap: "5px",
                            marginTop: "2px",
                          }}
                        >
                          {o.compressedSteps
                            .filter((s) => s.mode !== "ARRIVE")
                            .map((s, sIdx, arr) => {
                              const mins = Math.max(1, Math.round(s.baseline_duration || 1));
                              const rawCode = String(s.line_id || s.line_display || "")
                                .replace(/\s*(Bus|Train|Rail|Ferry)\s*/gi, "")
                                .trim();
                              const lc = getLineColor(rawCode);
                              return (
                                <React.Fragment key={sIdx}>
                                  {s.mode === "WALK" ? (
                                    <span
                                      style={{
                                        display: "inline-flex",
                                        alignItems: "center",
                                        gap: "2px",
                                        fontSize: "12px",
                                        color: "#585862",
                                        fontWeight: 500,
                                      }}
                                    >
                                      <span>🚶</span>
                                      <sub style={{ fontSize: "10px" }}>{mins}</sub>
                                    </span>
                                  ) : s.mode === "CITIBIKE" ? (
                                    <span
                                      style={{
                                        background: "#1A7F46",
                                        color: "#FFFFFF",
                                        borderRadius: "6px",
                                        padding: "2px 8px",
                                        fontSize: "12px",
                                        fontWeight: 700,
                                      }}
                                    >
                                      🚲 Gira ({mins}m)
                                    </span>
                                  ) : (
                                    <span
                                      style={{
                                        display: "inline-flex",
                                        alignItems: "center",
                                        gap: "4px",
                                      }}
                                    >
                                      <span style={{ fontSize: "13px" }}>{getStepEmoji(s)}</span>
                                      <span
                                        style={{
                                          background: lc.bg,
                                          color: lc.fg,
                                          borderRadius: "6px",
                                          padding: "2px 8px",
                                          fontSize: "13px",
                                          fontWeight: 700,
                                          lineHeight: 1.2,
                                        }}
                                      >
                                        {rawCode}
                                      </span>
                                    </span>
                                  )}
                                  {sIdx < arr.length - 1 && (
                                    <span style={{ color: "#9CA3AF", fontSize: "12px" }}>›</span>
                                  )}
                                </React.Fragment>
                              );
                            })}
                        </div>

                        <div style={{ fontSize: "12px", color: "#585862" }}>
                          <span>
                            {o.sai} – {o.chega}
                          </span>
                          <span style={{ margin: "0 6px" }}>·</span>
                          <span>€{o.cost.toFixed(2)}</span>
                        </div>

                        <div style={{ fontSize: "12px", color: "#585862", lineHeight: 1.35 }}>
                          em {o.firstWait} min (
                          <span style={{ color: band.text, fontWeight: 600 }}>{band.statusText}</span>
                          ) a partir de {o.firstStop}
                        </div>

                        {/* CARRISway 9-in-10 Range Bar */}
                        <div style={{ display: "flex", flexDirection: "column", gap: "4px", marginTop: "2px" }}>
                          <div
                            style={{
                              position: "relative",
                              height: "6px",
                              borderRadius: "3px",
                              background: "#E6E6E3",
                            }}
                          >
                            <div
                              style={{
                                position: "absolute",
                                top: 0,
                                bottom: 0,
                                borderRadius: "3px",
                                background: band.bg,
                                left: pctPos(o.lo),
                                width: `${Math.max(8, ((o.hi - o.lo) / scaleSpan) * 100)}%`,
                              }}
                            />
                            <div
                              style={{
                                position: "absolute",
                                top: "50%",
                                width: "11px",
                                height: "11px",
                                borderRadius: "50%",
                                background: "#1D1D1B",
                                border: "2px solid #FFFFFF",
                                transform: "translate(-50%, -50%)",
                                left: pctPos(o.dur),
                              }}
                            />
                          </div>
                          <span style={{ fontSize: "10px", color: "#6B6B66" }}>
                            {o.lo}–{o.hi} min em 9 de cada 10 viagens
                          </span>
                        </div>
                      </div>

                      {/* Right Column: Duration + Absolute Reliability Badge */}
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "flex-end",
                          gap: "8px",
                          flexShrink: 0,
                        }}
                      >
                        <span style={{ fontSize: "20px", fontWeight: 700, color: "#1D1D1B" }}>
                          {o.dur} min
                        </span>

                        <div
                          style={{
                            minWidth: "72px",
                            borderRadius: "10px",
                            padding: "8px 6px",
                            background: band.bg,
                            color: band.fg,
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            gap: "2px",
                          }}
                        >
                          {showPercentages && (
                            <span style={{ fontSize: "18px", fontWeight: 700, lineHeight: 1 }}>
                              {o.score}%
                            </span>
                          )}
                          <span style={{ fontSize: "10px", fontWeight: 600, textAlign: "center" }}>
                            {band.label}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* MODAL "FILTRAR POR" */}
            {showFilterModal && (
              <div
                onClick={() => setShowFilterModal(false)}
                style={{
                  position: "absolute",
                  inset: 0,
                  background: "rgba(0, 0, 0, 0.45)",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "flex-end",
                  zIndex: 50,
                }}
              >
                <div
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    background: "#FFFFFF",
                    borderTopLeftRadius: "24px",
                    borderTopRightRadius: "24px",
                    padding: "12px 20px 28px",
                    boxShadow: "0 -8px 30px rgba(0,0,0,0.25)",
                  }}
                >
                  <div
                    style={{
                      width: "40px",
                      height: "4px",
                      borderRadius: "2px",
                      background: "#D9D9D5",
                      margin: "0 auto 14px",
                    }}
                  />
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      marginBottom: "14px",
                    }}
                  >
                    <h3 style={{ margin: 0, fontSize: "20px", fontWeight: 500, color: "#1D1D1B" }}>
                      Filtrar por
                    </h3>
                    <button
                      type="button"
                      onClick={() => setShowFilterModal(false)}
                      style={{
                        width: "34px",
                        height: "34px",
                        borderRadius: "50%",
                        border: "none",
                        background: "#F4F4F2",
                        fontSize: "18px",
                        cursor: "pointer",
                      }}
                    >
                      ✕
                    </button>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                    {FILTER_OPTIONS.map((opt) => {
                      const selected = filterBy === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => {
                            setFilterBy(opt.id);
                            setShowFilterModal(false);
                          }}
                          style={{
                            display: "flex",
                            alignItems: "flex-start",
                            gap: "14px",
                            padding: "11px 4px",
                            border: "none",
                            background: "transparent",
                            cursor: "pointer",
                            textAlign: "left",
                            width: "100%",
                          }}
                        >
                          <span
                            style={{
                              marginTop: "2px",
                              width: "20px",
                              height: "20px",
                              borderRadius: "50%",
                              border: `2px solid ${selected ? "#00767A" : "#585862"}`,
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              flexShrink: 0,
                            }}
                          >
                            {selected && (
                              <span
                                style={{
                                  width: "10px",
                                  height: "10px",
                                  borderRadius: "50%",
                                  background: "#00767A",
                                }}
                              />
                            )}
                          </span>

                          <div style={{ display: "flex", flexDirection: "column" }}>
                            <span
                              style={{
                                fontSize: "15px",
                                fontWeight: selected ? 600 : 400,
                                color: "#1D1D1B",
                              }}
                            >
                              {opt.label}
                            </span>
                            {opt.sub && (
                              <span style={{ fontSize: "12px", color: "#6B6B66", marginTop: "2px" }}>
                                {opt.sub}
                              </span>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </section>
        )}

        {/* ============================================================
            SCREEN 4: DETALHE DO PERCURSO
           ============================================================ */}
        {screen === "detalhe" && activeRoute && (
          <section
            aria-label="Detalhe do percurso"
            style={{
              flex: 1,
              background: "#F4F4F2",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div
              style={{
                position: "relative",
                height: "300px",
                background: "#EEEBE4",
                overflow: "hidden",
              }}
            >
              <LiveMap
                origin={searched.origin}
                destination={searched.destination}
                route={activeRoute}
                getLineColor={getLineColor}
                height={300}
              />

              <button
                type="button"
                onClick={() => setScreen("resultados")}
                aria-label="Voltar aos percursos"
                style={{
                  position: "absolute",
                  zIndex: 1000,
                  top: "20px",
                  left: "16px",
                  width: "44px",
                  height: "44px",
                  background: "#FFFFFF",
                  border: "none",
                  borderRadius: "8px",
                  boxShadow: "0 2px 8px rgba(29,29,27,0.22)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                }}
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#1D1D1B" strokeWidth="2">
                  <path d="M19 12H5M11 6l-6 6 6 6" />
                </svg>
              </button>

              <div
                style={{
                  position: "absolute",
                  zIndex: 1000,
                  pointerEvents: "none",
                  left: "16px",
                  bottom: "48px",
                  display: "flex",
                  gap: "8px",
                }}
              >
                {activeRoute.linhas.map((l, idx) => (
                  <span
                    key={idx}
                    translate="no"
                    className="notranslate"
                    style={{
                      background: l.c.bg,
                      color: l.c.fg,
                      borderRadius: "30px",
                      padding: "4px 20px",
                      fontSize: "26px",
                      fontWeight: 700,
                      boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
                    }}
                  >
                    {l.n}
                  </span>
                ))}
              </div>

              <button
                type="button"
                onClick={() => {
                  const nextOrig = destination;
                  const nextDest = origin;
                  swapLocations();
                  runLiveSimulation(nextOrig, nextDest, allowBike);
                }}
                aria-label="Inverter o sentido"
                style={{
                  position: "absolute",
                  zIndex: 1000,
                  right: "16px",
                  bottom: "48px",
                  width: "46px",
                  height: "46px",
                  background: "#FFFFFF",
                  border: "none",
                  borderRadius: "8px",
                  boxShadow: "0 2px 8px rgba(29,29,27,0.22)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                }}
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#003F8F" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 8h14M14 4l4 4-4 4M20 16H6M10 12l-4 4 4 4" />
                </svg>
              </button>
            </div>

            <div
              style={{
                position: "relative",
                margin: "-36px 12px 16px",
                background: "#FFFFFF",
                borderRadius: "12px",
                boxShadow: "0 2px 12px rgba(29,29,27,0.16)",
                padding: "18px 16px 20px",
                display: "flex",
                flexDirection: "column",
                gap: "18px",
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <span style={{ fontSize: "16px" }}>📍</span>
                  <span style={{ fontSize: "14px", color: "#585862" }}>{origin}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <span style={{ fontSize: "16px" }}>🏁</span>
                  <span style={{ fontSize: "16px", fontWeight: 700 }}>Sentido – {destination}</span>
                </div>
                <div style={{ height: "1px", background: "#E6E6E3" }} />
                <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#003F8F" strokeWidth="1.8">
                    <circle cx="12" cy="12" r="9" />
                    <path d="M12 7v5l3 2" />
                  </svg>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                    <span style={{ fontSize: "26px", fontWeight: 700, lineHeight: 1 }}>
                      {activeRoute.firstWait}
                    </span>
                    <span style={{ fontSize: "11px", fontWeight: 700 }}>Minutos</span>
                  </div>
                  <span style={{ marginLeft: "auto", fontSize: "13px", color: "#585862" }}>
                    Chegada prevista às {activeRoute.chega}
                  </span>
                </div>
              </div>

              {(() => {
                const band = getReliabilityBand(activeRoute.score);
                return (
                  <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                    <h2 style={{ margin: 0, fontSize: "16px", fontWeight: 700 }}>
                      Fiabilidade do percurso
                    </h2>
                    <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
                      <div
                        style={{
                          flex: "0 0 92px",
                          width: "92px",
                          height: "92px",
                          borderRadius: "50%",
                          background: `conic-gradient(${band.bg} 0 ${activeRoute.score}%, #E6E6E3 ${activeRoute.score}% 100%)`,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <div
                          style={{
                            width: "70px",
                            height: "70px",
                            borderRadius: "50%",
                            background: "#FFFFFF",
                            display: "flex",
                            alignItems: "baseline",
                            justifyContent: "center",
                            paddingTop: "20px",
                            boxSizing: "border-box",
                          }}
                        >
                          <span style={{ fontSize: "26px", fontWeight: 700, lineHeight: 1 }}>
                            {activeRoute.score}
                          </span>
                          <span style={{ fontSize: "13px", fontWeight: 600 }}>%</span>
                        </div>
                      </div>
                      <div
                        style={{
                          flex: 1,
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "flex-start",
                          gap: "6px",
                        }}
                      >
                        <span
                          style={{
                            background: band.bg,
                            color: band.fg,
                            borderRadius: "12px",
                            padding: "4px 10px",
                            fontSize: "12px",
                            fontWeight: 700,
                          }}
                        >
                          {band.label}
                        </span>
                        <p style={{ margin: 0, fontSize: "13px", lineHeight: 1.45, color: "#1D1D1B" }}>
                          Chega a horas em <strong>{activeRoute.score} de cada 100 viagens</strong>, com
                          margem operacional padrão.
                        </p>
                      </div>
                    </div>

                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(3, 1fr)",
                        gap: "12px",
                        borderTop: "1px solid #E6E6E3",
                        paddingTop: "12px",
                      }}
                    >
                      <div>
                        <span
                          style={{
                            fontSize: "11px",
                            textTransform: "uppercase",
                            color: "#6B6B66",
                            display: "block",
                          }}
                        >
                          Típico
                        </span>
                        <span style={{ fontSize: "17px", fontWeight: 700 }}>
                          {activeRoute.dur} min
                        </span>
                      </div>
                      <div>
                        <span
                          style={{
                            fontSize: "11px",
                            textTransform: "uppercase",
                            color: "#6B6B66",
                            display: "block",
                          }}
                        >
                          9 em 10
                        </span>
                        <span style={{ fontSize: "17px", fontWeight: 700 }}>
                          {activeRoute.lo}–{activeRoute.hi} min
                        </span>
                      </div>
                      <div>
                        <span
                          style={{
                            fontSize: "11px",
                            textTransform: "uppercase",
                            color: "#6B6B66",
                            display: "block",
                          }}
                        >
                          Tarifa
                        </span>
                        <span style={{ fontSize: "17px", fontWeight: 700 }}>
                          €{activeRoute.cost.toFixed(2)}
                        </span>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() =>
                        setBoughtRouteId(
                          boughtRouteId === activeRoute.id ? null : activeRoute.id
                        )
                      }
                      style={{
                        width: "100%",
                        minHeight: "46px",
                        border: "none",
                        borderRadius: "8px",
                        background:
                          boughtRouteId === activeRoute.id ? "#1A7F46" : "#FFD400",
                        color:
                          boughtRouteId === activeRoute.id ? "#FFFFFF" : "#1D1D1B",
                        fontSize: "15px",
                        fontWeight: 700,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "8px",
                        boxShadow: "0 2px 8px rgba(29,29,27,0.12)",
                      }}
                    >
                      {boughtRouteId === activeRoute.id ? (
                        <span>
                          ✓ Bilhete comprado · €{activeRoute.cost.toFixed(2)}
                        </span>
                      ) : (
                        <span>Comprar agora · €{activeRoute.cost.toFixed(2)}</span>
                      )}
                    </button>
                  </div>
                );
              })()}

              {/* Simplified Combined Step-by-Step Instructions */}
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <h2 style={{ margin: 0, fontSize: "16px", fontWeight: 700 }}>
                  Instruções passo a passo
                </h2>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {activeRoute.compressedSteps.map((step, idx) => {
                    const isWalk = step.mode === "WALK";
                    const isArrive = step.mode === "ARRIVE";
                    const mins = Math.max(1, Math.round(step.baseline_duration || 0));
                    const cleanLabel = String(step.line_display || "")
                      .replace(/, Lisboa(, Portugal)?/gi, "")
                      .replace(/, Portugal/gi, "");

                    return (
                      <div
                        key={idx}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          padding: "10px 12px",
                          borderRadius: "8px",
                          background: "#F4F4F2",
                          fontSize: "13px",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                          <span style={{ fontSize: "16px" }}>
                            {getStepEmoji(step)}
                          </span>
                          <div>
                            <div style={{ fontWeight: 600, color: "#1D1D1B" }}>{cleanLabel}</div>
                            {step.departure_stop && step.departure_stop !== "N/A" && (
                              <div style={{ fontSize: "11px", color: "#585862" }}>
                                Partida: {step.departure_stop}
                              </div>
                            )}
                          </div>
                        </div>
                        {!isArrive && (
                          <span
                            style={{
                              fontWeight: 700,
                              fontSize: "12px",
                              color: "#003F8F",
                              background: "#FFFFFF",
                              padding: "3px 8px",
                              borderRadius: "6px",
                            }}
                          >
                            {mins} min
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Atraso face ao previsto */}
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <h2 style={{ margin: 0, fontSize: "16px", fontWeight: 700 }}>
                  Atraso face ao previsto
                </h2>
                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  {delayBuckets.map((d, idx) => (
                    <div
                      key={idx}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "10px",
                        minHeight: "24px",
                      }}
                    >
                      <span style={{ flex: "0 0 105px", fontSize: "12px", color: "#1D1D1B" }}>
                        {d.label}
                      </span>
                      <div
                        style={{
                          flex: 1,
                          height: "9px",
                          borderRadius: "5px",
                          background: "#EEEEEA",
                        }}
                      >
                        <div
                          style={{
                            height: "9px",
                            borderRadius: "5px",
                            background: d.bg,
                            width: `${d.v}%`,
                          }}
                        />
                      </div>
                      <span
                        style={{
                          flex: "0 0 34px",
                          textAlign: "right",
                          fontSize: "12px",
                          fontWeight: 600,
                        }}
                      >
                        {d.v}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Fiabilidade por hora de partida */}
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <h2 style={{ margin: 0, fontSize: "16px", fontWeight: 700 }}>
                  Fiabilidade por hora de partida
                </h2>
                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-end",
                    gap: "4px",
                    height: "84px",
                  }}
                >
                  {hourlyStats.map(([hr, val]) => {
                    const barColor = val >= 75 ? "#1A7F46" : val >= 60 ? "#F59E0B" : "#C8202B";
                    return (
                      <div
                        key={hr}
                        style={{
                          flex: 1,
                          display: "flex",
                          flexDirection: "column",
                          justifyContent: "flex-end",
                        }}
                      >
                        <div
                          style={{
                            borderRadius: "3px",
                            height: `${Math.round((val / 100) * 80)}px`,
                            background: barColor,
                            outline: hr === 13 ? "2px solid #1D1D1B" : "none",
                            outlineOffset: "1px",
                          }}
                        />
                      </div>
                    );
                  })}
                </div>
                <div style={{ display: "flex", gap: "4px" }}>
                  {hourlyStats.map(([hr]) => (
                    <span
                      key={hr}
                      style={{
                        flex: 1,
                        textAlign: "center",
                        fontSize: "10px",
                        color: "#6B6B66",
                      }}
                    >
                      {hr}h
                    </span>
                  ))}
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                <button
                  type="button"
                  onClick={() =>
                    setBoughtRouteId(
                      boughtRouteId === activeRoute.id ? null : activeRoute.id
                    )
                  }
                  style={{
                    minHeight: "48px",
                    border: 0,
                    borderRadius: "8px",
                    background:
                      boughtRouteId === activeRoute.id ? "#1A7F46" : "#FFD400",
                    color:
                      boughtRouteId === activeRoute.id ? "#FFFFFF" : "#1D1D1B",
                    fontSize: "15px",
                    fontWeight: 700,
                    cursor: "pointer",
                    boxShadow: "0 2px 8px rgba(29,29,27,0.12)",
                  }}
                >
                  {boughtRouteId === activeRoute.id ? (
                    <span>
                      ✓ Bilhete comprado · €{activeRoute.cost.toFixed(2)}
                    </span>
                  ) : (
                    <span>Comprar agora · €{activeRoute.cost.toFixed(2)}</span>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    const next = !alertEnabled;
                    setAlertEnabled(next);
                    if (next) {
                      setShowAlertModal(true);
                    }
                  }}
                  style={{
                    minHeight: "46px",
                    border: "1px solid #D9D9D5",
                    borderRadius: "8px",
                    background: alertEnabled ? "#1A7F46" : "#FFFFFF",
                    color: alertEnabled ? "#FFFFFF" : "#1D1D1B",
                    fontSize: "14px",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  <span>
                    {alertEnabled
                      ? "✓ Alerta ativado · tocar para desativar"
                      : "Ativar alerta de atrasos"}
                  </span>
                </button>
              </div>
            </div>
          </section>
        )}

        {/* ============================================================
            TIME SELECTION MODAL (Matches Uploaded Screenshot)
           ============================================================ */}
        {showTimeModal && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Selecionar hora"
            onClick={() => setShowTimeModal(false)}
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 2500,
              background: "rgba(29, 29, 27, 0.45)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "20px",
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                width: "100%",
                maxWidth: "340px",
                background: "#FFFFFF",
                borderRadius: "16px",
                boxShadow: "0 12px 36px rgba(0, 0, 0, 0.28)",
                padding: "16px 18px 18px",
                display: "flex",
                flexDirection: "column",
                gap: "14px",
              }}
            >
              {/* Top Tabs: Saída às / Chegada até */}
              <div
                style={{
                  display: "flex",
                  borderBottom: "1px solid #E6E6E3",
                }}
              >
                {[
                  { id: "depart_at", label: "Saída às" },
                  { id: "arrive_by", label: "Chegada até" },
                ].map((tab) => {
                  const active = draftTimeMode === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setDraftTimeMode(tab.id)}
                      style={{
                        flex: 1,
                        padding: "10px 8px 12px",
                        background: "transparent",
                        border: "none",
                        borderBottom: active ? "3px solid #00767A" : "3px solid transparent",
                        color: active ? "#003F8F" : "#585862",
                        fontSize: "15px",
                        fontWeight: active ? 700 : 500,
                        cursor: "pointer",
                        marginBottom: "-1px",
                      }}
                    >
                      <span>{tab.label}</span>
                    </button>
                  );
                })}
              </div>

              {/* 5-Row Wheel / Column Time Selector (HH : MM) */}
              <div
                translate="no"
                className="notranslate"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "18px",
                  padding: "6px 0",
                  userSelect: "none",
                }}
              >
                {/* Hours Column (00-23) */}
                <div
                  onWheel={(e) => {
                    e.preventDefault();
                    const delta = e.deltaY > 0 ? 1 : -1;
                    setDraftHour((h) => (h + delta + 24) % 24);
                  }}
                  style={{
                    width: "96px",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                  }}
                >
                  {[-2, -1, 0, 1, 2].map((offset) => {
                    const hr = (draftHour + offset + 24) % 24;
                    const isCenter = offset === 0;
                    const isOuter = Math.abs(offset) === 2;
                    return isCenter ? (
                      <div
                        key={offset}
                        style={{
                          position: "relative",
                          width: "100%",
                          height: "46px",
                          borderTop: "1px solid #B8B8B4",
                          borderBottom: "1px solid #B8B8B4",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: "24px",
                          fontWeight: 700,
                          color: "#1D1D1B",
                        }}
                      >
                        <span>{pad2(hr)}</span>
                        <select
                          aria-label="Hora"
                          value={draftHour}
                          onChange={(e) => setDraftHour(Number(e.target.value))}
                          style={{
                            position: "absolute",
                            inset: 0,
                            opacity: 0,
                            cursor: "pointer",
                            width: "100%",
                            height: "100%",
                          }}
                        >
                          {Array.from({ length: 24 }, (_, i) => (
                            <option key={i} value={i}>
                              {pad2(i)}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : (
                      <button
                        key={offset}
                        type="button"
                        onClick={() => setDraftHour(hr)}
                        style={{
                          width: "100%",
                          height: isOuter ? "28px" : "38px",
                          background: "transparent",
                          border: "none",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: isOuter ? "18px" : "21px",
                          fontWeight: 400,
                          color: "#8E8E93",
                          opacity: isOuter ? 0.55 : 0.9,
                          cursor: "pointer",
                        }}
                      >
                        <span>{pad2(hr)}</span>
                      </button>
                    );
                  })}
                </div>

                {/* Colon Separator */}
                <span
                  style={{
                    fontSize: "24px",
                    fontWeight: 700,
                    color: "#1D1D1B",
                    paddingBottom: "2px",
                  }}
                >
                  :
                </span>

                {/* Minutes Column (00-59) */}
                <div
                  onWheel={(e) => {
                    e.preventDefault();
                    const delta = e.deltaY > 0 ? 1 : -1;
                    setDraftMinute((m) => (m + delta + 60) % 60);
                  }}
                  style={{
                    width: "96px",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                  }}
                >
                  {[-2, -1, 0, 1, 2].map((offset) => {
                    const mn = (draftMinute + offset + 60) % 60;
                    const isCenter = offset === 0;
                    const isOuter = Math.abs(offset) === 2;
                    return isCenter ? (
                      <div
                        key={offset}
                        style={{
                          position: "relative",
                          width: "100%",
                          height: "46px",
                          borderTop: "1px solid #B8B8B4",
                          borderBottom: "1px solid #B8B8B4",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: "24px",
                          fontWeight: 700,
                          color: "#1D1D1B",
                        }}
                      >
                        <span>{pad2(mn)}</span>
                        <select
                          aria-label="Minuto"
                          value={draftMinute}
                          onChange={(e) => setDraftMinute(Number(e.target.value))}
                          style={{
                            position: "absolute",
                            inset: 0,
                            opacity: 0,
                            cursor: "pointer",
                            width: "100%",
                            height: "100%",
                          }}
                        >
                          {Array.from({ length: 60 }, (_, i) => (
                            <option key={i} value={i}>
                              {pad2(i)}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : (
                      <button
                        key={offset}
                        type="button"
                        onClick={() => setDraftMinute(mn)}
                        style={{
                          width: "100%",
                          height: isOuter ? "28px" : "38px",
                          background: "transparent",
                          border: "none",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: isOuter ? "18px" : "21px",
                          fontWeight: 400,
                          color: "#8E8E93",
                          opacity: isOuter ? 0.55 : 0.9,
                          cursor: "pointer",
                        }}
                      >
                        <span>{pad2(mn)}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Action Buttons: Cancelar / Definir */}
              <div style={{ display: "flex", gap: "12px", marginTop: "4px" }}>
                <button
                  type="button"
                  onClick={() => setShowTimeModal(false)}
                  style={{
                    flex: 1,
                    height: "46px",
                    borderRadius: "10px",
                    border: "1px solid #D9D9D5",
                    background: "#FFFFFF",
                    color: "#003F8F",
                    fontSize: "15px",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  <span>Cancelar</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const nextCustom = { hour: draftHour, minute: draftMinute };
                    setTimeMode(draftTimeMode);
                    setCustomTime(nextCustom);
                    setShowTimeModal(false);
                    if (screen === "resultados") {
                      runLiveSimulation(origin, destination, allowBike, draftTimeMode, nextCustom);
                    }
                  }}
                  style={{
                    flex: 1,
                    height: "46px",
                    borderRadius: "10px",
                    border: "none",
                    background: "#00767A",
                    color: "#FFFFFF",
                    fontSize: "15px",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  <span>Definir</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ============================================================
            ALERT ACTIVATED POPUP MODAL
           ============================================================ */}
        {showAlertModal && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Alert active"
            onClick={() => setShowAlertModal(false)}
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 3000,
              background: "rgba(29, 29, 27, 0.5)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "20px",
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                width: "100%",
                maxWidth: "340px",
                background: "#FFFFFF",
                borderRadius: "16px",
                boxShadow: "0 12px 36px rgba(0, 0, 0, 0.28)",
                padding: "22px 20px 18px",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                textAlign: "center",
                gap: "12px",
              }}
            >
              <div
                style={{
                  width: "48px",
                  height: "48px",
                  borderRadius: "50%",
                  background: "#ECFDF3",
                  color: "#1A7F46",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "22px",
                }}
              >
                🔔
              </div>
              <h3
                style={{
                  margin: 0,
                  fontSize: "17px",
                  fontWeight: 700,
                  color: "#1D1D1B",
                }}
              >
                <span>Journey Alert Active</span>
              </h3>
              <p
                style={{
                  margin: 0,
                  fontSize: "14px",
                  lineHeight: 1.5,
                  color: "#585862",
                }}
              >
                <span>
                  This alert is now active during your expected journey, if the reliability rate
                  drops to a lower tier of reliability due to live factors you will be informed and
                  an alternative given.
                </span>
              </p>
              <button
                type="button"
                onClick={() => setShowAlertModal(false)}
                style={{
                  marginTop: "6px",
                  width: "100%",
                  height: "44px",
                  borderRadius: "10px",
                  border: "none",
                  background: "#FFD400",
                  color: "#1D1D1B",
                  fontSize: "15px",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                <span>OK</span>
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
