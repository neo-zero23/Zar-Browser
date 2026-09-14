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
  // TEMP (test rendimiento): background-networking comentado. Sospecha de que
  // mata el DNS prefetch y suma segundos a cada búsqueda. Si mejora, se queda
  // comentado y se documenta; si no cambia nada, se restaura.
  // sw.appendSwitch('disable-background-networking'); // mata UMA/sync/translate bg
  sw.appendSwitch('disable-component-update'); // no actualiza chrome://components
  sw.appendSwitch('disable-domain-reliability'); // no reporta a Google
  sw.appendSwitch('disable-breakpad'); // sin dumps
  // NOTA: --expose-gc quitado a pedido (el botón 🧹 usa IPC, no necesita gc expuesto).
  // Pierdes Cast/Translate nativo (no se usa en Zar).
  // Vulkan bloqueado agresivo (Wayland): feature + backends ANGLE.
  // --disable-gpu-vulkan NO se pone: no existe en gpu_switches.cc (no inventar flags).
  sw.appendSwitch('disable-features', 'Translate,MediaRouter,OptimizationHints,DialMediaRouteProvider,Vulkan,VulkanFromANGLE,DefaultANGLEVulkan');
  sw.appendSwitch('disable-vulkan-surface'); // sin swapchain VK (verificado en gpu/command_buffer/service/gpu_switches.cc)

  // --- DNS sobre HTTPS (Firefox es rápido porque usa DoH por defecto) ---
  // systemd-resolved 910ms vs Cloudflare 505ms -> DoH recorta el handshake.
  // Verificar en chrome://net-internals/#dns que el resolver es Cloudflare.
  sw.appendSwitch('dns-over-https-mode', 'secure'); // OJO: sin fallback a DNS sistema; si Cloudflare cae, no hay DNS
  sw.appendSwitch('dns-over-https-templates', 'https://cloudflare-dns.com/dns-query');

  // --- GPU / video Intel Wayland (medio riesgo, alto premio en Alder Lake-N) ---
  // DnsOverHttps va concatenado aquí (mismo appendSwitch, no separado).
  sw.appendSwitch('enable-features', 'DnsOverHttps,VaapiVideoDecoder,AcceleratedVideoDecodeLinuxGL,AcceleratedVideoDecodeLinuxZeroCopyGL,WaylandLinuxDrmSyncobj');
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
  // ÚLTIMO RECURSO si Vulkan sigue fallando (fuerza GL vía ANGLE, más lento que VA-API):
  // sw.appendSwitch('use-gl', 'angle');
  // sw.appendSwitch('use-angle', 'gl');

  // --- Recursos (medio riesgo) ---
  sw.appendSwitch('js-flags', '--max-old-space-size=512'); // capa heap V8 por renderer
  sw.appendSwitch('disk-cache-size', '52428800'); // 50MB disco
  // NO por defecto (alto/medio riesgo): process-per-site, enable-low-end-device-mode, disable-back-forward-cache

  console.log('[Zar] 24 switches aplicados');
}

module.exports = { applyChromiumSwitches };
