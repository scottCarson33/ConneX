import json
import random
import requests
import sys
import logging
import numpy as np
from typing import Dict, List, Any, Optional
from datetime import datetime, timezone, timedelta

# --- LOGGING & ENVIRONMENT ---
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

try:
    from google.transit import gtfs_realtime_pb2
except ImportError:
    print("[!] ERROR: Missing 'gtfs-realtime-bindings'. Install via 'pip install gtfs-realtime-bindings protobuf'")
    sys.exit(1)

# --- CONFIGURATION TOKENS ---
GOOGLE_API_KEY = "AIzaSyDyiFzvUe3K7rFAXGi90QX0MQlDibmVThc"
ROUTES_ENDPOINT = "https://routes.googleapis.com/directions/v2:computeRoutes"
MTA_API_KEY = "40635c2e-4f8c-4565-abf7-0e3dfdefb924"
BUS_TIME_FEED_URL = f"https://bustime-beta.mta.info/api/gtfs-rt/tripUpdates?key={MTA_API_KEY}"

MTA_HEADERS = {"x-api-key": MTA_API_KEY}

MTA_FEED_URLS = {
    'ACE': 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-ace',
    'NQRW': 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-nqrw',
    'NUMBERS': 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs',
    'BDFM': 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-bdfm',
    'JZ': 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-jz',
    'L': 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-l',
    'G': 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-g',
    'MNR': 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/mnr%2Fgtfs-mnr',
    'LIRR': 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/lirr%2Fgtfs-lirr',
    'ALERTS': 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/camsys%2Fsubway-alerts'
}

# --- SIMULATION CONSTANTS ---
BASE_FARE = 3.00
EXPRESS_BUS_FARE = 7.25
NYC_FERRY_FARE = 4.50
STATEN_ISLAND_FERRY_FARE = 0.00

# Citi Bike Non-Member Pricing Structure
CITIBIKE_UNLOCK = 4.79
CITIBIKE_PER_MIN = 0.30

# --- FARE CALCULATION ---
def estimate_commuter_rail_fare(duration_mins: float) -> float:
    if duration_mins <= 30: return 7.00
    elif duration_mins <= 60: return 14.00
    elif duration_mins <= 90: return 18.00
    else: return 23.00

def calculate_itinerary_fare(itinerary: List[Dict], api_fare: float = 0.0) -> float:
    if api_fare > 0: return api_fare

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
            if "STATEN ISLAND" in line_name: total_fare += STATEN_ISLAND_FERRY_FARE
            elif "NYC FERRY" in line_name or "NEW YORK CITY FERRY" in line_name: total_fare += NYC_FERRY_FARE
            else: total_fare += 10.00
        elif is_bus and any(line_id.startswith(prefix) for prefix in ["QM", "SIM", "X", "BM", "BXM"]):
            total_fare += EXPRESS_BUS_FARE
        else:
            if not has_subway_or_local:
                total_fare += BASE_FARE
                has_subway_or_local = True

    return round(total_fare, 2)

# --- TELEMETRY & ALERT ENGINE ---
def get_transit_feed_type(route_id: str, is_bus: bool, line_name: str = "") -> Optional[str]:
    if is_bus: return 'BUS'
    name_upper = str(line_name).upper()
    if "LIRR" in name_upper: return 'LIRR'
    if "MNR" in name_upper or "HUDSON" in name_upper or "HARLEM" in name_upper or "NEW HAVEN" in name_upper: return 'MNR'

    route_tokens = str(route_id).upper().strip().split()
    route = route_tokens[0] if route_tokens else ""

    if route in ['A', 'C', 'E']: return 'ACE'
    if route in ['N', 'Q', 'R', 'W']: return 'NQRW'
    if route in ['B', 'D', 'F', 'M']: return 'BDFM'
    if route in ['J', 'Z']: return 'JZ'
    if route in ['L']: return 'L'
    if route in ['G']: return 'G'
    if route in ['1', '2', '3', '4', '5', '6', '7', '7X']: return 'NUMBERS'
    return None

