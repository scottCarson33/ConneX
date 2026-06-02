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
} from "lucide-react";

export default function App() {
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState([]);
  const [error, setError] = useState("");
  const [activeRouteIdx, setActiveRouteIdx] = useState(0);
  const [serviceStatus, setServiceStatus] = useState([]);

  const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/service-status`);
        if (res.ok) {
          const data = await res.json();
          setServiceStatus(data.data);
        }
      } catch (err) {
        console.error("Failed to fetch service status:", err);
      }
    };
    fetchStatus();
    const interval = setInterval(fetchStatus, 60000); // refresh every minute
    return () => clearInterval(interval);
  }, [API_BASE_URL]);

  const handleSimulate = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setResults([]);
    setActiveRouteIdx(0);

    try {
      const res = await fetch(`${API_BASE_URL}/api/simulate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ origin, destination }),
      });

      if (!res.ok)
        throw new Error("Telemetry feed offline or simulation failed.");
      const data = await res.json();

      const sorted = data.data.sort(
        (a, b) => b.metrics.win_rate - a.metrics.win_rate,
      );
      setResults(sorted);
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
    return (
      <Train className="w-5 h-5 text-orange-500 drop-shadow-[0_0_8px_rgba(249,115,22,0.8)]" />
    );
  };

  const nextRoute = () =>
    setActiveRouteIdx((prev) => (prev + 1) % results.length);
  const prevRoute = () =>
    setActiveRouteIdx((prev) => (prev - 1 + results.length) % results.length);

  const activeRoute = results[activeRouteIdx];

  return (
    <div className="min-h-screen bg-[#030305] text-slate-100 font-sans antialiased relative overflow-x-hidden selection:bg-orange-500/30">
      {/* Animated Background Grid */}
      <div className="fixed inset-0 bg-grid pointer-events-none z-0 opacity-50" />

      {/* Ambient Top Glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[300px] bg-orange-600/10 blur-[120px] rounded-full pointer-events-none z-0" />

      {/* TOP LIVE STATUS TICKER */}
      <div className="relative z-10 w-full bg-[#0a0a0f] border-b border-white/5 py-2.5 overflow-hidden flex items-center shadow-lg shadow-black/50">
        <div className="absolute left-0 top-0 bottom-0 w-16 bg-gradient-to-r from-[#0a0a0f] to-transparent z-20 pointer-events-none" />
        <div className="absolute right-0 top-0 bottom-0 w-16 bg-gradient-to-l from-[#0a0a0f] to-transparent z-20 pointer-events-none" />

        <div className="ticker-track animate-marquee flex items-center gap-8 text-[11px] font-mono tracking-widest text-slate-400 uppercase w-max px-8">
          {[...Array(3)].map((_, i) => (
            <React.Fragment key={i}>
              <span className="flex items-center gap-2 text-emerald-400">
                <div className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </div>
                System Online
              </span>
              <span>•</span>
              
              {serviceStatus.length > 0 ? (
                serviceStatus.map((status, idx) => {
                  let colorClass = "text-slate-400";
                  if (status.severity === "delay") colorClass = "text-orange-400";
                  else if (status.severity === "suspended") colorClass = "text-red-500";
                  else if (status.severity === "planned_work") colorClass = "text-yellow-400";
                  
                  return (
                    <React.Fragment key={idx}>
                      <span className={colorClass}>
                        {status.line_group}: {status.status}
                      </span>
                      <span>•</span>
                    </React.Fragment>
                  );
                })
              ) : (
                <>
                  <span>Connecting to MTA Feed...</span>
                  <span>•</span>
                </>
              )}
            </React.Fragment>
          ))}
        </div>
      </div>

      <div className="relative z-10 max-w-6xl mx-auto p-4 md:p-8 pt-10">
        {/* HERO HEADER */}
        <header className="mb-12 text-center md:text-left flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div>
            <div className="flex items-center justify-center md:justify-start gap-3 mb-3 animate-fade">
              <Cpu className="w-5 h-5 text-orange-500" />
              <span className="text-[10px] font-mono tracking-[0.2em] text-orange-500 uppercase border border-orange-500/30 bg-orange-500/10 px-3 py-1 rounded">
                V9.0 Stochastic Matrix
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
              <span className="text-white">Monte Carlo routing</span> • Live
              MTA telemetry active • Butterfly-effect transfer modeling
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
            <div className="md:col-span-5 relative group">
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

            <div className="md:col-span-4 relative group">
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

            <div className="md:col-span-2">
              <button
                type="submit"
                disabled={loading}
                className={`w-full h-[52px] bg-gradient-to-r from-orange-600 to-red-600 hover:from-orange-500 hover:to-red-500 disabled:from-slate-800 disabled:to-slate-800 text-white font-bold uppercase tracking-widest text-[11px] rounded-xl transition-all flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(234,88,12,0.3)] hover:shadow-[0_0_30px_rgba(234,88,12,0.5)] disabled:shadow-none ${loading ? "animate-pulse-glow" : ""}`}
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <Cpu className="w-4 h-4 animate-spin" /> Computing...
                  </span>
                ) : (
                  <>Run Engine</>
                )}
              </button>
            </div>
          </div>
        </form>

        {/* ERROR ALERT */}
        {error && (
          <div className="animate-slide-up bg-red-950/40 border border-red-500/30 text-red-200 p-4 rounded-xl mb-8 flex items-center gap-4 shadow-lg backdrop-blur-md">
            <div className="bg-red-500/20 p-2 rounded-lg">
              <AlertTriangle className="w-5 h-5 text-red-500" />
            </div>
            <p className="font-mono text-sm">{error}</p>
          </div>
        )}

        {/* RESULTS DASHBOARD */}
        {results.length > 0 && (
          <div className="space-y-8 animate-slide-up">
            {/* HERO CAROUSEL */}
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
                {/* Itinerary Column */}
                <div className="lg:col-span-7">
                  <div className="mb-8">
                    <h3 className="text-3xl font-black text-white tracking-tight mb-2 drop-shadow-md">
                      {activeRoute.title}
                    </h3>
                    <p className="text-sm text-slate-400 font-mono border-l-2 border-orange-500 pl-3">
                      {activeRoute.explanation}
                    </p>
                  </div>

                  <div className="relative border-l-2 border-[#1f202e] ml-4 space-y-6">
                    {activeRoute.itinerary.map((step, sIdx) => (
                      <div key={sIdx} className="relative pl-8 group">
                        <div className="absolute -left-[9px] top-1.5 w-4 h-4 rounded-full bg-[#030305] border-2 border-slate-600 group-hover:border-orange-500 group-hover:shadow-[0_0_10px_rgba(234,88,12,0.8)] transition-all z-10" />

                        <div className="bg-white/[0.02] p-4 rounded-xl border border-white/5 group-hover:border-white/10 group-hover:bg-white/[0.04] transition-all flex items-center justify-between">
                          <div className="flex items-center gap-4">
                            <div className="bg-black/50 p-2 rounded-lg border border-white/5">
                              {getModeIcon(step.mode)}
                            </div>
                            <div>
                              <span className="font-bold text-slate-100 text-sm block">
                                {step.mode === "WALK"
                                  ? "Pedestrian Vector"
                                  : step.line_display}
                              </span>
                              {step.departure_stop !== "N/A" && (
                                <span className="text-slate-500 font-mono text-[11px] mt-1 block">
                                  DEP: {step.departure_stop}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="text-right">
                            <span className="text-white font-mono text-lg font-bold block">
                              {step.baseline_duration.toFixed(0)}m
                            </span>
                            <span className="text-[10px] uppercase tracking-widest text-slate-500">
                              Duration
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Telemetry Column */}
                <div className="lg:col-span-5">
                  <div className="bg-[#050508] rounded-2xl p-6 border border-white/10 shadow-inner h-full flex flex-col relative overflow-hidden">
                    <Activity className="absolute -right-10 -bottom-10 w-48 h-48 text-white/[0.02] pointer-events-none" />

                    <h4 className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-6 font-mono flex items-center gap-2">
                      <Zap className="w-4 h-4 text-orange-500" /> Real-Time
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
                          Exp Time
                        </span>
                        <span className="text-4xl font-black text-white">
                          {activeRoute.metrics.exp_time}
                        </span>
                        <span className="text-slate-500 font-mono text-sm ml-1">
                          m
                        </span>
                      </div>
                    </div>

                    <div className="space-y-1 mt-auto">
                      <div className="flex justify-between items-center py-3 border-b border-white/5 group hover:bg-white/[0.02] px-2 rounded transition-colors">
                        <span className="text-xs text-slate-400 uppercase tracking-wider">
                          Severe Delay (&gt;20m)
                        </span>
                        <span
                          className={`font-mono font-bold ${activeRoute.metrics.severe_risk > 25 ? "text-red-500 drop-shadow-[0_0_5px_rgba(239,68,68,0.8)]" : "text-slate-200"}`}
                        >
                          {activeRoute.metrics.severe_risk}%
                        </span>
                      </div>
                      <div className="flex justify-between items-center py-3 border-b border-white/5 group hover:bg-white/[0.02] px-2 rounded transition-colors">
                        <span className="text-xs text-slate-400 uppercase tracking-wider">
                          Transfer Delay
                        </span>
                        <span className="font-mono font-bold text-orange-400 drop-shadow-[0_0_5px_rgba(251,146,60,0.5)]">
                          {activeRoute.metrics.transfer_delay_prob ?? activeRoute.metrics.miss_prob}%
                        </span>
                      </div>
                      <div className="flex justify-between items-center py-3 border-b border-white/5 group hover:bg-white/[0.02] px-2 rounded transition-colors">
                        <span className="text-xs text-slate-400 uppercase tracking-wider">
                          Beats Expected
                        </span>
                        <span className="font-mono font-bold text-emerald-300">
                          {activeRoute.metrics.early_prob}%
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

            {/* MATRIX ANALYTICS TABLE */}
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
                        Win Rate
                      </th>
                      <th className="py-4 px-6 font-semibold text-center">
                        Exp. Time
                      </th>
                      <th className="py-4 px-6 font-semibold text-center">
                        Risk Factor
                      </th>
                      <th className="py-4 px-6 font-semibold text-center">
                        Beats Exp.
                      </th>
                      <th className="py-4 px-6 font-semibold text-right">
                        Cost
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {results.map((route, idx) => (
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
                          <span className="font-mono font-bold text-emerald-400 bg-emerald-400/10 px-2 py-1 rounded">
                            {route.metrics.win_rate}%
                          </span>
                        </td>
                        <td className="py-4 px-6 text-center font-mono text-slate-300">
                          {route.metrics.exp_time}m
                        </td>
                        <td className="py-4 px-6 text-center font-mono">
                          <span
                            className={
                              route.metrics.severe_risk > 25
                                ? "text-red-400"
                                : "text-slate-500"
                            }
                          >
                            {route.metrics.severe_risk}%
                          </span>
                        </td>
                        <td className="py-4 px-6 text-center font-mono text-emerald-300">
                          {route.metrics.early_prob}%
                        </td>
                        <td className="py-4 px-6 text-right font-mono font-semibold text-slate-300">
                          ${route.cost.toFixed(2)}
                        </td>
                      </tr>
                    ))}
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
