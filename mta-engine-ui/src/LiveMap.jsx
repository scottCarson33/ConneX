import React, { useEffect, useRef } from "react";
import ImportedL from "leaflet";
import "leaflet/dist/leaflet.css";

// Use global window.L (which has L.maplibreGL attached from @maplibre/maplibre-gl-leaflet)
const getL = () => (typeof window !== "undefined" && window.L ? window.L : ImportedL);

// Lisbon city centre [lat, lng]
const LISBON_CENTER = [38.72, -9.14];

// Fallback coordinates [lat, lng] when a route has no encoded polylines
const KNOWN_PLACES = {
  "baixa-chiado": [38.7106, -9.1394],
  "cais do sodre": [38.706, -9.1446],
  "marques de pombal": [38.7253, -9.15],
  "sao sebastiao": [38.7343, -9.154],
  "oriente": [38.7678, -9.099],
  "praca do comercio": [38.7075, -9.1364],
  "terreiro do paco": [38.7075, -9.1335],
  "belem": [38.6975, -9.2066],
  "campo grande": [38.7597, -9.1577],
  "alameda": [38.7372, -9.1336],
  "rossio": [38.7139, -9.1394],
  "restauradores": [38.7154, -9.1414],
  "saldanha": [38.7347, -9.1449],
  "entrecampos": [38.748, -9.1486],
  "sete rios": [38.742, -9.1686],
  "jardim zoologico": [38.742, -9.1686],
  "santa apolonia": [38.7139, -9.1225],
  "roma-areeiro": [38.7446, -9.1339],
  "areeiro": [38.7425, -9.1336],
  "martim moniz": [38.7167, -9.1355],
  "cidade universitaria": [38.7516, -9.1585],
  "igot": [38.7498, -9.1566],
  "ikonik": [38.7452, -9.1476],
};

const geocodeCache = new Map();

function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function lookupKnown(name) {
  const n = normalize(name);
  if (!n) return null;
  for (const [key, coords] of Object.entries(KNOWN_PLACES)) {
    if (n.includes(key)) return coords;
  }
  return null;
}

async function geocode(name, signal) {
  const known = lookupKnown(name);
  if (known) return known;
  const key = normalize(name);
  if (!key || key === "n/a") return null;
  if (geocodeCache.has(key)) return geocodeCache.get(key);

  const q = /lisboa|lisbon|portugal/i.test(name) ? name : `${name}, Lisboa`;
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=pt&q=${encodeURIComponent(q)}`,
      { signal, headers: { "Accept-Language": "pt" } }
    );
    const data = await res.json();
    const coords = data?.[0] ? [parseFloat(data[0].lat), parseFloat(data[0].lon)] : null;
    geocodeCache.set(key, coords);
    return coords;
  } catch {
    return null;
  }
}

// Decode a Google encoded polyline string into [[lat, lng], ...]
function decodePolyline(str) {
  if (!str) return [];
  let index = 0,
    lat = 0,
    lng = 0;
  const points = [];
  while (index < str.length) {
    let b,
      shift = 0,
      result = 0;
    do {
      b = str.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    shift = 0;
    result = 0;
    do {
      b = str.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    points.push([lat / 1e5, lng / 1e5]);
  }
  return points;
}

function cleanLineCode(step) {
  return String(step?.line_id || step?.line_display || "Carris")
    .replace(/\s*(Bus|Train|Rail|Ferry|Metro)\s*/gi, "")
    .trim();
}

function stepColor(step, getLineColor, legIdx = 0) {
  if (step.mode === "WALK") return "#6B6B66";
  if (step.mode === "CITIBIKE") return "#1A7F46";
  const code = cleanLineCode(step);
  if (typeof getLineColor === "function") {
    return getLineColor(code).bg;
  }
  const fallbackPalette = ["#D6006F", "#8B4513", "#003F8F", "#E2231A", "#00767A"];
  return fallbackPalette[legIdx % fallbackPalette.length];
}

function makeEndpointIcon(L, label) {
  return L.divIcon({
    className: "",
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    html: `<div translate="no" class="notranslate" style="
      width:28px;height:28px;border-radius:50%;
      background:#FFD400;color:#1D1D1B;
      border:2.5px solid #1D1D1B;
      display:flex;align-items:center;justify-content:center;
      font-size:13px;font-weight:800;font-family:Roboto,Arial,sans-serif;
      box-shadow:0 2px 6px rgba(0,0,0,.28);
    ">${label}</div>`,
  });
}

