# ⚡ Zar Browser v1.2.0 (ultra-light)

<img width="356" height="356" alt="Captura de pantalla_20260914_070146" src="https://github.com/user-attachments/assets/70205ccf-3f1d-438d-a982-5032b5cad62f" />


Philosophy: "Optimization before beauty." Zero customization. only speed.





## State

Electron + `WebContentsView` per tab. Without sidebar, without profiles, without favorites, without complete settings, without onboarding, without telemetry.

## Structure

zar-browser/
main.js -> windows, tabs, discarding 5min, adblock, downloads, session, engines
preload.js -> minimum bridge window.api
optimizations.js -> 25 switches Chromium (see the header of the file for rules)
db.js -> minimum JSON history (zar-history.json, asleep: no UI)
ui/index.html -> title bar + tabs + tools bar + home page
ui/renderer.js -> UI controller
ui/style.css -> dark design system + red accent
ui/about.html -> About page
ui/download-popup.html -> download bubble (anchored view, Brave style)
assets/icon.png / icon.ico -> logo (Linux / Windows)
benchmark.sh -> manual measurement of idle RAM vs video

## Fact

* **Adblock** `@ghostery/adblocker-electron` (EasyList + EasyPrivacy) with disk cache (`adblock-cache-ghostery.bin`, refresh every 7 days). Only partition `persist:zar`.
* **Native Zoom** `Ctrl +/-/0` with standard levels (-3..+5).
* **Downloads**: bubble anchored at the top-right within the window (in Wayland, OS windows cannot be positioned, hence it's a view and not a popup), auto-opening without stealing focus, bar + % + cancel + progress ring on the button ⬇ (inline SVG Material).
* **Engines**: DuckDuckGo (default), Google, Brave, Startpage, SearXNG. Button with initial to the left of the omnibox, persists in `zar-settings.json`.
* **Session**: saves/restores tabs + activates in `zar-session.json`, silent. `--open-url=` overrides the session (benchmark).
* **Back/forward** via `navigationHistory` (the `webContents.goBack/goForward` are deprecated); buttons are grayed out without history.
* **RAM meter removed** The System Monitor does that better. Only the purge 🧹 is left.
* **Packaging**: `build:win` (nsis x64 `.exe`), `build:linux` (`.deb/.rpm/.pacman` x64). Without AppImage.

## Measured consumption (CachyOS/KDE/Wayland, iGPU Alder Lake-N)

* Normal: **~180-200 MB**
* Video: **~400-700 MB**

Measure with `./benchmark.sh` (see file for the procedure).

## Decisions

* History: `db.js` exists but is dormant (without UI, without IPC).
* Favorites: NO (fixed tab or .txt).

## Keyboard Shortcuts

* `Ctrl+T` → new tab
* `Ctrl+W` → close tab (pinned tabs are protected)
* `Ctrl+Tab` / `Ctrl+Shift+Tab` → next / previous tab
* `Ctrl+Shift+P` → pin/unpin active tab (pinned tabs show 📌 and can't be closed)
* `Ctrl+L` / `Alt+D` → focus omnibox
* `Ctrl+R` / `F5` → reload
* `Ctrl++` / `Ctrl+-` / `Ctrl+0` → zoom in / out / reset
* `Alt+Left` / `Alt+Right` → back / forward
* `F11` → fullscreen
* `F12` or `Ctrl+Shift+I` → devtools

Right-click on a tab opens the context menu (pin/unpin, close, new tab).

## Compile
```
npm ci
npm start # dev
npm run build:linux # .deb .rpm .pacman in dist/
npm run build:win # .exe (on Windows; on Linux it requires Wine)
```

## License

See `LICENSE`.
