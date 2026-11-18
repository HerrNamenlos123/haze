# Scenarios inside the sealed shell (session.sh): the dev build of the switcher,
# installed into the sandbox's own HOME, against the real GNOME Shell 48.
import sys, os, time, json, subprocess
import gi
gi.require_version('Gio', '2.0')
from gi.repository import Gio, GLib

H = os.path.dirname(os.path.abspath(__file__))
scenario, out = sys.argv[1], sys.argv[2]
APPSTATE = os.environ["APPSTATE"]
REPO = os.path.realpath(os.path.join(H, "../../.."))
BIN = os.path.join(REPO, "__haze__/claude-account-switcher/bin/claude-account-switcher")
UUID = "claude-account-switcher@hazelang.github.io"
bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)

def call(dest, path, iface, method, args=None):
    return bus.call_sync(dest, path, iface, method, args, None, 0, 20000, None)

def log(*a):
    print(f"[{time.monotonic():.2f}]", *a, flush=True)

def ev(code):
    return call("org.sandbox.Probe", "/org/sandbox/Probe", "org.sandbox.Probe", "Eval",
                GLib.Variant("(s)", (code,))).unpack()[0]

for i in range(150):
    try:
        ev("1"); break
    except GLib.Error:
        time.sleep(0.2)
log("probe up")

rd = call("org.gnome.Mutter.RemoteDesktop", "/org/gnome/Mutter/RemoteDesktop",
          "org.gnome.Mutter.RemoteDesktop", "CreateSession").unpack()[0]
SES = ("org.gnome.Mutter.RemoteDesktop", rd, "org.gnome.Mutter.RemoteDesktop.Session")
call(*SES, "Start")
def rel(dx, dy): call(*SES, "NotifyPointerMotionRelative", GLib.Variant("(dd)", (float(dx), float(dy))))
def button(code, down): call(*SES, "NotifyPointerButton", GLib.Variant("(ib)", (code, down)))
def keysym(sym, down): call(*SES, "NotifyKeyboardKeysym", GLib.Variant("(ub)", (sym, down)))
keysym(0xffe1, True); keysym(0xffe1, False); time.sleep(0.3)

def move_abs(x, y):
    rel(-20000, -20000); time.sleep(0.05); rel(x, y); time.sleep(0.2)

def pointer():
    return json.loads(ev("""(() => { const [x, y] = global.get_pointer();
        const a = global.stage.get_actor_at_pos(probe.Clutter.PickMode.REACTIVE, x, y);
        return JSON.stringify({x, y, actor: a ? (a.constructor.name + ':' + (a.label?.text ?? a.name ?? '')) : null}); })()"""))

def move_to(x, y):
    p0 = pointer()
    rel(x - p0["x"], y - p0["y"]); time.sleep(0.3)

def click(x, y, code=0x110):
    # Straight to the point, from where the pointer is (a jump to the corner
    # first leaves an open menu, which then closes on the press).
    move_to(x, y); button(code, True); time.sleep(0.08); button(code, False); time.sleep(0.3)

INDICATOR = f"probe.Main.panel.statusArea['{UUID}']"

def indicator():
    return json.loads(ev(f"""(() => {{ const i = {INDICATOR}; if (!i) return 'null';
        const [x, y] = i.get_transformed_position(); const [w, h] = i.get_transformed_size();
        return JSON.stringify({{visible: i.visible, x, y, w, h, menuOpen: i.menu.isOpen,
            switchLabel: i._switchItem.label.text, switchSensitive: i._switchItem.sensitive}}); }})()"""))

def windows():
    return json.loads(ev("""JSON.stringify(global.display.list_all_windows().map(w => { const r = w.get_frame_rect();
        return {wmClass: w.get_wm_class(), title: w.get_title(), x: r.x, y: r.y, w: r.width, h: r.height, focus: w.has_focus(),
            type: w.get_window_type()}; }))"""))

def work_area(i):
    return json.loads(ev(f"""(() => {{ const a = global.workspace_manager.get_active_workspace().get_work_area_for_monitor({i});
        return JSON.stringify({{x: a.x, y: a.y, w: a.width, h: a.height}}); }})()"""))

def switcher_windows():
    return [w for w in windows() if w["wmClass"] == "claude-account-switcher"]

def wait_windows(count, seconds=15):
    for i in range(int(seconds * 10)):
        wins = switcher_windows()
        if len(wins) == count:
            return wins
        time.sleep(0.1)
    return switcher_windows()

