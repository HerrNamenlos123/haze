#!/usr/bin/env bash
# Kills every process left from the sandbox (its runtime dir in the environment).
for p in $(ls /proc | grep -E '^[0-9]+$'); do
  if { tr '\0' '\n' < /proc/$p/environ; } 2>/dev/null | grep -qx "XDG_RUNTIME_DIR=/tmp/cas-gnome-$(id -u)"; then
    echo "killing $p $(tr '\0' ' ' < /proc/$p/cmdline 2>/dev/null | head -c 80)"; kill -9 $p 2>/dev/null
  fi
done
true
