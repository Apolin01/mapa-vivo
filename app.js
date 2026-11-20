/* Mapa Vivo · pantalla en bucle con las noticias de las últimas 24 horas (Ica y La Libertad)
 *
 * Parámetros de URL opcionales:
 *   ?seg=11        segundos que se muestra cada noticia
 *   ?max=30        máximo de noticias por vuelta
 *   ?dep=Ica       solo una región
 *   ?refresco=2    minutos entre lecturas de data/noticias.json
 * Teclado: Espacio pausa · ← → anterior / siguiente · F pantalla completa
 */
(() => {
  const $ = (id) => document.getElementById(id);
  const q = new URLSearchParams(location.search);
  const CFG = {
    seg: +q.get("seg") || 11,
    max: +q.get("max") || 30,
    dep: q.get("dep") || "",
    refresco: +q.get("refresco") || 2,
  };

  // Para el diagnóstico: qué tarjeta gráfica usa el navegador
  function rendererWebGL() {
    try {
      const gl = document.createElement("canvas").getContext("webgl");
      if (!gl) return "sin WebGL";
      const ext = gl.getExtension("WEBGL_debug_renderer_info");
      return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : "desconocido";
    } catch (e) { return "error WebGL: " + e; }
  }

  // Paleta categórica validada (script del skill dataviz, modo oscuro): el color sigue a la categoría
  const CAT_COLOR = {
    "Coyuntura Social": "#3987e5",
    "Seguridad y delincuencia": "#d95926",
    "Agro-Agua-Medioambiente": "#199e70",
    "Economía-Desarrollo": "#c98500",
    "Protestas, Paros y Bloqueos": "#d55181",
    "Coyuntura Política": "#0ca30c",
  };
  const CAT_PESO = {
    "Protestas, Paros y Bloqueos": 6, "Seguridad y delincuencia": 4, "Coyuntura Política": 3,
    "Agro-Agua-Medioambiente": 2, "Coyuntura Social": 2, "Economía-Desarrollo": 1,
  };
  const REL_PESO = { Alto: 30, Medio: 20, Bajo: 10 };
  const ZOOM = { exacta: 11.5, distrito: 11, provincia: 9.2, departamento: 7.6 };
  const T = { fly: 2600, flyLargo: 5200, overview: 9000 };
  const ZOOM_MIN_TRAMO = 5.6; // en los saltos entre noticias la cámara no se abre más que esto (ver como máximo el Perú)
  const NUEVO_MIN = 90; // minutos en los que una noticia se marca como "nueva"

  const color = (c) => CAT_COLOR[c] || "#94a3b8";
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const normTxt = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ");
  const hora = (d) => d.toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit", hour12: false });
  const fechaCorta = (d) => d.toLocaleDateString("es-PE", { day: "numeric", month: "short" });

  let DATA = window.NOTICIAS || null;
  const st = { lista: [], ventana: [], idx: -1, pausa: false, accion: null, ir: 0, pendiente: null, markers: [], desde: null, enVivo: true };

  // ------------------------------------------------------------------ mapa
  const map = new maplibregl.Map({
    container: "map",
    style: {
      version: 8,
      sources: {
        sat: {
          type: "raster", tileSize: 256, maxzoom: 18,
          tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
          attribution: "Imágenes © Esri, Maxar, Earthstar Geographics",
        },
        ref: {
          type: "raster", tileSize: 256, maxzoom: 13,
          tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"],
        },
      },
      layers: [
        { id: "sat", type: "raster", source: "sat", paint: { "raster-saturation": -0.1, "raster-contrast": 0.08 } },
        { id: "ref", type: "raster", source: "ref", paint: { "raster-opacity": 0.75 } },
      ],
    },
    center: [-76.8, -11.2], zoom: 5,
    maxPitch: 70,
    attributionControl: { compact: true },
    interactive: false, // es una pantalla: la cámara la maneja el recorrido
    preserveDrawingBuffer: true, // permite capturas de pantalla del mapa
  });

  // ---- diagnóstico: si el mapa no carga, avisa en pantalla y lo reporta al servidor (data/diag.log)
  const diag = { errores: [], tilesOk: 0 };
  map.on("error", (e) => {
    const m = [e.sourceId, e.error?.status, e.error?.message || String(e.error || "")].filter(Boolean).join(" ");
    if (diag.errores.length < 15 && !diag.errores.includes(m)) diag.errores.push(m);
  });
  map.on("data", (e) => { if (e.dataType === "source" && e.tile && e.sourceId === "sat") diag.tilesOk++; });

  function centroNegro() {
    try {
      const c = map.getCanvas();
      const gl = c.getContext("webgl2") || c.getContext("webgl");
      const px = new Uint8Array(4);
      gl.readPixels(Math.floor(c.width / 3), Math.floor(c.height / 2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return px[0] + px[1] + px[2] < 15;
    } catch { return null; }
  }

  function reportarDiagnostico() {
    const info = {
      url: location.href, navegador: navigator.userAgent, renderer: rendererWebGL(),
      canvas: [map.getCanvas().width, map.getCanvas().height], tilesSatelite: diag.tilesOk,
      pantallaNegra: centroNegro(), errores: diag.errores, zoom: +map.getZoom().toFixed(2),
    };
    try { navigator.sendBeacon("diag", JSON.stringify(info)); } catch { /* sin servidor */ }
    if (!diag.tilesOk || info.pantallaNegra) {
      const aviso = document.createElement("div");
      aviso.className = "aviso";
      aviso.textContent = !diag.tilesOk
        ? `No cargan las imágenes satelitales${diag.errores[0] ? " (" + diag.errores[0] + ")" : ""}. Revisa la conexión, el proxy o un bloqueador de anuncios.`
        : `El mapa se dibuja en negro en este equipo (gráficos: ${info.renderer}). Prueba desactivar "Usar aceleración por hardware" en Chrome.`;
      document.body.appendChild(aviso);
    }
  }
  setTimeout(reportarDiagnostico, 20000);

  // deja libre la zona del panel y de la tarjeta al centrar
  const relleno = (conTarjeta = true) => ({
    top: innerHeight * 0.12,
    left: innerWidth * 0.04,
    right: (document.querySelector(".panel")?.offsetWidth || 0) + innerWidth * 0.04,
    bottom: conTarjeta ? innerHeight * 0.48 : innerHeight * 0.26,
  });

  function volar(opts) {
    return new Promise((res) => {
      let listo = false;
      const fin = () => { if (!listo) { listo = true; res(); } };
      map.once("moveend", fin);
      setTimeout(fin, (opts.duration || 2000) + 1500);
      if (opts.bounds) {
        // Encuadre con easeTo (movimiento directo): fitBounds usa un vuelo en arco que se aleja de más por el camino
        const pad = opts.padding || relleno(false);
        const cam = map.cameraForBounds(opts.bounds, { padding: pad, maxZoom: opts.maxZoom || 12 });
        if (cam) {
          map.easeTo({
            center: cam.center, zoom: Math.max(cam.zoom, opts.minZoom || 0), pitch: 20, bearing: 0,
            padding: { top: 0, bottom: 0, left: 0, right: 0 }, // el centro de cam ya compensa el relleno
            duration: opts.duration, essential: true,
          });
        } else map.fitBounds(opts.bounds, { padding: pad, pitch: 20, bearing: 0, duration: opts.duration, essential: true, maxZoom: opts.maxZoom || 12, linear: true });
      }
      else map.flyTo({ essential: true, curve: 1.5, padding: relleno(), ...opts });
    });
  }
  const tiles = (max = 1500) => new Promise((res) => { let ok = false; const f = () => { if (!ok) { ok = true; res(); } }; map.once("idle", f); setTimeout(f, max); });

  // Espera "ms" de tiempo sin pausa; termina antes si el usuario navega
  function espera(ms) {
    return new Promise((res) => {
      let restante = ms;
      const t = setInterval(() => {
        if (st.accion) { const a = st.accion; st.accion = null; clearInterval(t); return res(a); }
        if (!st.pausa) restante -= 100;
        if (restante <= 0) { clearInterval(t); res("fin"); }
      }, 100);
    });
  }

  // ------------------------------------------------------------------ datos
  function ventana24h() {
    const todas = Object.values(DATA?.dias || {}).flat()
      .filter((i) => !CFG.dep || i.departamento === CFG.dep)
      .map((i) => ({ ...i, _t: new Date(i.registrado || i.fecha + "T12:00:00") }));
    if (!todas.length) return { items: [], desde: null, enVivo: true };
    let hasta = new Date();
    let items = todas.filter((i) => i._t > hasta - 864e5 && i._t <= hasta);
    let enVivo = true;
    if (items.length < 5) { // sin datos recientes (p. ej. fin de semana): últimas 24 h con datos
      hasta = new Date(Math.max(...todas.map((i) => i._t)));
      items = todas.filter((i) => i._t > hasta - 864e5);
      enVivo = false;
    }
    return { items, desde: new Date(hasta - 864e5), enVivo };
  }

  const puntaje = (it) => (REL_PESO[it.relevancia] || 10) + (it.tipo === "Incidente" ? 6 : 0) + (CAT_PESO[it.categoria] || 0) +
    (it.precision === "distrito" || it.precision === "exacta" ? 2 : 0) + (it.imagen ? 1 : 0);
  const palabras = (it) => new Set(normTxt(it.resumen).split(/\s+/).filter((w) => w.length >= 5));

  // Misma noticia de varios medios: misma región y ≥2 palabras poco frecuentes en común
  function esDuplicado(a, b, df) {
    if (a.departamento !== b.departamento) return false;
    if (a.etiquetas && a.etiquetas === b.etiquetas && a.distrito === b.distrito) return true;
    let comunes = 0;
    for (const w of a._w) if (b._w.has(w) && (df.get(w) || 0) <= 3) comunes++;
    return comunes >= 2;
  }

  function seleccionar(items) {
    const df = new Map();
    items.forEach((it) => { it._score = puntaje(it); it._w = palabras(it); it._w.forEach((w) => df.set(w, (df.get(w) || 0) + 1)); });
    const unicas = [], porDep = {};
    [...items].sort((a, b) => b._score - a._score || b._t - a._t).forEach((it) => {
      if (unicas.some((u) => esDuplicado(u, it, df))) return;
      unicas.push(it);
      (porDep[it.departamento] ||= []).push(it);
    });
    // reparto alterno entre regiones hasta el máximo
    const deps = Object.keys(porDep), elegidas = [];
    while (elegidas.length < CFG.max && deps.some((d) => porDep[d].length)) {
      for (const d of deps) if (porDep[d].length && elegidas.length < CFG.max) elegidas.push(porDep[d].shift());
    }
    return { unicas, lista: ordenarPorFecha(elegidas) };
  }

  // Orden cronológico: la más reciente primero (fecha y hora de registro en el sheet)
  function ordenarPorFecha(items) {
    return [...items].sort((a, b) => b._t - a._t);
  }

  function preparar() {
    const v = ventana24h();
    const { unicas, lista } = seleccionar(v.items);
    st.ventana = unicas; st.lista = lista; st.desde = v.desde; st.enVivo = v.enVivo; st.idx = -1;
    const deps = CFG.dep ? CFG.dep : (DATA?.departamentos || []).join(" · ");
    $("scope").textContent = v.enVivo ? `${deps} · últimas 24 horas` : `${deps} · sin registros recientes: últimas 24 h con datos`;
    $("updated").textContent = DATA?.generado ? `Datos sincronizados ${DATA.generado.slice(11)}` : "";
    pintarPanel();
    actualizarPuntos();
  }

  // ------------------------------------------------------------------ panel
  // Orden fijo de las categorías (el mismo de la paleta validada)
  const ORDEN_CAT = ["Coyuntura Social", "Seguridad y delincuencia", "Agro-Agua-Medioambiente", "Economía-Desarrollo", "Protestas, Paros y Bloqueos", "Coyuntura Política"];
  // Nombres cortos para la leyenda (los completos van en la lista y en la tarjeta)
  const CORTO = {
    "Coyuntura Social": "Social", "Seguridad y delincuencia": "Seguridad", "Agro-Agua-Medioambiente": "Agro y ambiente",
    "Economía-Desarrollo": "Economía", "Protestas, Paros y Bloqueos": "Protestas y paros", "Coyuntura Política": "Política",
  };
  const ICONOS = {
    "Seguridad y delincuencia": '<path d="M12 3 5 6v5.5c0 4.2 2.9 7.8 7 9 4.1-1.2 7-4.8 7-9V6l-7-3z"/><path d="m9 12 2.2 2.2L15.5 10"/>',
    "Protestas, Paros y Bloqueos": '<path d="M4 10v4h3l6 4V6L7 10H4z"/><path d="M16.5 9.5a3.5 3.5 0 0 1 0 5"/><path d="M19 7a7 7 0 0 1 0 10"/>',
    "Coyuntura Política": '<path d="M3 9.5 12 4l9 5.5"/><path d="M5 10v7M9.5 10v7M14.5 10v7M19 10v7"/><path d="M3 20h18"/>',
    "Coyuntura Social": '<circle cx="9" cy="8.5" r="3"/><path d="M3.5 19v-1a4.5 4.5 0 0 1 4.5-4.5h2a4.5 4.5 0 0 1 4.5 4.5v1"/><path d="M16 5.7a3 3 0 0 1 0 5.6M18 14a4.2 4.2 0 0 1 2.7 4v1"/>',
    "Agro-Agua-Medioambiente": '<path d="M12 3s6 6.3 6 11a6 6 0 0 1-12 0c0-4.7 6-11 6-11z"/><path d="M9.5 14.5a2.5 2.5 0 0 0 2.5 2.5"/>',
    "Economía-Desarrollo": '<path d="m3 17 6-6 4 4 7.5-7.5"/><path d="M15 7.5h5.5V13"/>',
    otro: '<circle cx="12" cy="12" r="8.5"/><path d="M12 8v4.5"/><path d="M12 16v.2"/>',
  };
  const FLAMA = '<path d="M12 3c.8 3.2 4.5 4.8 4.5 9a4.5 4.5 0 0 1-9 0c0-1.7.9-2.9 1.8-3.9.8-.9 1.3-2.2 2.7-5.1z"/>';
  const AVISO = '<path d="M12 4.5 3.5 19h17L12 4.5z"/><path d="M12 10v4"/><path d="M12 16.8v.2"/>';
  const svg = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
  const hace = (d) => {
    const m = Math.max(0, Math.round((Date.now() - d) / 6e4));
    return m < 1 ? "ahora" : m < 60 ? `hace ${m} min` : m < 1440 ? `hace ${Math.floor(m / 60)} h` : "hace 1 día";
  };

  // Cuenta hasta el valor (solo anima si el número cambia)
  function contar(el, hasta) {
    const desde = +el.dataset.v || 0;
    el.dataset.v = hasta;
    if (desde === hasta) { el.textContent = hasta; return; }
    const t0 = performance.now();
    const paso = () => {
      const p = Math.min(1, (performance.now() - t0) / 900), e = 1 - (1 - p) ** 3;
      el.textContent = Math.round(desde + (hasta - desde) * e);
      if (p < 1) requestAnimationFrame(paso);
    };
    requestAnimationFrame(paso);
  }

  function pintarPanel() {
    const v = st.ventana;
    contar($("heroTotal"), v.length);
    contar($("tAlto"), v.filter((i) => i.relevancia === "Alto").length);
    contar($("tInc"), v.filter((i) => i.tipo === "Incidente").length);

    // actividad por hora: 24 barras, la última (hora actual) en el color de acento
    const fin = st.desde ? +st.desde + 864e5 : Date.now(), inicio = fin - 864e5;
    const porHora = new Array(24).fill(0);
    v.forEach((i) => { porHora[Math.min(23, Math.max(0, Math.floor((i._t - inicio) / 36e5)))]++; });
    const max = Math.max(1, ...porHora), pico = porHora.indexOf(Math.max(...porHora));
    const horaDe = (k) => hora(new Date(inicio + k * 36e5)).slice(0, 2) + ":00";
    $("spark").innerHTML = porHora.map((n, k) =>
      `<i class="b${k === 23 ? " now" : ""}" style="--h:${(n / max) * 100}%;--k:${k}" title="${horaDe(k)} · ${n} ${n === 1 ? "noticia" : "noticias"}">${n && k === pico ? `<em>${n}</em>` : ""}</i>`).join("");
    $("pico").textContent = v.length ? `Pico a las ${horaDe(pico)}` : "";

    // reparto por categoría: barra segmentada + leyenda con las cifras
    const porCat = {};
    v.forEach((i) => (porCat[i.categoria] = (porCat[i.categoria] || 0) + 1));
    const cats = [...ORDEN_CAT.filter((c) => porCat[c]), ...Object.keys(porCat).filter((c) => !ORDEN_CAT.includes(c))];
    $("mix").innerHTML = cats.map((c) => `<i style="--n:${porCat[c]};--c:${color(c)}" title="${esc(c)}: ${porCat[c]}"></i>`).join("");
    $("legend").innerHTML = cats.map((c) => `<li style="--c:${color(c)}" title="${esc(c)}"><span>${esc(CORTO[c] || c)}</span><b>${porCat[c]}</b></li>`).join("");

    // línea de tiempo
    const ahora = Date.now();
    $("list").innerHTML = st.lista.map((it, i) => {
      const lugar = [it.distrito, it.departamento].filter(Boolean).join(" · ");
      const etiquetas = [
        it.relevancia === "Alto" ? `<span class="tag alta">${svg(FLAMA)}Alta</span>` : it.relevancia === "Medio" ? `<span class="tag media">${svg(AVISO)}Media</span>` : "",
        it.tipo === "Incidente" ? '<span class="tag inc">Incidente</span>' : "",
        ahora - it._t < NUEVO_MIN * 6e4 ? '<span class="tag nuevo">Nuevo</span>' : "",
      ].join("");
      const mas = it.bajada || (it.resumen !== it.titular ? it.resumen : "");
      return `<li class="it" data-i="${i}" style="--c:${color(it.categoria)};--n:${i}">
        <div class="it-ico" title="${esc(it.categoria)}">${svg(ICONOS[it.categoria] || ICONOS.otro)}</div>
        <div class="it-body">
          <div class="it-row"><span class="it-place">${esc(lugar)}</span><span class="it-ago" data-t="${+it._t}">${hora(it._t)} · ${hace(it._t)}</span></div>
          <div class="it-title">${esc(it.titular)}</div>
          ${etiquetas ? `<div class="it-tags">${etiquetas}</div>` : ""}
          <div class="it-more"><div>${mas ? `<p>${esc(mas)}</p>` : ""}<div class="it-prog"><i></i></div></div></div>
        </div>
      </li>`;
    }).join("");
    $("list").querySelectorAll("li").forEach((li) => (li.onclick = () => { st.ir = +li.dataset.i; st.accion = "goto"; }));
  }

  // "hace 5 min" se actualiza solo cada minuto
  function refrescarHace() {
    $("list").querySelectorAll(".it-ago").forEach((el) => { const t = new Date(+el.dataset.t); el.textContent = `${hora(t)} · ${hace(t)}`; });
  }

  // La noticia en pantalla se resalta; las anteriores de esta vuelta quedan marcadas como vistas
  function marcarLista() {
    $("list").querySelectorAll("li").forEach((li) => {
      const i = +li.dataset.i;
      li.classList.toggle("current", i === st.idx);
      li.classList.toggle("visto", st.idx >= 0 && i < st.idx);
    });
    $("list").querySelector("li.current")?.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  // La barra de la tarjeta abierta avanza junto con el tiempo que le queda a la noticia
  function progresoLista() {
    const barra = $("list").querySelector("li.current .it-prog i");
    if (!barra) return;
    barra.classList.remove("run"); void barra.offsetWidth;
    barra.style.setProperty("--dur", `${CFG.seg}s`); barra.classList.add("run");
  }

  function actualizarPuntos() {
    const fc = { type: "FeatureCollection", features: st.ventana.map((i) => ({ type: "Feature", properties: { c: color(i.categoria) }, geometry: { type: "Point", coordinates: [i.lon, i.lat] } })) };
    const put = () => {
      if (map.getSource("dia")) return map.getSource("dia").setData(fc);
      map.addSource("dia", { type: "geojson", data: fc });
      map.addLayer({ id: "dia", type: "circle", source: "dia", paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 4, 11, 7],
        "circle-color": ["get", "c"], "circle-opacity": 0.85, "circle-stroke-color": "#fff", "circle-stroke-width": 1.2,
      } }, map.getLayer("ruta-borde") ? "ruta-borde" : undefined);
    };
    const intentar = () => { try { put(); } catch { map.once("styledata", intentar); } };
    intentar();
  }

  // ------------------------------------------------------------------ línea de recorrido
  const VACIO = { type: "FeatureCollection", features: [] };

  function crearCapaRuta() {
    const poner = () => {
      if (map.getSource("ruta")) return;
      map.addSource("ruta", { type: "geojson", data: VACIO });
      const ancho = (a, b) => ["interpolate", ["linear"], ["zoom"], 5, a, 11, b];
      const trazo = { "line-cap": "round", "line-join": "round" };
      // resplandor rojo suave y, encima, la línea fina roja
      map.addLayer({ id: "ruta-borde", type: "line", source: "ruta", layout: trazo,
        paint: { "line-color": "#ff2a3a", "line-opacity": 0.4, "line-width": ancho(7, 13), "line-blur": 5 } });
      map.addLayer({ id: "ruta", type: "line", source: "ruta", layout: trazo,
        paint: { "line-color": "#ff2a3a", "line-width": ancho(2.5, 4.5) } });
      if (map.getLayer("dia")) map.moveLayer("dia", "ruta-borde");
    };
    const intentar = () => { try { poner(); } catch { map.once("styledata", intentar); } };
    intentar();
  }

  function limpiarRuta() {
    map.getSource("ruta")?.setData(VACIO);
  }

  // Arco suave entre dos coordenadas (curva de Bézier), para que la línea no sea una recta
  function curva(a, b, n = 80) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const k = [(a[0] + b[0]) / 2 - dy * 0.18, (a[1] + b[1]) / 2 + dx * 0.18];
    return Array.from({ length: n + 1 }, (_, i) => {
      const t = i / n, u = 1 - t;
      return [u * u * a[0] + 2 * u * t * k[0] + t * t * b[0], u * u * a[1] + 2 * u * t * k[1] + t * t * b[1]];
    });
  }

  // Dibuja la línea roja avanzando desde el origen hasta el destino
  function dibujarRuta(pts, ms) {
    return new Promise((res) => {
      const t0 = performance.now();
      const paso = () => {
        const p = Math.min(1, Math.max(0, (performance.now() - t0) / ms));
        const e = p < 0.5 ? 2 * p * p : 1 - ((-2 * p + 2) ** 2) / 2; // arranca y frena suave
        const f = Math.min(Math.max(e, 0), 1) * (pts.length - 1), i0 = Math.min(Math.floor(f), pts.length - 2), fr = f - i0;
        const a = pts[i0], b = pts[i0 + 1];
        const punta = [a[0] + (b[0] - a[0]) * fr, a[1] + (b[1] - a[1]) * fr];
        map.getSource("ruta")?.setData({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [...pts.slice(0, i0 + 1), punta] } });
        p < 1 ? requestAnimationFrame(paso) : res();
      };
      requestAnimationFrame(paso);
    });
  }

  // Tramo entre la noticia anterior y la nueva: la cámara muestra ambos puntos y una línea roja los une
  async function tramo(prev, it) {
    const d = Math.hypot(prev.lon - it.lon, prev.lat - it.lat);
    if (d < 0.02) return; // mismo lugar: no hay recorrido que dibujar
    const A = [prev.lon, prev.lat], B = [it.lon, it.lat], pts = curva(A, B);
    const punto = (x, origen) => {
      const el = document.createElement("div"); el.className = "mk-dot" + (origen ? " mk-origen" : "");
      el.style.setProperty("--c", color(x.categoria)); return marcador(el, [x.lon, x.lat]);
    };
    const etiqueta = (x) => {
      const el = document.createElement("div"); el.className = "mk-label"; el.style.setProperty("--c", color(x.categoria));
      el.textContent = x.distrito || x.provincia || x.departamento; return marcador(el, [x.lon, x.lat], "bottom");
    };
    punto(prev, true); etiqueta(prev);
    const temporales = [punto(it, false), etiqueta(it)];
    const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
    // sin tarjeta en pantalla durante el tramo: se aprovecha el espacio de abajo. El zoom mínimo evita que se abra más allá del Perú.
    await volar({
      bounds: [[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], duration: T.fly,
      maxZoom: 10.5, minZoom: ZOOM_MIN_TRAMO, padding: { ...relleno(false), bottom: innerHeight * 0.12 },
    });
    await tiles(1200);
    await dibujarRuta(pts, Math.min(2800, 1500 + d * 250));
    await new Promise((r) => setTimeout(r, 400));
    // el destino lo vuelve a poner etiquetas(); el origen y la línea se quedan
    temporales.forEach((m) => m.remove());
    st.markers = st.markers.filter((m) => !temporales.includes(m));
  }

  // ------------------------------------------------------------------ escenas
  function limpiar() {
    st.markers.forEach((m) => m.remove());
    st.markers = [];
    limpiarRuta();
    $("card").classList.remove("show");
  }

  function marcador(el, lngLat, anchor = "center") {
    const wrap = document.createElement("div"); // MapLibre usa transform en el contenedor
    wrap.appendChild(el);
    const m = new maplibregl.Marker({ element: wrap, anchor }).setLngLat(lngLat).addTo(map);
    st.markers.push(m);
    return m;
  }

  function etiquetas(it) {
    const c = color(it.categoria);
    const ref = DATA.referencias?.[it.departamento] || {};
    if (ref._ && Math.hypot(ref._[0] - it.lon, ref._[1] - it.lat) > 0.12) {
      const d = document.createElement("div"); d.className = "mk-dep"; d.textContent = it.departamento; marcador(d, ref._);
    }
    const p = ref[it.provincia];
    if (p && it.provincia !== it.distrito && Math.hypot(p[0] - it.lon, p[1] - it.lat) > 0.03) {
      const e = document.createElement("div"); e.className = "mk-prov"; e.textContent = "Prov. " + it.provincia; marcador(e, p);
    }
    const dot = document.createElement("div"); dot.className = "mk-dot"; dot.style.setProperty("--c", c); marcador(dot, [it.lon, it.lat]);
    const lab = document.createElement("div"); lab.className = "mk-label"; lab.style.setProperty("--c", c);
    lab.textContent = it.distrito || it.provincia || it.departamento;
    marcador(lab, [it.lon, it.lat], "bottom");
  }

  async function vistaGeneral() {
    limpiar();
    const v = st.ventana;
    $("ovTotal").textContent = v.length;
    $("ovAlto").textContent = v.filter((i) => i.relevancia === "Alto").length;
    $("ovInc").textContent = v.filter((i) => i.tipo === "Incidente").length;
    const porDep = {};
    v.forEach((i) => (porDep[i.departamento] = (porDep[i.departamento] || 0) + 1));
    $("ovDeps").innerHTML = Object.entries(porDep).map(([d, n]) => `<span>${esc(d)}: ${n}</span>`).join("") ||
      "<span>Sin noticias registradas en las últimas 24 horas</span>";
    $("overview").classList.add("show");
    const pts = v.length ? v.map((i) => [i.lon, i.lat]) : [[-79.6, -7.0], [-74.9, -15.5]];
    const b = pts.reduce((acc, p) => [[Math.min(acc[0][0], p[0]), Math.min(acc[0][1], p[1])], [Math.max(acc[1][0], p[0]), Math.max(acc[1][1], p[1])]], [pts[0], pts[0]]);
    await volar({ bounds: [[b[0][0] - 0.4, b[0][1] - 0.4], [b[1][0] + 0.4, b[1][1] + 0.4]], duration: 3500 });
    const r = await espera(T.overview);
    $("overview").classList.remove("show");
    return r;
  }

  async function escena(it, prev) {
    limpiar();
    $("overview").classList.remove("show");
    // con el orden por fecha las noticias saltan de un lugar a otro: una línea roja une la anterior con la nueva
    if (prev) await tramo(prev, it);
    const z = ZOOM[it.precision] || 10;
    await volar({ center: [it.lon, it.lat], zoom: z, pitch: z > 9 ? 55 : 35, bearing: ((it.lon * 1000) % 40) - 20, duration: prev ? T.flyLargo / 2 : T.fly });
    await tiles();

    etiquetas(it);
    const lugar = [it.provincia && it.provincia !== it.distrito ? it.provincia : "", it.distrito].filter(Boolean);
    $("place").innerHTML = `<b>${esc(it.departamento)}</b>${lugar.map((l) => `<span>${esc(l)}</span>`).join("")}`;
    const c = color(it.categoria);
    $("headline").innerHTML = it.titular.split(/\s+/).map((w, i) =>
      `<span class="w" style="animation-delay:${i * 55}ms${i === 0 ? `;color:${c}` : ""}">${esc(w)}</span>`).join(" ");
    const cat = $("cardCat"); cat.textContent = it.categoria; cat.style.setProperty("--c", c);
    const rel = $("cardRel"); rel.textContent = it.relevancia === "Bajo" ? "" : `Relevancia ${it.relevancia.toLowerCase()}`; rel.className = `chip chip-ghost rel-${it.relevancia}`;
    $("cardTipo").textContent = it.tipo === "Incidente" ? "Incidente" : "";
    $("cardSrc").textContent = it.fuente;
    $("cardTime").textContent = `${fechaCorta(it._t)} · ${hora(it._t)}`;
    const img = $("cardImg");
    img.hidden = !it.imagen;
    if (it.imagen) { img.onerror = () => (img.hidden = true); img.src = it.imagen; } else img.removeAttribute("src");
    const bar = $("bar");
    bar.classList.remove("run"); void bar.offsetWidth;
    bar.style.setProperty("--dur", `${CFG.seg}s`); bar.classList.add("run");
    progresoLista();
    $("card").classList.add("show");
  }

  // ------------------------------------------------------------------ bucle principal
  async function bucle() {
    for (;;) {
      if (st.pendiente) { DATA = st.pendiente; st.pendiente = null; }
      preparar();
      await vistaGeneral();
      let i = 0, prev = null;
      while (i < st.lista.length) {
        st.idx = i; marcarLista();
        await escena(st.lista[i], prev);
        const r = await espera(CFG.seg * 1000);
        prev = st.lista[i];
        if (r === "prev") i = Math.max(0, i - 1);
        else if (r === "goto") i = st.ir;
        else i++;
        if (st.pendiente && r === "fin" && i >= st.lista.length) break;
      }
    }
  }

  // Lee data/noticias.json cada pocos minutos; los cambios entran en la siguiente vuelta
  // Si cambia el código de la pantalla (app.js, styles.css, index.html), se recarga sola
  let firmaCodigo = null;
  async function firma() {
    const textos = await Promise.all(["index.html", "app.js", "styles.css"].map((f) =>
      fetch(`${f}?t=${Date.now()}`, { cache: "no-store" }).then((r) => (r.ok ? r.text() : ""))));
    let h = 0;
    for (const ch of textos.join("|")) h = (h * 31 + ch.charCodeAt(0)) | 0;
    return h;
  }
  async function revisarCodigo() {
    try {
      const f = await firma();
      if (firmaCodigo === null) firmaCodigo = f;
      else if (f !== firmaCodigo) location.reload();
    } catch { /* sin servidor: nada que revisar */ }
  }

  async function refrescar() {
    revisarCodigo();
    try {
      const r = await fetch(`data/noticias.json?t=${Date.now()}`, { cache: "no-store" });
      if (!r.ok) return;
      const nuevo = await r.json();
      if (!DATA || nuevo.generado !== DATA.generado) {
        st.pendiente = nuevo;
        $("updated").textContent = `Datos sincronizados ${nuevo.generado.slice(11)} · entran en la próxima vuelta`;
      }
    } catch { /* abierto sin servidor (file://): se usa data/noticias.js */ }
  }

  // ------------------------------------------------------------------ reloj, teclado, cursor
  function reloj() {
    const d = new Date();
    $("clock").textContent = hora(d);
    $("today").textContent = d.toLocaleDateString("es-PE", { weekday: "long", day: "numeric", month: "long" });
  }

  document.addEventListener("keydown", (e) => {
    if (e.code === "Space") {
      e.preventDefault();
      st.pausa = !st.pausa;
      document.body.classList.toggle("pausa", st.pausa);
      $("paused").hidden = !st.pausa;
    } else if (e.key === "ArrowRight") st.accion = "next";
    else if (e.key === "ArrowLeft") st.accion = "prev";
    else if (e.key === "f" || e.key === "F") {
      document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.();
    }
  });

  let idle;
  document.addEventListener("mousemove", () => {
    document.body.classList.remove("idle");
    clearTimeout(idle);
    idle = setTimeout(() => document.body.classList.add("idle"), 3000);
  });

  // ------------------------------------------------------------------ arranque
  reloj();
  setInterval(reloj, 1000);
  setInterval(refrescarHace, 60e3);
  setInterval(refrescar, CFG.refresco * 60e3);
  revisarCodigo(); // firma inicial del código
  crearCapaRuta();
  new ResizeObserver(() => map.resize()).observe(document.body);
  (async () => {
    while (!DATA) {
      await refrescar();
      DATA = st.pendiente; st.pendiente = null;
      if (!DATA) { $("scope").textContent = "Cargando noticias…"; await new Promise((r) => setTimeout(r, 10000)); }
    }
    bucle();
  })();
  window.mapaVivo = { map, st, CFG, escena, tramo, preparar };
})();
