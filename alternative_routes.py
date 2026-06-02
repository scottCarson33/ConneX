from typing import List, Optional

ALTERNATIVE_GROUPS = {
    # IND Eighth Avenue Line (Blue)
    "ACE_LOCAL": {"lines": ["A", "C"], "type": "express_local", "shared_stops": [
        "168 St", "145 St", "125 St", "59 St-Columbus Circle",
        "42 St-Port Authority", "34 St-Penn Station", "14 St",
        "W 4 St-Washington Sq", "Canal St", "Fulton St",
        "High St-Brooklyn Bridge", "Jay St-MetroTech",
        "Hoyt-Schermerhorn Sts", "Nostrand Av", "Utica Av",
        "Broadway Junction", "Euclid Av"
    ]},
    # IND Sixth Avenue Line (Orange)
    "BD_EXPRESS": {"lines": ["B", "D"], "type": "express_local", "shared_stops": [
        "145 St", "125 St", "59 St-Columbus Circle",
        "7 Av", "47-50 Sts-Rockefeller Ctr", "42 St-Bryant Park",
        "34 St-Herald Sq", "W 4 St-Washington Sq",
        "Broadway-Lafayette St", "Grand St", "DeKalb Av",
        "Atlantic Av-Barclays Ctr"
    ]},
    # BMT Broadway Line (Yellow)
    "NQR_LOCAL": {"lines": ["N", "Q", "R"], "type": "express_local", "shared_stops": [
        "Times Sq-42 St", "34 St-Herald Sq", "28 St",
        "23 St", "14 St-Union Sq", "8 St-NYU",
        "Prince St", "Canal St", "City Hall",
        "Cortlandt St", "Rector St", "Whitehall St"
    ]},
    # IRT Lexington Avenue Line (Green)
    "45_EXPRESS": {"lines": ["4", "5"], "type": "express_local", "shared_stops": [
        "125 St", "86 St", "59 St", "Grand Central-42 St",
        "14 St-Union Sq", "Brooklyn Bridge-City Hall",
        "Fulton St", "Wall St", "Bowling Green",
        "Borough Hall", "Nevins St", "Atlantic Av-Barclays Ctr",
        "Franklin Av-Medgar Evers College"
    ]},
    # IRT Broadway-Seventh Avenue Line (Red)
    "23_LOCAL": {"lines": ["2", "3"], "type": "express_local", "shared_stops": [
        "96 St", "72 St", "Times Sq-42 St", "34 St-Penn Station",
        "14 St", "Chambers St", "Park Pl", "Fulton St",
        "Wall St", "Clark St", "Borough Hall",
        "Hoyt St", "Nevins St", "Atlantic Av-Barclays Ctr",
        "Bergen St", "Grand Army Plaza", "Eastern Pkwy-Brooklyn Museum",
        "Franklin Av-Medgar Evers College", "Nostrand Av"
    ]},
    # IRT Lexington + Broadway (Green/Red)
    "JZ_SHUTTLE": {"lines": ["J", "Z"], "type": "skip_stop", "shared_stops": [
        "Broad St", "Fulton St", "Chambers St",
        "Canal St", "Bowery", "Delancey St-Essex St",
        "Marcy Av", "Hewes St", "Broadway Junction"
    ]}
}

# Average headways in minutes for [peak, midday, evening, overnight]
# None means the line does not run at that time.
HEADWAY_DATA = {
    "A": {"peak": 5.0, "midday": 8.0, "evening": 10.0, "overnight": 20.0},
    "C": {"peak": 6.0, "midday": 10.0, "evening": 12.0, "overnight": None},
    "B": {"peak": 6.0, "midday": 10.0, "evening": 10.0, "overnight": None},
    "D": {"peak": 5.0, "midday": 8.0, "evening": 10.0, "overnight": 20.0},
    "N": {"peak": 6.0, "midday": 10.0, "evening": 12.0, "overnight": 20.0},
    "Q": {"peak": 5.0, "midday": 8.0, "evening": 10.0, "overnight": 20.0},
    "R": {"peak": 8.0, "midday": 10.0, "evening": 15.0, "overnight": None},
    "4": {"peak": 4.0, "midday": 6.0, "evening": 8.0, "overnight": 20.0},
    "5": {"peak": 5.0, "midday": 8.0, "evening": 12.0, "overnight": None},
    "2": {"peak": 5.0, "midday": 8.0, "evening": 10.0, "overnight": 20.0},
    "3": {"peak": 6.0, "midday": 8.0, "evening": 10.0, "overnight": None},
    "J": {"peak": 5.0, "midday": 8.0, "evening": 10.0, "overnight": 20.0},
    "Z": {"peak": 5.0, "midday": None, "evening": None, "overnight": None},
    # Fallback default
    "DEFAULT": {"peak": 6.0, "midday": 10.0, "evening": 12.0, "overnight": 20.0}
}

def clean_stop_name(stop_name: str) -> str:
    # Basic normalization to improve matching
    s = stop_name.replace("Station", "").strip()
    s = s.replace(" - ", "-").replace(" / ", "/").replace(" /", "/").replace("/ ", "/")
    return s

def is_stop_in_list(target: str, stop_list: List[str]) -> bool:
    target_clean = clean_stop_name(target).lower()
    for s in stop_list:
        if s.lower() in target_clean or target_clean in s.lower():
            return True
    return False

def find_alternatives(line_id: str, departure_stop: str, arrival_stop: Optional[str]) -> List[str]:
    """
    Returns a list of alternative subway lines that serve both the departure and arrival stop.
    Includes the original line_id in the result if valid.
    """
    if not line_id or not departure_stop or not arrival_stop:
        return [line_id] if line_id else []

    clean_line = line_id.strip()[0] # e.g. "A Train" -> "A"
    
    alternatives = [clean_line]
    
    for group_name, group_data in ALTERNATIVE_GROUPS.items():
        if clean_line in group_data["lines"]:
            # Check if both departure and arrival stops are in the shared list
            dep_valid = is_stop_in_list(departure_stop, group_data["shared_stops"])
            arr_valid = is_stop_in_list(arrival_stop, group_data["shared_stops"])
            
            if dep_valid and arr_valid:
                for alt_line in group_data["lines"]:
                    if alt_line not in alternatives:
                        alternatives.append(alt_line)
            break # Found the group

    return alternatives

def get_headway(line_id: str, time_of_day: str = "peak") -> Optional[float]:
    """
    Returns average headway in minutes. time_of_day is one of: 'peak', 'midday', 'evening', 'overnight'.
    """
    clean_line = line_id.strip()[0]
    data = HEADWAY_DATA.get(clean_line, HEADWAY_DATA["DEFAULT"])
    return data.get(time_of_day)
