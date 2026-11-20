"""
Sincroniza las noticias del Google Sheet de monitoreo y genera data/noticias.json
para la pantalla del Mapa Vivo. Uso:  python sync.py   (opcional: --dias 7 --csv archivo.csv)

Solo se exportan los campos necesarios para mostrar la noticia: no se copian
correos ni nombres de operadores.
"""
import argparse
import csv
import io
import json
import re
import sys
import unicodedata
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlparse

SHEET_ID = "1hWfu3EymR5Li4qWQv3RcBaaJruI9wOA0m44KnTGnZhs"
GID = "1677128006"
CSV_URL = f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/export?format=csv&gid={GID}"
DEPARTAMENTOS = {"ICA", "LA LIBERTAD"}
OUT = Path(__file__).parent / "data" / "noticias.js"

# Columnas del sheet (índice 0)
C_RELEV, C_COORD, C_IMG, C_LINK = 4, 6, 7, 8
C_FECHA, C_DEP, C_PROV, C_DIST, C_CAT, C_ETIQ, C_TEXTO, C_TIPO = 10, 11, 12, 13, 14, 15, 16, 22


# ---------------------------------------------------------------------------
# Nomenclátor aproximado (lon, lat) de capitales de distrito. Es suficiente
# para el zoom del mapa; se puede reemplazar luego por la tabla de ubigeo INEI.
# "_" = punto de referencia de la provincia / departamento.
# ---------------------------------------------------------------------------
GAZ = {
    "ICA": {
        "_": (-75.55, -14.15),
        "ICA": {
            "_": (-75.7286, -14.0678), "ICA": (-75.7286, -14.0678),
            "PARCONA": (-75.701, -14.047), "LA TINGUINA": (-75.705, -14.035),
            "SUBTANJALLA": (-75.757, -14.017), "SALAS": (-75.770, -13.990),
            "SAN JUAN BAUTISTA": (-75.736, -14.010), "LOS AQUIJES": (-75.690, -14.097),
            "PUEBLO NUEVO": (-75.705, -14.130), "SANTIAGO": (-75.712, -14.188),
            "OCUCAJE": (-75.672, -14.346), "PACHACUTEC": (-75.690, -14.150),
            "TATE": (-75.700, -14.160), "SAN JOSE DE LOS MOLINOS": (-75.669, -13.928),
            "YAUCA DEL ROSARIO": (-75.400, -14.120), "HUACACHINA": (-75.763, -14.087),
            "SAN JOAQUIN": (-75.735, -14.055), "LA VICTORIA": (-75.725, -14.060),
            "SANTA CRUZ DE VILLACURI": (-75.800, -13.950),
        },
        "CHINCHA": {
            "_": (-76.1325, -13.4099), "CHINCHA ALTA": (-76.1325, -13.4099),
            "PUEBLO NUEVO": (-76.125, -13.400), "SUNAMPE": (-76.165, -13.425),
            "GROCIO PRADO": (-76.155, -13.395), "TAMBO DE MORA": (-76.180, -13.460),
            "CHINCHA BAJA": (-76.165, -13.460), "EL CARMEN": (-76.055, -13.500),
            "ALTO LARAN": (-76.080, -13.440), "SAN PEDRO DE HUACARPANA": (-75.650, -13.050),
            "CHAVIN": (-75.900, -13.080), "SAN JUAN DE YANAC": (-75.780, -13.210),
        },
        "PISCO": {
            "_": (-76.2032, -13.7103), "PISCO": (-76.2032, -13.7103),
            "SAN ANDRES": (-76.222, -13.730), "PARACAS": (-76.253, -13.835),
            "SAN CLEMENTE": (-76.160, -13.680), "TUPAC AMARU INCA": (-76.180, -13.710),
            "INDEPENDENCIA": (-76.030, -13.690), "HUMAY": (-75.880, -13.720),
            "HUANCANO": (-75.620, -13.600),
        },
        "NASCA": {
            "_": (-74.9389, -14.8309), "NASCA": (-74.9389, -14.8309),
            "VISTA ALEGRE": (-74.940, -14.850), "MARCONA": (-75.155, -15.360),
            "EL INGENIO": (-75.060, -14.640), "CHANGUILLO": (-75.220, -14.660),
        },
        "PALPA": {
            "_": (-75.185, -14.533), "PALPA": (-75.185, -14.533),
            "RIO GRANDE": (-75.200, -14.520), "SANTA CRUZ": (-75.250, -14.480),
        },
    },
    "LA LIBERTAD": {
        "_": (-78.55, -8.00),
        "TRUJILLO": {
            "_": (-79.0300, -8.1116), "TRUJILLO": (-79.0300, -8.1116),
            "EL PORVENIR": (-79.000, -8.080), "LA ESPERANZA": (-79.045, -8.075),
            "ALTO TRUJILLO": (-78.990, -8.070), "FLORENCIA DE MORA": (-79.020, -8.080),
            "VICTOR LARCO": (-79.050, -8.135), "HUANCHACO": (-79.120, -8.080),
            "MOCHE": (-79.005, -8.170), "SALAVERRY": (-78.977, -8.224),
            "LAREDO": (-78.960, -8.090), "EL MILAGRO": (-79.060, -8.030),
            "SIMBAL": (-78.810, -7.970), "POROTO": (-78.770, -8.010),
        },
        "VIRU": {
            "_": (-78.752, -8.414), "VIRU": (-78.752, -8.414), "CHAO": (-78.678, -8.540),
            "GUADALUPITO": (-78.630, -8.940), "VICTOR RAUL": (-78.700, -8.470),
        },
        "ASCOPE": {
            "_": (-79.110, -7.715), "ASCOPE": (-79.110, -7.715),
            "CASA GRANDE": (-79.185, -7.745), "CHICAMA": (-79.145, -7.840),
            "PAIJAN": (-79.300, -7.730), "SANTIAGO DE CAO": (-79.240, -7.960),
            "CHOCOPE": (-79.220, -7.790), "CARTAVIO": (-79.220, -7.890),
            "RAZURI": (-79.430, -7.700),
        },
        "PACASMAYO": {
            "_": (-79.500, -7.430), "SAN PEDRO DE LLOC": (-79.500, -7.430),
            "PACASMAYO": (-79.570, -7.400), "GUADALUPE": (-79.450, -7.240),
            "SAN JOSE": (-79.450, -7.350),
        },
        "CHEPEN": {
            "_": (-79.430, -7.225), "CHEPEN": (-79.430, -7.225), "PACANGA": (-79.490, -7.170),
            "PUEBLO NUEVO": (-79.510, -7.190), "PACANGUILLA": (-79.430, -7.170),
        },
        "OTUZCO": {
            "_": (-78.565, -7.900), "OTUZCO": (-78.565, -7.900), "USQUIL": (-78.420, -7.800),
            "AGALLPAMPA": (-78.550, -7.980), "HUARANCHAL": (-78.450, -7.690),
            "SALPO": (-78.610, -8.000),
        },
        "SANCHEZ CARRION": {
            "_": (-78.040, -7.815), "HUAMACHUCO": (-78.040, -7.815),
            "COCHORCO": (-77.700, -7.800), "SARTIMBAMBA": (-77.730, -7.700),
            "CHUGAY": (-77.870, -7.780), "SANAGORAN": (-78.140, -7.790),
            "SARIN": (-77.900, -7.910), "MARCABAL": (-78.020, -7.710),
        },
        "SANTIAGO DE CHUCO": {
            "_": (-78.170, -8.145), "SANTIAGO DE CHUCO": (-78.170, -8.145),
            "QUIRUVILCA": (-78.310, -7.980), "CACHICADAN": (-78.150, -8.090),
            "SANTA CRUZ DE CHUCA": (-78.180, -8.120), "ANGASMARCA": (-77.980, -8.130),
            "MOLLEBAMBA": (-77.970, -8.170), "MOLLEPATA": (-77.950, -8.190),
            "CALIPUY": (-78.250, -8.300),
        },
        "PATAZ": {
            "_": (-77.300, -8.275), "TAYABAMBA": (-77.300, -8.275), "PATAZ": (-77.600, -7.780),
            "PARCOY": (-77.480, -8.030), "PIAS": (-77.550, -7.880), "URPAY": (-77.400, -8.350),
            "VIJUS": (-77.630, -7.700), "LLACUABAMBA": (-77.450, -8.030),
            "HUAYLILLAS": (-77.350, -8.170),
        },
        "GRAN CHIMU": {
            "_": (-78.820, -7.480), "CASCAS": (-78.820, -7.480), "SAYAPULLO": (-78.470, -7.600),
        },
        "JULCAN": {
            "_": (-78.490, -8.040), "JULCAN": (-78.490, -8.040),
            "CARABAMBA": (-78.610, -8.110), "HUASO": (-78.400, -8.210),
        },
        "BOLIVAR": {"_": (-77.700, -7.150), "BOLIVAR": (-77.700, -7.150)},
    },
}

