import json
import logging
import math
import os
import random
import time
import xml.etree.ElementTree as ET
from bisect import bisect_left
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from typing import Any, Dict, List, Optional

import numpy as np
import requests
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from google.transit import gtfs_realtime_pb2
from pydantic import BaseModel, Field

from alternative_routes import find_alternatives, get_headway
from realtime_engine import engine as rt_engine
from weather_service import fetch_weather_conditions
from transfer_times import get_transfer_walk_time

# --- LOGGING & ENVIRONMENT ---
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)
LISBON_TZ = ZoneInfo("Europe/Lisbon")

# --- SECURE CONFIGURATION TOKENS ---
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY", "AIzaSyDyiFzvUe3K7rFAXGi90QX0MQlDibmVThc")

# Lisbon transit doesn't require API keys for GTFS feeds

ROUTES_ENDPOINT = "https://routes.googleapis.com/directions/v2:computeRoutes"

# Lisbon Metro lines: Azul (Blue), Amarela (Yellow), Verde (Green), Vermelha (Red)
# Carris: Buses and trams
# CP: Comboios de Portugal suburban trains
# Fertagus: Cross-Tagus train
# Transtejo/Soflusa: Ferries
LISBON_FEED_URLS = {
    "METRO": None,  # Metro de Lisboa GTFS-RT (not publicly available yet)
    "CARRIS": None,  # Carris Metropolitana GTFS-RT
    "CP": None,  # CP suburban trains
    "FERTAGUS": None,  # Fertagus cross-Tagus
    "FERRY": None,  # Transtejo/Soflusa ferries
}

# --- SIMULATION CONSTANTS ---
BASE_FARE = 1.65  # Lisbon metro/bus single ticket (Viva Viagem)
ZAPPING_FARE = 1.47  # Zapping (rechargeable) fare
CP_SUBURBAN_FARE = 2.30  # CP suburban train base
FERRY_FARE = 2.80  # Transtejo ferry
GIRA_UNLOCK = 0.00  # Gira bike sharing (free first 45 min with pass)
GIRA_PER_MIN = 0.15  # After free period

GIRA_WALK_TO_STATION = 4.0
GIRA_UNLOCK_DOCK_TIME = 2.0
GIRA_WALK_TO_DESTINATION = 4.0
# Gira / Citibike compatibility aliases
CITIBIKE_WALK_TO_STATION = GIRA_WALK_TO_STATION
CITIBIKE_UNLOCK_DOCK_TIME = GIRA_UNLOCK_DOCK_TIME
CITIBIKE_WALK_TO_DESTINATION = GIRA_WALK_TO_DESTINATION

DEFAULT_SIM_TRIALS = int(os.getenv("SIM_TRIALS", "2000"))

