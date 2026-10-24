import React, { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Lisbon city centre
const LISBON_CENTER = [38.726, -9.145];

// Fallback coordinates when a route has no encoded polylines
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

// Yellow circle A / B endpoint markers matching the CARRISway screenshot
function endpointIcon(label) {
  return L.divIcon({
    className: "notranslate",
    html: `<div translate="no" style="width:28px;height:28px;border-radius:50%;background:#FFD400;color:#1D1D1B;border:2.5px solid #1D1D1B;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;font-family:Roboto,Arial,sans-serif;box-shadow:0 2px 6px rgba(0,0,0,.28)">${label}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

// Blue/white circular transfer icon + floating callout card matching the screenshot
function transferIcon(stopName, fromLine, toLine) {
  const cleanStop = String(stopName || "Paragem")
    .replace(/, Lisboa.*$/i, "")
    .trim();
  const label = `Transbordo · ${cleanStop} · ${fromLine} → ${toLine}`;
  return L.divIcon({
    className: "notranslate",
    html: `
      <div translate="no" style="position:relative;width:28px;height:28px;">
        <div style="position:absolute;bottom:36px;left:50%;transform:translateX(-50%);background:#FFFFFF;color:#1D1D1B;padding:6px 12px;border-radius:8px;box-shadow:0 3px 12px rgba(0,0,0,0.22);font-family:Roboto,Arial,sans-serif;font-size:12px;font-weight:700;white-space:nowrap;pointer-events:none;">
          ${label}
          <div style="position:absolute;bottom:-6px;left:50%;transform:translateX(-50%);width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-top:6px solid #FFFFFF;"></div>
        </div>
        <div style="width:28px;height:28px;border-radius:50%;background:#FFFFFF;border:2.5px solid #003F8F;color:#003F8F;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:800;box-shadow:0 2px 6px rgba(0,0,0,0.25);">
          ⇄
        </div>
      </div>
    `,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

// Sample intermediate points along a polyline to draw transit stop dots
function sampleStopPoints(pts, count = 6) {
  if (!pts || pts.length < 4) return [];
  const numStops = Math.min(8, Math.max(3, count));
  const sampled = [];
  for (let i = 1; i < numStops; i++) {
    const idx = Math.floor((i / numStops) * (pts.length - 1));
    if (pts[idx]) sampled.push(pts[idx]);
  }
  return sampled;
}

export default function LiveMap({ origin, destination, route, getLineColor, height = 240 }) {
  const wrapperRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);

  // Initialise OpenStreetMap inside an imperatively created child div so React never collides with Leaflet DOM nodes
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper || mapRef.current) return;

    const mapEl = document.createElement("div");
    mapEl.style.width = "100%";
    mapEl.style.height = "100%";
    wrapper.innerHTML = "";
    wrapper.appendChild(mapEl);

    const map = L.map(mapEl, {
      center: LISBON_CENTER,
      zoom: 13,
      zoomControl: false,
      attributionControl: true,
    });

    if (map.attributionControl) {
      map.attributionControl.setPrefix("© OpenStreetMap · GTFS Carris");
    }

    // Standard OpenStreetMap tiles (no API key required, warm road palette)
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "",
    }).addTo(map);

    L.control.zoom({ position: "topright" }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    const timer = setTimeout(() => {
      try {
        map.invalidateSize();
      } catch {
        // ignore if unmounted
      }
    }, 60);

    return () => {
      clearTimeout(timer);
      try {
        map.remove();
      } catch {
        // ignore DOM removal race
      }
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  // Redraw route segments, stop dots, transfer badge, and A/B markers whenever the selected route changes
  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
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
        if (controller.signal.aborted || !mapRef.current) return;

        let cursor = oCoords;
        for (let i = 0; i < steps.length; i++) {
          const s = steps[i];
          if (s.mode === "TRANSIT") {
            const dep = await geocode(s.departure_stop, controller.signal);
            const arr = await geocode(s.arrival_stop, controller.signal);
            if (controller.signal.aborted || !mapRef.current) return;
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
      }

      if (controller.signal.aborted || !mapRef.current || !layerRef.current) return;
      layer.clearLayers();

      const bounds = [];

      // 1. Draw grey casing first so colored lines sit cleanly inside
      for (const seg of segments) {
        if (!seg.isWalk) {
          L.polyline(seg.pts, {
            color: "#8E9299",
            weight: 11,
            opacity: 0.7,
            lineCap: "round",
            lineJoin: "round",
          }).addTo(layer);
        }
      }

      // 2. Draw colored transit lines, walking dashed lines, and intermediate stop dots
      for (const seg of segments) {
        if (seg.isWalk) {
          L.polyline(seg.pts, {
            color: "#585862",
            weight: 4,
            dashArray: "4 7",
            opacity: 0.85,
            lineCap: "round",
          }).addTo(layer);
        } else {
          L.polyline(seg.pts, {
            color: seg.color,
            weight: 6,
            opacity: 1,
            lineCap: "round",
            lineJoin: "round",
          }).addTo(layer);

          if (seg.isTransit) {
            const stopDots = sampleStopPoints(seg.pts, seg.step?.stop_count || 6);
            for (const pt of stopDots) {
              L.circleMarker(pt, {
                radius: 4.5,
                fillColor: "#787878",
                color: "#FFFFFF",
                weight: 2,
                fillOpacity: 1,
              }).addTo(layer);
            }
          }
        }
        bounds.push(...seg.pts);
      }

      // 3. Draw transfer marker & callout if there are 2+ transit segments
      const transitSegments = segments.filter((s) => s.isTransit);
      if (transitSegments.length >= 2) {
        const firstTransit = transitSegments[0];
        const secondTransit = transitSegments[1];
        const transferPt =
          secondTransit.pts[0] || firstTransit.pts[firstTransit.pts.length - 1];
        if (transferPt) {
          const stopName =
            secondTransit.step?.departure_stop ||
            firstTransit.step?.arrival_stop ||
            "Transbordo";
          const fromCode = cleanLineCode(firstTransit.step);
          const toCode = cleanLineCode(secondTransit.step);
          L.marker(transferPt, {
            icon: transferIcon(stopName, fromCode, toCode),
            zIndexOffset: 900,
          }).addTo(layer);
        }
      }

      // 4. Determine exact start (A) and end (B) coordinates from geometry (or fallback geocoding)
      let startCoord = segments.length > 0 ? segments[0].pts[0] : null;
      let endCoord =
        segments.length > 0
          ? segments[segments.length - 1].pts[segments[segments.length - 1].pts.length - 1]
          : null;

      if (!startCoord || !endCoord) {
        const [oCoords, dCoords] = await Promise.all([
          geocode(origin, controller.signal),
          geocode(destination, controller.signal),
        ]);
        if (controller.signal.aborted || !mapRef.current) return;
        startCoord = startCoord || oCoords;
        endCoord = endCoord || dCoords;
      }

      if (startCoord) {
        L.marker(startCoord, { icon: endpointIcon("A"), zIndexOffset: 1000 }).addTo(layer);
        bounds.push(startCoord);
      }
      if (endCoord) {
        L.marker(endCoord, { icon: endpointIcon("B"), zIndexOffset: 1000 }).addTo(layer);
        bounds.push(endCoord);
      }

      if (bounds.length > 1) {
        map.fitBounds(bounds, { padding: [38, 38], maxZoom: 15 });
      } else if (bounds.length === 1) {
        map.setView(bounds[0], 14);
      }
    })();

    return () => controller.abort();
  }, [origin, destination, route, getLineColor]);

  return (
    <div
      ref={wrapperRef}
      style={{
        position: "absolute",
        inset: 0,
        height: `${height}px`,
        width: "100%",
        zIndex: 0,
      }}
    />
  );
}
