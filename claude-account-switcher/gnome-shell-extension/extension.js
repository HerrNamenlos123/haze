// The tray icon of Claude Account Switcher on GNOME. The program installs this
// extension into the user's extensions folder itself, with paths.json beside
// it naming the program's state folder (ui/src/gnome_extension.hz), and GNOME
// Shell loads it at the next login.
//
// While the program runs, the icon shows what the program writes to
// share/tray.json (the active account's icon); without that file there is no
// icon. A left click opens the program's window, or closes it while it is
// open; a right click opens the menu. However the window opens, this puts it
// at the icon, as the program does on Windows (README, "Where the window
// opens"): on Wayland no program can place its own window.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

// The program's window: SDL names it after the program's file.
const WM_CLASS = 'claude-account-switcher';
// The program's own icon, installed with it, for while no account is active.
const APP_ICON = 'io.github.hazelang.ClaudeAccountSwitcher';

const decoder = new TextDecoder();

function logProblem(message) {
    console.error(`Claude Account Switcher: ${message}`);
}

// The JSON in the file at `path`; null when there is no file. A file that
// cannot be read or is not JSON is logged and counts as none.
function readJson(path) {
    let bytes;
    try {
        [, bytes] = GLib.file_get_contents(path);
    } catch (e) {
        if (!e.matches(GLib.FileError, GLib.FileError.NOENT))
            logProblem(`${path}: ${e.message}`);
        return null;
    }
    try {
        return JSON.parse(decoder.decode(bytes));
    } catch (e) {
        logProblem(`${path} is not JSON: ${e.message}`);
        return null;
    }
}

// What the program shows in the tray (its TrayState, ui/src/tray_state.hz), or
// null while it does not run. The program leaves out a field that is none.
function readTrayState(trayPath) {
    const state = readJson(trayPath);
    if (state === null)
        return null;
    const text = value => typeof value === 'string';
    const textOrAbsent = value => value === undefined || text(value);
    if (state.version !== 1 || !text(state.executable) || !textOrAbsent(state.account) ||
        !textOrAbsent(state.icon) || !textOrAbsent(state.next)) {
        logProblem(`${trayPath} is not a tray state this extension knows`);
        return null;
    }
    return {
        executable: state.executable,
        account: state.account ?? null,
        icon: state.icon ?? null,
        next: state.next ?? null,
    };
}

// `value` moved into [low, high]; low wins where the two cross.
function clamp(value, low, high) {
    return Math.max(low, Math.min(value, high));
}

// The work area of monitor `index`: the monitor less the top bar, docks and
// panels, wherever they are.
function workArea(index) {
    return global.workspace_manager.get_active_workspace().get_work_area_for_monitor(index);
}

// Centred on the icon and moved into the work area of the icon's monitor,
// which puts the window right against the top bar (or whichever edge holds
// the icon).
function besideIcon(icon, width, height) {
    const [x, y] = icon.get_transformed_position();
    const [w, h] = icon.get_transformed_size();
    const area = workArea(Main.layoutManager.findIndexForActor(icon));
    return {
        x: clamp(Math.round(x + w / 2 - width / 2), area.x, area.x + area.width - width),
        y: clamp(Math.round(y + h / 2 - height / 2), area.y, area.y + area.height - height),
    };
}

function iconFor(path) {
    if (path === null)
        return new Gio.ThemedIcon({name: APP_ICON});
    try {
        // From the bytes, not the path: the shell keeps the picture of a path
        // it has shown, and a changed icon keeps its path.
        const [, bytes] = GLib.file_get_contents(path);
        return Gio.BytesIcon.new(new GLib.Bytes(bytes));
    } catch (e) {
        logProblem(`${path}: ${e.message}`);
        return new Gio.ThemedIcon({name: APP_ICON});
    }
}

// The program's window while it is open.
function openWindow() {
    return global.display.list_all_windows().find(w => w.get_wm_class() === WM_CLASS) ?? null;
}

