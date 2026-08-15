"""Known transfer walking times at major NYC subway stations.

These override generic Google walking time estimates with accurate
platform-to-platform walking times based on real station layouts.
Times are in minutes.
"""
from typing import Optional, Tuple

# (from_line, to_line, station_keyword) -> base_walk_minutes
# These represent platform-to-platform walking time, not including wait.
TRANSFER_WALK_TIMES = {
    # Cross-platform transfers (same platform, opposite sides)
    ("4", "5", "14 st"): 0.3,
    ("5", "4", "14 st"): 0.3,
    ("2", "3", "14 st"): 0.3,
    ("3", "2", "14 st"): 0.3,
    ("N", "R", "times sq"): 0.5,
    ("R", "N", "times sq"): 0.5,
    ("A", "C", "fulton"): 0.5,
    ("C", "A", "fulton"): 0.5,
    ("B", "D", "atlantic"): 0.5,
    ("D", "B", "atlantic"): 0.5,
    
    # Short transfers (same station complex, different level)
    ("L", "1", "14 st"): 3.0,
    ("1", "L", "14 st"): 3.0,
    ("L", "2", "14 st"): 3.5,
    ("2", "L", "14 st"): 3.5,
    ("L", "3", "14 st"): 3.5,
    ("3", "L", "14 st"): 3.5,
    ("L", "F", "14 st"): 2.5,
    ("F", "L", "14 st"): 2.5,
    ("L", "N", "union sq"): 4.0,
    ("N", "L", "union sq"): 4.0,
    ("L", "Q", "union sq"): 4.0,
    ("Q", "L", "union sq"): 4.0,
    ("L", "R", "union sq"): 4.0,
    ("R", "L", "union sq"): 4.0,
    ("L", "4", "union sq"): 3.5,
    ("4", "L", "union sq"): 3.5,
    ("L", "5", "union sq"): 3.5,
    ("5", "L", "union sq"): 3.5,
    ("L", "6", "union sq"): 3.0,
    ("6", "L", "union sq"): 3.0,
    
    # Medium transfers
    ("7", "N", "times sq"): 4.0,
    ("N", "7", "times sq"): 4.0,
    ("7", "Q", "times sq"): 4.0,
    ("Q", "7", "times sq"): 4.0,
    ("7", "1", "times sq"): 3.5,
    ("1", "7", "times sq"): 3.5,
    ("7", "2", "times sq"): 3.5,
    ("2", "7", "times sq"): 3.5,
    ("7", "3", "times sq"): 3.5,
    ("3", "7", "times sq"): 3.5,
    ("7", "S", "times sq"): 5.0,
    ("S", "7", "times sq"): 5.0,
    ("A", "1", "times sq"): 5.0,
    ("1", "A", "times sq"): 5.0,
    
    # Long transfers (multi-block tunnel walks)
    ("F", "A", "jay st"): 2.0,
    ("A", "F", "jay st"): 2.0,
    ("F", "C", "jay st"): 2.0,
    ("C", "F", "jay st"): 2.0,
    ("F", "R", "jay st"): 3.0,
    ("R", "F", "jay st"): 3.0,
    ("A", "2", "fulton"): 5.0,
    ("2", "A", "fulton"): 5.0,
    ("A", "3", "fulton"): 5.0,
    ("3", "A", "fulton"): 5.0,
    ("A", "J", "fulton"): 4.0,
    ("J", "A", "fulton"): 4.0,
    ("4", "N", "atlantic"): 4.0,
    ("N", "4", "atlantic"): 4.0,
    ("2", "B", "atlantic"): 3.5,
    ("B", "2", "atlantic"): 3.5,
    ("D", "R", "atlantic"): 4.0,
    ("R", "D", "atlantic"): 4.0,
    
    # Herald Sq
    ("B", "N", "herald sq"): 2.0,
    ("N", "B", "herald sq"): 2.0,
    ("D", "R", "herald sq"): 2.0,
    ("R", "D", "herald sq"): 2.0,
    ("F", "N", "herald sq"): 2.5,
    ("N", "F", "herald sq"): 2.5,
    
    # Broadway Junction (very long walks)
    ("A", "J", "broadway jct"): 5.0,
    ("J", "A", "broadway jct"): 5.0,
    ("A", "L", "broadway jct"): 6.0,
    ("L", "A", "broadway jct"): 6.0,
    ("J", "L", "broadway jct"): 5.0,
    ("L", "J", "broadway jct"): 5.0,
}


def get_transfer_walk_time(
    from_line: str, to_line: str, station_name: str
) -> Optional[float]:
    """Look up known transfer walk time between two lines at a station.
    
    Returns the known walk time in minutes, or None if not in the database
    (in which case the caller should use Google's estimate).
    """
    station_lower = station_name.lower().replace("station", "").strip()
    from_clean = from_line.strip().upper()[:1]
    to_clean = to_line.strip().upper()[:1]
    
    for (fl, tl, station_kw), walk_mins in TRANSFER_WALK_TIMES.items():
        if fl == from_clean and tl == to_clean and station_kw in station_lower:
            return walk_mins
    
    return None
