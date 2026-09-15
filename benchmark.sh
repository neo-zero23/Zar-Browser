#!/bin/bash
# Zar manual benchmark (xdg-open launched the default browser, not Zar).
# Usage:
#   1. Terminal A: npm start -- --open-url="https://www.youtube.com/watch?v=aqz-KE-bpKQ"
#      (or open YouTube by hand in Zar if you prefer)
#   2. Terminal B: ./benchmark.sh
# Measures only 'electron' processes (once packaged, swap -C electron for -C "zar-browser").
set -e
ram() { ps -o rss= -C electron 2>/dev/null | awk '{s+=$1} END {if (s>0) printf "%.1f MB\n", s/1024; else print "0 MB (Zar running?)"}'; }
echo "[1/3] Idle RAM (Zar already open, waiting 5s)..."
sleep 5
RAM1=$(ram); echo "Idle: $RAM1"
echo "[2/3] Open the 1080p video in Zar now unless you used --open-url. Waiting 15s..."
sleep 15
RAM2=$(ram); echo "Video: $RAM2"
echo "[3/3] Diff: $RAM1 -> $RAM2 (also check chrome://gpu and chrome://media-internals -> MojoVideoDecoder)"