ALIAS_PROV = {"NAZCA": "NASCA"}
ALIAS_DIST = {
    "VICTOR LARCO HERRERA": "VICTOR LARCO", "SALAS GUADALUPE": "SALAS", "GUADALUPE": "SALAS",
    "NAZCA": "NASCA", "SAN JUAN DE MARCONA": "MARCONA", "LOS MOLINOS": "SAN JOSE DE LOS MOLINOS",
    "CHINCHA": "CHINCHA ALTA", "SANCHEZ CARRION": "HUAMACHUCO",
}
CATEGORIAS = {
    "COYUNTURA POLITICA": "Coyuntura Política",
    "ECONOMIA-DESARROLLO": "Economía-Desarrollo",
    "ECONOMIA - DESARROLLO": "Economía-Desarrollo",
    "PROTESTAS PAROS Y BLOQUEOS": "Protestas, Paros y Bloqueos",
    "PROTESTAS-PAROS-Y-BLOQUEOS": "Protestas, Paros y Bloqueos",
    "PROTESTAS, PAROS Y BLOQUEOS": "Protestas, Paros y Bloqueos",
    "SEGURIDAD Y DELINCUENCIA": "Seguridad y delincuencia",
    "COYUNTURA SOCIAL": "Coyuntura Social",
    "AGRO-AGUA-MEDIOAMBIENTE": "Agro-Agua-Medioambiente",
}


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", (s or "").strip().upper())
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    return re.sub(r"\s+", " ", s)


