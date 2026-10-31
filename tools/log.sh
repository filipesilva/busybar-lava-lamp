#!/bin/sh
# Usage: tools/log.sh [pattern] [lines=20]
# Dumps the bar's in-memory log, prints the last matching lines (by default the JS runner and console lines), and
# deletes the dump. Set BUSY_ADDR when the bar is not at 10.0.4.20.
B=http://${BUSY_ADDR:-10.0.4.20}
curl -s -m 10 -X POST "$B/api/log_dump?filename=agent_log" >/dev/null
curl -s -m 10 "$B/api/storage/read?path=/ext/agent_log.txt" | grep -a -E "${1:-JsConsole|JsRunner|lava-lamp}" | tail -"${2:-20}"
curl -s -m 5 -X DELETE "$B/api/storage/remove?path=/ext/agent_log.txt" >/dev/null