app = FastAPI(title="Lisbon Transit Stochastic Engine API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


class SimulationRequest(BaseModel):
    origin: str
    destination: str
    target_time: Optional[str] = None  # ISO8601 String
    time_mode: str = "depart_at"  # "depart_at" or "arrive_by"
    suspended_lines: List[str] = Field(default_factory=list)  # "What If" mode
    allow_bike: bool = False  # Toggle bike / Gira options (off by default)


def clean_line_id(line_id: str) -> str:
    token = str(line_id or "").upper().strip().split()[0]
    # Map Lisbon metro color names
    metro_map = {
        "BLUE": "AZUL", "YELLOW": "AMARELA", 
        "GREEN": "VERDE", "RED": "VERMELHA",
    }
    return metro_map.get(token, token)


def estimate_commuter_rail_fare(duration_mins: float) -> float:
    """Estimate CP suburban train fare based on zones."""
    if duration_mins <= 20:
        return 2.30  # 1-2 zones
    elif duration_mins <= 45:
        return 3.50  # 3-4 zones
    else:
        return 5.00  # 5+ zones


def calculate_itinerary_fare(itinerary: List[Dict], api_fare: float = 0.0) -> float:
    if api_fare > 0:
        return api_fare
    total_fare = 0.0
    has_metro_or_bus = False

    for step in itinerary:
        if step["mode"] == "CITIBIKE":  # Gira bikes
            dur = step.get("baseline_duration", 0.0)
            bike_cost = GIRA_UNLOCK
            if dur > 45:
                bike_cost += (dur - 45) * GIRA_PER_MIN
            total_fare += bike_cost
            continue

        if step["mode"] != "TRANSIT":
            continue

        is_ferry = step.get("is_ferry", False)
        is_rail = step.get("is_commuter_rail", False)
        duration = step.get("baseline_duration", 0.0)

        if is_rail:
            total_fare += CP_SUBURBAN_FARE
        elif is_ferry:
            total_fare += FERRY_FARE
        else:
            if not has_metro_or_bus:
                total_fare += ZAPPING_FARE  # First metro/bus with Zapping
                has_metro_or_bus = True
            # Additional transfers within 60 min are free with Zapping

    return round(total_fare, 2)


def get_transit_feed_type(
    route_id: str, is_bus: bool, line_name: str = ""
) -> Optional[str]:
    if is_bus:
        return "CARRIS"
    name_upper = str(line_name).upper()
    if any(kw in name_upper for kw in ["CP", "COMBOIOS", "SINTRA", "CASCAIS", "AZAMBUJA"]):
        return "CP"
    if "FERTAGUS" in name_upper:
        return "FERTAGUS"
    if any(kw in name_upper for kw in ["FERRY", "TRANSTEJO", "SOFLUSA"]):
        return "FERRY"
    # Metro lines
    route = str(route_id).upper().strip()
    if route in ["AZUL", "BLUE", "AMARELA", "YELLOW", "VERDE", "GREEN", "VERMELHA", "RED"]:
        return "METRO"
    return "METRO"  # Default to metro for Lisbon


def check_for_alerts(route_character: str, feed_key: Optional[str] = None, is_bus: bool = False) -> bool:
    """Check for transit alerts. Currently returns False as Lisbon GTFS-RT alerts are not yet integrated."""
    return False


def fetch_live_delay(route_id: str, feed_key: Optional[str]) -> float:
    """Fetch live delay. Currently returns base estimate as Lisbon GTFS-RT is not yet integrated."""
    return 0.5  # Default 30-second base delay estimate


def parse_v2_duration(val: Any) -> float:
    if not val:
        return 0.0
    if isinstance(val, (int, float)):
        return float(val) / 60.0
    if str(val).endswith("s"):
        return float(val[:-1]) / 60.0
    try:
        return float(val) / 60.0
    except:
        return 0.0


def parse_iso_time(time_str: str) -> Optional[datetime]:
    if not time_str:
        return None
    try:
        return datetime.fromisoformat(time_str.replace("Z", "+00:00"))
    except:
        return None


def route_signature(itinerary: List[Dict]) -> str:
    segments = []
    last_label = None
    for step in itinerary:
        if step["mode"] == "TRANSIT":
            label = str(step.get("line_display") or step.get("line_id") or "Transit")
            for suffix in [" Train", " Bus", " Ferry", " Rail"]:
                label = label.replace(suffix, "")
            
            if label != last_label:
                if segments and step.get("departure_stop"):
                    station = step["departure_stop"].replace("Station", "").strip()
                    segments.append(f"({station})")
                segments.append(label)
                last_label = label
        elif step["mode"] == "CITIBIKE" and "Gira Bike" not in segments:
            segments.append("Gira Bike")
            last_label = "Gira Bike"
    return " → ".join(segments) if segments else "Walk Only"


def get_strict_route_hash(itinerary: List[Dict]) -> str:
    parts = []
    for step in itinerary:
        if step["mode"] == "TRANSIT":
            parts.append(
                f"{step.get('line_id')}|{step.get('departure_stop')}|{step.get('arrival_stop')}"
            )
    return " -> ".join(parts) if parts else "WALK_ONLY"


def inject_citibike_alternative(
    base_itinerary: Dict, destination: str
) -> Optional[Dict]:
    steps = base_itinerary["itinerary"]
    rail_idx = -1
    for idx, step in enumerate(steps):
        if step.get("is_commuter_rail"):
            rail_idx = idx
            break

    if rail_idx != -1:
        rail_step = steps[rail_idx]
        pre_rail_mins = sum(
            s["baseline_duration"] for s in steps[:rail_idx] if s["mode"] == "TRANSIT"
        )
        if pre_rail_mins == 0:
            pre_rail_mins = 45.0

        cycling_duration = pre_rail_mins * 1.4
        new_steps = [
            {
                "mode": "WALK",
                "baseline_duration": CITIBIKE_WALK_TO_STATION,
                "line_id": "Walk",
                "departure_stop": "Origin",
                "arrival_stop": "Gira Station",
                "line_display": "Walk to Gira Station",
            },
            {
                "mode": "CITIBIKE",
                "baseline_duration": cycling_duration,
                "line_id": "Gira Bike",
                "departure_stop": "Gira Station",
                "arrival_stop": rail_step["departure_stop"],
                "line_display": "Gira Bike Ride",
            },
            {
                "mode": "DOCKING_OVERHEAD",
                "baseline_duration": CITIBIKE_UNLOCK_DOCK_TIME,
                "line_id": "Docking Overhead",
                "departure_stop": "Gira Dock",
                "arrival_stop": "Gira Dock",
                "line_display": "Dock Gira Bike",
            },
            {
                "mode": "WALK",
                "baseline_duration": 2.0,
                "line_id": "Walk",
                "departure_stop": "Gira Dock",
                "arrival_stop": rail_step["departure_stop"],
                "line_display": "Walk to Station",
            },
        ]
        new_steps.extend(steps[rail_idx:])
    else:
        walk_mins = sum(s["baseline_duration"] for s in steps if s["mode"] == "WALK")
        transit_mins = sum(
            s["baseline_duration"] for s in steps if s["mode"] == "TRANSIT"
        )

        cycling_duration = (walk_mins * 0.25) + (transit_mins * 1.2)
        if cycling_duration > 120.0 or cycling_duration == 0:
            return None

        new_steps = [
            {
                "mode": "WALK",
                "baseline_duration": CITIBIKE_WALK_TO_STATION,
                "line_id": "Walk",
                "departure_stop": "Origin Location",
                "arrival_stop": "Nearest Gira Station",
                "line_display": "Walk to Gira Dock",
            },
            {
                "mode": "CITIBIKE",
                "baseline_duration": cycling_duration,
                "line_id": "Gira Bike",
                "departure_stop": "Nearest Gira Station",
                "arrival_stop": "Destination Gira Station",
                "line_display": "Gira Bike Ride",
            },
            {
                "mode": "DOCKING_OVERHEAD",
                "baseline_duration": CITIBIKE_UNLOCK_DOCK_TIME,
                "line_id": "Docking Overhead",
                "departure_stop": "Destination Gira Station",
                "arrival_stop": "Destination Gira Station",
                "line_display": "Dock Gira Bike",
            },
            {
                "mode": "WALK",
                "baseline_duration": CITIBIKE_WALK_TO_DESTINATION,
                "line_id": "Walk",
                "departure_stop": "Destination Gira Station",
                "arrival_stop": destination,
                "line_display": f"Walk to {destination}",
            },
        ]

    return {
        "route_index": 4,
        "baseline_mins": sum(s["baseline_duration"] for s in new_steps),
        "itinerary": new_steps,
        "cost": calculate_itinerary_fare(new_steps),
    }


def normalize_lisbon_address(addr: str) -> str:
    cleaned = str(addr or "").strip()
    lower = cleaned.lower()
    if not any(
        k in lower
        for k in [
            "lisboa",
            "lisbon",
            "portugal",
            "cascais",
            "sintra",
            "almada",
            "amadora",
            "oeiras",
            "setúbal",
            "barreiro",
        ]
    ):
        cleaned += ", Lisboa, Portugal"
    return cleaned


def fetch_google_itineraries(
    origin: str, destination: str, target_time: datetime, time_mode: str, allow_bike: bool = False
) -> List[Dict]:
    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": GOOGLE_API_KEY,
        "X-Goog-FieldMask": "routes.duration,routes.legs.steps,routes.travelAdvisory",
    }

    norm_origin = normalize_lisbon_address(origin)
    norm_dest = normalize_lisbon_address(destination)

    payload = {
        "origin": {"address": norm_origin},
        "destination": {"address": norm_dest},
        "travelMode": "TRANSIT",
        "computeAlternativeRoutes": True,
    }

    rfc_time = target_time.strftime("%Y-%m-%dT%H:%M:%SZ")
    if time_mode == "arrive_by":
        payload["arrivalTime"] = rfc_time
    else:
        payload["departureTime"] = rfc_time

    try:
        response = requests.post(ROUTES_ENDPOINT, json=payload, headers=headers, timeout=5)
        data = response.json()
    except Exception as e:
        logger.warning(f"Google Routes API call failed ({e}); falling back to Lisbon transit routing.")
        data = {}

    parsed = []
    for idx, route in enumerate(data.get("routes", []), 1):
        if idx > 5:
            break
        total_dur = parse_v2_duration(route.get("duration"))

        api_fare = 0.0
        fare_details = route.get("travelAdvisory", {}).get("transitFare", {})
        if fare_details:
            api_fare = float(fare_details.get("units", "0")) + (
                float(fare_details.get("nanos", "0")) / 1e9
            )

        raw_steps = []
        steps_list = [s for leg in route.get("legs", []) for s in leg.get("steps", [])]

        for i, step in enumerate(steps_list):
            mode = step.get("travelMode", "WALK")
            dur = parse_v2_duration(step.get("staticDuration", "0s"))

            if mode == "WALK":
                next_stop = destination
                for next_step in steps_list[i + 1 :]:
                    if next_step.get("travelMode") in ["TRANSIT", "FERRY"]:
                        next_stop = (
                            next_step.get("transitDetails", {})
                            .get("stopDetails", {})
                            .get("departureStop", {})
                            .get("name", "Station")
                        )
                        break

                raw_steps.append(
                    {
                        "mode": "WALK",
                        "baseline_duration": dur,
                        "line_id": "Walk",
                        "is_bus": False,
                        "is_ferry": False,
                        "is_commuter_rail": False,
                        "line_name": "Walk",
                        "departure_stop": "N/A",
                        "arrival_stop": "N/A",
                        "line_display": f"Walk to {next_stop}",
                        "scheduled_departure": None,
                    }
                )

            elif mode in ["TRANSIT", "FERRY"]:
                details = step.get("transitDetails", {})
                t_line = details.get("transitLine", {})
                v_type = t_line.get("vehicle", {}).get("type", "")
                stop_details = details.get("stopDetails", {})
                stop_count = details.get("stopCount", 1)

                line_id = t_line.get("nameShort")
                line_name = t_line.get("name", "")
                is_bus = v_type == "BUS"
                is_ferry = v_type == "FERRY" or mode == "FERRY"
                is_commuter_rail = v_type == "COMMUTER_TRAIN" or any(
                    rn in line_name.upper()
                    for rn in [
                        "CP",
                        "COMBOIOS",
                        "SINTRA",
                        "CASCAIS",
                        "AZAMBUJA",
                        "FERTAGUS",
                        "SADO",
                    ]
                )

                dep_stop = stop_details.get("departureStop", {}).get(
                    "name", "Unknown Station"
                )
                arr_stop = stop_details.get("arrivalStop", {}).get(
                    "name", "Unknown Station"
                )

                dep_time_str = stop_details.get("departureTime")
                sched_dep = parse_iso_time(dep_time_str) if dep_time_str else None

                line_id_val = line_id if line_id else line_name
                display_type = (
                    "Bus"
                    if is_bus
                    else "Ferry"
                    if is_ferry
                    else "Rail"
                    if is_commuter_rail
                    else "Train"
                )

                alt_list = []
                if not is_bus and not is_ferry and not is_commuter_rail:
                    alt_list = find_alternatives(line_id_val, dep_stop, arr_stop)

                line_display = (
                    f"{'/'.join(alt_list)} {display_type}"
                    if alt_list and len(alt_list) > 1
                    else f"{line_id_val} {display_type}"
                )

                raw_steps.append(
                    {
                        "mode": "TRANSIT",
                        "baseline_duration": dur,
                        "line_id": line_id_val,
                        "is_bus": is_bus,
                        "is_ferry": is_ferry,
                        "is_commuter_rail": is_commuter_rail,
                        "stop_count": stop_count,
                        "line_name": line_name,
                        "departure_stop": dep_stop,
                        "arrival_stop": arr_stop,
                        "line_display": line_display,
                        "scheduled_departure": sched_dep,
                    }
                )

        parsed.append(
            {
                "route_index": idx,
                "baseline_mins": total_dur,
                "itinerary": raw_steps,
                "cost": calculate_itinerary_fare(raw_steps, api_fare),
            }
        )

    unique_routes = {}
    for route in parsed:
        r_hash = get_strict_route_hash(route["itinerary"])
        if r_hash not in unique_routes:
            unique_routes[r_hash] = route
        else:
            if route["baseline_mins"] < unique_routes[r_hash]["baseline_mins"]:
                unique_routes[r_hash] = route

    parsed_deduped = list(unique_routes.values())

    for i, r in enumerate(parsed_deduped):
        r["route_index"] = i + 1

    if parsed_deduped:
        if allow_bike:
            bike_alt = inject_citibike_alternative(parsed_deduped[0], destination)
            if bike_alt:
                bike_alt["route_index"] = len(parsed_deduped) + 1
                parsed_deduped.append(bike_alt)
        else:
            parsed_deduped = [
                r for r in parsed_deduped
                if not any(s.get("mode") == "CITIBIKE" for s in r["itinerary"])
            ]
            for i, r in enumerate(parsed_deduped):
                r["route_index"] = i + 1
        return parsed_deduped

    logger.warning("No routes from Google API; providing Lisbon fallback itineraries.")
    return create_fallback_lisbon_itineraries(origin, destination, target_time, allow_bike=allow_bike)


