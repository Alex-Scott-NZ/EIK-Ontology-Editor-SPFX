/**
 * Reading and writing files in a SharePoint document library.
 *
 * Path encoding matters: library and file names may contain apostrophes,
 * ampersands and braces. Each path segment is encoded individually so slashes
 * survive, and single quotes are doubled for the OData string literal.
 */

import { SPHttpClient, SPHttpClientResponse } from '@microsoft/sp-http';
import { WebPartContext } from '@microsoft/sp-webpart-base';

/** Encode each segment, preserving the slashes between them. */
function encodePath(serverRelativePath: string): string {
  return serverRelativePath.split('/').map(encodeURIComponent).join('/');
}

/** Escape a path for use inside an OData single-quoted string. */
function odataLiteral(serverRelativePath: string): string {
  return serverRelativePath.replace(/'/g, "''");
}

export interface ILibraryFile {
  name: string;
  serverRelativeUrl: string;
  size: number;
  modified: string;
}

/**
 * The hard-coded home for ontology files on the current site:
 * `<site>/Shared Documents/Ontology`. One well-known folder beats per-user
 * paths — the default Documents library also versions every save, which is
 * the safety net for a master file. The property-pane folder overrides this.
 */
export function defaultOntologyFolder(context: WebPartContext): string {
  const web = context.pageContext.web.serverRelativeUrl;
  return `${web === '/' ? '' : web}/Shared Documents/Ontology`;
}

export class FileService {
  private _context: WebPartContext;

  public constructor(context: WebPartContext) {
    this._context = context;
  }

  private get _webUrl(): string {
    return this._context.pageContext.web.absoluteUrl;
  }

  /** Raw bytes of a file, by server-relative path. */
  public async readFile(serverRelativePath: string): Promise<ArrayBuffer> {
    const url =
      `${this._webUrl}/_api/web/GetFileByServerRelativePath(decodedurl='` +
      `${encodePath(odataLiteral(serverRelativePath))}')/$value`;

    const response: SPHttpClientResponse = await this._context.spHttpClient.get(
      url, SPHttpClient.configurations.v1
    );
    if (!response.ok) {
      throw new Error(`Could not read ${serverRelativePath} — HTTP ${response.status} ${response.statusText}`);
    }
    return response.arrayBuffer();
  }

  /** File contents as text — for .ttl sources. */
  public async readText(serverRelativePath: string): Promise<string> {
    const buffer = await this.readFile(serverRelativePath);
    return new TextDecoder('utf-8').decode(buffer);
  }

  /**
   * List files in a library folder, optionally filtered by extension.
   * `folderPath` is server-relative, e.g. /sites/knowledge/Shared Documents/ontology
   */
  public async listFiles(folderPath: string, extensions?: string[]): Promise<ILibraryFile[]> {
    const url =
      `${this._webUrl}/_api/web/GetFolderByServerRelativePath(decodedurl='` +
      `${encodePath(odataLiteral(folderPath))}')/Files` +
      `?$select=Name,ServerRelativeUrl,Length,TimeLastModified&$orderby=Name`;

    const response: SPHttpClientResponse = await this._context.spHttpClient.get(
      url, SPHttpClient.configurations.v1
    );
    if (!response.ok) {
      throw new Error(`Could not list ${folderPath} — HTTP ${response.status} ${response.statusText}`);
    }
    const json = await response.json();
    const values: Array<{
      Name: string; ServerRelativeUrl: string; Length: string; TimeLastModified: string;
    }> = json.value || [];

    const files = values.map(v => ({
      name: v.Name,
      serverRelativeUrl: v.ServerRelativeUrl,
      size: Number(v.Length),
      modified: v.TimeLastModified
    }));

    if (!extensions || !extensions.length) return files;
    const lower = extensions.map(e => e.toLowerCase());
    return files.filter(f => lower.some(e => f.name.toLowerCase().lastIndexOf(e) === f.name.length - e.length));
  }

  /**
   * Create a folder if it does not exist. AddUsingPath returns the existing
   * folder rather than failing, so calling this before every write is safe.
   * Only the LAST segment is created — the parent library must exist, which
   * "Shared Documents" always does.
   */
  public async ensureFolder(serverRelativePath: string): Promise<void> {
    const url =
      `${this._webUrl}/_api/web/Folders/AddUsingPath(decodedurl='` +
      `${encodePath(odataLiteral(serverRelativePath))}')`;
    const response: SPHttpClientResponse = await this._context.spHttpClient.post(
      url, SPHttpClient.configurations.v1, {}
    );
    if (!response.ok) {
      throw new Error(`Could not create folder ${serverRelativePath} — HTTP ${response.status} ${response.statusText}`);
    }
  }

  /**
   * Write bytes to a library folder, overwriting. SharePoint's AddUsingPath
   * caps a single POST at 250 MB; the ontology database is ~30 MB so a chunked
   * upload is not needed yet.
   */
  public async writeFile(
    folderPath: string,
    fileName: string,
    bytes: ArrayBuffer | Uint8Array
  ): Promise<void> {
    const url =
      `${this._webUrl}/_api/web/GetFolderByServerRelativePath(decodedurl='` +
      `${encodePath(odataLiteral(folderPath))}')/Files/AddUsingPath(` +
      `decodedurl='${encodeURIComponent(odataLiteral(fileName))}',overwrite=true)`;

    const body: ArrayBuffer = bytes instanceof Uint8Array
      // Copy into a standalone ArrayBuffer: a Uint8Array view may cover only
      // part of a larger buffer, and posting the whole buffer would corrupt it.
      ? bytes.slice().buffer
      : bytes;

    const response: SPHttpClientResponse = await this._context.spHttpClient.post(
      url,
      SPHttpClient.configurations.v1,
      { body, headers: { 'Content-Type': 'application/octet-stream' } }
    );
    if (!response.ok) {
      throw new Error(`Could not write ${fileName} — HTTP ${response.status} ${response.statusText}`);
    }
  }
}

/** Read a File chosen through an <input type="file"> as text. */
export function readLocalFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error(`Could not read ${file.name}`));
    reader.readAsText(file);
  });
}

/** Read a File chosen through an <input type="file"> as bytes. */
export function readLocalFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error || new Error(`Could not read ${file.name}`));
    reader.readAsArrayBuffer(file);
  });
}

/** Offer bytes to the user as a download — the no-SharePoint way to keep a build. */
export function downloadBytes(bytes: Uint8Array, fileName: string): void {
  const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke on the next tick — revoking synchronously can cancel the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