def check_for_alerts(route_character: str) -> bool:
    feed = gtfs_realtime_pb2.FeedMessage()
    try:
        response = requests.get(MTA_FEED_URLS['ALERTS'], headers=MTA_HEADERS, timeout=5)
        if response.status_code != 200: return False
        feed.ParseFromString(response.content)
        target = str(route_character).upper().strip()
        keywords = ["delay", "slow", "suspended", "mechanical", "ongoing", "service change"]

        for entity in feed.entity:
            if entity.HasField('alert'):
                for informed in entity.alert.informed_entity:
                    if str(informed.route_id).upper().strip() == target:
                        text = str(entity.alert.header_text).lower()
                        if any(w in text for w in keywords): return True
    except: pass
    return False

def fetch_live_delay(route_id: str, feed_key: Optional[str]) -> float:
    if not feed_key: return 0.0
    url = BUS_TIME_FEED_URL if feed_key == 'BUS' else MTA_FEED_URLS.get(feed_key)
    if not url: return 0.0

    feed = gtfs_realtime_pb2.FeedMessage()
    try:
        response = requests.get(url, headers=MTA_HEADERS, timeout=5)
        if response.status_code != 200: return 0.5
        feed.ParseFromString(response.content)

        delays = []
        clean_target = str(route_id).upper().strip().split()[0]

        for entity in feed.entity:
            if entity.HasField('trip_update'):
                f_route = str(entity.trip_update.trip.route_id).upper().strip()
                if clean_target in f_route or f_route in clean_target:
                    if entity.trip_update.stop_time_update:
                        arrival = entity.trip_update.stop_time_update[0].arrival
                        if arrival and arrival.HasField('delay'):
                            delays.append(arrival.delay)
        return (sum(delays) / len(delays)) / 60.0 if delays else 0.0
    except: return 0.5

# --- PARSING ENGINE ---
def parse_v2_duration(val: Any) -> float:
    if not val: return 0.0
    if isinstance(val, (int, float)): return float(val) / 60.0
    if str(val).endswith('s'): return float(val[:-1]) / 60.0
    try: return float(val) / 60.0
    except: return 0.0

def parse_iso_time(time_str: str) -> Optional[datetime]:
    if not time_str: return None
    try:
        return datetime.fromisoformat(time_str.replace("Z", "+00:00"))
    except Exception:
        return None

def generate_route_explanation(itinerary: List[Dict]) -> str:
    steps = []
    transit_legs = 0
    for step in itinerary:
        if step["mode"] == "CITIBIKE":
            steps.append(f"Unlock Citi Bike and cycle directly to {step['arrival_stop']}")
            transit_legs += 1
        elif step["mode"] == "TRANSIT":
            if transit_legs > 0:
                steps.append(f"Transfer at {step['departure_stop']} to the {step['line_display']}")
            else:
                steps.append(f"Board the {step['line_display']} at {step['departure_stop']}")

            steps.append(f"Ride to {step['arrival_stop']}")
            transit_legs += 1

    return " -> ".join(steps) if steps else "Walking route only."