def create_fallback_lisbon_itineraries(origin: str, destination: str, target_time: datetime, allow_bike: bool = True) -> List[Dict]:
    """Fallback generator for Lisbon routes if external API returns no transit results."""
    r1 = {
        "route_index": 1,
        "baseline_mins": 26.0,
        "cost": 1.47,
        "itinerary": [
            {
                "mode": "WALK",
                "baseline_duration": 4.0,
                "line_id": "Walk",
                "is_bus": False,
                "is_ferry": False,
                "is_commuter_rail": False,
                "line_name": "Walk",
                "departure_stop": "N/A",
                "arrival_stop": "N/A",
                "line_display": f"Walk from {origin} to Baixa-Chiado",
                "scheduled_departure": None,
            },
            {
                "mode": "TRANSIT",
                "baseline_duration": 14.0,
                "line_id": "VERDE",
                "is_bus": False,
                "is_ferry": False,
                "is_commuter_rail": False,
                "stop_count": 5,
                "line_name": "Linha Verde",
                "departure_stop": "Baixa-Chiado",
                "arrival_stop": "Cais do Sodré",
                "line_display": "Linha Verde (Metro)",
                "scheduled_departure": target_time + timedelta(minutes=4),
            },
            {
                "mode": "WALK",
                "baseline_duration": 8.0,
                "line_id": "Walk",
                "is_bus": False,
                "is_ferry": False,
                "is_commuter_rail": False,
                "line_name": "Walk",
                "departure_stop": "N/A",
                "arrival_stop": "N/A",
                "line_display": f"Walk to {destination}",
                "scheduled_departure": None,
            },
        ],
    }

    r2 = {
        "route_index": 2,
        "baseline_mins": 32.0,
        "cost": 1.47,
        "itinerary": [
            {
                "mode": "WALK",
                "baseline_duration": 3.0,
                "line_id": "Walk",
                "is_bus": False,
                "is_ferry": False,
                "is_commuter_rail": False,
                "line_name": "Walk",
                "departure_stop": "N/A",
                "arrival_stop": "N/A",
                "line_display": f"Walk from {origin} to Praça do Comércio",
                "scheduled_departure": None,
            },
            {
                "mode": "TRANSIT",
                "baseline_duration": 24.0,
                "line_id": "15E",
                "is_bus": True,
                "is_ferry": False,
                "is_commuter_rail": False,
                "stop_count": 9,
                "line_name": "Elétrico 15E",
                "departure_stop": "Praça do Comércio",
                "arrival_stop": "Belém",
                "line_display": "Elétrico 15E (Carris)",
                "scheduled_departure": target_time + timedelta(minutes=5),
            },
            {
                "mode": "WALK",
                "baseline_duration": 5.0,
                "line_id": "Walk",
                "is_bus": False,
                "is_ferry": False,
                "is_commuter_rail": False,
                "line_name": "Walk",
                "departure_stop": "N/A",
                "arrival_stop": "N/A",
                "line_display": f"Walk to {destination}",
                "scheduled_departure": None,
            },
        ],
    }

    r3 = {
        "route_index": 3,
        "baseline_mins": 35.0,
        "cost": 1.47,
        "itinerary": [
            {
                "mode": "WALK",
                "baseline_duration": 4.0,
                "line_id": "Walk",
                "is_bus": False,
                "is_ferry": False,
                "is_commuter_rail": False,
                "line_name": "Walk",
                "departure_stop": "N/A",
                "arrival_stop": "N/A",
                "line_display": f"Walk from {origin} to Marquês de Pombal",
                "scheduled_departure": None,
            },
            {
                "mode": "TRANSIT",
                "baseline_duration": 12.0,
                "line_id": "AZUL",
                "is_bus": False,
                "is_ferry": False,
                "is_commuter_rail": False,
                "stop_count": 4,
                "line_name": "Linha Azul",
                "departure_stop": "Marquês de Pombal",
                "arrival_stop": "São Sebastião",
                "line_display": "Linha Azul (Metro)",
                "scheduled_departure": target_time + timedelta(minutes=3),
            },
            {
                "mode": "TRANSIT",
                "baseline_duration": 14.0,
                "line_id": "VERMELHA",
                "is_bus": False,
                "is_ferry": False,
                "is_commuter_rail": False,
                "stop_count": 6,
                "line_name": "Linha Vermelha",
                "departure_stop": "São Sebastião",
                "arrival_stop": "Oriente",
                "line_display": "Linha Vermelha (Metro)",
                "scheduled_departure": target_time + timedelta(minutes=18),
            },
            {
                "mode": "WALK",
                "baseline_duration": 5.0,
                "line_id": "Walk",
                "is_bus": False,
                "is_ferry": False,
                "is_commuter_rail": False,
                "line_name": "Walk",
                "departure_stop": "N/A",
                "arrival_stop": "N/A",
                "line_display": f"Walk to {destination}",
                "scheduled_departure": None,
            },
        ],
    }

    routes = [r1, r2, r3]
    if allow_bike:
        bike_alt = inject_citibike_alternative(r1, destination)
        if bike_alt:
            bike_alt["route_index"] = 4
            routes.append(bike_alt)
    return routes