def write_tray(state):
    path = os.path.join(APPSTATE, "share", "tray.json")
    with open(path + ".tmp", "w") as f:
        json.dump(state, f)
    os.rename(path + ".tmp", path)

ENV = dict(os.environ, WAYLAND_DISPLAY="sw-test-0", SDL_VIDEODRIVER="wayland")
PROCS = []
def start(*args):
    p = subprocess.Popen([BIN, *args], env=ENV, stdout=open(os.path.join(out, f"switcher-{len(PROCS)}.log"), "w"),
                         stderr=subprocess.STDOUT)
    PROCS.append(p)
    return p

def finish():
    for p in PROCS:
        if p.poll() is None:
            p.kill()
    ev("global.context.terminate()")

import shutil
HOME = os.environ["HOME"]
INSTALLED = os.path.join(HOME, ".local/bin/claude-account-switcher")
GNOME_ENV = dict(os.environ, WAYLAND_DISPLAY="sw-test-0", XDG_CURRENT_DESKTOP="GNOME")
EXTDIR = os.path.join(os.environ["XDG_DATA_HOME"], "gnome-shell/extensions", UUID)
TRAY = os.path.join(APPSTATE, "share", "tray.json")

def install_program():
    # What `haze install` puts in place, with the dev build.
    os.makedirs(os.path.dirname(INSTALLED), exist_ok=True)
    shutil.copy2(BIN, INSTALLED)
    data = os.environ["XDG_DATA_HOME"]
    binDir = os.path.dirname(BIN)
    os.makedirs(f"{data}/applications", exist_ok=True)
    shutil.copy2(f"{binDir}/io.github.hazelang.ClaudeAccountSwitcher.desktop", f"{data}/applications/")
    os.makedirs(f"{data}/icons/hicolor/512x512/apps", exist_ok=True)
    shutil.copy2(f"{binDir}/io.github.hazelang.ClaudeAccountSwitcher.png", f"{data}/icons/hicolor/512x512/apps/")

def start_installed(*args):
    p = subprocess.Popen([INSTALLED, *args], env=GNOME_ENV,
                         stdout=open(os.path.join(out, f"installed-{len(PROCS)}.log"), "w"), stderr=subprocess.STDOUT)
    PROCS.append(p)
    return p

def gs(key):
    return subprocess.run(["gsettings", "get", "org.gnome.shell", key], capture_output=True, text=True).stdout.strip()

def read(path):
    return open(path).read() if os.path.exists(path) else None

CHECKS = {"total": 0, "failed": 0}
def check(name, ok, detail=""):
    CHECKS["total"] += 1
    if not ok:
        CHECKS["failed"] += 1
    log(("ok   " if ok else "FAIL ") + name + (f"  ({detail})" if detail else ""))

def at_icon(ind, w, h):
    # The rule the extension follows: centred on the icon, moved into the work area.
    area = work_area(0)
    x = min(max(round(ind["x"] + ind["w"] / 2 - w / 2), area["x"]), area["x"] + area["w"] - w)
    y = min(max(round(ind["y"] + ind["h"] / 2 - h / 2), area["y"]), area["y"] + area["h"] - h)
    return x, y

# First login: the extension is not there yet; the program installs it.
def s_e2e1():
    ev("probe.Main.overview.hide()"); time.sleep(0.5)
    install_program()
    primary = start_installed()
    wins = wait_windows(1); time.sleep(2)
    check("the window opens (GNOME places it: no extension yet)", len(wins) == 1, wins)
    check("extension files", os.path.isdir(EXTDIR) and sorted(os.listdir(EXTDIR)) == ["extension.js", "metadata.json", "paths.json"],
          os.listdir(EXTDIR) if os.path.isdir(EXTDIR) else None)
    paths = json.loads(read(os.path.join(EXTDIR, "paths.json")) or "{}")
    check("paths.json names the state folder", paths.get("stateDir") == APPSTATE, paths)
    check("extension.js is the source", read(os.path.join(EXTDIR, "extension.js")) == read(os.path.join(REPO, "claude-account-switcher/gnome-shell-extension/extension.js")))
    check("metadata.json is the source", read(os.path.join(EXTDIR, "metadata.json")) == read(os.path.join(REPO, "claude-account-switcher/gnome-shell-extension/metadata.json")))
    check("turned on", UUID in gs("enabled-extensions"), gs("enabled-extensions"))
    check("not loaded before the next login", ev(f"String(probe.Main.extensionManager.lookup('{UUID}')?.state ?? 'none')") == "none")
    tray = json.loads(read(TRAY) or "{}")
    check("tray.json", tray == {"version": 1, "executable": INSTALLED}, tray)
    check("state folder 0700", oct(os.stat(APPSTATE).st_mode & 0o777) == "0o700")
    autostart = read(os.path.join(os.environ["XDG_CONFIG_HOME"], "autostart/claude-account-switcher.desktop")) or ""
    check("login entry starts the installed program", f'Exec="{INSTALLED}" --background' in autostart, autostart)
    q = start_installed("--quit")
    check("--quit", q.wait(timeout=10) == 0 and primary.wait(timeout=10) == 0)
    check("tray.json gone at quit", read(TRAY) is None)
    finish()

