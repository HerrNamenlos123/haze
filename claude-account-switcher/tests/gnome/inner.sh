#!/usr/bin/env bash
set -uo pipefail
dconf write /org/gnome/shell/welcome-dialog-last-shown-version "'999'"
dconf write /org/gnome/desktop/interface/enable-animations false
dconf write /org/gnome/desktop/interface/enable-hot-corners false
dconf write /org/gnome/mutter/dynamic-workspaces true
dconf write /org/gnome/shell/disable-user-extensions false
# The probe always; whatever else a previous run (the program) enabled stays.
CUR=$(dconf read /org/gnome/shell/enabled-extensions)
if [ -z "$CUR" ] || [ "$CUR" = "@as []" ]; then CUR="[]"; fi
case "$CUR" in *probe@sandbox*) ;; *) CUR=$(python3 -c "import ast,sys; l=ast.literal_eval(sys.argv[1]); l.append('probe@sandbox'); print(repr(l))" "$CUR");; esac
if [ "${PREINSTALL:-}" = 1 ]; then CUR="['probe@sandbox', '$UUID']"; fi
dconf write /org/gnome/shell/enabled-extensions "$CUR"
gnome-shell --headless --wayland --no-x11 --wayland-display=sw-test-0 --virtual-monitor 1280x800 > "$OUT/shell.log" 2>&1 &
SHELL_PID=$!
for i in $(seq 1 100); do [ -S "$XDG_RUNTIME_DIR/sw-test-0" ] && break; sleep 0.1; done
python3 "$H/run.py" "$SCENARIO" "$OUT" > "$OUT/run.log" 2>&1
echo "run exit $?" >> "$OUT/run.log"
# The scenario ends the shell (global.context.terminate()): it gets time to
# exit by itself before any signal.
for i in $(seq 1 100); do kill -0 $SHELL_PID 2>/dev/null || break; sleep 0.1; done
kill $SHELL_PID 2>/dev/null; sleep 1; kill -9 $SHELL_PID 2>/dev/null
true
