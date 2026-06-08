import React, { useState, useEffect } from "react";
import {
  MapPin,
  ArrowRight,
  Train,
  Bike,
  Footprints,
  AlertTriangle,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Activity,
  Zap,
  Cpu,
  Wifi,
  Clock,
  CalendarDays,
} from "lucide-react";

export default function App() {
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [timeMode, setTimeMode] = useState("depart_at");
  const [targetTime, setTargetTime] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState([]);
  const [metaData, setMetaData] = useState(null);
  const [error, setError] = useState("");
  const [activeRouteIdx, setActiveRouteIdx] = useState(0);

  const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

  // Pre-fill datetime-local with current local time
  useEffect(() => {
    const now = new Date();
    // Format to YYYY-MM-DDThh:mm
    const offset = now.getTimezoneOffset() * 60000;
    const localISOTime = new Date(now - offset).toISOString().slice(0, 16);
    setTargetTime(localISOTime);
  }, []);

  const handleSimulate = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setResults([]);
    setMetaData(null);
    setActiveRouteIdx(0);

    try {
      let isoTarget = null;
      if (targetTime) {
        isoTarget = new Date(targetTime).toISOString();
      }

      const res = await fetch(`${API_BASE_URL}/api/simulate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          origin,
          destination,
          target_time: isoTarget,
          time_mode: timeMode,
        }),
      });

      if (!res.ok)
        throw new Error("Telemetry feed offline or simulation failed.");

      const data = await res.json();

      if (data.status === "success") {
        setMetaData({
          mode: data.time_mode,
          targetStr: data.target_time_str,
        });
        setResults(data.data);
      } else {
        throw new Error("Simulation returned an error state.");
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const getModeIcon = (mode) => {
    if (mode === "CITIBIKE")
      return (
        <Bike className="w-5 h-5 text-blue-400 drop-shadow-[0_0_8px_rgba(96,165,250,0.8)]" />
      );
    if (mode === "WALK")
      return <Footprints className="w-5 h-5 text-slate-400" />;
    if (mode === "DOCKING_OVERHEAD")
      return (
        <Clock className="w-5 h-5 text-purple-400 drop-shadow-[0_0_8px_rgba(168,85,247,0.8)]" />
      );
    if (mode === "ARRIVE")
      return (
        <MapPin className="w-5 h-5 text-emerald-500 drop-shadow-[0_0_8px_rgba(16,185,129,0.8)]" />
      );
    return (
      <Train className="w-5 h-5 text-orange-500 drop-shadow-[0_0_8px_rgba(249,115,22,0.8)]" />
    );
  };

  const nextRoute = () =>
    setActiveRouteIdx((prev) => (prev + 1) % results.length);
  const prevRoute = () =>
    setActiveRouteIdx((prev) => (prev - 1 + results.length) % results.length);

  const activeRoute = results[activeRouteIdx];

  const MAX_CHART_MINS =
    results.length > 0
      ? Math.max(...results.map((r) => r.metrics.worst_time)) + 5
      : 120;

  return (
    <div className="min-h-screen bg-[#030305] text-slate-100 font-sans antialiased relative overflow-x-hidden selection:bg-orange-500/30">
      <div className="fixed inset-0 bg-grid pointer-events-none z-0 opacity-50" />
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[300px] bg-orange-600/10 blur-[120px] rounded-full pointer-events-none z-0" />

      {/* TOP LIVE STATUS TICKER */}
      <div className="relative z-10 w-full bg-[#0a0a0f] border-b border-white/5 py-2.5 overflow-hidden flex items-center shadow-lg shadow-black/50">
        <div className="absolute left-0 top-0 bottom-0 w-16 bg-gradient-to-r from-[#0a0a0f] to-transparent z-20" />
        <div className="absolute right-0 top-0 bottom-0 w-16 bg-gradient-to-l from-[#0a0a0f] to-transparent z-20" />

        <div className="ticker-track flex items-center gap-8 text-[11px] font-mono tracking-widest text-slate-400 uppercase">
          {[...Array(2)].map((_, i) => (
            <React.Fragment key={i}>
              <span className="flex items-center gap-2 text-emerald-400">
                <div className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </div>
                System Online
              </span>
              <span>•</span>
              <span className="text-orange-400">
                N/Q/R/W: Delays (Earlier Incident)
              </span>
              <span>•</span>
              <span>L: Good Service</span>
              <span>•</span>
              <span>G: Good Service</span>
              <span>•</span>
              <span className="text-yellow-400">B/D/F/M: Moderate Delays</span>
              <span>•</span>
              <span>LIRR: On/Close to Schedule</span>
              <span>•</span>
            </React.Fragment>
          ))}
        </div>
      </div>

      <div className="relative z-10 max-w-6xl mx-auto p-4 md:p-8 pt-10">
        <header className="mb-12 text-center md:text-left flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div>
            <div className="flex items-center justify-center md:justify-start gap-3 mb-3 animate-fade">
              <Cpu className="w-5 h-5 text-orange-500" />
              <span className="text-[10px] font-mono tracking-[0.2em] text-orange-500 uppercase border border-orange-500/30 bg-orange-500/10 px-3 py-1 rounded">
                V9.4 Stochastic Matrix
              </span>
            </div>
            <h1 className="text-5xl md:text-6xl font-black tracking-tighter text-white uppercase drop-shadow-2xl animate-slide-up">
              Route{" "}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-orange-500 to-red-600">
                Intelligence
              </span>
            </h1>
            <p
              className="text-sm text-slate-400 mt-4 font-mono max-w-xl animate-fade"
              style={{ animationDelay: "0.2s" }}
            >
              <span className="text-white">5,000-trial Monte Carlo</span> • Live
              MTA telemetry active • Dynamic pivot graph routing
            </p>
          </div>

          <div
            className="hidden md:flex items-center gap-4 text-xs font-mono text-slate-500 bg-[#0d0e15] border border-white/5 p-3 rounded-lg shadow-2xl animate-fade"
            style={{ animationDelay: "0.3s" }}
          >
            <div className="flex flex-col items-center px-4 border-r border-white/5">
              <Wifi className="w-4 h-4 text-emerald-500 mb-1" />
              <span>GTFS Sync</span>
            </div>
            <div className="flex flex-col items-center px-4">
              <Zap className="w-4 h-4 text-orange-500 mb-1" />
              <span>Live Feed</span>
            </div>
          </div>
        </header>

        {/* INPUT CONFIGURATOR CARD */}
        <form
          onSubmit={handleSimulate}
          className="glass-panel p-6 rounded-2xl shadow-2xl mb-12 transform transition-all hover:border-white/10 animate-slide-up"
          style={{ animationDelay: "0.1s" }}
        >
          <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
            <div className="md:col-span-4 relative group">
              <label className="block text-[10px] font-mono uppercase tracking-widest text-slate-400 mb-2 ml-1">
                Origin Node
              </label>
              <div className="relative">
                <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 group-focus-within:text-orange-500 transition-colors" />
                <input
                  type="text"
                  required
                  className="w-full bg-[#050508] border border-white/10 rounded-xl py-3.5 pl-11 pr-4 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500 text-white placeholder-slate-600 transition-all font-medium"
                  placeholder="e.g., Grand Central Terminal"
                  value={origin}
                  onChange={(e) => setOrigin(e.target.value)}
                />
              </div>
            </div>

            <div className="hidden md:flex md:col-span-1 justify-center pb-3">
              <ArrowRight className="w-5 h-5 text-slate-600" />
            </div>

            <div className="md:col-span-3 relative group">
              <label className="block text-[10px] font-mono uppercase tracking-widest text-slate-400 mb-2 ml-1">
                Destination Node
              </label>
              <div className="relative">
                <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 group-focus-within:text-orange-500 transition-colors" />
                <input
                  type="text"
                  required
                  className="w-full bg-[#050508] border border-white/10 rounded-xl py-3.5 pl-11 pr-4 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500 text-white placeholder-slate-600 transition-all font-medium"
                  placeholder="e.g., Brooklyn Bridge"
                  value={destination}
                  onChange={(e) => setDestination(e.target.value)}
                />
              </div>
            </div>

            <div className="md:col-span-2 relative group">
              <div className="flex gap-2 mb-2 ml-1">
                <button
                  type="button"
                  onClick={() => setTimeMode("depart_at")}
                  className={`text-[10px] font-mono uppercase tracking-widest px-2 py-1 rounded transition-colors ${timeMode === "depart_at" ? "bg-orange-500/20 text-orange-400" : "text-slate-500 hover:text-slate-300"}`}
                >
                  Depart At
                </button>
                <button
                  type="button"
                  onClick={() => setTimeMode("arrive_by")}
                  className={`text-[10px] font-mono uppercase tracking-widest px-2 py-1 rounded transition-colors ${timeMode === "arrive_by" ? "bg-emerald-500/20 text-emerald-400" : "text-slate-500 hover:text-slate-300"}`}
                >
                  Arrive By
                </button>
              </div>
              <div className="relative">
                <CalendarDays className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 group-focus-within:text-orange-500 transition-colors" />
                <input
                  type="datetime-local"
                  className="w-full bg-[#050508] border border-white/10 rounded-xl py-3.5 pl-11 pr-2 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500 text-white placeholder-slate-600 transition-all font-medium text-xs md:text-sm appearance-none"
                  value={targetTime}
                  onChange={(e) => setTargetTime(e.target.value)}
                />
              </div>
            </div>

            <div className="md:col-span-2">
              <button
                type="submit"
                disabled={loading}
                className={`w-full h-[52px] bg-gradient-to-r from-orange-600 to-red-600 hover:from-orange-500 hover:to-red-500 disabled:from-slate-800 disabled:to-slate-800 text-white font-bold uppercase tracking-widest text-[11px] rounded-xl transition-all flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(234,88,12,0.3)] hover:shadow-[0_0_30px_rgba(234,88,12,0.5)] disabled:shadow-none ${loading ? "animate-pulse-glow" : ""}`}
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <Cpu className="w-4 h-4 animate-spin" /> Computing
                  </span>
                ) : (
                  <>Run Engine</>
                )}
              </button>
            </div>
          </div>
        </form>

        {error && (
          <div className="animate-slide-up bg-red-950/40 border border-red-500/30 text-red-200 p-4 rounded-xl mb-8 flex items-center gap-4 shadow-lg backdrop-blur-md">
            <div className="bg-red-500/20 p-2 rounded-lg">
              <AlertTriangle className="w-5 h-5 text-red-500" />
            </div>
            <p className="font-mono text-sm">{error}</p>
          </div>
        )}

        {results.length > 0 && (
          <div className="space-y-8 animate-slide-up">
            {metaData && (
              <div
                className={`border rounded-lg px-4 py-3 flex items-center gap-3 backdrop-blur-md animate-fade ${metaData.mode === "arrive_by" ? "bg-emerald-950/20 border-emerald-500/30" : "bg-[#0c0d16]/80 border-orange-500/30"}`}
              >
                <Clock
                  className={`w-5 h-5 ${metaData.mode === "arrive_by" ? "text-emerald-500" : "text-orange-500"}`}
                />
                <span className="text-xs text-slate-300 uppercase tracking-widest font-mono">
                  {metaData.mode === "arrive_by"
                    ? "Target Arrival: "
                    : "Departure Base: "}
                  <span className="text-white font-bold ml-1">
                    {metaData.targetStr}
                  </span>
                </span>
              </div>
            )}

            <div className="glass-panel rounded-2xl overflow-hidden shadow-2xl shadow-black">
              <div className="bg-white/[0.02] px-6 py-4 border-b border-white/5 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <span className="text-[11px] font-mono bg-black border border-white/10 text-slate-300 px-3 py-1.5 rounded-md">
                    Simulation Route {activeRouteIdx + 1} / {results.length}
                  </span>
                  {activeRouteIdx === 0 && (
                    <span className="bg-emerald-500/10 text-emerald-400 text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 rounded-md border border-emerald-500/30 flex items-center gap-1.5 drop-shadow-[0_0_8px_rgba(16,185,129,0.5)]">
                      <CheckCircle className="w-3.5 h-3.5" /> Optimal Vector
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={prevRoute}
                    className="p-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/5 text-slate-300 transition-all hover:scale-105 active:scale-95"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    onClick={nextRoute}
                    className="p-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/5 text-slate-300 transition-all hover:scale-105 active:scale-95"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div
                key={activeRouteIdx}
                className="p-6 md:p-8 grid grid-cols-1 lg:grid-cols-12 gap-10 animate-fade"
              >
                <div className="lg:col-span-7">
                  <div className="mb-8">
                    <h3 className="text-3xl font-black text-white tracking-tight mb-2 drop-shadow-md">
                      {activeRoute.title}
                    </h3>
                  </div>

                  <div className="mb-6 flex flex-col md:flex-row items-center gap-4 bg-gradient-to-r from-orange-500/10 to-emerald-500/10 p-5 rounded-xl border border-white/10">
                    <div className="flex-1 flex items-center gap-4 border-r border-white/10 pr-4">
                      <Clock className="w-6 h-6 text-orange-500" />
                      <div>
                        <span className="text-[10px] uppercase tracking-widest text-slate-500 font-mono block">
                          {metaData?.mode === "arrive_by"
                            ? "Required Departure (P90)"
                            : "Departure Time"}
                        </span>
                        <span className="font-bold text-white font-mono text-lg">
                          {activeRoute.metrics.req_departure_time}
                        </span>
                      </div>
                    </div>
                    <div className="flex-1 flex items-center justify-end gap-4 pl-4">
                      <div className="text-right">
                        <span className="text-[10px] uppercase tracking-widest text-slate-500 font-mono block">
                          Est. Final Arrival
                        </span>
                        <span className="font-bold text-emerald-400 font-mono text-lg">
                          {activeRoute.metrics.est_arrival_time}
                        </span>
                      </div>
                      <CheckCircle className="w-6 h-6 text-emerald-500" />
                    </div>
                  </div>

                  <div className="relative border-l-2 border-[#1f202e] ml-4 space-y-6">
                    {activeRoute.itinerary.map((step, sIdx) => (
                      <div key={sIdx} className="relative pl-8 group">
                        <div
                          className={`absolute -left-[9px] top-1.5 w-4 h-4 rounded-full bg-[#030305] border-2 z-10 transition-all ${step.mode === "ARRIVE" ? "border-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.8)]" : "border-slate-600 group-hover:border-orange-500 group-hover:shadow-[0_0_10px_rgba(234,88,12,0.8)]"}`}
                        />

                        <div
                          className={`bg-white/[0.02] p-4 rounded-xl border transition-all flex items-center justify-between ${step.mode === "ARRIVE" ? "border-emerald-500/30 bg-emerald-950/20" : "border-white/5 group-hover:border-white/10 group-hover:bg-white/[0.04]"}`}
                        >
                          <div className="flex items-center gap-4">
                            <div className="bg-black/50 p-2 rounded-lg border border-white/5">
                              {getModeIcon(step.mode)}
                            </div>
                            <div>
                              <span
                                className={`font-bold text-sm block ${step.mode === "ARRIVE" ? "text-emerald-400" : "text-slate-100"}`}
                              >
                                {step.line_display}
                              </span>

                              {step.mode === "TRANSIT" ? (
                                <span className="text-slate-400 font-mono text-[11px] mt-1 flex items-center gap-2">
                                  <span className="text-orange-400 font-bold">
                                    Wait: ~{step.expected_wait_mins}m
                                  </span>
                                  <span>•</span>
                                  <span className="text-emerald-400">
                                    Board: {step.expected_board_time}
                                  </span>
                                </span>
                              ) : step.mode === "ARRIVE" ? (
                                <span className="text-emerald-400 font-mono text-[11px] mt-1 block">
                                  Est. Arrival: {step.expected_board_time}
                                </span>
                              ) : (
                                <span className="text-slate-500 font-mono text-[11px] mt-1 block">
                                  Start: {step.expected_board_time}
                                </span>
                              )}
                            </div>
                          </div>

                          {step.mode !== "ARRIVE" && (
                            <div className="text-right">
                              <span className="text-white font-mono text-lg font-bold block">
                                {step.baseline_duration.toFixed(0)}m
                              </span>
                              <span className="text-[10px] uppercase tracking-widest text-slate-500">
                                Duration
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="lg:col-span-5">
                  <div className="bg-[#050508] rounded-2xl p-6 border border-white/10 shadow-inner h-full flex flex-col relative overflow-hidden">
                    <Activity className="absolute -right-10 -bottom-10 w-48 h-48 text-white/[0.02] pointer-events-none" />

                    <h4 className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-6 font-mono flex items-center gap-2">
                      <Zap className="w-4 h-4 text-orange-500" /> Statistical
                      Telemetry
                    </h4>

                    <div className="grid grid-cols-2 gap-4 mb-6">
                      <div className="bg-white/[0.03] p-4 rounded-xl border border-white/5 relative overflow-hidden group hover:border-emerald-500/30 transition-colors">
                        <div className="absolute top-0 left-0 w-full h-1 bg-emerald-500/20 group-hover:bg-emerald-500/50 transition-colors" />
                        <span className="text-[10px] uppercase tracking-widest text-slate-500 block mb-1 font-mono">
                          Win Rate
                        </span>
                        <span className="text-4xl font-black text-emerald-400 drop-shadow-[0_0_10px_rgba(52,211,153,0.3)]">
                          {activeRoute.metrics.win_rate}%
                        </span>
                      </div>
                      <div className="bg-white/[0.03] p-4 rounded-xl border border-white/5 relative overflow-hidden group hover:border-white/20 transition-colors">
                        <div className="absolute top-0 left-0 w-full h-1 bg-white/10 group-hover:bg-white/20 transition-colors" />
                        <span className="text-[10px] uppercase tracking-widest text-slate-500 block mb-1 font-mono">
                          Typical (P50)
                        </span>
                        <span className="text-4xl font-black text-white">
                          {activeRoute.metrics.p50_mins}
                        </span>
                        <span className="text-slate-500 font-mono text-sm ml-1">
                          m
                        </span>
                      </div>
                    </div>

                    <div className="space-y-1 mt-auto">
                      <div className="flex justify-between items-center py-3 border-b border-white/5 group hover:bg-white/[0.02] px-2 rounded transition-colors">
                        <span className="text-xs text-slate-400 uppercase tracking-wider">
                          Budgeted (P90)
                        </span>
                        <span className="font-mono font-bold text-amber-500 drop-shadow-[0_0_5px_rgba(245,158,11,0.5)]">
                          {activeRoute.metrics.p90_mins}m
                        </span>
                      </div>
                      <div className="flex justify-between items-center py-3 border-b border-white/5 group hover:bg-white/[0.02] px-2 rounded transition-colors">
                        <span className="text-xs text-slate-400 uppercase tracking-wider">
                          Predictability (IQR)
                        </span>
                        <span className="font-mono font-bold text-purple-400 drop-shadow-[0_0_5px_rgba(168,85,247,0.5)]">
                          ±{activeRoute.metrics.iqr_mins}m
                        </span>
                      </div>
                      <div className="flex justify-between items-center py-3 border-b border-white/5 group hover:bg-white/[0.02] px-2 rounded transition-colors">
                        <span className="text-xs text-slate-400 uppercase tracking-wider">
                          Operating Cost
                        </span>
                        <span className="font-mono font-bold text-emerald-400">
                          ${activeRoute.cost.toFixed(2)}
                        </span>
                      </div>
                      <div className="flex justify-between items-center py-3 px-2">
                        <span className="text-xs text-slate-400 uppercase tracking-wider">
                          Time Envelope
                        </span>
                        <span className="text-slate-300 font-mono text-xs bg-black px-2 py-1 rounded border border-white/10">
                          {activeRoute.metrics.best_time}m{" "}
                          <span className="text-slate-600 mx-1">→</span>{" "}
                          {activeRoute.metrics.worst_time}m
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* MATRIX ANALYTICS TABLE WITH VISUAL SPREAD */}
            <div className="glass-panel rounded-2xl overflow-hidden shadow-2xl mt-8">
              <div className="px-6 py-5 border-b border-white/5 bg-black/40">
                <h3 className="text-xs font-bold uppercase tracking-widest text-slate-300 font-mono flex items-center gap-3">
                  <Activity className="w-4 h-4 text-orange-500" /> Matrix
                  Analytics Overview
                </h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm whitespace-nowrap">
                  <thead>
                    <tr className="bg-black/20 text-slate-400 border-b border-white/5 font-mono text-[10px] uppercase tracking-widest">
                      <th className="py-4 px-6 font-semibold">Rank</th>
                      <th className="py-4 px-6 font-semibold">
                        Route Signature
                      </th>
                      <th className="py-4 px-6 font-semibold text-center">
                        {metaData?.mode === "arrive_by"
                          ? "Req. Departure"
                          : "Win Rate"}
                      </th>
                      <th className="py-4 px-6 font-semibold text-center">
                        Typical (P50)
                      </th>
                      <th className="py-4 px-6 font-semibold text-center">
                        Budget (P90)
                      </th>
                      <th className="py-4 px-6 font-semibold text-center hidden md:table-cell">
                        Time Spread (Min → Max)
                      </th>
                      <th className="py-4 px-6 font-semibold text-center">
                        Risk / Early
                      </th>
                      <th className="py-4 px-6 font-semibold text-right">
                        Cost
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {results.map((route, idx) => {
                      const bestPct = Math.min(
                        (route.metrics.best_time / MAX_CHART_MINS) * 100,
                        100,
                      );
                      const worstPct = Math.min(
                        (route.metrics.worst_time / MAX_CHART_MINS) * 100,
                        100,
                      );
                      const p25Pct = Math.min(
                        (route.metrics.p25_mins / MAX_CHART_MINS) * 100,
                        100,
                      );
                      const p75Pct = Math.min(
                        (route.metrics.p75_mins / MAX_CHART_MINS) * 100,
                        100,
                      );
                      const p50Pct = Math.min(
                        (route.metrics.p50_mins / MAX_CHART_MINS) * 100,
                        100,
                      );

                      return (
                        <tr
                          key={idx}
                          onClick={() => setActiveRouteIdx(idx)}
                          className={`cursor-pointer transition-all duration-200 ${
                            idx === activeRouteIdx
                              ? "bg-orange-500/10 border-l-2 border-l-orange-500"
                              : "hover:bg-white/[0.03] border-l-2 border-l-transparent"
                          }`}
                        >
                          <td className="py-4 px-6">
                            {idx === 0 ? (
                              <span className="bg-emerald-500/20 text-emerald-400 font-mono text-[10px] px-2 py-1 rounded border border-emerald-500/30 font-bold">
                                OPTIMAL
                              </span>
                            ) : (
                              <span className="font-mono text-slate-500 font-bold ml-2">
                                #{idx + 1}
                              </span>
                            )}
                          </td>
                          <td className="py-4 px-6">
                            <div className="font-sans font-bold text-slate-200 truncate max-w-[200px] sm:max-w-xs lg:max-w-md">
                              {route.title}
                            </div>
                          </td>
                          <td className="py-4 px-6 text-center">
                            {metaData?.mode === "arrive_by" ? (
                              <span className="font-mono font-bold text-orange-400 bg-orange-400/10 px-2 py-1 rounded">
                                {route.metrics.req_departure_time}
                              </span>
                            ) : (
                              <span className="font-mono font-bold text-emerald-400 bg-emerald-400/10 px-2 py-1 rounded">
                                {route.metrics.win_rate}%
                              </span>
                            )}
                          </td>
                          <td className="py-4 px-6 text-center font-mono text-slate-200">
                            {route.metrics.p50_mins}m
                          </td>
                          <td className="py-4 px-6 text-center font-mono text-amber-500">
                            {route.metrics.p90_mins}m
                          </td>

                          <td className="py-4 px-6 w-48 hidden md:table-cell">
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-mono text-slate-500 w-6 text-right">
                                {route.metrics.best_time.toFixed(0)}
                              </span>
                              <div className="relative w-full h-1.5 bg-white/5 rounded-full overflow-visible">
                                <div
                                  className="absolute h-full bg-slate-600/50 rounded-full"
                                  style={{
                                    left: `${bestPct}%`,
                                    right: `${100 - worstPct}%`,
                                  }}
                                />
                                <div
                                  className={`absolute h-1.5 top-0 rounded-full ${route.metrics.severe_risk > 25 ? "bg-gradient-to-r from-orange-500 to-red-500" : "bg-gradient-to-r from-emerald-500 to-orange-400"}`}
                                  style={{
                                    left: `${p25Pct}%`,
                                    right: `${100 - p75Pct}%`,
                                  }}
                                />
                                <div
                                  className="absolute w-1 h-3 bg-white rounded-sm -top-[3px] shadow-[0_0_5px_rgba(255,255,255,0.8)]"
                                  style={{
                                    left: `${p50Pct}%`,
                                    transform: "translateX(-50%)",
                                  }}
                                />
                              </div>
                              <span className="text-[10px] font-mono text-slate-500 w-6">
                                {route.metrics.worst_time.toFixed(0)}
                              </span>
                            </div>
                          </td>

                          <td className="py-4 px-6 text-center font-mono">
                            <div className="flex flex-col gap-1 items-center">
                              <span
                                className={
                                  route.metrics.severe_risk > 25
                                    ? "text-red-400 font-bold drop-shadow-[0_0_5px_rgba(248,113,113,0.5)]"
                                    : "text-slate-400"
                                }
                              >
                                {route.metrics.severe_risk}%
                              </span>
                              <span className="text-[9px] text-emerald-400 opacity-80">
                                {route.metrics.early_prob}%
                              </span>
                            </div>
                          </td>
                          <td className="py-4 px-6 text-right font-mono font-semibold text-slate-300">
                            ${route.cost.toFixed(2)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
