import requests
import logging
import time
from typing import Dict

logger = logging.getLogger(__name__)

# Cache weather for 15 minutes
_weather_cache: Dict = {"data": None, "timestamp": 0}
WEATHER_CACHE_TTL = 900  # 15 minutes

# Lisbon weather via Open-Meteo (free, no key needed)
WEATHER_URL = "https://api.open-meteo.com/v1/forecast?latitude=38.7223&longitude=-9.1393&current=temperature_2m,wind_speed_10m,weather_code"


def fetch_weather_conditions() -> Dict:
    now = time.time()
    if _weather_cache["data"] and (now - _weather_cache["timestamp"]) < WEATHER_CACHE_TTL:
        return _weather_cache["data"]
    
    try:
        resp = requests.get(WEATHER_URL, timeout=5)
        if resp.status_code != 200:
            return _default_conditions()
        
        current = resp.json().get("current", {})
        temp_c = current.get("temperature_2m")
        wind_speed_kmh = current.get("wind_speed_10m", 0)
        weather_code = current.get("weather_code", 0)
        
        # WMO Weather codes: https://www.nodc.noaa.gov/archive/arc0021/0002199/1.1/data/0-data/HTML/WMO-CODE/WMO4677.HTM
        delay_multiplier = 1.0
        walk_multiplier = 1.0
        description = "clear"
        
        if weather_code in [61, 63, 65, 80, 81, 82]:  # Rain
            description = "rain"
            delay_multiplier *= 1.3
            walk_multiplier *= 1.25
            if weather_code in [65, 82]:  # Heavy rain
                description = "heavy rain"
                delay_multiplier *= 1.5
                walk_multiplier *= 1.4
        elif weather_code in [95, 96, 99]:  # Thunderstorm
            description = "thunderstorm"
            delay_multiplier *= 1.6
            walk_multiplier *= 1.5
        elif weather_code in [71, 73, 75, 77, 85, 86]:  # Snow (rare in Lisbon)
            description = "snow"
            delay_multiplier *= 2.0
            walk_multiplier *= 1.5
        elif weather_code in [51, 53, 55, 56, 57]:  # Drizzle
            description = "drizzle"
            delay_multiplier *= 1.1
            walk_multiplier *= 1.1
        elif weather_code in [45, 48]:  # Fog
            description = "fog"
            delay_multiplier *= 1.1
        elif weather_code in [0, 1]:  # Clear
            description = "clear"
        elif weather_code in [2, 3]:  # Partly cloudy / overcast
            description = "cloudy"
        
        # Extreme heat (Lisbon summers can be brutal)
        if temp_c is not None and temp_c > 38:
            delay_multiplier *= 1.2
        
        # High winds
        if wind_speed_kmh > 60:
            delay_multiplier *= 1.3
        
        result = {
            "delay_multiplier": round(delay_multiplier, 2),
            "walk_multiplier": round(walk_multiplier, 2),
            "description": description,
            "temp_c": temp_c,
            "is_outdoor_risk": delay_multiplier > 1.3,
        }
        
        _weather_cache["data"] = result
        _weather_cache["timestamp"] = now
        logger.info(f"Weather: {description}, delay_mult={delay_multiplier}, walk_mult={walk_multiplier}")
        return result
        
    except Exception as e:
        logger.warning(f"Weather fetch failed: {e}")
        return _default_conditions()


def _default_conditions() -> Dict:
    return {
        "delay_multiplier": 1.0,
        "walk_multiplier": 1.0,
        "description": "unknown",
        "temp_c": None,
        "is_outdoor_risk": False,
    }