def titulo(s: str) -> str:
    small = {"de", "del", "la", "las", "los", "y", "el"}
    words = (s or "").lower().split()
    return " ".join(w if (i and w in small) else w.capitalize() for i, w in enumerate(words))


def geocodificar(dep, prov, dist, coord_txt):
    """Devuelve (lon, lat, precision, provincia_encontrada)."""
    m = re.findall(r"-?\d+\.\d+", coord_txt or "")
    if len(m) >= 2:
        lat, lon = float(m[0]), float(m[1])
        if -19 < lat < 0 and -82 < lon < -68:
            return lon, lat, "exacta", prov
    d = GAZ.get(dep)
    if not d:
        return None
    prov = ALIAS_PROV.get(prov, prov)
    dist_a = ALIAS_DIST.get(dist, dist)
    p = d.get(prov)
    if p:
        for k in (dist, dist_a):
            if k in p and k != "_":
                return (*p[k], "distrito", prov)
    # distrito sin provincia correcta: buscar en todo el departamento
    for pk, pv in d.items():
        if pk == "_":
            continue
        for k in (dist, dist_a):
            if k in pv and k != "_":
                return (*pv[k], "distrito", pk)
    if p:
        return (*p["_"], "provincia", prov)
    return (*d["_"], "departamento", "")