function makeTransferIcon(L, stopName, fromLine, toLine) {
  const cleanStop = String(stopName || "Paragem")
    .replace(/, Lisboa.*$/i, "")
    .trim();
  const label = `Transbordo · ${cleanStop} · ${fromLine} → ${toLine}`;

  return L.divIcon({
    className: "",
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    html: `
      <div translate="no" class="notranslate" style="position:relative;width:28px;height:28px;">
        <div style="
          position:absolute;
          bottom:34px;
          left:50%;
          transform:translateX(-50%);
          background:#FFFFFF;
          color:#1D1D1B;
          padding:5px 10px;
          border-radius:8px;
          box-shadow:0 3px 10px rgba(0,0,0,0.22);
          font-family:Roboto,Arial,sans-serif;
          font-size:11px;
          font-weight:700;
          white-space:nowrap;
          pointer-events:none;
        ">
          ${label}
          <div style="
            position:absolute;
            bottom:-5px;
            left:50%;
            transform:translateX(-50%);
            width:0;height:0;
            border-left:5px solid transparent;
            border-right:5px solid transparent;
            border-top:5px solid #FFFFFF;
          "></div>
        </div>
        <div style="
          width:28px;height:28px;border-radius:50%;
          background:#FFFFFF;
          border:2.5px solid #003F8F;
          color:#003F8F;
          display:flex;align-items:center;justify-content:center;
          font-size:13px;font-weight:800;
          box-shadow:0 2px 6px rgba(0,0,0,0.25);
        ">⇄</div>
      </div>
    `,
  });
}

