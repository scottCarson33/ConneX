import json
import random
import requests
import numpy as np
import logging
from typing import Dict, List, Any, Optional
from datetime import datetime, timezone, timedelta
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

try:
    from google.transit import gtfs_realtime_pb2
except ImportError:
    raise RuntimeError("Missing 'gtfs-realtime-bindings'. Install via 'pip install gtfs-realtime-bindings protobuf'")

# --- LOGGING & ENVIRONMENT ---
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

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
CITIBIKE_UNLOCK = 4.79
CITIBIKE_PER_MIN = 0.30

# --- FASTAPI SETUP ---
app = FastAPI(title="MTA Stochastic Engine API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # In production, lock this down to your React app's URL
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class SimulationRequest(BaseModel):
    origin: str
    destination: str

# --- ENGINE LOGIC ---
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
            if dur > 30: bike_cost += (dur - 30) * CITIBIKE_PER_MIN
            total_fare += bike_cost
            continue

        if step["mode"] != "TRANSIT": continue

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

def parse_v2_duration(val: Any) -> float:
    if not val: return 0.0
    if isinstance(val, (int, float)): return float(val) / 60.0
    if str(val).endswith('s'): return float(val[:-1]) / 60.0
    try: return float(val) / 60.0
    except: return 0.0

def parse_iso_time(time_str: str) -> Optional[datetime]:
    if not time_str: return None
    try: return datetime.fromisoformat(time_str.replace("Z", "+00:00"))
    except: return None

def generate_route_explanation(itinerary: List[Dict]) -> str:
    steps = []
    transit_legs = 0
    for step in itinerary:
        if step["mode"] == "CITIBIKE":
            steps.append(f"Unlock Citi Bike and cycle directly to {step['arrival_stop']}")
            transit_legs += 1
        elif step["mode"] == "TRANSIT":
            if transit_legs > 0: steps.append(f"Transfer at {step['departure_stop']} to the {step['line_display']}")
            else: steps.append(f"Board the {step['line_display']} at {step['departure_stop']}")
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
        pre_rail_mins = sum(s["baseline_duration"] for s in steps[:rail_idx] if s["mode"] == "TRANSIT")
        if pre_rail_mins == 0: pre_rail_mins = 45.0
        new_steps = [{
            "mode": "CITIBIKE", "baseline_duration": pre_rail_mins * 1.6, "line_id": "Citi Bike",
            "is_bus": False, "is_ferry": False, "is_commuter_rail": False,
            "line_name": "Citi Bike Share", "departure_stop": "Origin Location", "arrival_stop": rail_step["departure_stop"],
            "line_display": "Citi Bike", "scheduled_departure": None
        }]
        new_steps.extend(steps[rail_idx:])
    else:
        walk_mins = sum(s["baseline_duration"] for s in steps if s["mode"] == "WALK")
        transit_mins = sum(s["baseline_duration"] for s in steps if s["mode"] == "TRANSIT")
        bike_duration = (walk_mins * 0.33) + (transit_mins * 1.5)
        if bike_duration > 120.0 or bike_duration == 0: return None
        new_steps = [{
            "mode": "CITIBIKE", "baseline_duration": bike_duration, "line_id": "Citi Bike",
            "is_bus": False, "is_ferry": False, "is_commuter_rail": False,
            "line_name": "Citi Bike Share", "departure_stop": "Origin", "arrival_stop": "Destination",
            "line_display": "Citi Bike", "scheduled_departure": None
        }]

    return {
        "route_index": 4, "baseline_mins": sum(s["baseline_duration"] for s in new_steps),
        "itinerary": new_steps, "cost": calculate_itinerary_fare(new_steps),
        "explanation": generate_route_explanation(new_steps)
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
    for idx, route in enumerate(data.get("routes", []), 1):
        if idx > 3: break
        total_dur = parse_v2_duration(route.get("duration"))
        
        api_fare = 0.0
        fare_details = route.get("travelAdvisory", {}).get("transitFare", {})
        if fare_details:
            api_fare = float(fare_details.get("units", "0")) + (float(fare_details.get("nanos", "0")) / 1e9)

        raw_steps = []
        for leg in route.get("legs", []):
            for step in leg.get("steps", []):
                mode = step.get("travelMode", "WALK")
                dur = parse_v2_duration(step.get("staticDuration", "0s"))
                line_id, is_bus, is_ferry, is_commuter_rail, line_name, dep_stop, arr_stop, sched_dep = None, False, False, False, "", "N/A", "N/A", None

                if mode in ["TRANSIT", "FERRY"]:
                    details = step.get("transitDetails", {})
                    t_line = details.get("transitLine", {})
                    v_type = t_line.get("vehicle", {}).get("type", "")
                    stop_details = details.get("stopDetails", {})

                    line_id = t_line.get("nameShort")
                    line_name = t_line.get("name", "")
                    is_bus = (v_type == "BUS")
                    is_ferry = (v_type == "FERRY" or mode == "FERRY")
                    is_commuter_rail = (v_type == "COMMUTER_TRAIN" or any(rn in line_name.upper() for rn in ["LIRR", "LONG ISLAND", "METRO-NORTH", "HUDSON", "HARLEM", "NEW HAVEN"]))
                    mode = "TRANSIT"
                    dep_stop = stop_details.get("departureStop", {}).get("name", "Unknown Station")
                    arr_stop = stop_details.get("arrivalStop", {}).get("name", "Unknown Station")
                    
                    dep_time_str = stop_details.get("departureTime")
                    if dep_time_str: sched_dep = parse_iso_time(dep_time_str)

                display_type = "Bus" if is_bus else "Ferry" if is_ferry else "Rail" if is_commuter_rail else "Train"
                raw_steps.append({
                    "mode": mode, "baseline_duration": dur, "line_id": line_id if line_id else line_name,
                    "is_bus": is_bus, "is_ferry": is_ferry, "is_commuter_rail": is_commuter_rail,
                    "line_name": line_name, "departure_stop": dep_stop, "arrival_stop": arr_stop,
                    "line_display": f"{line_id} {display_type}" if line_id else f"{line_name} {display_type}",
                    "scheduled_departure": sched_dep
                })

        parsed.append({
            "route_index": idx, "baseline_mins": total_dur, "itinerary": raw_steps,
            "cost": calculate_itinerary_fare(raw_steps, api_fare), "explanation": generate_route_explanation(raw_steps)
        })

    if parsed:
        bike_alt = inject_citibike_alternative(parsed[0])
        if bike_alt: parsed.append(bike_alt)

    return parsed

def run_competitive_simulation(itineraries: List[Dict], live_telemetry: Dict[str, Dict], num_trials: int = 5000) -> Dict:
    win_counts = {r["route_index"]: 0 for r in itineraries}
    severe_delays = {r["route_index"]: 0 for r in itineraries}
    missed_transfers = {r["route_index"]: 0 for r in itineraries}
    early_transfers = {r["route_index"]: 0 for r in itineraries}
    all_durations = {r["route_index"]: [] for r in itineraries} 
    
    for _ in range(num_trials):
        trial_durations = {}
        for route in itineraries:
            first_train, initial_walk_mins = None, 0.0
            for step in route["itinerary"]:
                if step["mode"] == "TRANSIT":
                    first_train = step
                    break
                if step["mode"] == "WALK":
                    initial_walk_mins += step["baseline_duration"]

            if first_train and first_train.get("scheduled_departure"):
                virtual_clock = first_train["scheduled_departure"] - timedelta(minutes=(5.0 + initial_walk_mins))
            else:
                virtual_clock = datetime.now(timezone.utc)
            
            sim_time = 0.0
            missed_this_trial, early_transfer_this_trial = False, False
            transit_leg_count = 0
            
            for step in route["itinerary"]:
                mode = step["mode"]
                base = step["baseline_duration"]

                if mode == "WALK": leg_duration = base * random.uniform(0.95, 1.20)
                elif mode == "CITIBIKE": leg_duration = base * random.uniform(0.90, 1.15)
                else: 
                    transit_leg_count += 1
                    data = live_telemetry.get(step.get("line_id"), {"delay": 0.0, "has_alert": False})
                    delay_penalty = data["delay"] + (np.random.gamma(3, 3) if data["has_alert"] else np.random.gamma(1.5, 2.0))
                    leg_duration = base + delay_penalty

                if mode == "TRANSIT" and step.get("scheduled_departure"):
                    time_diff = (virtual_clock - step["scheduled_departure"]).total_seconds() / 60.0
                    if time_diff > 0:
                        missed_this_trial = True 
                        leg_duration += random.uniform(5.0, 15.0) 
                    else:
                        leg_duration += abs(time_diff)
                        if transit_leg_count > 1: early_transfer_this_trial = True
                
                sim_time += leg_duration
                virtual_clock += timedelta(minutes=leg_duration)

            if missed_this_trial: missed_transfers[route["route_index"]] += 1
            if early_transfer_this_trial: early_transfers[route["route_index"]] += 1
            trial_durations[route["route_index"]] = sim_time
            all_durations[route["route_index"]].append(sim_time)
            if sim_time > (route["baseline_mins"] + 20.0): severe_delays[route["route_index"]] += 1

        winner = min(trial_durations, key=trial_durations.get)
        win_counts[winner] += 1

    return {
        r["route_index"]: {
            "win_rate": round((win_counts[r["route_index"]] / num_trials) * 100, 1),
            "severe_risk": round((severe_delays[r["route_index"]] / num_trials) * 100, 1),
            "miss_prob": round((missed_transfers[r["route_index"]] / num_trials) * 100, 1),
            "early_prob": round((early_transfers[r["route_index"]] / num_trials) * 100, 1),
            "exp_time": round(sum(all_durations[r["route_index"]]) / num_trials, 1),
            "best_time": round(min(all_durations[r["route_index"]]), 1),
            "worst_time": round(max(all_durations[r["route_index"]]), 1)
        } for r in itineraries
    }

# --- API ENDPOINTS ---
@app.post("/api/simulate")
async def run_simulation(req: SimulationRequest):
    try:
        itineraries = fetch_google_itineraries(req.origin, req.destination)
        if not itineraries: raise HTTPException(status_code=400, detail="No routes found")

        live_telemetry = {}
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
        
        sim_results = run_competitive_simulation(itineraries, live_telemetry)
        
        # Combine data for frontend
        payload = []
        for route in itineraries:
            route_data = route.copy()
            # Serialize datetimes for JSON
            for step in route_data["itinerary"]:
                if step.get("scheduled_departure"):
                    step["scheduled_departure"] = step["scheduled_departure"].isoformat()
            
            route_data["metrics"] = sim_results[route["route_index"]]
            
            # Create a simple title for the route
            route_str = " → ".join([s["line_id"] if s["line_id"] else "Transit" for s in route['itinerary'] if s["mode"] in ["TRANSIT", "CITIBIKE"]])
            route_data["title"] = route_str if route_str else "Walk Only"
            
            payload.append(route_data)

        return {"status": "success", "data": payload}
    
    except Exception as e:
        logger.error(f"Error during simulation: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)