def fuente_desde_url(url: str) -> str:
    try:
        u = urlparse(url.strip())
    except ValueError:
        return "Fuente web"
    host = (u.netloc or "").lower().removeprefix("www.").removeprefix("m.")
    parts = [p for p in u.path.split("/") if p]
    generic = {"reel", "permalink.php", "share", "watch", "photo", "photo.php", "story.php", "groups", "video.php", "people"}
    if "facebook.com" in host or host == "fb.watch":
        if parts and parts[0] not in generic:
            return f"{parts[0]} · Facebook"
        return "Facebook"
    if "tiktok.com" in host:
        return f"{parts[0]} · TikTok" if parts and parts[0].startswith("@") else "TikTok"
    if "youtube.com" in host or "youtu.be" in host:
        return "YouTube"
    if "instagram.com" in host:
        return "Instagram"
    if "x.com" in host or "twitter.com" in host:
        return f"@{parts[0]} · X" if parts else "X"
    return host or "Fuente web"


CORTES = (", ", " donde ", " tras ", " por ", " para ", " ante ", " luego ", " con ", " en ", " y ")


def titular_corto(texto: str, maximo: int = 75) -> str:
    """Titular para pantalla: primera oración, recortada en una pausa natural (sin '…').
    En producción esto lo reescribiría un LLM; el texto completo va en la tarjeta."""
    t = re.sub(r"\s+", " ", texto or "").strip().removesuffix(".png").removesuffix(".jpg")
    primera = re.split(r"(?<=[.!?])\s", t)[0].rstrip(".")
    if len(primera) <= maximo:
        return primera
    for sep in CORTES:
        pos = primera.rfind(sep, 30, maximo)
        if pos > 0:
            return primera[:pos].rstrip(",;: ")
    return primera[:maximo].rsplit(" ", 1)[0].rstrip(",;: ") + "…"


