#!/usr/bin/env bash
# Lab 8 - publish the dotnet11lab CLI three ways and measure size, startup and memory.
#
#   ./scripts/publish-compare.sh [--runs N] [--modes fd,sc,aot] [--preliminary] [--note TEXT] [--skip-publish]
#
# Modes (all Release, for the current RID, output in artifacts/publish/<mode>):
#   framework-dependent  needs a .NET 11 runtime on the machine; smallest download.
#   self-contained       runtime bundled; published as ONE single-file executable (PublishSingleFile=true),
#                        untrimmed - the usual "copy one file" alternative to Native AOT.
#   native-aot           PublishAot=true: ahead-of-time compiled native executable, no JIT, no runtime install.
#
# Writes results/publish/latest.json (read by the dashboard) and results/publish/latest.md.
# Requirements: .NET SDK 11 (global.json), bash >= 5 for the high-resolution $EPOCHREALTIME timer
# (macOS ships bash 3.2: install a newer bash, otherwise a slower perl-based timer is used and recorded).
# Native AOT needs the platform toolchain: clang (or gcc) + zlib development files on Linux,
# Xcode command line tools on macOS. There is no cross-OS Native AOT compilation.
set -euo pipefail

RUNS=10
MODES="framework-dependent,self-contained,native-aot"
PRELIMINARY=false
NOTE=""
SKIP_PUBLISH=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --runs) RUNS="$2"; shift 2 ;;
        --modes) MODES="$2"; shift 2 ;;
        --preliminary) PRELIMINARY=true; shift ;;
        --note) NOTE="$2"; shift 2 ;;
        --skip-publish) SKIP_PUBLISH=true; shift ;;
        -h|--help) sed -n '2,19p' "$0"; exit 0 ;;
        *) echo "unknown option: $1" >&2; exit 2 ;;
    esac
done
if ! [[ "$RUNS" =~ ^[0-9]+$ ]] || (( RUNS < 1 || RUNS > 200 )); then echo "--runs must be 1..200" >&2; exit 2; fi

LAB_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$LAB_ROOT"
PROJECT="src/DotNet11Lab.Cli/DotNet11Lab.Cli.csproj"
PUBLISH_ROOT="artifacts/publish"
RESULTS_DIR="results/publish"
LOG_DIR="artifacts/publish/logs"
mkdir -p "$PUBLISH_ROOT" "$RESULTS_DIR" "$LOG_DIR"

# ---------- machine facts ----------
case "$(uname -s)" in
    Linux)  OS_FAMILY=linux ;;
    Darwin) OS_FAMILY=osx ;;
    *) echo "Unsupported OS $(uname -s); use scripts/publish-compare.ps1 on Windows." >&2; exit 1 ;;
esac
case "$(uname -m)" in
    x86_64|amd64) ARCH=x64 ;;
    aarch64|arm64) ARCH=arm64 ;;
    *) echo "Unsupported architecture $(uname -m)" >&2; exit 1 ;;
esac
if [[ $OS_FAMILY == linux ]] && (ldd --version 2>&1 | grep -qi musl); then OS_FAMILY=linux-musl; fi
RID="${OS_FAMILY}-${ARCH}"

if [[ $OS_FAMILY == osx ]]; then
    OS_DESC="macOS $(sw_vers -productVersion 2>/dev/null || uname -r)"
    CPU="$(sysctl -n machdep.cpu.brand_string 2>/dev/null || echo unknown)"
    CORES="$(sysctl -n hw.logicalcpu 2>/dev/null || echo 0)"
else
    OS_DESC="$( (. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME") || uname -s) (kernel $(uname -r))"
    CPU="$(grep -m1 'model name' /proc/cpuinfo 2>/dev/null | cut -d: -f2- | sed 's/^ *//' || true)"
    CPU="${CPU:-unknown}"
    CORES="$(nproc 2>/dev/null || echo 0)"
fi
SDK="$(dotnet --version)"

# ---------- helpers ----------
if [[ -n "${EPOCHREALTIME:-}" ]]; then
    TIMER="bash EPOCHREALTIME"
    now_us() { local t="${EPOCHREALTIME/[.,]/}"; echo "$t"; }
else
    TIMER="perl Time::HiRes (includes perl start/exit overhead)"
    now_us() { perl -MTime::HiRes=time -e 'printf "%d\n", time()*1e6'; }
fi

