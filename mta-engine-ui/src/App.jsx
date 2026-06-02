import React, { useState } from "react";
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
  Clock,
  DollarSign,
  Activity,
} from "lucide-react";

export default function App() {
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState([]);
  const [error, setError] = useState("");

  // Tracks which route option is actively displayed in the hero view
  const [activeRouteIdx, setActiveRouteIdx] = useState(0);

  const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

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

      if (!res.ok) throw new Error("Simulation failed or no routes found.");
      const data = await res.json();

      // Sort by Win Rate highest first
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
    if (mode === "CITIBIKE") return <Bike className="w-4 h-4 text-blue-400" />;
    if (mode === "WALK")
      return <Footprints className="w-4 h-4 text-slate-400" />;
    return <Train className="w-4 h-4 text-orange-400" />;
  };

  const nextRoute = () => {
    setActiveRouteIdx((prev) => (prev + 1) % results.length);
  };

  const prevRoute = () => {
    setActiveRouteIdx((prev) => (prev - 1 + results.length) % results.length);
  };

  const activeRoute = results[activeRouteIdx];

  return (
    <div className="min-h-screen bg-[#07080e] text-slate-100 font-sans antialiased">
      {/* TOP LIVE STATUS TICKER */}
      <div className="w-full bg-[#0d0e16] border-b border-slate-900 px-4 py-2 flex items-center justify-between text-xs tracking-wider text-slate-400 overflow-hidden whitespace-nowrap">
        <div className="flex items-center gap-6 animate-marquee">
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping"></span>{" "}
            FEEDS ONLINE
          </span>
          <span className="text-slate-600">|</span>
          <span>N/Q/R/W • DELAYS DUE TO EARLIER INCIDENT</span>
          <span className="text-slate-600">|</span>
          <span>L • GOOD SERVICE</span>
          <span className="text-slate-600">|</span>
          <span>G • GOOD SERVICE</span>
          <span className="text-slate-600">|</span>
          <span>B/D/F/M • MODERATE DELAYS</span>
        </div>
        <div className="bg-[#131522] px-2 py-0.5 rounded text-[10px] font-mono text-slate-500 border border-slate-800 hidden md:block">
          V8.0 • HYBRID SCHEDULING
        </div>
      </div>

      <div className="max-w-6xl mx-auto p-4 md:p-8">
        {/* HERO HEADER */}
        <header className="mb-8 mt-4">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-bold tracking-widest text-orange-500 uppercase bg-orange-500/10 px-2.5 py-1 rounded">
              Route Intelligence
            </span>
          </div>
          <h1 className="text-4xl font-extrabold tracking-tight text-white uppercase">
            New York City
          </h1>
          <p className="text-sm text-slate-400 mt-1 font-mono">
            5,000-trial Monte Carlo simulation • Live MTA telemetry •
            Butterfly-effect transfer modeling
          </p>
        </header>

        {/* INPUT CONFIGURATOR CARD */}
        <form
          onSubmit={handleSimulate}
          className="bg-[#0c0d16] p-6 rounded-xl border border-slate-800 shadow-2xl mb-8"
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
                Origin Point
              </label>
              <div className="relative">
                <MapPin className="absolute left-3 top-3.5 w-4 h-4 text-slate-500" />
                <input
                  type="text"
                  required
                  className="w-full bg-[#121320] border border-slate-800 rounded-lg py-3 pl-10 pr-4 focus:outline-none focus:border-orange-500 text-slate-100 placeholder-slate-600 transition-colors text-sm"
                  placeholder="e.g., Grand Central Terminal, NYC"
                  value={origin}
                  onChange={(e) => setOrigin(e.target.value)}
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
                Destination Point
              </label>
              <div className="relative">
                <MapPin className="absolute left-3 top-3.5 w-4 h-4 text-slate-500" />
                <input
                  type="text"
                  required
                  className="w-full bg-[#121320] border border-slate-800 rounded-lg py-3 pl-10 pr-4 focus:outline-none focus:border-orange-500 text-slate-100 placeholder-slate-600 transition-colors text-sm"
                  placeholder="e.g., Brooklyn Bridge, NYC"
                  value={destination}
                  onChange={(e) => setDestination(e.target.value)}
                />
              </div>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full md:w-auto px-6 py-3 bg-[#d97736] hover:bg-[#c2652a] disabled:bg-slate-800 text-white font-bold uppercase tracking-wider text-xs rounded transition-all flex items-center justify-center gap-2 shadow-lg shadow-orange-950/20"
          >
            {loading ? (
              <span className="animate-pulse">Processing 5,000 runs...</span>
            ) : (
              <>
                Run Simulation <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>

        {/* ERROR BOX */}
        {error && (
          <div className="bg-red-950/20 border border-red-900/50 text-red-300 p-4 rounded-lg mb-8 flex items-center gap-3 text-sm font-mono">
            <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0" />
            <p>{error}</p>
          </div>
        )}

        {/* RESULTS INTERACTION HUB */}
        {results.length > 0 && (
          <div className="space-y-8">
            {/* INTERACTIVE ROUTE CAROUSEL (HERO VIEW) */}
            <div className="bg-[#0c0d16] rounded-xl border border-slate-800 shadow-2xl overflow-hidden">
              {/* Carousel Control Bar */}
              <div className="bg-[#11121e] px-6 py-4 border-b border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-mono bg-slate-800 text-slate-300 px-2 py-1 rounded">
                    Option {activeRouteIdx + 1} of {results.length}
                  </span>
                  {activeRouteIdx === 0 && (
                    <span className="bg-emerald-500/10 text-emerald-400 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded border border-emerald-500/20 flex items-center gap-1">
                      <CheckCircle className="w-3 h-3" /> Stochastic Best Match
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={prevRoute}
                    className="p-1.5 rounded bg-[#181a2b] hover:bg-slate-700 border border-slate-800 text-slate-300 transition-colors"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    onClick={nextRoute}
                    className="p-1.5 rounded bg-[#181a2b] hover:bg-slate-700 border border-slate-800 text-slate-300 transition-colors"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Active Route Body Content */}
              <div className="p-6 grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Itinerary Structure */}
                <div className="lg:col-span-2 space-y-4">
                  <div>
                    <h3 className="text-2xl font-bold text-white tracking-tight mb-1">
                      {activeRoute.title}
                    </h3>
                    <p className="text-xs text-slate-400 italic font-mono">
                      {activeRoute.explanation}
                    </p>
                  </div>

                  <div className="relative border-l-2 border-slate-800 pl-4 ml-2 my-4 space-y-4">
                    {activeRoute.itinerary.map((step, sIdx) => (
                      <div key={sIdx} className="relative group">
                        {/* Bullet point node locator */}
                        <div className="absolute -left-[23px] top-1 bg-[#0c0d16] p-0.5 rounded-full border border-slate-700">
                          <div className="w-2 h-2 rounded-full bg-slate-500 group-hover:bg-orange-500 transition-colors"></div>
                        </div>

                        <div className="flex items-center justify-between bg-[#121320] p-3 rounded-lg border border-slate-800/60 hover:border-slate-700/80 transition-colors">
                          <div className="flex items-center gap-3 text-xs">
                            {getModeIcon(step.mode)}
                            <div>
                              <span className="font-semibold text-slate-200">
                                {step.mode === "WALK"
                                  ? "Walk Vector"
                                  : step.line_display}
                              </span>
                              {step.departure_stop !== "N/A" && (
                                <span className="text-slate-500 block text-[11px] mt-0.5">
                                  from {step.departure_stop}
                                </span>
                              )}
                            </div>
                          </div>
                          <span className="text-slate-400 font-mono text-xs bg-[#191a2a] px-2 py-0.5 rounded border border-slate-800">
                            {step.baseline_duration.toFixed(0)}m
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Deep Telemetry Analytics Panel */}
                <div className="bg-[#11121e] rounded-xl p-5 border border-slate-800/80 flex flex-col justify-between gap-4">
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3 font-mono">
                      Performance Telemetry
                    </h4>

                    <div className="grid grid-cols-2 gap-3 mb-4">
                      <div className="bg-[#161829] p-3 rounded border border-slate-800 text-center">
                        <span className="text-[10px] uppercase tracking-wider text-slate-500 block mb-0.5 font-mono">
                          Win Rate
                        </span>
                        <span className="text-2xl font-black text-emerald-400 font-mono">
                          {activeRoute.metrics.win_rate}%
                        </span>
                      </div>
                      <div className="bg-[#161829] p-3 rounded border border-slate-800 text-center">
                        <span className="text-[10px] uppercase tracking-wider text-slate-500 block mb-0.5 font-mono">
                          Exp Duration
                        </span>
                        <span className="text-2xl font-black text-slate-200 font-mono">
                          {activeRoute.metrics.exp_time}m
                        </span>
                      </div>
                    </div>

                    <div className="space-y-2 text-xs font-mono">
                      <div className="flex justify-between py-1.5 border-b border-slate-800/50">
                        <span className="text-slate-500">
                          Severe Delay Risk (&gt;20m)
                        </span>
                        <span
                          className={`font-semibold ${activeRoute.metrics.severe_risk > 25 ? "text-red-400" : "text-slate-300"}`}
                        >
                          {activeRoute.metrics.severe_risk}%
                        </span>
                      </div>
                      <div className="flex justify-between py-1.5 border-b border-slate-800/50">
                        <span className="text-slate-500">
                          Missed Transfer Prob
                        </span>
                        <span className="font-semibold text-orange-400">
                          {activeRoute.metrics.miss_prob}%
                        </span>
                      </div>
                      <div className="flex justify-between py-1.5 border-b border-slate-800/50">
                        <span className="text-slate-500">
                          Est. Operating Cost
                        </span>
                        <span className="font-semibold text-slate-300">
                          ${activeRoute.cost.toFixed(2)}
                        </span>
                      </div>
                      <div className="flex justify-between py-1.5">
                        <span className="text-slate-500">
                          Variance Envelope
                        </span>
                        <span className="text-slate-400 text-[11px]">
                          {activeRoute.metrics.best_time}m -{" "}
                          {activeRoute.metrics.worst_time}m
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* COMPARATIVE ANALYSIS TABLE */}
            <div className="bg-[#0c0d16] rounded-xl border border-slate-800 shadow-2xl overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-800 bg-[#11121e]">
                <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300 font-mono flex items-center gap-2">
                  <Activity className="w-4 h-4 text-orange-500" /> Simulated
                  Matrix Analytics
                </h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs font-mono">
                  <thead>
                    <tr className="bg-[#121322] text-slate-400 border-b border-slate-800 uppercase tracking-wider text-[10px]">
                      <th className="py-3 px-4">Index</th>
                      <th className="py-3 px-4">Route Architecture</th>
                      <th className="py-3 px-4 text-center">Win Rate</th>
                      <th className="py-3 px-4 text-center">Exp. Time</th>
                      <th className="py-3 px-4 text-center">Severe Risk</th>
                      <th className="py-3 px-4 text-center">Transfer Miss</th>
                      <th className="py-3 px-4 text-right">Cost</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-900">
                    {results.map((route, idx) => (
                      <tr
                        key={idx}
                        onClick={() => setActiveRouteIdx(idx)}
                        className={`cursor-pointer transition-colors ${idx === activeRouteIdx ? "bg-orange-500/5 text-white font-semibold" : "text-slate-400 hover:bg-slate-900/40"}`}
                      >
                        <td className="py-3.5 px-4 font-bold text-slate-500">
                          {idx === 0 ? "🏆 #1" : `#${idx + 1}`}
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="font-sans font-bold text-slate-200 text-sm truncate max-w-xs sm:max-w-md">
                            {route.title}
                          </div>
                        </td>
                        <td className="py-3.5 px-4 text-center font-bold text-emerald-400 text-sm">
                          {route.metrics.win_rate}%
                        </td>
                        <td className="py-3.5 px-4 text-center text-slate-200 text-sm">
                          {route.metrics.exp_time}m
                        </td>
                        <td
                          className={`py-3.5 px-4 text-center ${route.metrics.severe_risk > 25 ? "text-red-400" : "text-slate-400"}`}
                        >
                          {route.metrics.severe_risk}%
                        </td>
                        <td className="py-3.5 px-4 text-center text-orange-400">
                          {route.metrics.miss_prob}%
                        </td>
                        <td className="py-3.5 px-4 text-right text-slate-300 font-sans font-semibold">
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
