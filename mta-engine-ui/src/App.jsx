import React, { useState } from "react";
import {
  MapPin,
  ArrowRight,
  Train,
  Bike,
  Footprints,
  AlertTriangle,
  CheckCircle,
} from "lucide-react";

export default function App() {
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState([]);
  const [error, setError] = useState("");

  // Resolves the live backend URL from Vite environment variables on Render, or falls back to localhost
  const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

  const handleSimulate = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setResults([]);

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
    if (mode === "CITIBIKE") return <Bike className="w-5 h-5 text-blue-400" />;
    if (mode === "WALK")
      return <Footprints className="w-5 h-5 text-gray-400" />;
    return <Train className="w-5 h-5 text-orange-400" />;
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 p-6 font-sans">
      <div className="max-w-5xl mx-auto">
        {/* HEADER */}
        <header className="mb-10 text-center">
          <h1 className="text-4xl font-bold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-orange-400 to-red-500 mb-2">
            MTA Stochastic Engine
          </h1>
          <p className="text-slate-400">
            Monte Carlo Route Simulation & Live Telemetry
          </p>
        </header>

        {/* INPUT FORM */}
        <form
          onSubmit={handleSimulate}
          className="bg-slate-800 p-6 rounded-2xl shadow-xl mb-10 flex flex-col md:flex-row gap-4 items-end border border-slate-700"
        >
          <div className="flex-1 w-full">
            <label className="block text-sm font-medium text-slate-400 mb-1">
              Origin
            </label>
            <div className="relative">
              <MapPin className="absolute left-3 top-3 w-5 h-5 text-slate-500" />
              <input
                type="text"
                required
                className="w-full bg-slate-900 border border-slate-700 rounded-lg py-2.5 pl-10 pr-4 focus:outline-none focus:ring-2 focus:ring-orange-500 text-slate-100 placeholder-slate-600"
                placeholder="e.g., Windsor Terrace, Brooklyn"
                value={origin}
                onChange={(e) => setOrigin(e.target.value)}
              />
            </div>
          </div>

          <div className="flex-1 w-full">
            <label className="block text-sm font-medium text-slate-400 mb-1">
              Destination
            </label>
            <div className="relative">
              <MapPin className="absolute left-3 top-3 w-5 h-5 text-slate-500" />
              <input
                type="text"
                required
                className="w-full bg-slate-900 border border-slate-700 rounded-lg py-2.5 pl-10 pr-4 focus:outline-none focus:ring-2 focus:ring-orange-500 text-slate-100 placeholder-slate-600"
                placeholder="e.g., Times Square, Manhattan"
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full md:w-auto px-8 py-2.5 bg-orange-600 hover:bg-orange-500 disabled:bg-slate-700 text-white font-semibold rounded-lg shadow-lg transition-colors flex items-center justify-center gap-2"
          >
            {loading ? (
              <span className="animate-pulse">Simulating 5,000 runs...</span>
            ) : (
              <>
                Simulate <ArrowRight className="w-5 h-5" />
              </>
            )}
          </button>
        </form>

        {/* ERROR STATE */}
        {error && (
          <div className="bg-red-900/30 border border-red-500/50 text-red-200 p-4 rounded-lg mb-8 flex items-center gap-3">
            <AlertTriangle className="w-6 h-6 text-red-400" />
            <p>{error}</p>
          </div>
        )}

        {/* RESULTS GRID */}
        {results.length > 0 && (
          <div className="space-y-6">
            <h2 className="text-2xl font-semibold mb-4 text-slate-200 border-b border-slate-700 pb-2">
              Simulation Results
            </h2>

            {results.map((route, idx) => (
              <div
                key={idx}
                className="bg-slate-800 rounded-2xl p-6 border border-slate-700 shadow-xl relative overflow-hidden"
              >
                {/* Win Badge for top result */}
                {idx === 0 && (
                  <div className="absolute top-0 right-0 bg-green-500 text-slate-900 text-xs font-bold px-4 py-1 rounded-bl-lg flex items-center gap-1">
                    <CheckCircle className="w-3 h-3" /> BEST OPTION
                  </div>
                )}

                <div className="flex flex-col lg:flex-row gap-8">
                  {/* Left Column: Route Meta */}
                  <div className="flex-1">
                    <h3 className="text-xl font-bold text-orange-400 mb-2 truncate">
                      {route.title}
                    </h3>
                    <p className="text-sm text-slate-400 mb-6 italic">
                      {route.explanation}
                    </p>

                    <div className="space-y-3">
                      {route.itinerary.map((step, sIdx) => (
                        <div
                          key={sIdx}
                          className="flex items-center gap-3 text-sm bg-slate-900/50 p-2.5 rounded-lg border border-slate-700/50"
                        >
                          {getModeIcon(step.mode)}
                          <div className="flex-1">
                            <span className="font-semibold text-slate-200">
                              {step.mode === "WALK"
                                ? "Walk"
                                : step.line_display}
                            </span>
                            {step.departure_stop !== "N/A" && (
                              <span className="text-slate-500 ml-2">
                                from {step.departure_stop}
                              </span>
                            )}
                          </div>
                          <span className="text-slate-400 bg-slate-800 px-2 py-1 rounded text-xs">
                            {step.baseline_duration.toFixed(0)}m
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Right Column: Telemetry & Metrics */}
                  <div className="lg:w-1/3 flex flex-col justify-center gap-4 border-t lg:border-t-0 lg:border-l border-slate-700 pt-6 lg:pt-0 lg:pl-8">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-slate-900 p-4 rounded-xl border border-slate-700 flex flex-col items-center justify-center text-center">
                        <span className="text-slate-400 text-xs uppercase tracking-wider mb-1">
                          Win Rate
                        </span>
                        <span className="text-3xl font-bold text-green-400">
                          {route.metrics.win_rate}%
                        </span>
                      </div>

                      <div className="bg-slate-900 p-4 rounded-xl border border-slate-700 flex flex-col items-center justify-center text-center">
                        <span className="text-slate-400 text-xs uppercase tracking-wider mb-1">
                          Exp Time
                        </span>
                        <span className="text-2xl font-bold text-slate-200">
                          {route.metrics.exp_time}m
                        </span>
                      </div>
                    </div>

                    <div className="bg-slate-900 rounded-xl border border-slate-700 p-4 text-sm">
                      <div className="flex justify-between items-center mb-2 pb-2 border-b border-slate-800">
                        <span className="text-slate-400">Total Cost</span>
                        <span className="font-semibold text-slate-200">
                          ${route.cost.toFixed(2)}
                        </span>
                      </div>
                      <div className="flex justify-between items-center mb-2 pb-2 border-b border-slate-800">
                        <span className="text-slate-400">
                          Severe Delay Risk (&gt;20m)
                        </span>
                        <span className="font-semibold text-red-400">
                          {route.metrics.severe_risk}%
                        </span>
                      </div>
                      <div className="flex justify-between items-center mb-2 pb-2 border-b border-slate-800">
                        <span className="text-slate-400">
                          Missed Transfer Prob
                        </span>
                        <span className="font-semibold text-orange-400">
                          {route.metrics.miss_prob}%
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-slate-400">
                          Range (Best - Worst)
                        </span>
                        <span className="font-mono text-slate-300 text-xs">
                          {route.metrics.best_time}m -{" "}
                          {route.metrics.worst_time}m
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
