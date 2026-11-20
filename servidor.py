"""
Levanta el Mapa Vivo: sirve la pantalla y sincroniza el Google Sheet cada cierto tiempo.

    python servidor.py                 # http://127.0.0.1:8765, sincroniza cada 5 min
    python servidor.py --cada 10       # cada 10 minutos (por defecto 5)
    python servidor.py --red           # accesible desde otras PCs / TV de la red local

La pantalla (index.html) vuelve a leer data/noticias.json sola: no hace falta recargarla.

En la nube (Railway): la plataforma define la variable PORT y el servidor escucha en 0.0.0.0.
Como el enlace es público, exige usuario y contraseña con estas variables del servicio:
    ACCESO_CLAVE     contraseña (obligatoria en la nube; sin ella el servidor no arranca)
    ACCESO_USUARIO   usuario (opcional; por defecto "mapa")
    ABIERTO=1        solo si de verdad quieres dejarlo público y sin contraseña
"""
import argparse
import base64
import functools
import hmac
import http.server
import os
import subprocess
import sys
import threading
import time
from datetime import datetime
from pathlib import Path

BASE = Path(__file__).parent
USUARIO = os.environ.get("ACCESO_USUARIO") or "mapa"
CLAVE = os.environ.get("ACCESO_CLAVE") or ""


def log(msg: str) -> None:
    print(f"[{datetime.now():%H:%M:%S}] {msg}", flush=True)


def sincronizar_en_bucle(cada_min: int, sin_ia: bool) -> None:
    while True:
        cmd = [sys.executable, str(BASE / "sync.py")] + (["--sin-ia"] if sin_ia else [])
        try:
            r = subprocess.run(cmd, cwd=BASE, capture_output=True, text=True, encoding="utf-8", timeout=600)
            salida = (r.stdout.strip().splitlines() or ["(sin salida)"])
            log("sync: " + salida[0] if r.returncode == 0 else f"sync falló:\n{r.stderr.strip()[-800:]}")
            for linea in salida:
                if "[IA]" in linea:
                    log(linea.strip())
        except subprocess.TimeoutExpired:
            log("sync: tardó demasiado, se reintenta en el próximo ciclo")
        time.sleep(cada_min * 60)


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # que la pantalla siempre reciba los datos y el código más recientes
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *args):  # silencio: solo interesan los logs de sincronización
        pass

    # ---- contraseña (solo si se definió ACCESO_CLAVE)
    def _autorizado(self) -> bool:
        if not CLAVE:
            return True
        cab = self.headers.get("Authorization", "")
        if not cab.startswith("Basic "):
            return False
        try:
            usuario, _, clave = base64.b64decode(cab[6:]).decode("utf-8").partition(":")
        except Exception:
            return False
        ok_u = hmac.compare_digest(usuario.encode(), USUARIO.encode())
        ok_c = hmac.compare_digest(clave.encode(), CLAVE.encode())
        return ok_u and ok_c

    def _pedir_clave(self):
        self.send_response(401)
        self.send_header("WWW-Authenticate", 'Basic realm="Mapa Vivo", charset="UTF-8"')
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        if not self._autorizado():
            return self._pedir_clave()
        super().do_GET()

    def do_HEAD(self):
        if not self._autorizado():
            return self._pedir_clave()
        super().do_HEAD()

    def do_POST(self):
        if not self._autorizado():
            return self._pedir_clave()
        # la pantalla envía aquí su diagnóstico (¿cargó el mapa? ¿qué errores hubo?)
        if self.path.split("?")[0] != "/diag":
            self.send_error(404)
            return
        largo = min(int(self.headers.get("Content-Length") or 0), 20000)
        cuerpo = self.rfile.read(largo).decode("utf-8", "replace")
        with open(BASE / "data" / "diag.log", "a", encoding="utf-8") as f:
            f.write(f"{datetime.now():%Y-%m-%d %H:%M:%S} {self.client_address[0]} {cuerpo}\n")
        log(f"diagnóstico de la pantalla ({self.client_address[0]}): {cuerpo[:300]}")
        self.send_response(204)
        self.end_headers()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--puerto", type=int, default=8765)
    ap.add_argument("--cada", type=int, default=5, help="minutos entre sincronizaciones")
    ap.add_argument("--red", action="store_true", help="escuchar en la red local (0.0.0.0) y no solo en esta PC")
    ap.add_argument("--sin-ia", action="store_true", help="no reescribir titulares con Claude")
    args = ap.parse_args()

    en_la_nube = bool(os.environ.get("PORT"))  # Railway y similares definen PORT
    if en_la_nube and not CLAVE and os.environ.get("ABIERTO") != "1":
        sys.exit("Falta ACCESO_CLAVE: en la nube el enlace es público y necesita contraseña. "
                 "Defínela en las variables del servicio (o ABIERTO=1 para dejarlo sin contraseña).")

    (BASE / "data").mkdir(exist_ok=True)
    threading.Thread(target=sincronizar_en_bucle, args=(args.cada, args.sin_ia), daemon=True).start()

    puerto = int(os.environ.get("PORT") or args.puerto)
    host = "0.0.0.0" if (args.red or en_la_nube) else "127.0.0.1"
    handler = functools.partial(Handler, directory=str(BASE))
    srv = http.server.ThreadingHTTPServer((host, puerto), handler)
    log(f"Mapa Vivo en el puerto {puerto} ({'con' if CLAVE else 'SIN'} contraseña) · sincroniza cada {args.cada} min")
    if args.red or en_la_nube:
        log("Visible fuera de esta PC" + (": pide usuario y contraseña" if CLAVE else ": cualquiera con el enlace puede verlo"))
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        log("detenido")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    main()
