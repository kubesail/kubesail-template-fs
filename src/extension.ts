import * as vscode from "vscode";
import { KubesailTemplateFS } from "./fileSystemProvider";
import AuthSettings from "./authSettings";
import fetch from "node-fetch";

export async function activate(context: vscode.ExtensionContext) {
  // Initialize and get current instance of our Secret Storage
  AuthSettings.init(context);
  const settings = AuthSettings.instance;

  // Register commands to save and retrieve token

  const requestKey = async () => {
    const input = await vscode.window.showInputBox({
      placeHolder: "Your KubeSail API Key",
    });
    if (input === undefined) {
      await requestKey();
      return;
    }
    console.log({ input });
    await settings.storeAuthKey(input);
  };

  const requestSecret = async () => {
    const input = await vscode.window.showInputBox({
      placeHolder: "Your KubeSail API Secret",
    });
    if (input === undefined) {
      await requestSecret();
      return;
    }
    console.log({ input });
    await settings.storeAuthSecret(input);
  };

  vscode.commands.registerCommand("kubesailtemplatefs.setApiKey", requestKey);
  vscode.commands.registerCommand(
    "kubesailtemplatefs.setApiSecret",
    requestSecret
  );

  console.log("KubeSailTemplateFS says Hello!");

  const init = async (_: any) => {
    const { key, secret } = await settings.getAuthData();
    if (!key) {
      await requestKey();
      await init(_);
    }
    if (!secret) {
      await requestSecret();
      await init(_);
    }

    let profile: any = await fetch(`https://api.kubesail.com/profile`, {
      headers: {
        "content-type": "application/json",
        Authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString(
          "base64"
        )}`,
      },
    });
    if (profile.status !== 200) {
      console.log("Profile fetch status", profile.status);
      vscode.window.showErrorMessage(
        "Invalid Kubesail API Key or Secret. Failed to fetch your profile."
      );
      await requestKey();
      await requestSecret();
      await init(_);
      return;
    }
    profile = await profile.json();
    const username = profile.username;
    console.log(`Logged in as ${username}`);

    const kubesailTemplateFS = new KubesailTemplateFS(key, secret, username);
    context.subscriptions.push(
      vscode.workspace.registerFileSystemProvider(
        "kubesailtemplatefs",
        kubesailTemplateFS,
        { isCaseSensitive: true }
      )
    );
    vscode.workspace.updateWorkspaceFolders(0, 0, {
      uri: vscode.Uri.parse("kubesailtemplatefs:/"),
      name: `My Templates (${username})`,
    });
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("kubesailtemplatefs.workspaceInit", init)
  );
}
