import requests
import logging
import time
from typing import Dict

logger = logging.getLogger(__name__)

# Cache weather for 15 minutes
_weather_cache: Dict = {"data": None, "timestamp": 0}
WEATHER_CACHE_TTL = 900  # 15 minutes

# NWS API for NYC (Central Park station)
NWS_STATION_URL = "https://api.weather.gov/stations/KNYC/observations/latest"

def fetch_weather_conditions() -> Dict:
    """Fetch current NYC weather and return simulation multipliers."""
    now = time.time()
    if _weather_cache["data"] and (now - _weather_cache["timestamp"]) < WEATHER_CACHE_TTL:
        return _weather_cache["data"]
    
    try:
        headers = {"User-Agent": "MTA-Stochastic-Engine/1.0"}
        resp = requests.get(NWS_STATION_URL, headers=headers, timeout=5)
        if resp.status_code != 200:
            return _default_conditions()
        
        props = resp.json().get("properties", {})
        
        # Extract conditions
        temp_c = props.get("temperature", {}).get("value")
        wind_speed_kmh = props.get("windSpeed", {}).get("value", 0) or 0
        description = (props.get("textDescription") or "").lower()
        
        # Determine multipliers
        delay_multiplier = 1.0
        walk_multiplier = 1.0
        
        # Rain effects
        if any(w in description for w in ["rain", "drizzle", "shower", "thunderstorm"]):
            delay_multiplier *= 1.3  # 30% more delays (outdoor sections, slippery rails)
            walk_multiplier *= 1.25  # 25% slower walking
            if "heavy" in description or "thunderstorm" in description:
                delay_multiplier *= 1.5
                walk_multiplier *= 1.4
        
        # Snow/ice effects
        if any(w in description for w in ["snow", "ice", "sleet", "freezing", "blizzard"]):
            delay_multiplier *= 2.0  # Double delays
            walk_multiplier *= 1.5  # 50% slower walking
            if "heavy" in description or "blizzard" in description:
                delay_multiplier *= 2.5
                walk_multiplier *= 2.0
        
        # Extreme heat (signal equipment failures)
        if temp_c is not None and temp_c > 35:
            delay_multiplier *= 1.2  # Heat causes track/signal issues
        
        # Extreme cold
        if temp_c is not None and temp_c < -10:
            delay_multiplier *= 1.3  # Switch heater failures
            walk_multiplier *= 1.3
        
        # High winds (affects elevated lines)
        if wind_speed_kmh > 80:
            delay_multiplier *= 1.5  # Service suspensions on bridges/elevated
        
        # Fog
        if "fog" in description:
            delay_multiplier *= 1.1
        
        result = {
            "delay_multiplier": round(delay_multiplier, 2),
            "walk_multiplier": round(walk_multiplier, 2),
            "description": description or "clear",
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