json_escape() { local s="$1"; s="${s//\\/\\\\}"; s="${s//\"/\\\"}"; s="${s//$'\n'/\\n}"; s="${s//$'\r'/}"; s="${s//$'\t'/ }"; printf '%s' "$s"; }
json_str() { if [[ -z "$1" ]]; then printf 'null'; else printf '"%s"' "$(json_escape "$1")"; fi; }
json_num() { if [[ -z "$1" ]]; then printf 'null'; else printf '%s' "$1"; fi; }
# Extract a number / bool / string field from a one-line JSON object (the probe's output).
probe_field() { sed -n "s/.*\"$2\":\([^,}\"]*\).*/\1/p" <<<"$1"; }
probe_string() { sed -n "s/.*\"$2\":\"\([^\"]*\)\".*/\1/p" <<<"$1"; }
# stats <values...> -> "median min max" (2 decimals)
stats() { printf '%s\n' "$@" | sort -g | awk '{v[NR]=$1} END {if (NR==0) exit; m=(NR%2)?v[(NR+1)/2]:(v[NR/2]+v[NR/2+1])/2; printf "%.3f %.3f %.3f\n", m, v[1], v[NR]}'; }
median_int() { printf '%s\n' "$@" | sort -n | awk '{v[NR]=$1} END {if (NR==0) exit; m=(NR%2)?v[(NR+1)/2]:(v[NR/2]+v[NR/2+1])/2; printf "%d\n", m}'; }
file_size() { wc -c <"$1" | tr -d ' '; }

publish_args() {
    case "$1" in
        framework-dependent) echo "--self-contained false -p:PublishSingleFile=false" ;;
        self-contained)      echo "--self-contained true -p:PublishSingleFile=true" ;;
        native-aot)          echo "-p:PublishAot=true" ;;
    esac
}

TIME_TOOL=""
if [[ -x /usr/bin/time ]]; then
    if /usr/bin/time -v true >/dev/null 2>&1; then TIME_TOOL=gnu
    elif /usr/bin/time -l true >/dev/null 2>&1; then TIME_TOOL=bsd
    fi
fi
max_rss_bytes() { # runs the probe once under /usr/bin/time; prints max RSS in bytes or nothing
    local exe="$1" err
    case "$TIME_TOOL" in
        gnu) err="$( { /usr/bin/time -v "$exe" --startup-probe >/dev/null; } 2>&1 )"
             awk -F: '/Maximum resident set size/ {gsub(/ /,"",$2); print $2*1024}' <<<"$err" ;;
        bsd) err="$( { /usr/bin/time -l "$exe" --startup-probe >/dev/null; } 2>&1 )"
             awk '/maximum resident set size/ {print $1}' <<<"$err" ;;
    esac
}

