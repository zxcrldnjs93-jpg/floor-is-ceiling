#!/bin/bash
# 사용: compose.sh 표지PNG 본편MP4 출력MP4  (앞 1.0초 정지 + 0.3초 교차 + 본편 + 0.3초 교차 + 끝 0.5초 정지)
set -e; C=$1; V=$2; O=$3
D=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$V")
ffmpeg -loglevel error -y -loop 1 -framerate 24 -t 1.3 -i "$C" -i "$V" -loop 1 -framerate 24 -t 0.8 -i "$C" -filter_complex \
"[0:v]format=yuv420p,setsar=1,fps=24[a];[1:v]format=yuv420p,setsar=1,fps=24[b];[2:v]format=yuv420p,setsar=1,fps=24[c];\
[a][b]xfade=transition=fade:duration=0.3:offset=1.0[ab];[ab][c]xfade=transition=fade:duration=0.3:offset=$(python3 -c "print(1.0+$D-0.3)")[out]" \
-map "[out]" -c:v libx264 -preset slow -crf 20 -pix_fmt yuv420p -movflags +faststart -an "$O"
