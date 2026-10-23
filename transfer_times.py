"""Known transfer walking times at major Lisbon transit stations.

Times are in minutes.
"""
from typing import Optional

# (from_line, to_line, station_keyword) -> base_walk_minutes
TRANSFER_WALK_TIMES = {
    # Marquês de Pombal (Azul <-> Amarela)
    ("AZUL", "AMARELA", "marquês"): 2.0,
    ("AMARELA", "AZUL", "marquês"): 2.0,
    # Alameda (Verde <-> Vermelha)
    ("VERDE", "VERMELHA", "alameda"): 3.0,
    ("VERMELHA", "VERDE", "alameda"): 3.0,
    # Campo Grande (Amarela <-> Verde)
    ("AMARELA", "VERDE", "campo grande"): 2.5,
    ("VERDE", "AMARELA", "campo grande"): 2.5,
    # Baixa-Chiado (Azul <-> Verde)
    ("AZUL", "VERDE", "baixa"): 3.0,
    ("VERDE", "AZUL", "baixa"): 3.0,
    # Cais do Sodré (Metro <-> Ferry <-> CP Cascais)
    ("VERDE", "FERRY", "cais do sodré"): 5.0,
    ("FERRY", "VERDE", "cais do sodré"): 5.0,
    ("VERDE", "CP_CASCAIS", "cais do sodré"): 4.0,
    ("CP_CASCAIS", "VERDE", "cais do sodré"): 4.0,
    # Oriente (Vermelha <-> CP <-> Bus)
    ("VERMELHA", "CP", "oriente"): 5.0,
    ("CP", "VERMELHA", "oriente"): 5.0,
    # Sete Rios (Azul <-> CP Sintra)
    ("AZUL", "CP_SINTRA", "sete rios"): 4.0,
    ("CP_SINTRA", "AZUL", "sete rios"): 4.0,
    # Entrecampos (Amarela <-> CP)
    ("AMARELA", "CP", "entrecampos"): 3.5,
    ("CP", "AMARELA", "entrecampos"): 3.5,
    # Roma-Areeiro (Verde <-> CP)
    ("VERDE", "CP", "roma"): 4.0,
    ("CP", "VERDE", "roma"): 4.0,
}


def get_transfer_walk_time(
    from_line: str, to_line: str, station_name: str
) -> Optional[float]:
    station_lower = station_name.lower().replace("station", "").replace("estação", "").strip()
    from_clean = from_line.strip().upper()
    to_clean = to_line.strip().upper()
    
    for (fl, tl, station_kw), walk_mins in TRANSFER_WALK_TIMES.items():
        if fl == from_clean and tl == to_clean and station_kw in station_lower:
            return walk_mins
    
    return None
