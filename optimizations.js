/**
 * Zar Browser - Chromium optimizations
 *
 * Switches applied before app.whenReady().
 * Rules:
 * - Every switch must have a comment saying what it does and its risk.
 * - If a switch turns out useless or breaks something, comment it out or remove it.
 * - No switches for fashion: only if they add something measurable.
 * - DoH doesn't hook into Electron with flags (verified 2026).
 *   Flags stay in place in case Electron supports it in the future.
 */
function applyChromiumSwitches(app) {
  const sw = app.commandLine;

  // --- Processes & runtime (low risk) ---
  sw.appendSwitch('renderer-process-limit', '4'); // cap renderers
  sw.appendSwitch('autoplay-policy', 'no-user-gesture-required');
  sw.appendSwitch('disable-extensions');
  sw.appendSwitch('disable-speech-api'); // voice API out
  sw.appendSwitch('disable-speech-synthesis-api');
  sw.appendSwitch('disable-print-preview');
  sw.appendSwitch('no-first-run');
  sw.appendSwitch('no-default-browser-check');

  // --- Telemetry (low risk) ---
  // NOTE: --disable-sync is a no-op in Electron, skip it.
  // TEMP (perf test): background-networking commented out. Suspected of
  // killing DNS prefetch and adding seconds to every search. If it helps,
  // stays commented and documented; if nothing changes, restore it.
  // sw.appendSwitch('disable-background-networking'); // kills UMA/sync/translate bg
  sw.appendSwitch('disable-component-update'); // no chrome://components updates
  sw.appendSwitch('disable-domain-reliability'); // no reports to Google
  sw.appendSwitch('disable-breakpad'); // no dumps
  // NOTE: --expose-gc removed on request (the 🧹 button uses IPC, no exposed gc needed).
  // You lose native Cast/Translate (unused in Zar).
  // Aggressive Vulkan block (Wayland): feature + ANGLE backends.
  // --disable-gpu-vulkan NOT added: doesn't exist in gpu_switches.cc (no invented flags).
  sw.appendSwitch('disable-features', 'Translate,MediaRouter,OptimizationHints,DialMediaRouteProvider,Vulkan,VulkanFromANGLE,DefaultANGLEVulkan');
  sw.appendSwitch('disable-vulkan-surface'); // no VK swapchain (verified in gpu/command_buffer/service/gpu_switches.cc)

  // --- DNS over HTTPS (reserve: doesn't hook into Electron today, breaks nothing) ---
  // Verify at https://1.1.1.1/help that "Using DNS over HTTPS" flips to Yes.
  sw.appendSwitch('dns-over-https-mode', 'secure'); // CAREFUL: no fallback to system DNS; if Cloudflare is down, no DNS
  sw.appendSwitch('dns-over-https-templates', 'https://cloudflare-dns.com/dns-query');

  // --- GPU / video Intel Wayland (medium risk, high reward on Alder Lake-N) ---
  // DnsOverHttps+SecureDns go concatenated here (same appendSwitch, not separate).
  // NOTE: kDnsOverHttps was removed from Chromium (shipped feature, see
  // commit c40b0ba); stays as a harmless ghost. SecureDns covers the possible
  // rename. Unknown names in enable-features are silently ignored.
  sw.appendSwitch('enable-features', 'DnsOverHttps,SecureDns,VaapiVideoDecoder,AcceleratedVideoDecodeLinuxGL,AcceleratedVideoDecodeLinuxZeroCopyGL,WaylandLinuxDrmSyncobj');
  // VaapiIgnoreDriverChecks commented out: only enable if VA-API fails (see chrome://gpu).
  // To enable: add ',VaapiIgnoreDriverChecks' to the line above.
  sw.appendSwitch('ignore-gpu-blocklist'); // force GPU even if blocklisted
  sw.appendSwitch('enable-accelerated-video-decode');
  sw.appendSwitch('enable-accelerated-2d-canvas');
  sw.appendSwitch('enable-gpu-rasterization');
  sw.appendSwitch('enable-zero-copy');
  sw.appendSwitch('ozone-platform-hint', 'auto'); // Wayland/X11 auto
  // NOTE: --no-zygote only if you confirm electron#50455 (60%+ gpu-process).
  // Uncomment to test: sw.appendSwitch('no-zygote'); // +100ms spawn per process
  // Force GL backend via ANGLE: Vulkan never initializes and the
  // 'wayland is not compatible with Vulkan' warning goes away at the root.
  // (--use-gl removed: deprecated since Chromium 116, no-op.)
  // If Video Decode drops to software in chrome://gpu, comment the line below.
  sw.appendSwitch('use-angle', 'gl');

  // --- Resources (medium risk) ---
  sw.appendSwitch('js-flags', '--max-old-space-size=512'); // cap V8 heap per renderer
  sw.appendSwitch('disk-cache-size', '52428800'); // 50MB disk
  // NOT by default (high/medium risk): process-per-site, enable-low-end-device-mode, disable-back-forward-cache

  console.log('[Zar] 25 switches applied');
}

module.exports = { applyChromiumSwitches };
