# ⚡ Zar Browser v1.0.0 (personal, ultra-light)

Fork minimal de Neutron. Filosofía: "Optimization before beauty. Zero customization. Just speed."

## Estado

Electron + `WebContentsView` por tab. Sin sidebar, sin perfiles, sin favoritos, sin settings completa, sin onboarding, sin telemetría.

## Estructura

```
zar-browser/
  main.js          -> ventanas, tabs, discarding 5min, adblock, descargas, sesión, motores
  preload.js       -> puente mínimo window.api
  optimizations.js -> 25 switches Chromium (ver cabecera del archivo para reglas)
  db.js            -> historial mínimo JSON (zar-history.json, dormido: sin UI)
  ui/index.html    -> titlebar + tabs + toolbar + overlay homepage
  ui/renderer.js   -> controlador UI
  ui/style.css     -> design system oscuro + acento rojo
  ui/about.html    -> página Acerca de
  ui/download-popup.html -> bubble de descargas (view anclada, estilo Brave)
  assets/icon.png / icon.ico -> logo (Linux / Windows)
  benchmark.sh     -> medición manual de RAM idle vs video
```

## Hecho

* **Adblock** `@ghostery/adblocker-electron` (EasyList + EasyPrivacy) con caché en disco (`adblock-cache-ghostery.bin`, refresh 7 días). Solo partición `persist:zar`.
* **Zoom** nativo `Ctrl +/-/0` con niveles estándar (-3..+5).
* **Descargas**: bubble anclado arriba-derecha dentro de la ventana (en Wayland no se puede posicionar ventanas del SO, por eso es view y no popup), auto-apertura sin robar foco, barra + % + cancelar + anillo de progreso en el botón ⬇ (SVG Material inline).
* **Motores**: DuckDuckGo (default), Google, Brave, Startpage, SearXNG. Botón con inicial a la izquierda del omnibox, persiste en `zar-settings.json`.
* **Sesión**: guarda/restaura tabs + activa en `zar-session.json`, silencioso. `--open-url=` manda sobre la sesión (benchmark).
* **Back/forward** por `navigationHistory` (los `webContents.goBack/goForward` están deprecados); botones se atenúan sin historial.
* **RAM meter eliminado** (medía mal: 588 vs 155 reales). El Monitor del Sistema hace eso mejor. Quedó solo el purge 🧹.
* **Packaging**: `build:win` (nsis x64 `.exe`), `build:linux` (`.deb/.rpm/.pacman` x64). Sin AppImage.

## Consumo medido (CachyOS/KDE/Wayland, iGPU Alder Lake-N)

* Normal: **~180 MB**
* Video: **~400-500 MB**

Medir con `./benchmark.sh` (ver archivo para el procedimiento).

## Decisiones

* Historial: `db.js` existe pero dormido (sin UI, sin IPC).
* Favoritos: NO (tab fija o .txt).
* Find-in-page: NO (usar buscador del sitio o `window.find()` en DevTools).
* DoH por flags: NO engancha en Electron (verificado 2026); flags en reserva.
* Warning Vulkan/Wayland: ruido de probeo, cosmético.

## Compilar

```
npm ci
npm start                  # dev
npm run build:linux        # .deb .rpm .pacman en dist/
npm run build:win          # .exe (en Windows; en Linux pide Wine)
```

## Licencia

Ver `LICENSE`.
