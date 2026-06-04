import json
import logging
import math
import os
import random
import time
from bisect import bisect_left
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import numpy as np
import requests
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from google.transit import gtfs_realtime_pb2
from pydantic import BaseModel, Field

from alternative_routes import find_alternatives, get_headway
from realtime_engine import engine as rt_engine

# --- LOGGING & ENVIRONMENT ---
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

# --- SECURE CONFIGURATION TOKENS ---
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY", "AIzaSyDyiFzvUe3K7rFAXGi90QX0MQlDibmVThc")
MTA_API_KEY = os.getenv("MTA_API_KEY", "40635c2e-4f8c-4565-abf7-0e3dfdefb924")

ROUTES_ENDPOINT = "https://routes.googleapis.com/directions/v2:computeRoutes"
BUS_TIME_FEED_URL = (
    f"https://bustime-beta.mta.info/api/gtfs-rt/tripUpdates?key={MTA_API_KEY}"
)
MTA_HEADERS = {"x-api-key": MTA_API_KEY}

MTA_FEED_URLS = {
    "ACE": "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-ace",
    "NQRW": "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-nqrw",
    "NUMBERS": "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs",
    "BDFM": "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-bdfm",
    "JZ": "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-jz",
    "L": "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-l",
    "G": "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-g",
    "MNR": "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/mnr%2Fgtfs-mnr",
    "LIRR": "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/lirr%2Fgtfs-lirr",
    "ALERTS": "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/camsys%2Fsubway-alerts",
}

# --- SIMULATION CONSTANTS ---
BASE_FARE = 3.00
EXPRESS_BUS_FARE = 7.25
NYC_FERRY_FARE = 4.50
STATEN_ISLAND_FERRY_FARE = 0.00
CITIBIKE_UNLOCK = 4.79
CITIBIKE_PER_MIN = 0.30

CITIBIKE_WALK_TO_STATION = 4.0
CITIBIKE_UNLOCK_DOCK_TIME = 2.0
CITIBIKE_WALK_TO_DESTINATION = 4.0

DEFAULT_SIM_TRIALS = int(os.getenv("SIM_TRIALS", "2000"))

app = FastAPI(title="MTA Stochastic Engine API")

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


def clean_line_id(line_id: str) -> str:
    token = str(line_id or "").upper().strip().split()[0]
    if token.startswith(("6", "7")):
        return token[0]
    return token


def estimate_commuter_rail_fare(duration_mins: float) -> float:
    if duration_mins <= 30:
        return 7.00
    elif duration_mins <= 60:
        return 14.00
    elif duration_mins <= 90:
        return 18.00
    else:
        return 23.00


def calculate_itinerary_fare(itinerary: List[Dict], api_fare: float = 0.0) -> float:
    if api_fare > 0:
        return api_fare
    total_fare = 0.0
    has_subway_or_local = False

    for step in itinerary:
        if step["mode"] == "CITIBIKE":
            dur = step.get("baseline_duration", 0.0)
            bike_cost = CITIBIKE_UNLOCK
            if dur > 30:
                bike_cost += (dur - 30) * CITIBIKE_PER_MIN
            total_fare += bike_cost
            continue

        if step["mode"] != "TRANSIT":
            continue

        line_id = str(step.get("line_id", "")).upper()
        line_name = str(step.get("line_name", "")).upper()
        is_bus = step.get("is_bus", False)
        is_ferry = step.get("is_ferry", False)
        is_rail = step.get("is_commuter_rail", False)
        duration = step.get("baseline_duration", 0.0)

        if is_rail:
            total_fare += estimate_commuter_rail_fare(duration)
        elif is_ferry:
            if "STATEN ISLAND" in line_name:
                total_fare += STATEN_ISLAND_FERRY_FARE
            elif "NYC FERRY" in line_name or "NEW YORK CITY FERRY" in line_name:
                total_fare += NYC_FERRY_FARE
            else:
                total_fare += 10.00
        elif is_bus and any(
            line_id.startswith(prefix) for prefix in ["QM", "SIM", "X", "BM", "BXM"]
        ):
            total_fare += EXPRESS_BUS_FARE
        else:
            if not has_subway_or_local:
                total_fare += BASE_FARE
                has_subway_or_local = True

    return round(total_fare, 2)