def inject_citibike_alternative(base_itinerary: Dict) -> Optional[Dict]:
    steps = base_itinerary["itinerary"]
    rail_idx = -1
    for idx, step in enumerate(steps):
        if step.get("is_commuter_rail"):
            rail_idx = idx
            break

    if rail_idx != -1:
        rail_step = steps[rail_idx]
        terminal_station = rail_step["departure_stop"]
        pre_rail_subway_mins = sum(s["baseline_duration"] for s in steps[:rail_idx] if s["mode"] == "TRANSIT")
        if pre_rail_subway_mins == 0: pre_rail_subway_mins = 45.0
        bike_duration = pre_rail_subway_mins * 1.6

        new_steps = [{
            "mode": "CITIBIKE", "baseline_duration": bike_duration, "line_id": "Citi Bike",
            "is_bus": False, "is_ferry": False, "is_commuter_rail": False,
            "line_name": "Citi Bike Share", "departure_stop": "Origin Location", "arrival_stop": terminal_station,
            "line_display": "Citi Bike", "scheduled_departure": None
        }]
        new_steps.extend(steps[rail_idx:])
    else:
        total_walk_mins = sum(s["baseline_duration"] for s in steps if s["mode"] == "WALK")
        total_transit_mins = sum(s["baseline_duration"] for s in steps if s["mode"] == "TRANSIT")
        bike_duration = (total_walk_mins * 0.33) + (total_transit_mins * 1.5)

        if bike_duration > 120.0 or bike_duration == 0:
            return None

        new_steps = [{
            "mode": "CITIBIKE", "baseline_duration": bike_duration, "line_id": "Citi Bike",
            "is_bus": False, "is_ferry": False, "is_commuter_rail": False,
            "line_name": "Citi Bike Share", "departure_stop": "Origin Location", "arrival_stop": "your destination",
            "line_display": "Citi Bike", "scheduled_departure": None
        }]

    total_dur = sum(s["baseline_duration"] for s in new_steps)
    cost = calculate_itinerary_fare(new_steps)
    explanation = generate_route_explanation(new_steps)

    return {
        "route_index": 4, "baseline_mins": total_dur, "itinerary": new_steps,
        "cost": cost, "explanation": explanation
    }

def fetch_google_itineraries(origin: str, destination: str) -> List[Dict]:
    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": GOOGLE_API_KEY,
        "X-Goog-FieldMask": "routes.duration,routes.legs.steps,routes.travelAdvisory"
    }
    payload = {"origin": {"address": origin}, "destination": {"address": destination}, "travelMode": "TRANSIT", "computeAlternativeRoutes": True}

    try:
        response = requests.post(ROUTES_ENDPOINT, json=payload, headers=headers)
        data = response.json()
    except Exception as e:
        logger.error(f"API Call Failed: {e}")
        return []

    parsed = []
    idx = 1
    for route in data.get("routes", []):
        total_dur = parse_v2_duration(route.get("duration"))

        api_fare = 0.0
        fare_details = route.get("travelAdvisory", {}).get("transitFare", {})
        if fare_details:
            units = float(fare_details.get("units", "0"))
            nanos = float(fare_details.get("nanos", "0")) / 1e9
            api_fare = units + nanos

        raw_steps = []
        for leg in route.get("legs", []):
            for step in leg.get("steps", []):
                mode = step.get("travelMode", "WALK")
                dur = parse_v2_duration(step.get("staticDuration", "0s"))
                line_id, is_bus, is_ferry, is_commuter_rail, line_name, dep_stop, arr_stop = None, False, False, False, "", "N/A", "N/A"
                scheduled_departure = None

                if mode in ["TRANSIT", "FERRY"]:
                    details = step.get("transitDetails", {})
                    t_line = details.get("transitLine", {})
                    vehicle_type = t_line.get("vehicle", {}).get("type", "")
                    stop_details = details.get("stopDetails", {})

                    line_id = t_line.get("nameShort")
                    line_name = t_line.get("name", "")

                    is_bus = (vehicle_type == "BUS")
                    is_ferry = (vehicle_type == "FERRY" or mode == "FERRY")

                    rail_names = ["LIRR", "LONG ISLAND", "METRO-NORTH", "HUDSON", "HARLEM", "NEW HAVEN"]
                    is_commuter_rail = (vehicle_type == "COMMUTER_TRAIN" or any(rn in line_name.upper() for rn in rail_names))

                    mode = "TRANSIT"
                    dep_stop = stop_details.get("departureStop", {}).get("name", "Unknown Station")
                    arr_stop = stop_details.get("arrivalStop", {}).get("name", "Unknown Station")

                    dep_time_str = stop_details.get("departureTime")
                    if dep_time_str:
                        scheduled_departure = parse_iso_time(dep_time_str)

                display_type = "Bus" if is_bus else "Ferry" if is_ferry else "Rail" if is_commuter_rail else "Train"

                raw_steps.append({
                    "mode": mode, "baseline_duration": dur, "line_id": line_id if line_id else line_name,
                    "is_bus": is_bus, "is_ferry": is_ferry, "is_commuter_rail": is_commuter_rail,
                    "line_name": line_name, "departure_stop": dep_stop, "arrival_stop": arr_stop,
                    "line_display": f"{line_id} {display_type}" if line_id else f"{line_name} {display_type}",
                    "scheduled_departure": scheduled_departure
                })

        final_cost = calculate_itinerary_fare(raw_steps, api_fare)
        explanation = generate_route_explanation(raw_steps)

        parsed.append({
            "route_index": idx, "baseline_mins": total_dur, "itinerary": raw_steps,
            "cost": final_cost, "explanation": explanation
        })
        idx += 1
        if idx > 3: break

    if parsed:
        bike_alt = inject_citibike_alternative(parsed[0])
        if bike_alt: parsed.append(bike_alt)

    return parsed

