# ⚡ Zar Browser (personal, ultra-light)

Fork minimal de Neutron. Filosofía: "Optimization before beauty. Zero customization. Just speed."

## Estructura viva (Fase 1)
```
zar-browser/
  main.js          -> ventanas, tabs WebContentsView, discarding 5min, adblock
  preload.js       -> puente mínimo window.api
  db.js            -> historial mínimo JSON (zar-history.json en userData) [pendiente conectar IPC]
  ui/index.html    -> titlebar + tabs + toolbar + overlay homepage
  ui/renderer.js   -> controlador UI
  ui/style.css     -> design system oscuro + acento rojo
  assets/          -> solo logos nuevos (256/512/png + ico)
```

## Cenizas eliminadas (quedan en `original neutron browser/` como museo)
settings.html (1635), i18n.js (1328), home.html, task-manager, favorites/*, history UI/*, downloads/*, sidebar-shortcut/*, onboarding/*, setup-wizard/*, lightsession.js, neutron-settings.json, neutron-shield.json, installer/, packaging/, docs/

## Decisiones confirmadas
- Historial: SÍ mínimo (db.js + Ctrl+H / panel simple)
- Favoritos: NO (usar tab fija o .txt)
- Settings: SÍ mínimo (4-5 toggles: adblock on/off, homepage, search engine, tab discarding)
- Adblock: SÍ pero cacheado en disco (no descargar EasyList en cada arranque)
- Carpeta nueva limpia + git init, original intacto

## Siguiente (Fase 2, pendiente)
1. Conectar db.js a IPC (`get-history`, `clear-history`) + atajo Ctrl+H
2. Cachear adblock (`adblock-cache.dat` con `ElectronBlocker.fromLists` + `toDataBuffer/fromDataBuffer`)
3. Settings mínimo `zar-settings.json` (5 claves) + UI panel simple
4. Favicon local único (quitar icon.horse/google fallback triple)
5. Zoom Ctrl+/-, find Ctrl+F, manejo descargas básico
