import * as vscode from "vscode";
import { LanguageClient } from "vscode-languageclient/node";

let client: LanguageClient | undefined = undefined;

async function startClient(_ctx: vscode.ExtensionContext) {
  let command = process.env.NODE_ENV === "development" ? "bun" : "haze";
  let args = process.env.NODE_ENV === "development" ? ["run", "dev", "lsp"] : ["lsp"];

  command = "bun";

  if (process.platform === "win32") {
    args = ["run", "--cwd", "C:/Users/Florian Zachs/Projects/haze", "dev", "lsp"];
  } else {
    args = ["run", "--cwd", "/home/fzachs/Projects/haze", "dev", "lsp"];
  }

  client = new LanguageClient(
    "haze",
    "Haze Language Server",
    { command, args },
    { documentSelector: [{ language: "haze" }] },
  );

  await client.start();
}

async function stopClient() {
  if (client) {
    await client.stop();
    client = undefined;
  }
}

export async function activate(ctx: vscode.ExtensionContext) {
  ctx.subscriptions.push(
    vscode.commands.registerCommand("haze.restartServer", async () => {
      await stopClient();
      await startClient(ctx);
      vscode.window.showInformationMessage("Haze language server restarted");
    }),
  );

  await startClient(ctx);
}

export async function deactivate() {
  await stopClient();
}