def build_live_arrival_cache(itineraries: List[Dict]) -> Dict[tuple, List[float]]:
    # Lisbon GTFS-RT is simulated via stochastic headways
    return {}


def next_cached_arrival(arrivals: List[float], current_unix: float) -> Optional[float]:
    if not arrivals:
        return None
    idx = bisect_left(arrivals, current_unix)
    return arrivals[idx] if idx < len(arrivals) else None


def get_lisbon_hour(dt: datetime) -> int:
    return dt.astimezone(ZoneInfo("Europe/Lisbon")).hour


def run_competitive_simulation(
    itineraries: List[Dict],
    live_telemetry: Dict[str, Dict],
    sim_start_time: datetime,
    time_mode: str,
    target_arrival_time: Optional[datetime],
    num_trials: int = DEFAULT_SIM_TRIALS,
    live_arrival_cache: Optional[Dict[tuple, List[float]]] = None,
) -> Dict:
    win_counts = {r["route_index"]: 0 for r in itineraries}
    severe_delays = {r["route_index"]: 0 for r in itineraries}
    delayed_transfers = {r["route_index"]: 0 for r in itineraries}
    early_arrivals = {r["route_index"]: 0 for r in itineraries}

    all_durations = {r["route_index"]: [] for r in itineraries}
    step_stats = {
        r["route_index"]: {
            i: {"board_unix": [], "wait_mins": []} for i in range(len(r["itinerary"]))
        }
        for r in itineraries
    }

    TRANSFER_DELAY_TOLERANCE_MINS = 2.0

    # Fetch live weather conditions
    weather = fetch_weather_conditions()
    weather_delay_mult = weather["delay_multiplier"]
    weather_walk_mult = weather["walk_multiplier"]

    for _ in range(num_trials):
        trial_durations = {}
        trial_line_offsets = {}
        trial_line_delays = {}
        trial_hub_shocks = {}

        def get_trial_line_schedule(line, tod):
            if line not in trial_line_offsets:
                h = get_headway(line, tod)
                if h is None:
                    trial_line_offsets[line] = 0.0
                    trial_line_delays[line] = 9999.0
                    return (0.0, 9999.0, 9999.0)
                trial_line_offsets[line] = random.uniform(0, h)
                data = live_telemetry.get(line, {"delay": 0.0, "has_alert": False})
                
                # Heavy-tailed base delay (log-normal)
                if data["has_alert"]:
                    base_delay = np.random.lognormal(2.5, 1.0) * weather_delay_mult # Mean ~20 mins, heavy tail
                else:
                    base_delay = np.random.lognormal(1.0, 0.8) * weather_delay_mult # Mean ~3-4 mins

                # Correlated delays (System Shocks)
                hub_delay = 0.0
                hubs = {
                    "marquês de pombal": ["AZUL", "AMARELA"],
                    "alameda": ["VERDE", "VERMELHA"],
                    "campo grande": ["AMARELA", "VERDE"],
                    "baixa-chiado": ["AZUL", "VERDE"],
                    "cais do sodré": ["VERDE"],  # Metro + Ferry + Train
                    "entrecampos": ["AMARELA"],  # Metro + CP
                    "roma-areeiro": ["VERDE"],  # Metro + CP
                    "oriente": ["VERMELHA"],  # Metro + CP + Bus hub
                    "sete rios": ["AZUL"],  # Metro + CP + Bus terminal
                }
                
                for hub, lines in hubs.items():
                    if line in lines:
                        if hub not in trial_hub_shocks:
                            # 2% chance of a severe system shock per hub per trial
                            trial_hub_shocks[hub] = np.random.lognormal(3.0, 0.8) if random.random() < 0.02 else 0.0
                        hub_delay = max(hub_delay, trial_hub_shocks[hub])

                # Shared track correlation (express/local on same tracks)
                shared_tracks = {
                    "sintra_line": ["CP_SINTRA"],
                    "cascais_line": ["CP_CASCAIS"],
                    "metro_blue_green": ["AZUL", "VERDE"],  # Share Baixa-Chiado
                }
                
                track_delay = 0.0
                for track_group, track_lines in shared_tracks.items():
                    if line in track_lines:
                        if track_group not in trial_hub_shocks:
                            trial_hub_shocks[track_group] = np.random.lognormal(2.0, 0.6) if random.random() < 0.03 else 0.0
                        track_delay = max(track_delay, trial_hub_shocks[track_group])

                trial_line_delays[line] = data["delay"] + base_delay + hub_delay + track_delay
            h_second = get_headway(line, tod)
            if h_second is None:
                return (0.0, 9999.0, 9999.0)
            return (
                trial_line_offsets[line],
                trial_line_delays[line],
                h_second,
            )

        for route in itineraries:
            virtual_clock = sim_start_time
            sim_time = 0.0
            delayed_transfer_this_trial = False
            transit_leg_count = 0

            for step_idx, step in enumerate(route["itinerary"]):
                mode = step["mode"]
                base = step["baseline_duration"]
                current_unix = virtual_clock.timestamp()

                if mode == "WALK":
                    # Check for known transfer walk time overrides
                    walk_base = base
                    if step_idx > 0 and step_idx < len(route["itinerary"]) - 1:
                        prev_step = route["itinerary"][step_idx - 1]
                        next_step = route["itinerary"][step_idx + 1]
                        if prev_step.get("mode") == "TRANSIT" and next_step.get("mode") == "TRANSIT":
                            from_line = clean_line_id(prev_step.get("line_id", ""))
                            to_line = clean_line_id(next_step.get("line_id", ""))
                            station = next_step.get("departure_stop", "")
                            override = get_transfer_walk_time(from_line, to_line, station)
                            if override is not None:
                                walk_base = override
                    leg_duration = walk_base * random.uniform(0.92, 1.12) * weather_walk_mult
                    step_stats[route["route_index"]][step_idx]["board_unix"].append(
                        current_unix
                    )
                    step_stats[route["route_index"]][step_idx]["wait_mins"].append(0.0)

                elif mode == "CITIBIKE":
                    leg_duration = base * random.uniform(0.85, 1.20)
                    step_stats[route["route_index"]][step_idx]["board_unix"].append(
                        current_unix
                    )
                    step_stats[route["route_index"]][step_idx]["wait_mins"].append(0.0)

                elif mode == "DOCKING_OVERHEAD":
                    leg_duration = base * random.uniform(0.75, 1.50)
                    step_stats[route["route_index"]][step_idx]["board_unix"].append(
                        current_unix
                    )
                    step_stats[route["route_index"]][step_idx]["wait_mins"].append(0.0)

                else:
                    transit_leg_count += 1
                    dep_stop_name = step.get("departure_stop", "")
                    arr_stop_name = step.get("arrival_stop", "")
                    line_id = clean_line_id(step.get("line_id", ""))

                    next_gtfs_arrival = None
                    if transit_leg_count == 1 and live_arrival_cache:
                        next_gtfs_arrival = next_cached_arrival(
                            live_arrival_cache.get(
                                (route["route_index"], step_idx), []
                            ),
                            current_unix,
                        )

                    lisbon_hour = get_lisbon_hour(virtual_clock)
                    is_weekend = virtual_clock.weekday() >= 5
                    if is_weekend:
                        tod = "weekend"
                    elif 6 <= lisbon_hour < 10 or 15 <= lisbon_hour < 20:
                        tod = "peak"
                    elif 10 <= lisbon_hour < 15:
                        tod = "midday"
                    elif 20 <= lisbon_hour < 24:
                        tod = "evening"
                    else:
                        tod = "overnight"

                    is_commuter_rail = step.get("is_commuter_rail", False)
                    if is_commuter_rail and step.get("scheduled_departure"):
                        sched_unix = step["scheduled_departure"].timestamp()
                        wait_time_mins = max(0.0, (sched_unix - current_unix) / 60.0)
                        _, mc_delay, _ = get_trial_line_schedule(line_id, tod)
                        ride_delay = mc_delay
                    else:
                        offset, mc_delay, headway = get_trial_line_schedule(line_id, tod)
    
                        if next_gtfs_arrival:
                            wait_time_mins = (next_gtfs_arrival - current_unix) / 60.0
                            ride_delay = mc_delay
                        else:
                            k = math.ceil((sim_time - offset) / headway)
                            next_arrival_sim = offset + k * headway + (mc_delay * 0.5)
                            wait_time_mins = next_arrival_sim - sim_time
                            ride_delay = mc_delay * 0.5

                    if wait_time_mins < 0:
                        wait_time_mins = 0

                    if transit_leg_count > 1 and step.get("scheduled_departure"):
                        sched_unix = step["scheduled_departure"].timestamp()
                        boarded_unix = current_unix + (wait_time_mins * 60.0)
                        delay_mins = (boarded_unix - sched_unix) / 60.0
                        if delay_mins > TRANSFER_DELAY_TOLERANCE_MINS:
                            delayed_transfer_this_trial = True

                    # Widen ride time variance using micro-simulation per stop
                    stop_count = max(1, step.get("stop_count", 1))
                    avg_segment_time = base / stop_count
                    micro_ride_time = 0.0
                    
                    for _ in range(stop_count):
                        # 1. Travel variance per segment
                        micro_ride_time += avg_segment_time * np.random.normal(1.0, 0.05)
                        
                        # 2. Door holding / passenger loading delays (5% chance per stop)
                        if random.random() < 0.05:
                            micro_ride_time += np.random.exponential(0.5) # mean 30s
                            
                        # 3. Train ahead / tunnel blockage (1% chance per segment)
                        if random.random() < 0.01:
                            micro_ride_time += np.random.gamma(2.0, 1.0) # mean 2 mins
                    
                    ride_time = micro_ride_time + ride_delay
                    leg_duration = wait_time_mins + ride_time

                    board_unix = current_unix + (wait_time_mins * 60.0)
                    step_stats[route["route_index"]][step_idx]["board_unix"].append(
                        board_unix
                    )
                    step_stats[route["route_index"]][step_idx]["wait_mins"].append(
                        wait_time_mins
                    )

                sim_time += leg_duration
                virtual_clock += timedelta(minutes=leg_duration)

            if delayed_transfer_this_trial:
                delayed_transfers[route["route_index"]] += 1
            trial_durations[route["route_index"]] = sim_time
            all_durations[route["route_index"]].append(sim_time)
            
            # Percentage-based severe risk (1.5x baseline)
            if sim_time > (route["baseline_mins"] * 1.5):
                severe_delays[route["route_index"]] += 1
            
            # Early arrival (beats baseline)
            if sim_time < (route["baseline_mins"] - 2.0):
                early_arrivals[route["route_index"]] += 1

        winner = min(trial_durations, key=trial_durations.get)
        win_counts[winner] += 1

    results = {}
    local_start_time = (
        sim_start_time.astimezone(LISBON_TZ)
        if sim_start_time.tzinfo
        else sim_start_time.replace(tzinfo=timezone.utc).astimezone(LISBON_TZ)
    )

    for r in itineraries:
        route_index = r["route_index"]
        durations = np.array(all_durations[route_index])

        mean_time = float(np.mean(durations))
        p50_time = float(np.percentile(durations, 50))
        p90_time = float(np.percentile(durations, 90))
        p25 = np.percentile(durations, 25)
        p75 = np.percentile(durations, 75)
        iqr_time = float(p75 - p25)

        # Handling Arrive By Reverse Calculation
        if time_mode == "arrive_by" and target_arrival_time:
            local_target_arr = (
                target_arrival_time.astimezone(LISBON_TZ)
                if target_arrival_time.tzinfo
                else target_arrival_time.replace(tzinfo=timezone.utc).astimezone(LISBON_TZ)
            )
            # Subtract P90 to find required departure
            dt_req_departure = local_target_arr - timedelta(minutes=p90_time)
            dt_est_arr = local_target_arr
        else:
            dt_req_departure = local_start_time
            dt_est_arr = local_start_time + timedelta(minutes=mean_time)

        step_metrics = {}
        for step_idx in step_stats[route_index]:
            b_unix = step_stats[route_index][step_idx]["board_unix"]
            w_mins = step_stats[route_index][step_idx]["wait_mins"]
            avg_board = np.mean(b_unix) if b_unix else 0
            avg_wait = np.mean(w_mins) if w_mins else 0

            # If arrive_by, the board times internally are shifted because they were run forward.
            # We must offset them so the final arrival equals the target.
            if time_mode == "arrive_by" and target_arrival_time:
                # The total time of the forward run was mean_time.
                # Our actual leave time is dt_req_departure.
                # Find the offset from the forward run's start to the required departure
                shift_offset_secs = (
                    dt_req_departure - local_start_time
                ).total_seconds()
                dt_board = datetime.fromtimestamp(
                    avg_board + shift_offset_secs, tz=LISBON_TZ
                )
            else:
                dt_board = datetime.fromtimestamp(avg_board, tz=LISBON_TZ)

            step_metrics[step_idx] = {
                "board_time": dt_board.strftime("%I:%M %p"),
                "wait_mins": round(avg_wait, 1),
            }

        results[route_index] = {
            "win_rate": round((win_counts[r["route_index"]] / num_trials) * 100, 1),
            "severe_risk": round((severe_delays[route_index] / num_trials) * 100, 1),
            "early_prob": round((early_arrivals[route_index] / num_trials) * 100, 1),
            "transfer_delay_prob": round(
                (delayed_transfers[route_index] / num_trials) * 100, 1
            ),
            "exp_time": round(mean_time, 1),
            "p50_mins": round(p50_time, 1),
            "p90_mins": round(p90_time, 1),
            "iqr_mins": round(iqr_time, 1),
            "best_time": round(float(np.min(durations)), 1),
            "worst_time": round(float(np.max(durations)), 1),
            "p25_mins": round(float(p25), 1),
            "p75_mins": round(float(p75), 1),
            "step_metrics": step_metrics,
            "req_departure_time": dt_req_departure.strftime("%I:%M %p"),
            "est_arrival_time": dt_est_arr.strftime("%I:%M %p"),
            "req_departure_dt": dt_req_departure,  # for backend sorting
        }
    return results