def get_transit_feed_type(
    route_id: str, is_bus: bool, line_name: str = ""
) -> Optional[str]:
    if is_bus:
        return "BUS"
    name_upper = str(line_name).upper()
    if "LIRR" in name_upper:
        return "LIRR"
    if (
        "MNR" in name_upper
        or "HUDSON" in name_upper
        or "HARLEM" in name_upper
        or "NEW HAVEN" in name_upper
    ):
        return "MNR"

    route_tokens = str(route_id).upper().strip().split()
    route = route_tokens[0] if route_tokens else ""
    if route in ["A", "C", "E"]:
        return "ACE"
    if route in ["N", "Q", "R", "W"]:
        return "NQRW"
    if route in ["B", "D", "F", "M"]:
        return "BDFM"
    if route in ["J", "Z"]:
        return "JZ"
    if route in ["L"]:
        return "L"
    if route in ["G"]:
        return "G"
    if route in ["1", "2", "3", "4", "5", "6", "7", "7X"]:
        return "NUMBERS"
    return None


def check_for_alerts(route_character: str) -> bool:
    feed = gtfs_realtime_pb2.FeedMessage()
    try:
        response = requests.get(MTA_FEED_URLS["ALERTS"], headers=MTA_HEADERS, timeout=5)
        if response.status_code != 200:
            return False
        feed.ParseFromString(response.content)
        target = str(route_character).upper().strip()
        keywords = [
            "delay",
            "slow",
            "suspended",
            "mechanical",
            "ongoing",
            "service change",
        ]

        for entity in feed.entity:
            if entity.HasField("alert"):
                for informed in entity.alert.informed_entity:
                    if str(informed.route_id).upper().strip() == target:
                        text = str(entity.alert.header_text).lower()
                        if any(w in text for w in keywords):
                            return True
    except:
        pass
    return False