# --- STOCHASTIC SIMULATION WITH BUTTERFLY EFFECT ---
def run_competitive_simulation(itineraries: List[Dict], live_telemetry: Dict[str, Dict], num_trials: int = 5000) -> Dict:
    win_counts = {r["route_index"]: 0 for r in itineraries}
    severe_delays = {r["route_index"]: 0 for r in itineraries}
    missed_transfers = {r["route_index"]: 0 for r in itineraries}

    MIN_HEADWAY = 5.0

    for _ in range(num_trials):
        trial_durations = {}

        for route in itineraries:
            first_train = next((step for step in route["itinerary"] if step["mode"] == "TRANSIT"), None)
            if first_train and first_train.get("scheduled_departure"):
                virtual_clock = first_train["scheduled_departure"] - timedelta(minutes=5)
            else:
                virtual_clock = datetime.now(timezone.utc)

            sim_time = 0.0
            missed_this_trial = False

            for step in route["itinerary"]:
                mode = step["mode"]
                base = step["baseline_duration"]

                if mode == "WALK":
                    leg_duration = base * random.uniform(0.95, 1.20)
                elif mode == "CITIBIKE":
                    leg_duration = base * random.uniform(0.90, 1.15)
                else:
                    data = live_telemetry.get(step.get("line_id"), {"delay": 0.0, "has_alert": False})
                    delay_penalty = data["delay"] + (np.random.gamma(3, 3) if data["has_alert"] else np.random.gamma(1.5, 2.0))
                    leg_duration = base + delay_penalty

                if mode == "TRANSIT" and step.get("scheduled_departure"):
                    if virtual_clock > step["scheduled_departure"]:
                        missed_this_trial = True
                        wait_penalty = random.uniform(MIN_HEADWAY, 15.0)
                        leg_duration += wait_penalty

                sim_time += leg_duration
                virtual_clock += timedelta(minutes=leg_duration)

            if missed_this_trial:
                missed_transfers[route["route_index"]] += 1

            trial_durations[route["route_index"]] = sim_time

            if sim_time > (route["baseline_mins"] + 20.0):
                severe_delays[route["route_index"]] += 1

        winner = min(trial_durations, key=trial_durations.get)
        win_counts[winner] += 1

    return {
        r["route_index"]: {
            "win_rate": (win_counts[r["route_index"]] / num_trials) * 100,
            "severe_risk": (severe_delays[r["route_index"]] / num_trials) * 100,
            "miss_prob": (missed_transfers[r["route_index"]] / num_trials) * 100
        } for r in itineraries
    }

