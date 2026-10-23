"""Lisbon transit alternative route logic and headway data."""
import re
from typing import List, Optional

# Lisbon Metro lines and shared stations
ALTERNATIVE_GROUPS = {
    "blue_yellow": {
        "lines": ["AZUL", "AMARELA"],
        "shared_stops": ["Marquês de Pombal"],
    },
    "green_red": {
        "lines": ["VERDE", "VERMELHA"],
        "shared_stops": ["Alameda"],
    },
    "yellow_green": {
        "lines": ["AMARELA", "VERDE"],
        "shared_stops": ["Campo Grande"],
    },
    "blue_green": {
        "lines": ["AZUL", "VERDE"],
        "shared_stops": ["Baixa-Chiado"],
    },
}

# Average headways in minutes for [peak, midday, evening, overnight, weekend]
HEADWAY_DATA = {
    "AZUL": {"peak": 4.0, "midday": 6.0, "evening": 8.0, "overnight": None, "weekend": 8.0},
    "AMARELA": {"peak": 4.0, "midday": 6.0, "evening": 8.0, "overnight": None, "weekend": 8.0},
    "VERDE": {"peak": 4.0, "midday": 6.0, "evening": 8.0, "overnight": None, "weekend": 8.0},
    "VERMELHA": {"peak": 5.0, "midday": 7.0, "evening": 9.0, "overnight": None, "weekend": 9.0},
    "CP_SINTRA": {"peak": 10.0, "midday": 20.0, "evening": 20.0, "overnight": None, "weekend": 20.0},
    "CP_CASCAIS": {"peak": 12.0, "midday": 20.0, "evening": 20.0, "overnight": None, "weekend": 20.0},
    "CP_AZAMBUJA": {"peak": 15.0, "midday": 30.0, "evening": 30.0, "overnight": None, "weekend": 30.0},
    "FERTAGUS": {"peak": 10.0, "midday": 20.0, "evening": 20.0, "overnight": None, "weekend": 20.0},
    "FERRY": {"peak": 15.0, "midday": 20.0, "evening": 30.0, "overnight": None, "weekend": 20.0},
    "DEFAULT": {"peak": 10.0, "midday": 15.0, "evening": 20.0, "overnight": 30.0, "weekend": 15.0},
}


def clean_stop_name(stop_name: str) -> str:
    s = stop_name.replace("Station", "").replace("Estação", "").strip()
    s = s.replace(" - ", "-").replace(" / ", "/").replace(" /", "/").replace("/ ", "/")
    return s


def is_stop_in_list(target: str, stop_list: List[str]) -> bool:
    target_clean = clean_stop_name(target).lower()
    for s in stop_list:
        s_clean = s.lower()
        if s_clean == target_clean or re.search(rf'\b{re.escape(s_clean)}\b', target_clean):
            return True
    return False


def find_alternatives(
    line_id: str, departure_stop: str, arrival_stop: Optional[str]
) -> List[str]:
    if not line_id or not departure_stop or not arrival_stop:
        return [line_id] if line_id else []

    clean_line = line_id.strip().upper()
    alternatives = [clean_line]

    for group_name, group_data in ALTERNATIVE_GROUPS.items():
        if clean_line in group_data["lines"]:
            dep_valid = is_stop_in_list(departure_stop, group_data["shared_stops"])
            arr_valid = is_stop_in_list(arrival_stop, group_data["shared_stops"])
            if dep_valid and arr_valid:
                for alt_line in group_data["lines"]:
                    if alt_line not in alternatives:
                        alternatives.append(alt_line)
            break

    return alternatives


def get_headway(line_id: str, time_of_day: str = "peak") -> Optional[float]:
    clean_line = line_id.strip().upper()
    data = HEADWAY_DATA.get(clean_line, HEADWAY_DATA["DEFAULT"])
    return data.get(time_of_day)
