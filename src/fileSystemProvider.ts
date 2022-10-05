/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from "path";
import * as vscode from "vscode";
import fetch from "node-fetch";
import { TextEncoder } from "util";

export class File implements vscode.FileStat {
  type: vscode.FileType;
  ctime: number;
  mtime: number;
  size: number;

  name: string;
  data?: Uint8Array;

  constructor(name: string) {
    this.type = vscode.FileType.File;
    this.ctime = Date.now();
    this.mtime = Date.now();
    this.size = 0;
    this.name = name;
  }
}

export class Directory implements vscode.FileStat {
  type: vscode.FileType;
  ctime: number;
  mtime: number;
  size: number;

  name: string;
  entries: Map<string, File | Directory>;

  constructor(name: string) {
    this.type = vscode.FileType.Directory;
    this.ctime = Date.now();
    this.mtime = Date.now();
    this.size = 0;
    this.name = name;
    this.entries = new Map();
  }
}

export type Entry = File | Directory;

export class KubesailTemplateFS implements vscode.FileSystemProvider {
  constructor(key: string, secret: string, username: string) {
    this.key = key;
    this.secret = secret;
    this.username = username;
  }
  key: string;
  secret: string;
  username: string;

  root = new Directory("");

  // --- manage file metadata

  stat(uri: vscode.Uri): vscode.FileStat {
    // return this._lookup(uri, false);
    if (uri.path === "/") return this.root;
    if (!uri.path.endsWith(".yaml")) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
    console.log("stat", uri.path);
    return new File(uri.path.split("/").pop() || "newfile");
  }

  async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
    let templates: any = await fetch(
      `https://api.kubesail.com/templates/${this.username}?limit=50&noDescription=true`,
      {
        headers: {
          "content-type": "application/json",
          authorization: `Basic ${Buffer.from(
            `${this.key}:${this.secret}`
          ).toString("base64")}`,
        },
      }
    );
    if (templates.status !== 200) {
      throw vscode.FileSystemError.Unavailable(
        "Problem fetching your templates. Is your API key correct?"
      );
    }
    templates = await templates.json();
    const result: [string, vscode.FileType][] = [];
    for (const { name } of templates.templates) {
      result.push([name + ".yaml", vscode.FileType.File]);
    }
    return result;
  }

  // --- manage file contents

  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    if (!uri.path.endsWith(".yaml")) {
      throw vscode.FileSystemError.FileNotFound();
    }
    console.log("readFile", uri.path);

    const url = `https://api.kubesail.com/templates/${
      this.username
    }/${encodeURIComponent(
      uri.path.substring(1).substring(0, uri.path.length - 6)
    )}`;
    let template: any = await fetch(url, {
      headers: {
        "content-type": "application/json",
        authorization: `Basic ${Buffer.from(
          `${this.key}:${this.secret}`
        ).toString("base64")}`,
      },
    });
    console.log({ url, status: template.status });
    if (template.status !== 200) {
      console.log("Template status - ", template.status);
      throw vscode.FileSystemError.FileNotFound(
        "404 - Template does not exist"
      );
    }
    template = await template.json();
    if (template.templates[0]?.data) {
      return new TextEncoder().encode(template.templates[0]?.data);
      // return new TextEncoder().encode("wtf what the actual");
    }
    throw vscode.FileSystemError.FileNotFound();
  }

  async writeFile(
    uri: vscode.Uri,
    content: Uint8Array,
    options: { create: boolean; overwrite: boolean }
  ): Promise<void> {
    console.log("writeFile", uri.path);

    const url = `https://api.kubesail.com/templates/${
      this.username
    }/${encodeURIComponent(
      uri.path.substring(1).substring(0, uri.path.length - 6)
    )}`;
    const resp: any = await fetch(url, {
      headers: {
        "content-type": "application/json",
        authorization: `Basic ${Buffer.from(
          `${this.key}:${this.secret}`
        ).toString("base64")}`,
      },
      body: JSON.stringify({ yaml: content.toString() }),
      method: "POST",
    });

    console.log("POST", url, resp.status);
    if (resp.status !== 200) {
      console.log("Template status ", resp.status, await resp.json());
      throw vscode.FileSystemError.Unavailable(
        "Failed to save template " + resp.status
      );
    }

    this._fireSoon({ type: vscode.FileChangeType.Changed, uri });
  }

  // --- manage files/folders

  rename(
    oldUri: vscode.Uri,
    newUri: vscode.Uri,
    options: { overwrite: boolean }
  ): void {
    throw vscode.FileSystemError.Unavailable(
      "KubeSail templates cannot be renamed from this extension. Please delete and re-create."
    );
  }

  delete(uri: vscode.Uri): void {
    // TODO issue template delete kubesail api call
    throw vscode.FileSystemError.Unavailable(
      "Deleting templates is not implemented yet"
    );
  }

  createDirectory(uri: vscode.Uri): void {
    throw vscode.FileSystemError.Unavailable(
      "KubeSail templates are in a flat structure. They cannot be nested."
    );
  }

  // --- lookup

  private _lookup(uri: vscode.Uri, silent: false): Entry;
  private _lookup(uri: vscode.Uri, silent: boolean): Entry | undefined;
  private _lookup(uri: vscode.Uri, silent: boolean): Entry | undefined {
    console.log("lookup", uri.path);
    const parts = uri.path.split("/");
    let entry: Entry = this.root;
    for (const part of parts) {
      if (!part) {
        continue;
      }
      let child: Entry | undefined;
      if (entry instanceof Directory) {
        child = entry.entries.get(part);
      }
      if (!child) {
        if (!silent) {
          throw vscode.FileSystemError.FileNotFound(uri);
        } else {
          return undefined;
        }
      }
      entry = child;
    }
    return entry;
  }

  private _lookupAsDirectory(uri: vscode.Uri, silent: boolean): Directory {
    const entry = this._lookup(uri, silent);
    if (entry instanceof Directory) {
      return entry;
    }
    throw vscode.FileSystemError.FileNotADirectory(uri);
  }

  private _lookupParentDirectory(uri: vscode.Uri): Directory {
    const dirname = uri.with({ path: path.posix.dirname(uri.path) });
    return this._lookupAsDirectory(dirname, false);
  }

  // --- manage file events

  private _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  private _bufferedEvents: vscode.FileChangeEvent[] = [];
  private _fireSoonHandle?: NodeJS.Timer;

  readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> =
    this._emitter.event;

  watch(_resource: vscode.Uri): vscode.Disposable {
    // ignore, fires for all changes...
    return new vscode.Disposable(() => {});
  }

  private _fireSoon(...events: vscode.FileChangeEvent[]): void {
    this._bufferedEvents.push(...events);

    if (this._fireSoonHandle) {
      clearTimeout(this._fireSoonHandle);
    }

    this._fireSoonHandle = setTimeout(() => {
      this._emitter.fire(this._bufferedEvents);
      this._bufferedEvents.length = 0;
    }, 5);
  }
}