# --- EXECUTION ---
def display_results(itineraries: List[Dict], sim: Dict):
    print("\n[+] DETAILED ROUTE BREAKDOWN:")
    for route in itineraries:
        print(f"\n--- OPTION {route['route_index']} ---")
        print(f"Estimated Cost: ${route['cost']:.2f}")
        print(f"Route Guide:    {route['explanation']}")
        print("Leg Breakdown:")

        first_transit = True
        for step in route['itinerary']:
            dur_str = f"({step['baseline_duration']:.1f}m)"

            time_str = ""
            if step.get('scheduled_departure'):
                local_time = step['scheduled_departure'].astimezone().strftime("%I:%M %p")
                time_str = f" [Sched: {local_time}]"

            if step['mode'] in ['TRANSIT', 'CITIBIKE']:
                action = "[BIKE UNLOCK]" if step['mode'] == 'CITIBIKE' else "[BOARD]" if first_transit else "[TRANSFER]"
                print(f"    {action:<14} @ {step.get('departure_stop', 'N/A'):<25} | {step['line_display']:<18} {time_str:<15} {dur_str:>8}")
                first_transit = False
            else:
                print(f"    [WALK]         {'-':<27} | {'Walking':<18} {'':<15} {dur_str:>8}")

    print("\n" + "="*115)
    print(f"{'Opt':<4} | {'Route Overview':<30} | {'Base':<7} | {'Cost':<7} | {'Win Rate':<10} | {'Risk (>20m)':<12} | {'Miss Prob':<10}")
    print("-" * 115)
    for r in itineraries:
        metrics = sim[r['route_index']]
        route_str = " → ".join([s["line_id"] if s["line_id"] else "Transit" for s in r['itinerary'] if s["mode"] in ["TRANSIT", "CITIBIKE"]])
        if len(route_str) > 28: route_str = route_str[:25] + "..."
        elif not route_str: route_str = "Walk"

        miss_prob_str = f"{metrics['miss_prob']:.1f}%"
        if r['route_index'] == 4: miss_prob_str = "N/A" # Bikes don't miss transfers

        print(f"#{r['route_index']:<3} | {route_str:<30} | {r['baseline_mins']:>5.1f}m | ${r['cost']:<6.2f} | {metrics['win_rate']:>7.1f}% | {metrics['severe_risk']:>8.1f}% | {miss_prob_str:>9}")
    print("="*115)

def main():
    print("==========================================================")
    print("   MTA STOCHASTIC ENGINE (V9.0) | HYBRID SCHEDULING       ")
    print("==========================================================")

    origin = input("Origin: ").strip()
    dest = input("Destination: ").strip()

    itineraries = fetch_google_itineraries(origin, dest)
    if not itineraries:
        print("[!] No routes found or API failed.")
        return

    live_telemetry = {}
    print("\n[+] FETCHING LIVE MTA TELEMETRY...")
    for route in itineraries:
        for s in route["itinerary"]:
            if s["mode"] == "TRANSIT":
                lid = s["line_id"]
                clean_str = str(lid).split()[0] if lid else ""
                clean = clean_str[0] if (clean_str.startswith('7') or clean_str.startswith('6')) else clean_str
                f_key = get_transit_feed_type(clean, s["is_bus"], s["line_name"])

                if lid not in live_telemetry:
                    delay = fetch_live_delay(clean, f_key)
                    alert = check_for_alerts(clean)
                    live_telemetry[lid] = {"delay": delay, "has_alert": alert}
                    print(f"    --> [{f_key or 'UNKN':<4}] {clean} | MTA Delay Tracker: +{delay:.1f}m | Alert Active: {alert}")

    print("\n[+] EXECUTING 5,000 MONTE CARLO SCHEDULE ITERATIONS...")
    sim = run_competitive_simulation(itineraries, live_telemetry)
    display_results(itineraries, sim)

if __name__ == "__main__":
    main()