export default function LiveMap({ origin, destination, route, getLineColor, height = 240 }) {
  const wrapperRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);

  // Initialise Leaflet + MapLibre GL (OpenFreeMap Liberty style) exactly as in the design prototype
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper || mapRef.current) return;

    const L = getL();
    const mapEl = document.createElement("div");
    mapEl.style.width = "100%";
    mapEl.style.height = `${height}px`;
    wrapper.innerHTML = "";
    wrapper.appendChild(mapEl);

    const mapa = L.map(mapEl, {
      zoomControl: false,
    }).setView(LISBON_CENTER, 13);

    L.control.zoom({ position: "topright" }).addTo(mapa);

    let gl = null;
    if (typeof L.maplibreGL === "function") {
      gl = L.maplibreGL({
        style: "https://tiles.openfreemap.org/styles/liberty",
      }).addTo(mapa);

      const ml = gl.getMaplibreMap?.();
      if (ml && typeof ml.on === "function") {
        ml.on("load", function () {
          if (mapa.attributionControl) {
            mapa.attributionControl.addAttribution(
              '<span translate="no" class="notranslate">navegante</span> · <a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> &copy; ' +
                '<a href="https://www.openmaptiles.org/" target="_blank">OpenMapTiles</a>'
            );
          }
          try {
            ml.resize();
          } catch {
            // ignore
          }
        });
      }
    } else {
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "© OpenStreetMap · navegante",
      }).addTo(mapa);
    }

    layerRef.current = L.layerGroup().addTo(mapa);
    mapRef.current = mapa;

    const timer = setTimeout(() => {
      try {
        mapa.invalidateSize();
        gl?.getMaplibreMap?.()?.resize();
      } catch {
        // Ignore if unmounted
      }
    }, 80);

    return () => {
      clearTimeout(timer);
      try {
        mapa.remove();
      } catch {
        // Ignore DOM cleanup race
      }
      mapRef.current = null;
      layerRef.current = null;
    };
  }, [height]);

  // Draw route polylines & markers whenever the selected route changes
  useEffect(() => {
    const mapa = mapRef.current;
    const group = layerRef.current;
    if (!mapa || !group) return;
    const L = getL();
    const controller = new AbortController();

    (async () => {
      const steps = (route?.compressedSteps || []).filter((s) => s.mode !== "ARRIVE");
      const hasGeometry = steps.some((s) => Array.isArray(s.polylines) && s.polylines.length > 0);
      const segments = [];
      let transitLegIdx = 0;

      if (hasGeometry) {
        for (const s of steps) {
          const pts = (s.polylines || []).flatMap((p) => decodePolyline(p));
          if (pts.length > 1) {
            const isTransit = s.mode === "TRANSIT";
            const color = stepColor(s, getLineColor, transitLegIdx);
            if (isTransit) transitLegIdx += 1;
            segments.push({
              pts,
              step: s,
              color,
              isWalk: s.mode === "WALK",
              isTransit,
            });
          }
        }
      } else {
        const [oCoords, dCoords] = await Promise.all([
          geocode(origin, controller.signal),
          geocode(destination, controller.signal),
        ]);
        if (controller.signal.aborted || !mapRef.current || !layerRef.current) return;

        let cursor = oCoords;
        for (let i = 0; i < steps.length; i++) {
          const s = steps[i];
          if (s.mode === "TRANSIT") {
            const dep = await geocode(s.departure_stop, controller.signal);
            const arr = await geocode(s.arrival_stop, controller.signal);
            if (controller.signal.aborted || !mapRef.current || !layerRef.current) return;
            if (cursor && dep) {
              segments.push({
                pts: [cursor, dep],
                step: { mode: "WALK" },
                color: "#6B6B66",
                isWalk: true,
                isTransit: false,
              });
            }
            if (dep && arr) {
              const color = stepColor(s, getLineColor, transitLegIdx);
              transitLegIdx += 1;
              segments.push({
                pts: [dep, arr],
                step: s,
                color,
                isWalk: false,
                isTransit: true,
              });
            }
            cursor = arr || dep || cursor;
          } else if (s.mode === "CITIBIKE" && cursor && dCoords) {
            segments.push({
              pts: [cursor, dCoords],
              step: s,
              color: "#1A7F46",
              isWalk: false,
              isTransit: false,
            });
            cursor = dCoords;
          }
        }
        if (cursor && dCoords && cursor !== dCoords) {
          segments.push({
            pts: [cursor, dCoords],
            step: { mode: "WALK" },
            color: "#6B6B66",
            isWalk: true,
            isTransit: false,
          });
        }
        if (segments.length === 0 && oCoords && dCoords) {
          segments.push({
            pts: [oCoords, dCoords],
            step: { mode: "TRANSIT" },
            color: "#003F8F",
            isWalk: false,
            isTransit: true,
          });
        }
      }

      if (controller.signal.aborted || !mapRef.current || !layerRef.current) return;

      group.clearLayers();
      const allPts = [];

      // 1. Soft grey casing behind the entire route
      for (const seg of segments) {
        allPts.push(...seg.pts);
        L.polyline(seg.pts, {
          color: "#9E9E99",
          weight: seg.isWalk ? 6 : 9,
          opacity: 0.4,
          lineCap: "round",
          lineJoin: "round",
        }).addTo(group);
      }

      // 2. Main colored transit & walk lines
      for (const seg of segments) {
        L.polyline(seg.pts, {
          color: seg.color,
          weight: seg.isWalk ? 4 : 5.5,
          opacity: 0.95,
          dashArray: seg.isWalk ? "6 8" : undefined,
          lineCap: "round",
          lineJoin: "round",
        }).addTo(group);
      }

      // 3. Transfer callout between consecutive transit segments
      const transitSegments = segments.filter((seg) => seg.isTransit && seg.pts.length > 0);
      for (let i = 0; i < transitSegments.length - 1; i++) {
        const currSeg = transitSegments[i];
        const nextSeg = transitSegments[i + 1];
        const transferPt = nextSeg.pts[0] || currSeg.pts[currSeg.pts.length - 1];
        if (transferPt) {
          const stopName =
            nextSeg.step.departure_stop && nextSeg.step.departure_stop !== "N/A"
              ? nextSeg.step.departure_stop
              : currSeg.step.arrival_stop || "Paragem";
          const fromCode = cleanLineCode(currSeg.step);
          const toCode = cleanLineCode(nextSeg.step);
          L.marker(transferPt, {
            icon: makeTransferIcon(L, stopName, fromCode, toCode),
            zIndexOffset: 900,
          }).addTo(group);
        }
      }

      // 4. Endpoint A and B badges
      if (allPts.length >= 2) {
        const start = allPts[0];
        const end = allPts[allPts.length - 1];
        L.marker(start, { icon: makeEndpointIcon(L, "A"), zIndexOffset: 1000 })
          .bindTooltip(`Origem: ${origin || "A"}`)
          .addTo(group);
        L.marker(end, { icon: makeEndpointIcon(L, "B"), zIndexOffset: 1000 })
          .bindTooltip(`Destino: ${destination || "B"}`)
          .addTo(group);
        mapa.fitBounds(L.latLngBounds(allPts), { padding: [36, 36], maxZoom: 15 });
      }
    })();

    return () => controller.abort();
  }, [origin, destination, route, getLineColor]);

  return (
    <div
      translate="no"
      className="notranslate"
      style={{
        position: "relative",
        height: `${height}px`,
        borderRadius: "12px",
        overflow: "hidden",
        border: "1px solid #E2E0DC",
        background: "#EAE6DF",
      }}
    >
      <div ref={wrapperRef} style={{ width: "100%", height: `${height}px` }} />
    </div>
  );
}