const Indicator = GObject.registerClass(
class Indicator extends PanelMenu.Button {
    _init(trayPath) {
        super._init(0.5, 'Claude Account Switcher');
        this._trayPath = trayPath;
        this._state = null;
        this._icon = new St.Icon({style_class: 'system-status-icon'});
        this.add_child(this._icon);
        this._switchItem = new PopupMenu.PopupMenuItem('');
        this._switchItem.connect('activate', () => this._run(['--next']));
        this.menu.addMenuItem(this._switchItem);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const quit = new PopupMenu.PopupMenuItem('Quit');
        quit.connect('activate', () => this._run(['--quit']));
        this.menu.addMenuItem(quit);
        this.visible = false;
    }

    setState(state) {
        this._state = state;
        this.visible = state !== null;
        if (state === null) {
            this.menu.close();
            return;
        }
        this._icon.gicon = iconFor(state.icon);
        this.accessible_name = state.account === null ? 'Claude Account Switcher' : `Claude: ${state.account}`;
        this._switchItem.label.text = state.next === null ? 'Switch account' : `Switch to ${state.next}`;
        this._switchItem.setSensitive(state.next !== null);
    }

    vfunc_event(event) {
        const type = event.type();
        const primary = type === Clutter.EventType.TOUCH_BEGIN ||
            (type === Clutter.EventType.BUTTON_PRESS && event.get_button() === Clutter.BUTTON_PRIMARY);
        if (primary) {
            this.menu.close();
            this._toggleWindow();
            return Clutter.EVENT_STOP;
        }
        if (type === Clutter.EventType.BUTTON_PRESS && event.get_button() === Clutter.BUTTON_SECONDARY) {
            this.menu.toggle();
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    _toggleWindow() {
        const open = openWindow();
        if (open !== null) {
            open.delete(global.get_current_time());
            return;
        }
        this._run([]);
    }

    // A new window: the program's is put at the icon once it is shown, which is
    // before its first frame. Not at `window-created`: a window moved there
    // crashes GNOME Shell 48 (docs/agent-notes/gnome-shell-window-placement.md),
    // and its wm class is not known yet.
    windowCreated(window) {
        const shown = window.connect('shown', () => {
            window.disconnect(shown);
            if (window.get_wm_class() === WM_CLASS)
                this._placeAtIcon(window);
        });
    }

    _placeAtIcon(window) {
        // The program writes tray.json before it opens its window; the change
        // may not have arrived yet.
        if (this._state === null)
            this.setState(readTrayState(this._trayPath));
        if (this._state === null) {
            logProblem(`its window opened while ${this._trayPath} says it does not run`);
            return;
        }
        if (this.has_allocation()) {
            this._moveToIcon(window);
            return;
        }
        // Just made visible: the icon has its place after the next layout.
        const unmanaging = window.connect('unmanaging', () => this.disconnect(allocated));
        const allocated = this.connect('notify::allocation', () => {
            this.disconnect(allocated);
            window.disconnect(unmanaging);
            this._moveToIcon(window);
        });
    }

    _moveToIcon(window) {
        const frame = window.get_frame_rect();
        const position = besideIcon(this, frame.width, frame.height);
        window.move_frame(true, position.x, position.y);
        Main.activateWindow(window);
    }

    _run(args) {
        if (this._state === null)
            return;
        try {
            const process = Gio.Subprocess.new([this._state.executable, ...args], Gio.SubprocessFlags.NONE);
            process.wait_async(null, (p, result) => {
                try {
                    p.wait_finish(result);
                } catch (e) {
                    logProblem(e.message);
                }
            });
        } catch (e) {
            logProblem(`${this._state.executable}: ${e.message}`);
        }
    }
});

export default class ClaudeAccountSwitcherExtension extends Extension {
    enable() {
        const paths = readJson(this.dir.get_child('paths.json').get_path());
        if (typeof paths?.stateDir !== 'string') {
            logProblem(`${this.path}/paths.json does not name the program's state folder`);
            return;
        }
        const trayPath = `${paths.stateDir}/share/tray.json`;
        this._indicator = new Indicator(trayPath);
        Main.panel.addToStatusArea(this.uuid, this._indicator);
        this._monitor = Gio.File.new_for_path(`${paths.stateDir}/share`)
            .monitor_directory(Gio.FileMonitorFlags.WATCH_MOVES, null);
        this._monitor.connect('changed', (monitor, file, other) => {
            if (file?.get_path() === trayPath || other?.get_path() === trayPath)
                this._indicator.setState(readTrayState(trayPath));
        });
        global.display.connectObject('window-created', (display, window) => this._indicator.windowCreated(window), this);
        this._indicator.setState(readTrayState(trayPath));
    }

    disable() {
        global.display.disconnectObject(this);
        this._monitor?.cancel();
        this._monitor = null;
        this._indicator?.destroy();
        this._indicator = null;
    }
}
