import csv
import math
import requests
from datetime import datetime
from google.transit import gtfs_realtime_pb2

MTA_FEED_URLS = {
    'ACE': 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-ace',
    'BDFM': 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-bdfm',
    'G': 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-g',
    'JZ': 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-jz',
    'NQRW': 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-nqrw',
    'L': 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-l',
    'NUMBERS': 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs',
    '7': 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs' # 7 is in the main feed
}

def get_feed_key(line_id: str) -> str:
    line = str(line_id).upper().strip()
    if line in ['A', 'C', 'E']: return 'ACE'
    if line in ['B', 'D', 'F', 'M']: return 'BDFM'
    if line in ['N', 'Q', 'R', 'W']: return 'NQRW'
    if line in ['J', 'Z']: return 'JZ'
    if line in ['1', '2', '3', '4', '5', '6']: return 'NUMBERS'
    if line == '7': return '7'
    if line == 'L': return 'L'
    if line == 'G': return 'G'
    return 'NUMBERS'

class RealtimeEngine:
    def __init__(self):
        self.stops = {}
        self.load_stops()
        self.cache = {}

    def load_stops(self):
        try:
            with open("stops.txt", "r", encoding="utf-8") as f:
                reader = csv.DictReader(f)
                for row in reader:
                    # Only store parent stations or the platform itself
                    self.stops[row["stop_id"]] = {
                        "name": row["stop_name"].lower(),
                        "lat": float(row["stop_lat"]),
                        "lon": float(row["stop_lon"])
                    }
        except Exception as e:
            print(f"Error loading stops.txt: {e}")

    def find_stop_id_by_name(self, stop_name: str, line_id: str) -> str:
        """Find the best GTFS parent stop_id for a Google Maps stop name"""
        target = stop_name.lower().strip()
        # Direct exact match
        matches = [s_id for s_id, s_data in self.stops.items() if s_data["name"] == target and len(s_id) <= 3]
        
        if not matches:
            # Fuzzy match
            matches = [s_id for s_id, s_data in self.stops.items() if target in s_data["name"] and len(s_id) <= 3]
            
        if not matches:
            return ""
            
        # MTA has multiple stop IDs with the same name (e.g. 42 St-Times Sq is 127, 725, 902, R16)
        # We must pick the one that matches the line_id!
        # The line_id mapping to stop_id prefix is complicated, but generally:
        # 1,2,3 -> 1xx, 2xx, 3xx
        # 4,5,6 -> 4xx, 6xx
        # 7 -> 7xx
        # A,C,E -> Axx
        # B,D,F,M -> Bxx, Dxx, Fxx
        # N,Q,R,W -> Rxx
        # L -> Lxx
        prefix_map = {
            'A': 'A', 'C': 'A', 'E': 'A',
            'B': ['B', 'D'], 'D': ['B', 'D'], 'F': 'F', 'M': 'F',
            'N': 'R', 'Q': 'R', 'R': 'R', 'W': 'R',
            '1': '1', '2': '2', '3': '3',
            '4': '4', '5': '5', '6': '6',
            '7': '7', 'L': 'L', 'G': 'G', 'J': 'J', 'Z': 'J'
        }
        
        expected_prefixes = prefix_map.get(line_id.upper(), "")
        if isinstance(expected_prefixes, str):
            expected_prefixes = [expected_prefixes]
            
        for s_id in matches:
            for p in expected_prefixes:
                if s_id.startswith(p):
                    return s_id
                    
        return matches[0] if matches else ""

    def get_direction(self, dep_id: str, arr_id: str) -> str:
        """Heuristic to determine N or S direction based on lat/lon"""
        if not dep_id or not arr_id or dep_id not in self.stops or arr_id not in self.stops:
            return "S" # default fallback
            
        dep = self.stops[dep_id]
        arr = self.stops[arr_id]
        
        d_lat = arr["lat"] - dep["lat"]
        d_lon = arr["lon"] - dep["lon"]
        
        if abs(d_lat) > abs(d_lon):
            # Mostly North/South
            return "N" if d_lat > 0 else "S"
        else:
            # Mostly East/West (e.g. L train or 7 train)
            # MTA Convention: Queens/Brooklyn bound is S, Manhattan bound is N
            return "S" if d_lon > 0 else "N"

    def fetch_live_arrivals(self, line_id: str, stop_id: str, direction: str) -> list:
        """Returns a sorted list of Unix timestamps for upcoming arrivals"""
        feed_key = get_feed_key(line_id)
        url = MTA_FEED_URLS.get(feed_key)
        if not url or not stop_id:
            return []

        # Simple memory caching for 30 seconds to avoid spamming the MTA API during 5000 MC trials
        import time
        cache_key = f"{feed_key}_{stop_id}_{direction}"
        if cache_key in self.cache:
            if time.time() - self.cache[cache_key]['time'] < 30:
                return self.cache[cache_key]['arrivals']

        target_stop = f"{stop_id}{direction}"
        arrivals = []

        try:
            feed = gtfs_realtime_pb2.FeedMessage()
            res = requests.get(url, timeout=5)
            if res.status_code == 200:
                feed.ParseFromString(res.content)
                for entity in feed.entity:
                    if entity.HasField('trip_update'):
                        route = str(entity.trip_update.trip.route_id).upper().strip()
                        # Allow exact match or substring match (e.g. '5X' matches '5')
                        if line_id.upper() in route or route in line_id.upper():
                            for stu in entity.trip_update.stop_time_update:
                                if stu.stop_id == target_stop:
                                    if stu.arrival and stu.arrival.time > 0:
                                        arrivals.append(stu.arrival.time)
        except Exception as e:
            pass

        arrivals.sort()
        self.cache[cache_key] = {
            'time': time.time(),
            'arrivals': arrivals
        }
        
        return arrivals

# Global singleton
engine = RealtimeEngine()
