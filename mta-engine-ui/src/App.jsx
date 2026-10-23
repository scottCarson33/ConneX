import React, { useState, useEffect, useMemo } from "react";
import {
  MapPin,
  ArrowRight,
  Train,
  Bike,
  Footprints,
  AlertTriangle,
  Clock,
  CalendarDays,
  Trophy,
  Sparkles,
  ArrowUpDown,
  Navigation,
  CheckCircle2,
  Percent,
} from "lucide-react";
import CarrisMobileApp from "./CarrisMobileApp";

export default function App() {
  const [viewMode, setViewMode] = useState("carris");
  const [origin, setOrigin] = useState("Praça do Comércio");
  const [destination, setDestination] = useState("Belém, Lisboa");
  const [timeMode, setTimeMode] = useState("depart_at");
  const [targetTime, setTargetTime] = useState("");
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState([]);
  const [weatherData, setWeatherData] = useState(null);
  const [error, setError] = useState("");
  const [activeRouteIdx, setActiveRouteIdx] = useState(0);
  const [allowBike, setAllowBike] = useState(false);
  const [showPercentages, setShowPercentages] = useState(false);

  const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

  useEffect(() => {
    const now = new Date();
    const offset = now.getTimezoneOffset() * 60000;
    const localISOTime = new Date(now - offset).toISOString().slice(0, 16);
    setTargetTime(localISOTime);
  }, []);

  const handleSwap = () => {
    setOrigin(destination);
    setDestination(origin);
  };

  const handleSimulate = async (e) => {
    if (e) e.preventDefault();
    if (!origin.trim() || !destination.trim()) return;

    setLoading(true);
    setError("");
    setResults([]);
    setActiveRouteIdx(0);

    try {
      let currentTarget = targetTime ? new Date(targetTime) : new Date();
      const now = new Date();
      if (!showTimePicker || currentTarget < now) {
        currentTarget = now;
      }

      const res = await fetch(`${API_BASE_URL}/api/simulate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          origin,
          destination,
          target_time: currentTarget.toISOString(),
          time_mode: timeMode,
          allow_bike: allowBike,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || "Unable to find routes. Please check locations.");
      }

      const data = await res.json();
      if (data.status === "success" && data.data?.length > 0) {
        const sortedByReliability = [...data.data].sort((a, b) => {
          const sa = a?.metrics?.score ?? a?.metrics?.reliability_score ?? 0;
          const sb = b?.metrics?.score ?? b?.metrics?.reliability_score ?? 0;
          return sb - sa || (a?.metrics?.p50_mins ?? 999) - (b?.metrics?.p50_mins ?? 999);
        });
        setResults(sortedByReliability);
        setWeatherData(data.weather || null);
      } else {
        throw new Error("No routes found between these locations.");
      }
    } catch (err) {
      setError(err.message || "Failed to calculate route.");
    } finally {
      setLoading(false);
    }
  };

  const getRankTier = (route, index) => {
    // Quality tiers are strictly based on absolute score, so adding bikes or other options never lowers tiers
    const score = Math.min(96, route?.metrics?.score ?? route?.metrics?.reliability_score ?? 75);
    const isWinner = index === 0;

    if (score >= 85) {
      return {
        label: isWinner ? "OPTIMAL" : "EXCELLENT",
        badge: isWinner ? "Rank 1: Best Choice" : `Rank ${index + 1}: Excellent Choice`,
        description: isWinner ? "Fastest travel time & high reliability" : "High reliability & dependable arrival",
        bar: "bg-emerald-500",
        text: "text-emerald-400",
        bg: "bg-emerald-950/20",
        border: "border-emerald-500/25",
        activeBg: "bg-emerald-950/40",
        activeBorder: "border-emerald-500",
        ring: "ring-emerald-500/30",
        badgeBg: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
        dot: "bg-emerald-500 border-emerald-300 ring-emerald-500/20",
      };
    } else if (score >= 70) {
      return {
        label: "GOOD",
        badge: `Rank ${index + 1}: Good Choice`,
        description: "Solid option meeting reliability threshold",
        bar: "bg-sky-500",
        text: "text-sky-400",
        bg: "bg-sky-950/20",
        border: "border-sky-500/25",
        activeBg: "bg-sky-950/40",
        activeBorder: "border-sky-500",
        ring: "ring-sky-500/30",
        badgeBg: "bg-sky-500/20 text-sky-300 border-sky-500/40",
        dot: "bg-sky-500 border-sky-300 ring-sky-500/20",
      };
    } else if (score >= 50) {
      return {
        label: "FAIR",
        badge: `Rank ${index + 1}: Moderate Risk`,
        description: "Higher transfer overhead or lower frequency",
        bar: "bg-amber-500",
        text: "text-amber-400",
        bg: "bg-amber-950/20",
        border: "border-amber-500/25",
        activeBg: "bg-amber-950/40",
        activeBorder: "border-amber-500",
        ring: "ring-amber-500/30",
        badgeBg: "bg-amber-500/20 text-amber-300 border-amber-500/40",
        dot: "bg-amber-500 border-amber-300 ring-amber-500/20",
      };
    } else {
      return {
        label: "POOR",
        badge: `Rank ${index + 1}: High Delay Risk`,
        description: "Significant delays or indirect routing",
        bar: "bg-rose-500",
        text: "text-rose-400",
        bg: "bg-rose-950/20",
        border: "border-rose-500/25",
        activeBg: "bg-rose-950/40",
        activeBorder: "border-rose-500",
        ring: "ring-rose-500/30",
        badgeBg: "bg-rose-500/20 text-rose-300 border-rose-500/40",
        dot: "bg-rose-500 border-rose-300 ring-rose-500/20",
      };
    }
  };

  const getModeIcon = (mode) => {
    if (mode === "CITIBIKE") return <Bike className="w-5 h-5 text-sky-400" />;
    if (mode === "WALK") return <Footprints className="w-5 h-5 text-slate-400" />;
    if (mode === "ARRIVE") return <MapPin className="w-5 h-5 text-emerald-400" />;
    return <Train className="w-5 h-5 text-amber-400" />;
  };

  const activeRoute = results[activeRouteIdx] || results[0];
  const activeTier = activeRoute ? getRankTier(activeRoute, activeRouteIdx) : null;

  // Combine consecutive walk instructions into a single block with simple instructions
  const displaySteps = useMemo(() => {
    if (!activeRoute?.itinerary) return [];
    const merged = [];
    for (const step of activeRoute.itinerary) {
      if (step.mode === "WALK") {
        if (merged.length > 0 && merged[merged.length - 1].mode === "WALK") {
          const prev = merged[merged.length - 1];
          prev.baseline_duration = (prev.baseline_duration || 0) + (step.baseline_duration || 0);
          if (step.line_display && step.line_display.toLowerCase().includes("walk to")) {
            prev.line_display = step.line_display;
          }
          continue;
        }
      }
      merged.push({ ...step });
    }
    return merged;
  }, [activeRoute]);

  if (viewMode === "carris") {
    return <CarrisMobileApp onSwitchToClassic={() => setViewMode("classic")} />;
  }

  return (
    <div className="min-h-screen bg-[#0a0a0c] text-slate-100 font-sans antialiased selection:bg-amber-500/30">
      <div className="fixed inset-0 bg-gradient-to-b from-[#111116] via-[#0a0a0c] to-[#0a0a0c] pointer-events-none" />

      <main className="relative z-10 max-w-2xl mx-auto px-4 py-8 md:py-12">
        {/* Simple Header */}
        <header className="text-center mb-8">
          <div className="flex items-center justify-center gap-2 mb-3">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/[0.04] border border-white/[0.08] text-xs text-slate-400">
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              <span>Lisbon Transit Intelligence</span>
              {weatherData && (
                <span className="text-slate-500 ml-1">
                  • {weatherData.description} {weatherData.temp_c ? `(${weatherData.temp_c}°C)` : ""}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => setViewMode("carris")}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#FFD400] text-[#1D1D1B] font-extrabold text-xs hover:brightness-95 transition-all cursor-pointer shadow-sm"
            >
              <span>🚌 Abrir App CARRISway</span>
            </button>
          </div>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-white">
            Find the Best Route
          </h1>
          <p className="text-sm text-slate-400 mt-2">
            Simulating Metro, Carris, CP, and Gira with ranked reliability
          </p>
        </header>

        {/* Input Card */}
        <form
          onSubmit={handleSimulate}
          className="bg-[#121217] border border-white/[0.08] rounded-2xl p-5 shadow-2xl mb-8"
        >
          <div className="space-y-3">
            {/* Origin */}
            <div className="relative">
              <label className="text-[11px] font-medium text-slate-400 uppercase tracking-wider block mb-1.5 ml-1">
                From
              </label>
              <div className="relative">
                <MapPin className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input
                  type="text"
                  required
                  value={origin}
                  onChange={(e) => setOrigin(e.target.value)}
                  placeholder="e.g. Praça do Comércio"
                  className="w-full bg-[#08080b] border border-white/10 rounded-xl py-3 pl-10 pr-10 text-white placeholder-slate-600 focus:outline-none focus:border-amber-500 transition-colors text-sm"
                />
              </div>
            </div>

            {/* Swap Button */}
            <div className="flex justify-end -my-1 pr-3">
              <button
                type="button"
                onClick={handleSwap}
                className="p-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-slate-400 hover:text-white transition-colors cursor-pointer"
                title="Swap origin and destination"
              >
                <ArrowUpDown className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Destination */}
            <div className="relative">
              <label className="text-[11px] font-medium text-slate-400 uppercase tracking-wider block mb-1.5 ml-1">
                To
              </label>
              <div className="relative">
                <Navigation className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input
                  type="text"
                  required
                  value={destination}
                  onChange={(e) => setDestination(e.target.value)}
                  placeholder="e.g. Belém, Lisboa"
                  className="w-full bg-[#08080b] border border-white/10 rounded-xl py-3 pl-10 pr-4 text-white placeholder-slate-600 focus:outline-none focus:border-amber-500 transition-colors text-sm"
                />
              </div>
            </div>

            {/* Departure Options & Bike Toggle */}
            <div className="pt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setShowTimePicker(!showTimePicker)}
                  className="flex items-center gap-1.5 hover:text-slate-200 transition-colors cursor-pointer"
                >
                  <CalendarDays className="w-3.5 h-3.5 text-amber-400" />
                  <span>{showTimePicker ? "Custom time" : "Departing now"}</span>
                </button>
                {showTimePicker && (
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => setTimeMode("depart_at")}
                      className={`px-2 py-0.5 rounded text-[11px] cursor-pointer ${
                        timeMode === "depart_at"
                          ? "bg-amber-500/20 text-amber-400"
                          : "text-slate-500"
                      }`}
                    >
                      Depart
                    </button>
                    <button
                      type="button"
                      onClick={() => setTimeMode("arrive_by")}
                      className={`px-2 py-0.5 rounded text-[11px] cursor-pointer ${
                        timeMode === "arrive_by"
                          ? "bg-emerald-500/20 text-emerald-400"
                          : "text-slate-500"
                      }`}
                    >
                      Arrive
                    </button>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2">
                {/* Bike Toggle Button */}
                <button
                  type="button"
                  onClick={() => setAllowBike(!allowBike)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border transition-all cursor-pointer text-xs ${
                    allowBike
                      ? "bg-sky-500/15 border-sky-500/30 text-sky-300 font-medium"
                      : "bg-white/[0.03] border-white/10 text-slate-500 hover:text-slate-400"
                  }`}
                  title={allowBike ? "Gira bikes included in simulation" : "Gira bikes excluded"}
                >
                  <Bike className={`w-3.5 h-3.5 ${allowBike ? "text-sky-400" : "text-slate-500"}`} />
                  <span>Bikes: {allowBike ? "ON" : "OFF"}</span>
                </button>

                {/* Percentage Toggle Button */}
                <button
                  type="button"
                  onClick={() => setShowPercentages(!showPercentages)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border transition-all cursor-pointer text-xs ${
                    showPercentages
                      ? "bg-amber-500/15 border-amber-500/30 text-amber-300 font-medium"
                      : "bg-white/[0.03] border-white/10 text-slate-500 hover:text-slate-400"
                  }`}
                  title={showPercentages ? "Percentages visible" : "Percentages hidden"}
                >
                  <Percent className={`w-3 h-3 ${showPercentages ? "text-amber-400" : "text-slate-500"}`} />
                  <span>Percentages: {showPercentages ? "ON" : "OFF"}</span>
                </button>
              </div>
            </div>

            {showTimePicker && (
              <input
                type="datetime-local"
                value={targetTime}
                onChange={(e) => setTargetTime(e.target.value)}
                className="w-full bg-[#08080b] border border-white/10 rounded-xl p-2.5 text-white text-xs"
              />
            )}

            {/* Submit Button */}
            <button
              type="submit"
              disabled={loading}
              className="w-full mt-2 h-12 bg-white text-[#0a0a0c] hover:bg-slate-200 disabled:bg-white/10 disabled:text-slate-500 font-semibold text-sm rounded-xl transition-all flex items-center justify-center gap-2 shadow-lg cursor-pointer"
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-slate-900 border-t-transparent rounded-full animate-spin" />
                  <span>Simulating Routes...</span>
                </>
              ) : (
                <>
                  <span>Show Ranked Routes</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>
        </form>

        {/* Error message */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 mb-6 flex items-center gap-3 text-red-300 text-sm">
            <AlertTriangle className="w-5 h-5 shrink-0 text-red-400" />
            <p>{error}</p>
          </div>
        )}

        {/* Results */}
        {results.length > 0 && activeRoute && (
          <div className="space-y-6">
            {/* Color-Coded Route Rankings */}
            <div>
              <div className="flex items-center justify-between text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 px-1">
                <span>Route Rankings (Color-Coded)</span>
                <button
                  type="button"
                  onClick={() => setShowPercentages(!showPercentages)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer border ${
                    showPercentages
                      ? "bg-amber-500/15 border-amber-500/30 text-amber-300 font-semibold"
                      : "bg-white/[0.04] border-white/10 text-slate-400 hover:text-white"
                  }`}
                >
                  <Percent className="w-3 h-3 text-amber-400" />
                  <span>{showPercentages ? "Hide Percentages" : "Show Percentages"}</span>
                </button>
              </div>

              <div className="space-y-2.5">
                {results.map((r, idx) => {
                  const tier = getRankTier(r, idx);
                  const isSelected = idx === activeRouteIdx;

                  return (
                    <div
                      key={idx}
                      onClick={() => setActiveRouteIdx(idx)}
                      className={`cursor-pointer rounded-xl p-3.5 border transition-all relative overflow-hidden flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                        isSelected
                          ? `${tier.activeBg} ${tier.activeBorder} ring-2 ${tier.ring} shadow-lg`
                          : `${tier.bg} ${tier.border} hover:border-white/20`
                      }`}
                    >
                      {/* Left color bar */}
                      <div className={`absolute left-0 top-0 bottom-0 w-1.5 ${tier.bar}`} />

                      <div className="flex items-start sm:items-center gap-3 pl-2.5">
                        <span
                          className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-md border font-mono shrink-0 ${tier.badgeBg}`}
                        >
                          {idx === 0 && <Trophy className="w-3.5 h-3.5 text-emerald-400" />}
                          #{idx + 1} {tier.label}
                        </span>

                        <div>
                          <div className="font-semibold text-sm text-white flex items-center gap-2">
                            <span>{r.title}</span>
                            {isSelected && (
                              <span className="text-[10px] font-semibold text-white bg-white/15 px-1.5 py-0.5 rounded">
                                Viewing
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-slate-400 mt-0.5">
                            {tier.description}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-4 pl-2.5 sm:pl-0 sm:justify-end text-right shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-white/5">
                        <div>
                          <span className="text-[10px] text-slate-500 uppercase block font-medium">Time</span>
                          <span className="font-bold text-white font-mono text-sm">{r.metrics.p50_mins}m</span>
                        </div>
                        {showPercentages && (
                          <div>
                            <span className="text-[10px] text-slate-500 uppercase block font-medium">Reliability</span>
                            <span className={`font-bold font-mono text-sm ${tier.text}`}>
                              {r.metrics.score ?? r.metrics.reliability_score}%
                            </span>
                          </div>
                        )}
                        <div>
                          <span className="text-[10px] text-slate-500 uppercase block font-medium">Fare</span>
                          <span className="font-bold text-slate-300 font-mono text-sm">€{r.cost.toFixed(2)}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Selected Route Step-by-Step Directions */}
            <div className="bg-[#121217] border border-white/[0.08] rounded-2xl overflow-hidden shadow-2xl">
              {/* Header with active rank tier color accent */}
              <div className={`p-5 border-b border-white/[0.06] ${activeTier.bg}`}>
                <div className="flex items-center justify-between mb-2">
                  <span
                    className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${activeTier.badgeBg}`}
                  >
                    {activeRouteIdx === 0 && <Trophy className="w-3 h-3 text-emerald-400" />}
                    {activeTier.badge}
                  </span>
                  {showPercentages && (
                    <span className={`text-xs font-mono font-bold ${activeTier.text}`}>
                      {activeRoute.metrics.score ?? activeRoute.metrics.reliability_score}% On-Time Reliability
                    </span>
                  )}
                </div>

                <h2 className="text-xl md:text-2xl font-bold text-white tracking-tight">
                  {activeRoute.title}
                </h2>

                {/* Key metrics grid */}
                <div className="grid grid-cols-3 gap-2 mt-4 pt-4 border-t border-white/[0.06] text-center">
                  <div className="bg-white/[0.02] rounded-xl p-2.5">
                    <span className="text-[10px] text-slate-400 uppercase tracking-wider block font-medium">
                      Trip Duration
                    </span>
                    <span className="text-lg font-bold text-white font-mono">
                      {activeRoute.metrics.p50_mins}
                      <span className="text-xs font-normal text-slate-400 ml-0.5">min</span>
                    </span>
                  </div>

                  <div className="bg-white/[0.02] rounded-xl p-2.5">
                    <span className="text-[10px] text-slate-400 uppercase tracking-wider block font-medium">
                      Est. Arrival
                    </span>
                    <span className="text-lg font-bold text-emerald-400 font-mono">
                      {activeRoute.metrics.est_arrival_time}
                    </span>
                  </div>

                  <div className="bg-white/[0.02] rounded-xl p-2.5">
                    <span className="text-[10px] text-slate-400 uppercase tracking-wider block font-medium">
                      Fare
                    </span>
                    <span className="text-lg font-bold text-slate-200 font-mono">
                      €{activeRoute.cost.toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Step-by-step Itinerary */}
              <div className="p-5">
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">
                  Step-by-Step Directions
                </h3>

                <div className="relative pl-6 space-y-5 before:absolute before:left-2.5 before:top-3 before:bottom-3 before:w-0.5 before:bg-white/[0.08]">
                  {displaySteps.map((step, idx) => {
                    const isArrive = step.mode === "ARRIVE";
                    const isTransit = step.mode === "TRANSIT";
                    const isWalk = step.mode === "WALK";

                    // Clean and simplify display instruction
                    const cleanTitle = (step.line_display || "")
                      .replace(/, Lisboa(, Portugal)?/gi, "")
                      .replace(/, Portugal/gi, "")
                      .trim() || (isWalk ? "Walk" : "Transit");

                    return (
                      <div key={idx} className="relative group">
                        {/* Dot indicator matching active rank tier */}
                        <div
                          className={`absolute -left-[19px] top-1.5 w-3.5 h-3.5 rounded-full border-2 transition-all ${
                            isArrive
                              ? "bg-emerald-500 border-emerald-300 ring-4 ring-emerald-500/20"
                              : isTransit
                              ? activeTier.dot
                              : "bg-[#121217] border-slate-500"
                          }`}
                        />

                        {/* Step Card */}
                        <div className="bg-white/[0.02] border border-white/[0.04] rounded-xl p-3.5 flex items-start justify-between gap-3 hover:border-white/[0.1] transition-colors">
                          <div className="flex items-start gap-3">
                            <div className="p-2 rounded-lg bg-white/[0.04] shrink-0 mt-0.5">
                              {getModeIcon(step.mode)}
                            </div>
                            <div>
                              <div className="font-semibold text-sm text-white">
                                {cleanTitle}
                              </div>

                              {isTransit && (
                                <div className="text-xs text-slate-400 mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                                  {step.departure_stop && step.departure_stop !== "N/A" && (
                                    <span>From {step.departure_stop}</span>
                                  )}
                                  {step.expected_board_time && (
                                    <span className="text-amber-400 font-mono font-medium">
                                      Board at {step.expected_board_time}
                                    </span>
                                  )}
                                  {step.expected_wait_mins > 0 && (
                                    <span className="text-slate-500">
                                      (~{step.expected_wait_mins}m wait)
                                    </span>
                                  )}
                                </div>
                              )}

                              {isArrive && (
                                <div className="text-xs text-emerald-400 mt-0.5 font-mono">
                                  Arrive at destination: {step.expected_board_time}
                                </div>
                              )}
                            </div>
                          </div>

                          {!isArrive && step.baseline_duration > 0 && (
                            <span className="text-xs font-mono font-semibold text-slate-400 shrink-0 bg-white/[0.03] px-2 py-1 rounded">
                              {Math.max(1, Math.round(step.baseline_duration))} min
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
