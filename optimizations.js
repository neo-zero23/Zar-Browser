// ⚡ Zar — switches Chromium verificados.
// Llamar ANTES de app.whenReady(). Ver Tarea 3 para fuentes y riesgos.
function applyChromiumSwitches(app) {
  const sw = app.commandLine;

  // --- Procesos y runtime (bajo riesgo) ---
  sw.appendSwitch('renderer-process-limit', '4'); // capa renderers
  sw.appendSwitch('autoplay-policy', 'no-user-gesture-required');
  sw.appendSwitch('disable-extensions');
  sw.appendSwitch('disable-speech-api'); // API voz fuera
  sw.appendSwitch('disable-speech-synthesis-api');
  sw.appendSwitch('disable-print-preview');
  sw.appendSwitch('no-first-run');
  sw.appendSwitch('no-default-browser-check');

  // --- Telemetría (bajo riesgo) ---
  // NOTA: --disable-sync es no-op en Electron, no se pone.
  sw.appendSwitch('disable-background-networking'); // mata UMA/sync/translate bg
  sw.appendSwitch('disable-component-update'); // no actualiza chrome://components
  sw.appendSwitch('disable-domain-reliability'); // no reporta a Google
  sw.appendSwitch('disable-breakpad'); // sin dumps
  // NOTA: --expose-gc quitado a pedido (el botón 🧹 usa IPC, no necesita gc expuesto).
  // Pierdes Cast/Translate nativo (no se usa en Zar).
  // Vulkan desactivado: en Wayland lanzaba warning ('--ozone-platform=wayland'
  // is not compatible with Vulkan) y Zar no usa WebGPU. Verificar tras el
  // cambio que VA-API sigue en chrome://gpu (Video Decode: Hardware accelerated).
  sw.appendSwitch('disable-features', 'Translate,MediaRouter,OptimizationHints,DialMediaRouteProvider,Vulkan');

  // --- GPU / video Intel Wayland (medio riesgo, alto premio en Alder Lake-N) ---
  sw.appendSwitch('enable-features', 'VaapiVideoDecoder,AcceleratedVideoDecodeLinuxGL,AcceleratedVideoDecodeLinuxZeroCopyGL,WaylandLinuxDrmSyncobj');
  // VaapiIgnoreDriverChecks comentado: solo activar si VA-API falla (ver chrome://gpu).
  // Para activarlo: añadir ',VaapiIgnoreDriverChecks' a la línea anterior.
  sw.appendSwitch('ignore-gpu-blocklist'); // fuerza GPU aunque esté en blocklist
  sw.appendSwitch('enable-accelerated-video-decode');
  sw.appendSwitch('enable-accelerated-2d-canvas');
  sw.appendSwitch('enable-gpu-rasterization');
  sw.appendSwitch('enable-zero-copy');
  sw.appendSwitch('ozone-platform-hint', 'auto'); // Wayland/X11 auto
  // NOTA: --no-zygote solo si confirmas bug electron#50455 (gpu-process 60%+).
  // Descomenta para probar: sw.appendSwitch('no-zygote'); // +100ms spawn por proceso

  // --- Recursos (medio riesgo) ---
  sw.appendSwitch('js-flags', '--max-old-space-size=512'); // capa heap V8 por renderer
  sw.appendSwitch('disk-cache-size', '52428800'); // 50MB disco
  // NO por defecto (alto/medio riesgo): process-per-site, enable-low-end-device-mode, disable-back-forward-cache

  console.log('[Zar] 15 switches aplicados');
}

module.exports = { applyChromiumSwitches };
