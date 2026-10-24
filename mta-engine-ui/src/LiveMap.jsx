import React, { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Lisbon city centre
const LISBON_CENTER = [38.7223, -9.1393];

// Approximate coordinates for common Lisbon stops/stations (used when the backend
// has no polyline geometry, e.g. when running on fallback routes).
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
  let index = 0, lat = 0, lng = 0;
  const points = [];
  while (index < str.length) {
    let b, shift = 0, result = 0;
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

function stepStyle(step, getLineColor) {
  if (step.mode === "WALK") {
    return { color: "#585862", weight: 4, dashArray: "4 8", opacity: 0.9 };
  }
  if (step.mode === "CITIBIKE") {
    return { color: "#1A7F46", weight: 6, opacity: 0.95 };
  }
  const code = String(step.line_id || step.line_display || "")
    .replace(/\s*(Bus|Train|Rail|Ferry)\s*/gi, "")
    .trim();
  return { color: getLineColor(code).bg, weight: 6, opacity: 0.95 };
}

function circleIcon(fill, stroke) {
  return L.divIcon({
    className: "",
    html: `<div style="width:16px;height:16px;border-radius:50%;background:${fill};border:3px solid ${stroke};box-shadow:0 1px 4px rgba(0,0,0,.35)"></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

export default function LiveMap({ origin, destination, route, getLineColor, height = 260 }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);

  // Initialise the map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      center: LISBON_CENTER,
      zoom: 13,
      zoomControl: false,
      attributionControl: true,
    });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "© OpenStreetMap",
    }).addTo(map);
    L.control.zoom({ position: "bottomright" }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    setTimeout(() => map.invalidateSize(), 50);

    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  // Redraw the route whenever it changes
  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    const controller = new AbortController();

    (async () => {
      const steps = (route?.compressedSteps || []).filter((s) => s.mode !== "ARRIVE");
      const hasGeometry = steps.some((s) => Array.isArray(s.polylines) && s.polylines.length > 0);
      const segments = [];

      const [oCoords, dCoords] = await Promise.all([
        geocode(origin, controller.signal),
        geocode(destination, controller.signal),
      ]);
      if (controller.signal.aborted) return;

      if (hasGeometry) {
        for (const s of steps) {
          const pts = (s.polylines || []).flatMap((p) => decodePolyline(p));
          if (pts.length > 1) segments.push({ pts, style: stepStyle(s, getLineColor) });
        }
      } else {
        // Approximate path: origin -> transit stops -> destination
        let cursor = oCoords;
        for (let i = 0; i < steps.length; i++) {
          const s = steps[i];
          if (s.mode === "TRANSIT") {
            const dep = await geocode(s.departure_stop, controller.signal);
            const arr = await geocode(s.arrival_stop, controller.signal);
            if (controller.signal.aborted) return;
            if (cursor && dep) {
              segments.push({ pts: [cursor, dep], style: stepStyle({ mode: "WALK" }, getLineColor) });
            }
            if (dep && arr) segments.push({ pts: [dep, arr], style: stepStyle(s, getLineColor) });
            cursor = arr || dep || cursor;
          } else if (s.mode === "CITIBIKE" && cursor && dCoords) {
            segments.push({ pts: [cursor, dCoords], style: stepStyle(s, getLineColor) });
            cursor = dCoords;
          }
        }
        if (cursor && dCoords && cursor !== dCoords) {
          segments.push({ pts: [cursor, dCoords], style: stepStyle({ mode: "WALK" }, getLineColor) });
        }
      }

      if (controller.signal.aborted) return;
      layer.clearLayers();
      const bounds = [];
      for (const seg of segments) {
        L.polyline(seg.pts, { ...seg.style, lineCap: "round", lineJoin: "round" }).addTo(layer);
        bounds.push(...seg.pts);
      }
      if (oCoords) {
        L.marker(oCoords, { icon: circleIcon("#FFFFFF", "#1D1D1B") }).bindTooltip(origin).addTo(layer);
        bounds.push(oCoords);
      }
      if (dCoords) {
        const m = L.marker(dCoords, { icon: circleIcon("#C8202B", "#FFFFFF") }).addTo(layer);
        if (route?.dur) {
          m.bindTooltip(`${route.dur} min`, { permanent: true, direction: "top", offset: [0, -10] });
        }
        bounds.push(dCoords);
      }
      if (bounds.length > 1) {
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
      } else if (bounds.length === 1) {
        map.setView(bounds[0], 15);
      }
    })();

    return () => controller.abort();
  }, [origin, destination, route, getLineColor]);

  return (
    <div
      ref={containerRef}
      style={{ position: "absolute", inset: 0, height: `${height}px`, width: "100%", zIndex: 0 }}
    />
  );
}
