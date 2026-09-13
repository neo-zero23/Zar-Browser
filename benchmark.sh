#!/bin/bash
# Zar benchmark manual (xdg-open abría el navegador por defecto, no Zar).
# Uso:
#   1. Terminal A: npm start -- --open-url="https://www.youtube.com/watch?v=aqz-KE-bpKQ"
#      (o abre YouTube a mano en Zar si prefieres)
#   2. Terminal B: ./benchmark.sh
# Mide solo procesos 'electron' (cuando empaquetemos, cambia -C electron por -C "zar-browser").
set -e
ram() { ps -o rss= -C electron 2>/dev/null | awk '{s+=$1} END {if (s>0) printf "%.1f MB\n", s/1024; else print "0 MB (¿Zar corriendo?)"}'; }
echo "[1/3] RAM idle (Zar ya abierto, espera 5s)..."
sleep 5
RAM1=$(ram); echo "Idle: $RAM1"
echo "[2/3] Abre el video 1080p en Zar ahora si no usaste --open-url. Espero 15s..."
sleep 15
RAM2=$(ram); echo "Video: $RAM2"
echo "[3/3] Diff: $RAM1 -> $RAM2 (revisa además chrome://gpu y chrome://media-internals -> MojoVideoDecoder)"