def cargar_csv(path_or_none):
    if path_or_none:
        return Path(path_or_none).read_text(encoding="utf-8")
    req = urllib.request.Request(CSV_URL, headers={"User-Agent": "map-vivo-sync/1.0"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read().decode("utf-8")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dias", type=int, default=7, help="cuántos días (con datos) exportar")
    ap.add_argument("--csv", help="usar un CSV local en vez de descargar el sheet")
    ap.add_argument("--sin-ia", action="store_true", help="no reescribir titulares con Claude")
    args = ap.parse_args()

    texto = cargar_csv(args.csv)
    filas = list(csv.reader(io.StringIO(texto)))[1:]
    hoy = datetime.now(timezone(timedelta(hours=-5))).replace(tzinfo=None)  # hora de Perú, igual en cualquier servidor
    por_dia, sin_geo = {}, 0
    for i, r in enumerate(filas):
        if len(r) <= C_TIPO or not r[0].strip():
            continue
        dep = norm(r[C_DEP])
        if dep not in DEPARTAMENTOS:
            continue
        try:
            f = datetime.strptime(r[C_FECHA].strip(), "%d-%m-%y")
            registrado = datetime.strptime(r[0].strip(), "%d/%m/%Y %H:%M:%S").isoformat()
        except ValueError:
            continue
        if f > hoy:
            continue
        cuerpo = re.sub(r"\s+", " ", r[C_TEXTO]).strip()
        if not cuerpo:
            continue
        prov, dist = norm(r[C_PROV]), norm(r[C_DIST])
        if ALIAS_PROV.get(prov, prov) not in GAZ[dep]:
            prov = ""  # p. ej. "NACIONAL" o "LA LIBERTAD" usado como provincia
        geo = geocodificar(dep, prov, dist, r[C_COORD])
        if geo and geo[2] != "distrito":
            dist = ""
        if not geo:
            sin_geo += 1
            continue
        relev = norm(r[C_RELEV]).capitalize() or "Bajo"
        cat_raw = norm(r[C_CAT])
        tipo = "Incidente" if "NCIDENTE" in norm(r[C_TIPO]) else "Noticia"
        img = r[C_IMG].strip()
        item = {
            "id": f"n{i + 2}",  # fila del sheet
            "fecha": f.strftime("%Y-%m-%d"),
            "registrado": registrado,  # marca temporal del sheet: define la ventana de 24 h
            "departamento": titulo(dep),
            "provincia": titulo(geo[3]) if geo[3] else "",
            "distrito": titulo(dist) if dist else "",
            "lon": round(geo[0], 4), "lat": round(geo[1], 4), "precision": geo[2],
            "categoria": CATEGORIAS.get(cat_raw, r[C_CAT].strip() or "Otros"),
            "etiquetas": r[C_ETIQ].strip(),
            "relevancia": relev if relev in ("Alto", "Medio", "Bajo") else "Bajo",
            "tipo": tipo,
            "titular": titular_corto(cuerpo),
            "resumen": cuerpo.removesuffix(".png"),
            "fuente": fuente_desde_url(r[C_LINK]),
            "url": r[C_LINK].strip(),
            # Las imágenes de Facebook (fbcdn) caducan; en producción hay que descargarlas al sincronizar.
            "imagen": img if img.startswith("http") and "drive.google.com" not in img else "",
        }
        por_dia.setdefault(item["fecha"], []).append(item)

    fechas = sorted(por_dia)[-args.dias:]

    # Titulares para pantalla con IA (con caché; si no hay credenciales queda el recorte)
    exportar = [it for f in fechas for it in por_dia[f]]
    if not args.sin_ia:
        from titulares import clave, reescribir
        ia = reescribir(exportar)
        for it in exportar:
            r = ia.get(clave(it))
            if r:
                it["titular"], it["bajada"], it["titular_ia"] = r["titular"], r["bajada"], True
    n_ia = sum(1 for it in exportar if it.get("titular_ia"))
    data = {
        "generado": hoy.strftime("%Y-%m-%d %H:%M"),
        "departamentos": sorted(titulo(d) for d in DEPARTAMENTOS),
        "dias": {f: por_dia[f] for f in fechas},
        # puntos de referencia para las etiquetas de provincia / departamento
        "referencias": {
            titulo(dep): {("_" if pk == "_" else titulo(pk)): (pv if pk == "_" else pv["_"]) for pk, pv in d.items()}
            for dep, d in GAZ.items() if dep in DEPARTAMENTOS
        },
    }
    OUT.parent.mkdir(exist_ok=True)
    # .json lo recarga la pantalla en vivo; .js permite abrir index.html sin servidor.
    # Se escribe a un temporal y se reemplaza, para que la pantalla nunca lea un archivo a medias.
    texto_json = json.dumps(data, ensure_ascii=False)
    for destino, contenido in ((OUT.with_suffix(".json"), texto_json), (OUT, f"window.NOTICIAS = {texto_json};\n")):
        tmp = destino.with_suffix(destino.suffix + ".tmp")
        tmp.write_text(contenido, encoding="utf-8")
        tmp.replace(destino)
    total = sum(len(v) for v in data["dias"].values())
    print(f"OK {OUT}  ·  {total} noticias en {len(fechas)} días ({fechas[0] if fechas else '-'} → {fechas[-1] if fechas else '-'})  ·  titulares IA: {n_ia}/{total}")
    for f in fechas:
        precs = {}
        for it in por_dia[f]:
            precs[it["precision"]] = precs.get(it["precision"], 0) + 1
        print(f"  {f}: {len(por_dia[f])}  {precs}")
    if sin_geo:
        print(f"  sin ubicar: {sin_geo}")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
