import { ExtensionContext, SecretStorage } from "vscode";

export default class AuthSettings {
  private static _instance: AuthSettings;

  constructor(private secretStorage: SecretStorage) {}

  static init(context: ExtensionContext): void {
    // Create instance of new AuthSettings.
    AuthSettings._instance = new AuthSettings(context.secrets);
  }

  static get instance(): AuthSettings {
    return AuthSettings._instance;
  }

  async storeAuthKey(data?: string): Promise<void> {
    if (data) {
      this.secretStorage.store("kubesail_api_key", data);
    }
  }
  async storeAuthSecret(data?: string): Promise<void> {
    if (data) {
      this.secretStorage.store("kubesail_api_secret", data);
    }
  }

  async getAuthData(): Promise<any | undefined> {
    const key = await this.secretStorage.get("kubesail_api_key");
    const secret = await this.secretStorage.get("kubesail_api_secret");
    return { key, secret };
  }
}
