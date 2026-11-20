# Mapa Vivo · Ica y La Libertad

Pantalla de monitoreo en vivo. Muestra un mapa satelital que recorre una por una las noticias de las últimas 24 horas: hace zoom al lugar y muestra el titular, una tarjeta con la fuente y un panel lateral con la lista completa. Funciona en bucle y se actualiza solo desde el Google Sheet de monitoreo.

## Levantarlo

Doble clic en **`iniciar.bat`**. Esto:

1. Inicia `servidor.py`, que sirve la pantalla en http://127.0.0.1:8765 y sincroniza el sheet cada 5 minutos.
2. Abre Chrome (o Edge) en pantalla completa (modo kiosco).

Para cerrar la pantalla: **Alt+F4**. Para detener el servidor: cerrar la ventana minimizada "Mapa Vivo - servidor".

Para que arranque solo al encender la PC: crear un acceso directo a `iniciar.bat` en la carpeta de inicio (`Win+R` → `shell:startup`).

Manualmente:

```bash
python servidor.py              # opciones: --cada 5  --puerto 8765  --red  --sin-ia
```

`--red` permite abrir la pantalla desde otra PC o una Smart TV de la red local (`http://IP-de-esta-PC:8765`). Con esa opción, cualquier equipo de la red puede ver las noticias y sus relevancias.

## En pantalla

- **Vista general** al inicio de cada vuelta: total de noticias, relevancia alta, incidentes y reparto por región.
- **Recorrido por fecha**: de la noticia más reciente a la más antigua, según la hora de registro en el sheet. Cada una se muestra unos 11 segundos. Entre una noticia y la siguiente, la cámara muestra los dos lugares y una **línea roja** se dibuja desde el punto anterior hasta el nuevo, como un arco; luego hace zoom a la noticia. El punto anterior y el trazo se quedan visibles mientras se muestra la nueva.
- **Panel lateral**: arriba, el total de noticias de las últimas 24 horas, cuántas son de relevancia alta y cuántos incidentes, una gráfica de actividad por hora (la hora actual en amarillo) y la proporción por categoría. Debajo, la línea de tiempo: cada noticia con el icono de su categoría, el lugar, la hora y "hace cuánto", y la etiqueta de relevancia. La noticia en pantalla se abre con una barra que muestra el tiempo que le queda; las anteriores de esa vuelta quedan marcadas como vistas y unidas por un hilo rojo, como el recorrido del mapa. Las registradas en los últimos 90 minutos llevan la marca **Nuevo**. Los colores de las categorías están validados contra daltonismo (script del skill `dataviz`).
- Las noticias repetidas por varios medios se muestran una sola vez.
- Los datos nuevos se leen cada 2 minutos y entran en la siguiente vuelta, sin recargar la página.

Teclado: **Espacio** pausa · **← →** anterior / siguiente · **F** pantalla completa. También se puede hacer clic en una noticia de la lista.

Opciones por URL (por ejemplo `http://127.0.0.1:8765/?seg=15&dep=Ica`):

| Parámetro | Efecto |
|---|---|
| `seg=11` | segundos por noticia |
| `max=30` | máximo de noticias por vuelta |
| `dep=Ica` | solo una región (`Ica` o `La Libertad`) |
| `refresco=2` | minutos entre lecturas de datos |

## Titulares con IA (opcional)

`sync.py` puede reescribir con Claude (`claude-opus-5-5`) un titular corto de 5 a 10 palabras y una bajada de una línea para cada noticia. Para activarlo:

```powershell
pip install -U anthropic
$env:ANTHROPIC_API_KEY = "sk-ant-..."
```

- Al modelo solo se envía el texto de la noticia, el lugar y la categoría.
- Cada noticia se procesa una sola vez; los resultados se guardan en `data/titulares_cache.json`.
- Sin credenciales, la pantalla usa el texto del sheet recortado en una pausa natural.

## Archivos

| Archivo | Qué hace |
|---|---|
| `iniciar.bat` | levanta el servidor y abre la pantalla |
| `servidor.py` | sirve la pantalla y ejecuta `sync.py` cada N minutos |
| `sync.py` | descarga el sheet, filtra Ica y La Libertad, ubica cada noticia por provincia y distrito y genera `data/noticias.json`; no exporta correos, operadores ni clientes |
| `titulares.py` | titulares cortos con IA (opcional) |
| `index.html`, `styles.css`, `app.js` | la pantalla |

## Pendiente

- Las imágenes de Facebook (`fbcdn`) caducan en pocos días: descargarlas al sincronizar.
- Reemplazar las coordenadas aproximadas por la tabla de ubigeo del INEI.
- Revisar la licencia de las imágenes satelitales (Esri) si la pantalla se muestra al público.
