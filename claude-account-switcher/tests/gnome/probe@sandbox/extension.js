// Sandbox-only driver: D-Bus Eval/State on the private session bus. No Clutter
// event filter: one still in place while the shell tears its stage down is
// called then, and GJS aborts the shell (a coredump at the end of every run
// that clicked).
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const IFACE = `<node><interface name="org.sandbox.Probe">
<method name="State"><arg type="s" direction="out"/></method>
<method name="Eval"><arg type="s" direction="in"/><arg type="s" direction="out"/></method>
<method name="Events"><arg type="s" direction="out"/></method>
</interface></node>`;

function state() {
    const wm = global.workspace_manager;
    const wins = global.display.list_all_windows().filter(w => w.get_window_type() === Meta.WindowType.NORMAL).map(w => ({
        title: w.get_title(), ws: w.get_workspace()?.index() ?? null, minimized: w.minimized,
        attention: w.demands_attention, urgent: w.urgent, focus: w.has_focus(),
        x11: w.get_client_type() === Meta.WindowClientType.X11,
    }));
    const banner = Main.messageTray._banner;
    let bannerBox = null;
    if (banner) {
        const [x, y] = banner.get_transformed_position();
        const [bw, bh] = banner.get_transformed_size();
        bannerBox = {x, y, w: bw, h: bh, source: banner.notification?.source?.title ?? null};
    }
    return JSON.stringify({
        ws: wm.get_active_workspace_index(), nws: wm.get_n_workspaces(),
        focus: global.display.focus_window?.get_title() ?? null,
        locked: Main.sessionMode.isLocked, overview: Main.overview.visible,
        sources: Main.messageTray.getSources().map(s => s.title),
        banner: bannerBox, wins,
    });
}

export default class Probe extends Extension {
    enable() {
        this._events = [];
        globalThis.probe = {Main, Meta, Clutter, GLib, Gio, Shell, state};
        this._obj = Gio.DBusExportedObject.wrapJSObject(IFACE, {
            State: () => state(),
            Eval: code => { try { return String((0, eval)(code)); } catch (e) { return `ERR ${e}\n${e.stack}`; } },
            Events: () => { const s = JSON.stringify(this._events); this._events = []; return s; },
        });
        this._obj.export(Gio.DBus.session, '/org/sandbox/Probe');
        this._name = Gio.bus_own_name_on_connection(Gio.DBus.session, 'org.sandbox.Probe', 0, null, null);
        global.display.connectObject('window-demands-attention', (d, w) => this._events.push({type: 'demands-attention', title: w.get_title(), time: global.get_current_time()}),
            'window-marked-urgent', (d, w) => this._events.push({type: 'urgent', title: w.get_title()}), this);
    }
    disable() {
        global.display.disconnectObject(this);
        Gio.bus_unown_name(this._name);
        this._obj.unexport();
    }
}
