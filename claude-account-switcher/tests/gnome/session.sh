#!/usr/bin/env bash
# The switcher on GNOME, end to end, in a sealed GNOME Shell 48: private buses,
# scratch HOME and XDG folders under state/, a headless shell at 1280x800 with
# the probe extension (probe@sandbox: D-Bus Eval on the private bus) enabled.
# Nothing of the user's session is touched, and no account exists, so nothing
# goes to the network. Build the switcher first (README).
#   ./session.sh e2e1 out-e2e1           first login: the program installs its extension
#   KEEP=1 ./session.sh e2e2 out-e2e2    second login: the tray icon, clicks, menu, Quit
#   ./cleanup.sh                         after every run: what the sandbox left running
# usage: session.sh SCENARIO OUT
set -euo pipefail
H="$(cd "$(dirname "$0")" && pwd)"
SCENARIO="$1"; OUT="$(realpath -m "$2")"
S="$H/state"
# KEEP=1: the state of the previous run stays (a second login). PREINSTALL=1:
# the extension is copied in before the shell starts (the measurements).
UUID=claude-account-switcher@hazelang.github.io
APPSTATE="$S/state/io.github.hazelang.ClaudeAccountSwitcher"
if [ "${KEEP:-}" != 1 ]; then rm -rf "$S"; fi
rm -rf "$OUT"; mkdir -p "$S"/{config,data/gnome-shell/extensions,cache,state,home} "$OUT"
ln -sfn "$H/probe@sandbox" "$S/data/gnome-shell/extensions/probe@sandbox"
if [ "${PREINSTALL:-}" = 1 ]; then
  SRC="$H/../../gnome-shell-extension"
  mkdir -p "$APPSTATE/share" "$S/data/gnome-shell/extensions/$UUID"
  cp "$SRC/metadata.json" "$SRC/extension.js" "$S/data/gnome-shell/extensions/$UUID/"
  printf '{"stateDir":"%s"}' "$APPSTATE" > "$S/data/gnome-shell/extensions/$UUID/paths.json"
fi
RT="/tmp/cas-gnome-$(id -u)"
rm -rf "$RT"; mkdir -p "$RT"; chmod 700 "$RT"
export XDG_RUNTIME_DIR="$RT" XDG_CONFIG_HOME="$S/config" XDG_DATA_HOME="$S/data" XDG_CACHE_HOME="$S/cache" XDG_STATE_HOME="$S/state" HOME="$S/home"
unset DISPLAY WAYLAND_DISPLAY GDK_BACKEND XAUTHORITY SESSION_MANAGER
export H SCENARIO OUT APPSTATE UUID
dbus-run-session -- bash -c 'export DBUS_SYSTEM_BUS_ADDRESS="$DBUS_SESSION_BUS_ADDRESS"; exec dbus-run-session -- bash "$H/inner.sh"'
cat "$OUT/run.log"
grep -qx "run exit 0" "$OUT/run.log"
