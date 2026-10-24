import React, { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Lisbon city centre
const LISBON_CENTER = [38.7223, -9.1393];

// Approximate coordinates for common Lisbon stops/stations
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

// Clean monochrome route styling so the map stays minimal and distraction-free
function stepStyle(step) {
  if (step.mode === "WALK") {
    return { color: "#6B6B66", weight: 3.5, dashArray: "4 7", opacity: 0.85 };
  }
  if (step.mode === "CITIBIKE") {
    return { color: "#3F3F3C", weight: 5, dashArray: "8 5", opacity: 0.9 };
  }
  return { color: "#1D1D1B", weight: 5, opacity: 0.92 };
}

function endpointIcon(label, isDest) {
  const bg = isDest ? "#1D1D1B" : "#FFFFFF";
  const fg = isDest ? "#FFFFFF" : "#1D1D1B";
  return L.divIcon({
    className: "notranslate",
    html: `<div translate="no" style="width:20px;height:20px;border-radius:50%;background:${bg};color:${fg};border:2px solid #1D1D1B;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;font-family:Roboto,Arial,sans-serif;box-shadow:0 1px 4px rgba(0,0,0,.22)">${label}</div>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });
}

export default function LiveMap({ origin, destination, route, height = 220 }) {
  const wrapperRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);

  // Initialise the map once inside an imperatively created child div so React never collides with Leaflet DOM nodes
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
      attributionControl: false,
    });

    // CartoDB Positron Light (minimal monochrome grayscale map)
    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
      maxZoom: 19,
      subdomains: "abcd",
    }).addTo(map);

    L.control.zoom({ position: "bottomright" }).addTo(map);
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
      if (controller.signal.aborted || !mapRef.current) return;

      if (hasGeometry) {
        for (const s of steps) {
          const pts = (s.polylines || []).flatMap((p) => decodePolyline(p));
          if (pts.length > 1) segments.push({ pts, style: stepStyle(s) });
        }
      } else {
        let cursor = oCoords;
        for (let i = 0; i < steps.length; i++) {
          const s = steps[i];
          if (s.mode === "TRANSIT") {
            const dep = await geocode(s.departure_stop, controller.signal);
            const arr = await geocode(s.arrival_stop, controller.signal);
            if (controller.signal.aborted || !mapRef.current) return;
            if (cursor && dep) {
              segments.push({ pts: [cursor, dep], style: stepStyle({ mode: "WALK" }) });
            }
            if (dep && arr) segments.push({ pts: [dep, arr], style: stepStyle(s) });
            cursor = arr || dep || cursor;
          } else if (s.mode === "CITIBIKE" && cursor && dCoords) {
            segments.push({ pts: [cursor, dCoords], style: stepStyle(s) });
            cursor = dCoords;
          }
        }
        if (cursor && dCoords && cursor !== dCoords) {
          segments.push({ pts: [cursor, dCoords], style: stepStyle({ mode: "WALK" }) });
        }
      }

      if (controller.signal.aborted || !mapRef.current || !layerRef.current) return;
      layer.clearLayers();
      const bounds = [];
      for (const seg of segments) {
        L.polyline(seg.pts, { ...seg.style, lineCap: "round", lineJoin: "round" }).addTo(layer);
        bounds.push(...seg.pts);
      }
      if (oCoords) {
        L.marker(oCoords, { icon: endpointIcon("A", false) }).addTo(layer);
        bounds.push(oCoords);
      }
      if (dCoords) {
        L.marker(dCoords, { icon: endpointIcon("B", true) }).addTo(layer);
        bounds.push(dCoords);
      }
      if (bounds.length > 1) {
        map.fitBounds(bounds, { padding: [32, 32], maxZoom: 15 });
      } else if (bounds.length === 1) {
        map.setView(bounds[0], 14);
      }
    })();

    return () => controller.abort();
  }, [origin, destination, route]);

  return (
    <div
      ref={wrapperRef}
      style={{
        position: "absolute",
        inset: 0,
        height: `${height}px`,
        width: "100%",
        zIndex: 0,
        filter: "grayscale(100%) contrast(97%)",
      }}
    />
  );
}
