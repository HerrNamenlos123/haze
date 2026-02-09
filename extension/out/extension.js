"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = require("vscode");
const node_1 = require("vscode-languageclient/node");
let client = undefined;
async function startClient(_ctx) {
    let command = process.env.NODE_ENV === "development" ? "bun" : "haze";
    let args = process.env.NODE_ENV === "development" ? ["run", "dev", "lsp"] : ["lsp"];
    command = "bun";
    if (process.platform === "win32") {
        args = ["run", "--cwd", "C:/Users/Florian Zachs/Projects/haze", "dev", "lsp"];
    }
    else {
        args = ["run", "--cwd", "/home/fzachs/Projects/haze", "dev", "lsp"];
    }
    client = new node_1.LanguageClient("haze", "Haze Language Server", { command, args }, { documentSelector: [{ language: "haze" }] });
    await client.start();
}
async function stopClient() {
    if (client) {
        await client.stop();
        client = undefined;
    }
}
async function activate(ctx) {
    ctx.subscriptions.push(vscode.commands.registerCommand("haze.restartServer", async () => {
        await stopClient();
        await startClient(ctx);
        vscode.window.showInformationMessage("Haze language server restarted");
    }));
    await startClient(ctx);
}
async function deactivate() {
    await stopClient();
}