# ---------- publish + measure ----------
MODE_JSON=()
MD_ROWS=()
IFS=',' read -r -a MODE_LIST <<<"$MODES"
for mode in "${MODE_LIST[@]}"; do
    case "$mode" in
        fd|framework-dependent) mode=framework-dependent ;;
        sc|self-contained) mode=self-contained ;;
        aot|native-aot) mode=native-aot ;;
        *) echo "unknown mode $mode (use fd, sc, aot)" >&2; exit 2 ;;
    esac
    out="$PUBLISH_ROOT/$mode"
    args="$(publish_args "$mode")"
    cmd="dotnet publish $PROJECT -c Release -r $RID $args -o $out"
    echo "==> [$mode] $cmd"
    ok=true; error=""
    if [[ $SKIP_PUBLISH == false ]]; then
        rm -rf "$out"
        # shellcheck disable=SC2086
        if ! dotnet publish "$PROJECT" -c Release -r "$RID" $args -o "$out" >"$LOG_DIR/$mode.log" 2>&1; then
            ok=false; error="dotnet publish failed: $(grep -E 'error' "$LOG_DIR/$mode.log" | head -3 | tr '\n' ' ')"
            echo "    publish FAILED (see $LOG_DIR/$mode.log)" >&2
        fi
    fi
    exe="$out/dotnet11lab"
    if [[ $ok == true && ! -x "$exe" ]]; then ok=false; error="executable $exe not found"; fi
    if [[ $ok == false ]]; then
        MODE_JSON+=("{\"mode\":\"$mode\",\"publishCommand\":$(json_str "$cmd"),\"succeeded\":false,\"error\":$(json_str "$error")}")
        MD_ROWS+=("| $mode | failed | | | | | |")
        continue
    fi

    # Size: deployable files only (symbol files *.pdb / *.dbg / *.dSYM are excluded and not needed to run).
    total=0; files=0
    while IFS= read -r -d '' f; do total=$((total + $(file_size "$f"))); files=$((files + 1)); done \
        < <(find "$out" -type f ! -name '*.pdb' ! -name '*.dbg' ! -path '*.dSYM/*' -print0)
    exe_size="$(file_size "$exe")"

    # Startup: 2 discarded warm-up launches (disk cache), then RUNS timed launches.
    for _ in 1 2; do "$exe" --startup-probe >/dev/null; done
    walls=(); probes=(); peaks=(); last=""
    for ((i = 0; i < RUNS; i++)); do
        t0="$(now_us)"
        line="$("$exe" --startup-probe)"
        t1="$(now_us)"
        walls+=("$(awk -v a="$t0" -v b="$t1" 'BEGIN {printf "%.3f", (b-a)/1000}')")
        p="$(probe_field "$line" startToMainMs)"; [[ -n "$p" && "$p" != null ]] && probes+=("$p")
        peaks+=("$(probe_field "$line" peakWorkingSetBytes)")
        last="$line"
    done
    read -r w_med w_min w_max <<<"$(stats "${walls[@]}")"
    probe_json=null
    if (( ${#probes[@]} > 0 )); then read -r p_med p_min p_max <<<"$(stats "${probes[@]}")"; probe_json="{\"median\":$p_med,\"min\":$p_min,\"max\":$p_max}"; fi
    peak="$(median_int "${peaks[@]}")"
    rss=""
    if [[ -n "$TIME_TOOL" ]]; then
        rss_runs=()
        for ((i = 0; i < (RUNS < 5 ? RUNS : 5); i++)); do v="$(max_rss_bytes "$exe")"; [[ -n "$v" ]] && rss_runs+=("$v"); done
        (( ${#rss_runs[@]} > 0 )) && rss="$(median_int "${rss_runs[@]}")"
    fi
    dyn="$(probe_field "$last" isDynamicCodeSupported)"
    runtime="$(probe_string "$last" runtime)"

    echo "    size ${total} B ($files files), exe ${exe_size} B, startup median ${w_med} ms, peak WS ${peak} B${rss:+, max RSS $rss B}"
    MODE_JSON+=("{\"mode\":\"$mode\",\"publishCommand\":$(json_str "$cmd"),\"succeeded\":true,\"totalSizeBytes\":$total,\"fileCount\":$files,\"executable\":\"dotnet11lab\",\"executableSizeBytes\":$exe_size,\"startupWallMs\":{\"median\":$w_med,\"min\":$w_min,\"max\":$w_max},\"startupProbeMs\":$probe_json,\"peakWorkingSetBytes\":$(json_num "$peak"),\"maxRssBytes\":$(json_num "$rss"),\"isDynamicCodeSupported\":$(json_num "$dyn"),\"runtime\":$(json_str "$runtime")}")
    MD_ROWS+=("| $mode | $(awk -v b="$total" 'BEGIN{printf "%.1f MB", b/1048576}') ($files files) | $(awk -v b="$exe_size" 'BEGIN{printf "%.1f MB", b/1048576}') | $w_med ms | $(awk -v b="$peak" 'BEGIN{printf "%.1f MB", b/1048576}') | ${rss:+$(awk -v b="$rss" 'BEGIN{printf "%.1f MB", b/1048576}')} | $dyn |")
done

GENERATED="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
FULL_NOTE="$NOTE"
# Separate the user's note from the timer sentence with a full stop unless it already ends with one.
[[ -n "$FULL_NOTE" && ! "$FULL_NOTE" =~ [.!?]$ ]] && FULL_NOTE+="."
[[ -n "$FULL_NOTE" ]] && FULL_NOTE+=" "
FULL_NOTE+="Timer: $TIMER. Wall-clock includes process creation and teardown."
{
    printf '{\n  "schemaVersion": 1,\n  "generatedUtc": "%s",\n  "preliminary": %s,\n  "note": %s,\n' "$GENERATED" "$PRELIMINARY" "$(json_str "$FULL_NOTE")"
    printf '  "machine": {"os": %s, "processor": %s, "logicalCores": %s, "rid": "%s", "sdk": "%s"},\n' "$(json_str "$OS_DESC")" "$(json_str "$CPU")" "$CORES" "$RID" "$SDK"
    printf '  "settings": {"configuration": "Release", "startupRuns": %s, "selfContainedVariant": "single-file, untrimmed"},\n' "$RUNS"
    printf '  "modes": [\n'
    for i in "${!MODE_JSON[@]}"; do
        sep=","; (( i == ${#MODE_JSON[@]} - 1 )) && sep=""
        printf '    %s%s\n' "${MODE_JSON[$i]}" "$sep"
    done
    printf '  ]\n}\n'
} >"$RESULTS_DIR/latest.json"

{
    echo "# Publish comparison - dotnet11lab"
    echo
    [[ $PRELIMINARY == true ]] && { echo "> **PRELIMINARY** - validation run (e.g. on a busy machine). Do not quote these numbers."; echo; }
    echo "- Generated: $GENERATED · RID \`$RID\` · SDK $SDK · $RUNS startup runs per mode"
    echo "- Machine: $CPU, $CORES logical cores, $OS_DESC"
    echo "- $FULL_NOTE"
    echo
    echo "| Mode | Deployed size | Executable | Startup (median wall) | Peak working set | Max RSS | Dynamic code |"
    echo "|---|---:|---:|---:|---:|---:|---|"
    printf '%s\n' "${MD_ROWS[@]}"
} >"$RESULTS_DIR/latest.md"

echo "Wrote $RESULTS_DIR/latest.json and $RESULTS_DIR/latest.md"