# Second login (KEEP=1): the extension is loaded.
def s_e2e2():
    ev("probe.Main.overview.hide()"); time.sleep(0.5)
    check("extension enabled", ev(f"String(probe.Main.extensionManager.lookup('{UUID}')?.state ?? 'none')") == "1")
    check("no icon while the program does not run", not indicator()["visible"])
    primary = start_installed("--background")
    time.sleep(3)
    ind = indicator()
    check("icon once it runs", ind["visible"], ind)
    check("menu: nothing to switch to", ind["switchLabel"] == "Switch account" and not ind["switchSensitive"], ind)
    centre = (ind["x"] + ind["w"] / 2, ind["y"] + ind["h"] / 2)
    click(*centre)
    wins = wait_windows(1); time.sleep(1.5)
    wins = switcher_windows()
    want = at_icon(ind, 340, 420) if wins else None
    check("a click opens the window at the icon", len(wins) == 1 and (wins[0]["x"], wins[0]["y"]) == want, f"{wins} want {want}")
    check("with the focus", len(wins) == 1 and wins[0]["focus"])
    click(*centre)
    time.sleep(2)
    check("another click closes it", switcher_windows() == [])
    check("the program goes on", primary.poll() is None and os.path.exists(TRAY))
    start_installed()
    wait_windows(1); time.sleep(1.5)
    wins = switcher_windows()
    check("opened from the app grid: at the icon too", len(wins) == 1 and (wins[0]["x"], wins[0]["y"]) == want, wins)
    ev("global.display.list_all_windows().filter(w => w.get_wm_class() === 'claude-account-switcher').forEach(w => w.delete(global.get_current_time()))")
    time.sleep(2)
    check("closed by the window manager: the program goes on", switcher_windows() == [] and primary.poll() is None and os.path.exists(TRAY))
    click(*centre, 0x111)
    time.sleep(0.8)
    check("right click: the menu", indicator()["menuOpen"])
    item = json.loads(ev(f"""(() => {{ const items = {INDICATOR}.menu._getMenuItems(); const q = items[items.length - 1];
        const [x, y] = q.get_transformed_position(); const [w, h] = q.get_transformed_size();
        return JSON.stringify({{label: q.label?.text, x, y, w, h}}); }})()"""))
    check("its last entry is Quit", item["label"] == "Quit", item)
    click(item["x"] + item["w"] / 2, item["y"] + item["h"] / 2)
    try:
        code = primary.wait(timeout=10)
    except subprocess.TimeoutExpired:
        code = None
    check("Quit quits", code == 0, code)
    time.sleep(0.8)
    check("tray.json gone, no icon", read(TRAY) is None and not indicator()["visible"])
    # Started from the app grid while it does not run: its window comes right
    # after tray.json, and still opens at the icon.
    fresh = start_installed()
    wait_windows(1); time.sleep(1.5)
    wins = switcher_windows()
    check("a fresh start from the app grid: at the icon", len(wins) == 1 and (wins[0]["x"], wins[0]["y"]) == want, f"{wins} want {want}")
    q = start_installed("--quit")
    check("and it quits", q.wait(timeout=10) == 0 and fresh.wait(timeout=10) == 0)
    finish()

try:
    globals()["s_" + scenario]()
except Exception as e:
    log("FAILED", repr(e))
    finish()
    raise
log(f"{CHECKS['total'] - CHECKS['failed']}/{CHECKS['total']} checks passed")
sys.exit(CHECKS["failed"])
