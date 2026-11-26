#!/usr/bin/env bash
set -u

qa_dir=$(cd -- "$(dirname -- "$0")" && pwd -P)
static_only=false
c11=false
v03=false
vote_url=
remote_url=
contrast=()
page_url=()
build_dir=

usage() {
  cat <<'EOF'
사용법
  qa/run.sh [--static-only] [--c11|--v03] [--vote-url URL] [--contrast PAIRS.json] [--page-url URL] [BUILD_DIR]
  qa/run.sh --url HTTPS_URL [--v03] [--vote-url URL]
기본 BUILD_DIR은 site/dist/이며, 빌드 전에는 site/입니다. BUILD_DIR에 index.html이 필요합니다.
QA_OUT으로 브라우저 결과 폴더를 지정합니다. 기본값은 qa/out/입니다.
EOF
}

while (($#)); do
  case "$1" in
    --static-only) static_only=true; shift ;;
    --c11) c11=true; shift ;;
    --v03) c11=true; v03=true; shift ;;
    --url)
      if (($# < 2)) || [[ -z $2 || $2 == --* ]]; then usage >&2; exit 2; fi
      remote_url=$2
      c11=true
      shift 2
      ;;
    --vote-url)
      if (($# < 2)) || [[ -z $2 || $2 == --* ]]; then usage >&2; exit 2; fi
      vote_url=$2
      shift 2
      ;;
    --contrast|--page-url)
      if (($# < 2)) || [[ $2 == --* ]]; then usage >&2; exit 2; fi
      if [[ $1 == --contrast ]]; then contrast=("$1" "$2"); else page_url=("$1" "$2"); fi
      shift 2
      ;;
    -h|--help) usage; exit 0 ;;
    -*) usage >&2; exit 2 ;;
    *)
      if [[ -n $build_dir ]]; then usage >&2; exit 2; fi
      build_dir=$1
      shift
      ;;
  esac
done

c11_options=()
if $c11; then
  vote_url=${vote_url:-https://hackathon.parallax.kr/}
  c11_options=(--vote-url "$vote_url")
elif [[ -n $vote_url ]]; then
  usage >&2
  exit 2
fi

static_status=0
version_options=()
if $v03; then version_options+=(--v03); fi
browser_options=("${version_options[@]}")
if [[ -n $remote_url ]]; then
  if $static_only || [[ -n $build_dir || ${#contrast[@]} -gt 0 || ${#page_url[@]} -gt 0 ]]; then usage >&2; exit 2; fi
  browser_options+=(--remote)
  page_url=(--page-url "$remote_url")
else
  if [[ -z $build_dir ]]; then
    build_dir="$qa_dir/../site"
    if [[ -f $build_dir/dist/index.html ]]; then build_dir="$build_dir/dist"; fi
  fi
  command -v python3 >/dev/null || { printf '%s\n' 'Python 3이 필요합니다.' >&2; exit 2; }
  python3 -B "$qa_dir/static.py" "$build_dir" "${contrast[@]}" "${page_url[@]}" "${c11_options[@]}" "${version_options[@]}" || static_status=$?
  if $static_only || ((static_status > 1)); then exit "$static_status"; fi
fi

command -v node >/dev/null || { printf '%s\n' 'Node.js가 필요합니다.' >&2; exit 3; }
out_dir=${QA_OUT:-"$qa_dir/out"}
browser_status=0
node "$qa_dir/browser.mjs" "$build_dir" "$out_dir" "${page_url[1]-https://qa.invalid/}" "$vote_url" "${browser_options[@]}" || browser_status=$?
if ((browser_status > 1)); then exit "$browser_status"; fi
if ((static_status || browser_status)); then exit 1; fi
