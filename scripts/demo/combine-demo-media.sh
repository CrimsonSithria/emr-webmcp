#!/usr/bin/env bash
set -euo pipefail

# Merge screen recording + ElevenLabs voiceover into one upload-ready MP4.
video="${1:-/tmp/emr-webmcp-contrast-v3/*.webm}"
audio="${2:-/tmp/lablatch-voiceover-90s.mp3}"
out="${3:-$HOME/Desktop/emr-webmcp-lablatch-demo.mp4}"

if [[ "$video" == *"*"* ]]; then
  video="$(ls -t $video 2>/dev/null | head -1)"
fi

if [[ ! -f "$video" ]]; then
  echo "missing video: $video" >&2
  exit 1
fi
if [[ ! -f "$audio" ]]; then
  echo "missing audio: $audio" >&2
  exit 1
fi

ffmpeg -y -i "$video" -i "$audio" \
  -map 0:v:0 -map 1:a:0 \
  -c:v libx264 -preset fast -crf 20 \
  -c:a aac -b:a 192k \
  -af apad \
  -shortest \
  "$out"

echo "wrote $out"