def fetch_live_delay(route_id: str, feed_key: Optional[str]) -> float:
    if not feed_key:
        return 0.0
    url = BUS_TIME_FEED_URL if feed_key == "BUS" else MTA_FEED_URLS.get(feed_key)
    if not url:
        return 0.0

    feed = gtfs_realtime_pb2.FeedMessage()
    try:
        response = requests.get(url, headers=MTA_HEADERS, timeout=5)
        if response.status_code != 200:
            return 0.5
        feed.ParseFromString(response.content)

        delays = []
        clean_target = str(route_id).upper().strip().split()[0]

        for entity in feed.entity:
            if entity.HasField("trip_update"):
                f_route = str(entity.trip_update.trip.route_id).upper().strip()
                if clean_target in f_route or f_route in clean_target:
                    if entity.trip_update.stop_time_update:
                        arrival = entity.trip_update.stop_time_update[0].arrival
                        if arrival and arrival.HasField("delay"):
                            delays.append(arrival.delay)
        return (sum(delays) / len(delays)) / 60.0 if delays else 0.0
    except:
        return 0.5


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
    for step in itinerary:
        if step["mode"] == "TRANSIT":
            label = str(step.get("line_display") or step.get("line_id") or "Transit")
            for suffix in [" Train", " Bus", " Ferry", " Rail"]:
                label = label.replace(suffix, "")
            if not segments or segments[-1] != label:
                segments.append(label)
        elif step["mode"] == "CITIBIKE" and "Citi Bike" not in segments:
            segments.append("Citi Bike")
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
                "arrival_stop": "Citi Bike Station",
                "line_display": "Walk to Station",
            },
            {
                "mode": "CITIBIKE",
                "baseline_duration": cycling_duration,
                "line_id": "Citi Bike",
                "departure_stop": "Citi Bike Station",
                "arrival_stop": rail_step["departure_stop"],
                "line_display": "Citi Bike Ride",
            },
            {
                "mode": "DOCKING_OVERHEAD",
                "baseline_duration": CITIBIKE_UNLOCK_DOCK_TIME,
                "line_id": "Docking Overhead",
                "departure_stop": "Docking Hub",
                "arrival_stop": "Docking Hub",
                "line_display": "Dock Bike",
            },
            {
                "mode": "WALK",
                "baseline_duration": 2.0,
                "line_id": "Walk",
                "departure_stop": "Docking Hub",
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
                "arrival_stop": "Nearest Citi Bike Station",
                "line_display": "Walk to Origin Dock",
            },
            {
                "mode": "CITIBIKE",
                "baseline_duration": cycling_duration,
                "line_id": "Citi Bike",
                "departure_stop": "Nearest Citi Bike Station",
                "arrival_stop": "Destination Docking Station",
                "line_display": "Citi Bike Ride",
            },
            {
                "mode": "DOCKING_OVERHEAD",
                "baseline_duration": CITIBIKE_UNLOCK_DOCK_TIME,
                "line_id": "Docking Overhead",
                "departure_stop": "Destination Docking Station",
                "arrival_stop": "Destination Docking Station",
                "line_display": "Dock Bike",
            },
            {
                "mode": "WALK",
                "baseline_duration": CITIBIKE_WALK_TO_DESTINATION,
                "line_id": "Walk",
                "departure_stop": "Destination Docking Station",
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


def fetch_google_itineraries(
    origin: str, destination: str, target_time: datetime, time_mode: str
) -> List[Dict]:
    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": GOOGLE_API_KEY,
        "X-Goog-FieldMask": "routes.duration,routes.legs.steps,routes.travelAdvisory",
    }

    payload = {
        "origin": {"address": origin},
        "destination": {"address": destination},
        "travelMode": "TRANSIT",
        "computeAlternativeRoutes": True,
    }

    rfc_time = target_time.strftime("%Y-%m-%dT%H:%M:%SZ")
    if time_mode == "arrive_by":
        payload["arrivalTime"] = rfc_time
    else:
        payload["departureTime"] = rfc_time

    try:
        response = requests.post(ROUTES_ENDPOINT, json=payload, headers=headers)
        data = response.json()
    except Exception as e:
        logger.error(f"API Call Failed: {e}")
        return []

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

                line_id = t_line.get("nameShort")
                line_name = t_line.get("name", "")
                is_bus = v_type == "BUS"
                is_ferry = v_type == "FERRY" or mode == "FERRY"
                is_commuter_rail = v_type == "COMMUTER_TRAIN" or any(
                    rn in line_name.upper()
                    for rn in [
                        "LIRR",
                        "LONG ISLAND",
                        "METRO-NORTH",
                        "HUDSON",
                        "HARLEM",
                        "NEW HAVEN",
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
        bike_alt = inject_citibike_alternative(parsed_deduped[0], destination)
        if bike_alt:
            bike_alt["route_index"] = len(parsed_deduped) + 1
            parsed_deduped.append(bike_alt)

    return parsed_deduped


def build_live_arrival_cache(itineraries: List[Dict]) -> Dict[tuple, List[float]]:
    arrival_cache = {}
    for route in itineraries:
        transit_leg_count = 0
        for step_idx, step in enumerate(route["itinerary"]):
            if step["mode"] != "TRANSIT":
                continue
            transit_leg_count += 1
            dep_stop_name = step.get("departure_stop", "")
            arr_stop_name = step.get("arrival_stop", "")
            line_id = clean_line_id(step.get("line_id", ""))
            lines = [line_id]

            if transit_leg_count > 1:
                lines = (
                    find_alternatives(line_id, dep_stop_name, arr_stop_name) or lines
                )

            arrivals = []
            for candidate_line in lines:
                dep_id = rt_engine.find_stop_id_by_name(dep_stop_name, candidate_line)
                arr_id = rt_engine.find_stop_id_by_name(arr_stop_name, candidate_line)
                direction = rt_engine.get_direction(dep_id, arr_id)
                arrivals.extend(
                    rt_engine.fetch_live_arrivals(candidate_line, dep_id, direction)
                )

            arrival_cache[(route["route_index"], step_idx)] = sorted(set(arrivals))

    return arrival_cache


def next_cached_arrival(arrivals: List[float], current_unix: float) -> Optional[float]:
    if not arrivals:
        return None
    idx = bisect_left(arrivals, current_unix)
    return arrivals[idx] if idx < len(arrivals) else None


def get_nyc_hour(dt: datetime) -> int:
    est_offset = timedelta(hours=-4)
    return (dt + est_offset).hour


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

    all_durations = {r["route_index"]: [] for r in itineraries}
    step_stats = {
        r["route_index"]: {
            i: {"board_unix": [], "wait_mins": []} for i in range(len(r["itinerary"]))
        }
        for r in itineraries
    }

    TRANSFER_DELAY_TOLERANCE_MINS = 2.0

    for _ in range(num_trials):
        trial_durations = {}
        trial_line_offsets = {}
        trial_line_delays = {}

        def get_trial_line_schedule(line, tod):
            if line not in trial_line_offsets:
                h = get_headway(line, tod) or 10.0
                trial_line_offsets[line] = random.uniform(0, h)
                data = live_telemetry.get(line, {"delay": 0.0, "has_alert": False})
                gamma_delay = (
                    np.random.gamma(3, 3)
                    if data["has_alert"]
                    else np.random.gamma(1.5, 2.0)
                )
                trial_line_delays[line] = data["delay"] + gamma_delay
            return (
                trial_line_offsets[line],
                trial_line_delays[line],
                get_headway(line, tod) or 10.0,
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
                    leg_duration = base * random.uniform(0.92, 1.12)
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

                    if live_arrival_cache is not None:
                        next_gtfs_arrival = next_cached_arrival(
                            live_arrival_cache.get(
                                (route["route_index"], step_idx), []
                            ),
                            current_unix,
                        )
                    else:
                        dep_id = rt_engine.find_stop_id_by_name(dep_stop_name, line_id)
                        arr_id = rt_engine.find_stop_id_by_name(arr_stop_name, line_id)
                        direction = rt_engine.get_direction(dep_id, arr_id)
                        gtfs_arrivals = rt_engine.fetch_live_arrivals(
                            line_id, dep_id, direction
                        )
                        next_gtfs_arrival = next_cached_arrival(
                            gtfs_arrivals, current_unix
                        )

                    if next_gtfs_arrival:
                        wait_time_mins = (next_gtfs_arrival - current_unix) / 60.0
                    else:
                        nyc_hour = get_nyc_hour(virtual_clock)
                        if 6 <= nyc_hour < 10 or 15 <= nyc_hour < 20:
                            tod = "peak"
                        elif 10 <= nyc_hour < 15:
                            tod = "midday"
                        elif 20 <= nyc_hour < 24:
                            tod = "evening"
                        else:
                            tod = "overnight"

                        offset, delay, headway = get_trial_line_schedule(line_id, tod)
                        k = math.ceil((sim_time - offset - delay) / headway)
                        next_arrival_sim = offset + k * headway + delay
                        wait_time_mins = next_arrival_sim - sim_time

                    if wait_time_mins < 0:
                        wait_time_mins = 0

                    if transit_leg_count > 1 and step.get("scheduled_departure"):
                        sched_unix = step["scheduled_departure"].timestamp()
                        boarded_unix = current_unix + (wait_time_mins * 60.0)
                        delay_mins = (boarded_unix - sched_unix) / 60.0
                        if delay_mins > TRANSFER_DELAY_TOLERANCE_MINS:
                            delayed_transfer_this_trial = True

                    ride_time = base * random.uniform(0.95, 1.05)
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
            if sim_time > (route["baseline_mins"] + 20.0):
                severe_delays[route["route_index"]] += 1

        winner = min(trial_durations, key=trial_durations.get)
        win_counts[winner] += 1

    results = {}
    est_offset = timedelta(hours=-4)
    local_start_time = sim_start_time + est_offset

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
            local_target_arr = target_arrival_time + est_offset
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
                dt_board = (
                    datetime.fromtimestamp(
                        avg_board + shift_offset_secs, tz=timezone.utc
                    )
                    + est_offset
                )
            else:
                dt_board = (
                    datetime.fromtimestamp(avg_board, tz=timezone.utc) + est_offset
                )

            step_metrics[step_idx] = {
                "board_time": dt_board.strftime("%I:%M %p"),
                "wait_mins": round(avg_wait, 1),
            }

        results[route_index] = {
            "win_rate": round((win_counts[r["route_index"]] / num_trials) * 100, 1),
            "severe_risk": round((severe_delays[route_index] / num_trials) * 100, 1),
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

        est_offset = timedelta(hours=-4)
        local_target_str = (target_dt + est_offset).strftime("%A, %B %d %Y at %I:%M %p")

        # In Arrive By mode, Google gives us an itinerary where the start time is calculated backwards.
        # We extract that start time from the first step and run our forward Monte Carlo from there.
        itineraries = fetch_google_itineraries(
            req.origin, req.destination, target_dt, req.time_mode
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
                        alert = check_for_alerts(clean)
                        live_telemetry[clean] = {"delay": delay, "has_alert": alert}

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

        return {
            "status": "success",
            "time_mode": req.time_mode,
            "target_time_str": local_target_str,
            "data": payload,
        }

    except Exception as e:
        logger.error(f"Error during simulation: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