@app.post("/api/simulate")
def run_simulation(req: SimulationRequest):
    try:
        # Determine the target datetime
        if req.target_time:
            target_dt = parse_iso_time(req.target_time)
            if not target_dt:
                target_dt = datetime.now(timezone.utc)
        else:
            target_dt = datetime.now(timezone.utc)

        local_target_dt = (
            target_dt.astimezone(LISBON_TZ)
            if target_dt.tzinfo
            else target_dt.replace(tzinfo=timezone.utc).astimezone(LISBON_TZ)
        )
        local_target_str = local_target_dt.strftime("%A, %B %d %Y at %I:%M %p")

        # In Arrive By mode, Google gives us an itinerary where the start time is calculated backwards.
        # We extract that start time from the first step and run our forward Monte Carlo from there.
        itineraries = fetch_google_itineraries(
            req.origin, req.destination, target_dt, req.time_mode, req.allow_bike
        )
        if not itineraries:
            raise HTTPException(status_code=400, detail="No routes found")

        sim_start_time = target_dt
        if req.time_mode == "arrive_by":
            # Extract the Google-estimated departure time to use as the base for our forward sim
            for step in itineraries[0]["itinerary"]:
                if step.get("scheduled_departure"):
                    sim_start_time = step["scheduled_departure"] - timedelta(
                        minutes=45
                    )  # pad backward to ensure we hit it
                    break

        live_telemetry = {}
        for route in itineraries:
            for s in route["itinerary"]:
                if s["mode"] == "TRANSIT":
                    lid = s["line_id"]
                    clean = clean_line_id(lid)
                    f_key = get_transit_feed_type(clean, s["is_bus"], s["line_name"])

                    if clean not in live_telemetry:
                        delay = fetch_live_delay(clean, f_key)
                        alert = check_for_alerts(clean, f_key, s["is_bus"])
                        live_telemetry[clean] = {"delay": delay, "has_alert": alert}

        # Apply "What If" suspensions
        for line in req.suspended_lines:
            clean = clean_line_id(line)
            live_telemetry[clean] = {"delay": 9999.0, "has_alert": True}

        live_arrival_cache = build_live_arrival_cache(itineraries)
        sim_results = run_competitive_simulation(
            itineraries,
            live_telemetry,
            sim_start_time,
            req.time_mode,
            target_dt if req.time_mode == "arrive_by" else None,
            live_arrival_cache=live_arrival_cache,
        )

        payload = []
        for route in itineraries:
            route_data = route.copy()
            m = sim_results[route["route_index"]]

            for step_idx, step in enumerate(route_data["itinerary"]):
                sm = m["step_metrics"].get(step_idx, {})
                step["expected_board_time"] = sm.get("board_time", "")
                step["expected_wait_mins"] = sm.get("wait_mins", 0.0)

                if step.get("scheduled_departure") and isinstance(
                    step["scheduled_departure"], datetime
                ):
                    step["scheduled_departure"] = step[
                        "scheduled_departure"
                    ].isoformat()

            route_data["itinerary"].append(
                {
                    "mode": "ARRIVE",
                    "baseline_duration": 0,
                    "line_display": "Destination Reached",
                    "departure_stop": "N/A",
                    "arrival_stop": req.destination,
                    "expected_board_time": m["est_arrival_time"],
                    "expected_wait_mins": 0,
                }
            )

            route_data["metrics"] = m
            route_data["title"] = route_signature(route["itinerary"])

            # Carbon footprint comparison
            total_transit_mins = sum(
                s["baseline_duration"] for s in route["itinerary"] if s["mode"] == "TRANSIT"
            )
            total_walk_mins = sum(
                s["baseline_duration"] for s in route["itinerary"] if s["mode"] == "WALK"
            )
            total_bike_mins = sum(
                s["baseline_duration"] for s in route["itinerary"] if s["mode"] == "CITIBIKE"
            )
            # Rough distance estimates (mph * hours)
            transit_miles = (total_transit_mins / 60) * 17.4  # avg subway speed 17.4 mph
            walk_miles = (total_walk_mins / 60) * 3.1
            bike_miles = (total_bike_mins / 60) * 9.0
            total_miles = transit_miles + walk_miles + bike_miles
            
            # CO2 per mile: car=404g, transit=96g, walk/bike=0g
            car_co2_g = total_miles * 404
            transit_co2_g = transit_miles * 96
            co2_saved_g = car_co2_g - transit_co2_g
            
            route_data["co2_saved_kg"] = round(co2_saved_g / 1000, 2)
            route_data["total_miles"] = round(total_miles, 1)

            # Remove the backend sorting key from payload to avoid JSON serialization errors with datetimes
            if "req_departure_dt" in route_data["metrics"]:
                route_data["metrics"].pop("req_departure_dt")

            payload.append(route_data)

        # Sort the payload:
        # If arrive_by: Sort by latest departure time (most convenient)
        # If depart_at: Sort by win rate (fastest P50)
        if req.time_mode == "arrive_by":
            payload.sort(
                key=lambda r: datetime.strptime(
                    r["metrics"]["req_departure_time"], "%I:%M %p"
                ),
                reverse=True,
            )
        else:
            payload.sort(key=lambda r: r["metrics"]["win_rate"], reverse=True)

        # Add ranking index based on sorted order
        for i, r in enumerate(payload):
            r["display_rank"] = i

        weather = fetch_weather_conditions()
        return {
            "status": "success",
            "time_mode": req.time_mode,
            "target_time_str": local_target_str,
            "weather": {
                "description": weather.get("description", "clear"),
                "delay_multiplier": weather.get("delay_multiplier", 1.0),
                "walk_multiplier": weather.get("walk_multiplier", 1.0),
                "temp_c": weather.get("temp_c"),
            },
            "data": payload,
            "navegante_pass": {
                "monthly_municipal": 30.00,  # Navegante Municipal (Lisbon only)
                "monthly_metropolitan": 40.00,  # Navegante Metropolitano (greater Lisbon)
                "single_ride": 1.65,
                "zapping_ride": 1.47,
            },
        }

    except Exception as e:
        logger.error(f"Error during simulation: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
