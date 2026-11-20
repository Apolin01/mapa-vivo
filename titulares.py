"""
Reescribe con Claude titulares cortos para la pantalla del Mapa Vivo (opcional).

- Solo envía al modelo el texto de la noticia, el lugar y la categoría
  (nunca cliente, correo ni operador).
- Guarda los resultados en data/titulares_cache.json: cada noticia se procesa una sola vez.
- Si no hay credenciales o la API falla, devuelve {} y sync.py usa el titular recortado.

Credenciales: variable ANTHROPIC_API_KEY (o un perfil de `ant auth login`).
"""
import hashlib
import json
from pathlib import Path

MODELO = "claude-opus-5-5"
LOTE = 25
CACHE = Path(__file__).parent / "data" / "titulares_cache.json"

SISTEMA = """Eres editor de una pantalla de monitoreo en vivo: un mapa satelital del Perú que recorre, \
una por una, las noticias de las últimas 24 horas en Ica y La Libertad. Para cada noticia escribes:

- "titular": 5 a 10 palabras, en español peruano, voz activa y tiempo presente. Debe leerse \
de un vistazo sobre un mapa. Empieza por el hecho, no por el lugar (el lugar ya aparece en pantalla), \
salvo que el lugar sea la noticia. Sin punto final, sin comillas, sin signos de exclamación.
- "bajada": una oración de máximo 120 caracteres que agrega el dato clave que falta en el titular \
(quién, cuántos, qué consecuencia).

Reglas:
- Usa solo información presente en el texto. No inventes cifras, nombres, causas ni responsables.
- Conserva cifras, instituciones y lugares tal como aparecen.
- Tono informativo: nada de sensacionalismo ni adjetivos alarmistas.
- Para hechos no confirmados usa "presunto", "denuncian" o "según".
- No nombres a menores de edad ni a víctimas de violencia sexual.
- Devuelve un elemento por cada id recibido, con el mismo id."""

ESQUEMA = {
    "type": "json_schema",
    "schema": {
        "type": "object",
        "properties": {
            "items": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "id": {"type": "string"},
                        "titular": {"type": "string"},
                        "bajada": {"type": "string"},
                    },
                    "required": ["id", "titular", "bajada"],
                    "additionalProperties": False,
                },
            }
        },
        "required": ["items"],
        "additionalProperties": False,
    },
}


def clave(item: dict) -> str:
    return hashlib.sha1(item["resumen"].encode("utf-8")).hexdigest()[:16]


def _cargar_cache() -> dict:
    try:
        return json.loads(CACHE.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def _guardar_cache(cache: dict) -> None:
    CACHE.parent.mkdir(exist_ok=True)
    CACHE.write_text(json.dumps(cache, ensure_ascii=False, indent=1, sort_keys=True), encoding="utf-8")


def _pedir_lote(client, lote: list[dict]) -> dict:
    entrada = [
        {
            "id": clave(it),
            "lugar": ", ".join(x for x in (it["distrito"], it["provincia"], it["departamento"]) if x),
            "categoria": it["categoria"],
            "texto": it["resumen"],
        }
        for it in lote
    ]
    resp = client.beta.messages.create(
        model=MODELO,
        max_tokens=16000,
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",  # si el modelo declina, la API reintenta con un modelo de respaldo
        output_config={"effort": "low", "format": ESQUEMA},
        system=SISTEMA,
        messages=[{"role": "user", "content": json.dumps(entrada, ensure_ascii=False)}],
    )
    if resp.stop_reason == "refusal":
        print(f"  [IA] lote rechazado por el modelo ({getattr(resp.stop_details, 'category', None)}); se mantiene el recorte")
        return {}
    if resp.stop_reason == "max_tokens":
        print("  [IA] respuesta cortada por max_tokens; se mantiene el recorte")
        return {}
    texto = next(b.text for b in resp.content if b.type == "text")
    validos = {e["id"] for e in entrada}
    return {
        r["id"]: {"titular": r["titular"].strip().rstrip("."), "bajada": r["bajada"].strip()}
        for r in json.loads(texto)["items"]
        if r["id"] in validos and r["titular"].strip()
    }


def reescribir(items: list[dict]) -> dict:
    """Devuelve {clave: {"titular", "bajada"}} para los items, usando la caché y llamando a la API solo para los nuevos."""
    cache = _cargar_cache()
    pendientes, vistos = [], set()
    for it in items:
        k = clave(it)
        if k not in cache and k not in vistos:
            pendientes.append(it)
            vistos.add(k)

    if pendientes:
        try:
            import anthropic
        except ImportError:
            print("  [IA] falta el paquete anthropic (pip install -U anthropic); se usan titulares recortados")
            return cache
        try:
            client = anthropic.Anthropic()
            print(f"  [IA] reescribiendo {len(pendientes)} titulares nuevos con {MODELO}…")
            for i in range(0, len(pendientes), LOTE):
                cache.update(_pedir_lote(client, pendientes[i:i + LOTE]))
                _guardar_cache(cache)  # guardar tras cada lote: si algo falla, no se repite lo ya hecho
        except anthropic.AuthenticationError:
            print("  [IA] sin credenciales válidas (ANTHROPIC_API_KEY); se usan titulares recortados")
        except anthropic.RateLimitError:
            print("  [IA] límite de uso alcanzado; los pendientes se procesan en la próxima sincronización")
        except anthropic.APIStatusError as e:
            print(f"  [IA] error de la API ({e.status_code}): {e.message}; se usan titulares recortados")
        except anthropic.APIConnectionError:
            print("  [IA] sin conexión con la API; se usan titulares recortados")
        except TypeError as e:
            # SDK antiguo que no conoce output_config / fallbacks
            print(f"  [IA] el SDK de anthropic está desactualizado ({e}); ejecuta: pip install -U anthropic")
        except Exception as e:  # la pantalla debe actualizarse aunque falle la IA (p. ej. sin credenciales configuradas)
            print(f"  [IA] no se pudo usar la IA: {type(e).__name__}: {e}")
    return cache
