import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';

/** Where evidence files live. Paths are relative keys such as `<workOrderId>/<evidenceId>/<name>`. */
export interface FileStore {
  put(path: string, data: Buffer, contentType: string): Promise<void>;
  read(path: string): Promise<Buffer>;
  /** A URL the browser can load the file from, or null if none can be produced. */
  url(path: string): Promise<string | null>;
}

/** Private Supabase Storage bucket; the browser only ever receives short-lived signed URLs. */
export class SupabaseFileStore implements FileStore {
  constructor(
    private readonly client: SupabaseClient,
    private readonly bucket: string,
  ) {}

  async put(path: string, data: Buffer, contentType: string) {
    const { error } = await this.client.storage.from(this.bucket).upload(path, data, { contentType });
    if (error) throw new Error(`Supabase Storage upload failed: ${error.message}`);
  }

  async read(path: string) {
    const { data, error } = await this.client.storage.from(this.bucket).download(path);
    if (error) throw new Error(`Supabase Storage download failed: ${error.message}`);
    return Buffer.from(await data.arrayBuffer());
  }

  async url(path: string) {
    const { data } = await this.client.storage.from(this.bucket).createSignedUrl(path, 60 * 60);
    return data?.signedUrl ?? null;
  }
}

/** Local-development file store on disk, served by the API at /api/files/*. */
export class LocalFileStore implements FileStore {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  /** Resolves a key to a path on disk, refusing anything that escapes the root. */
  absolutePath(path: string): string | null {
    const absolute = resolve(this.root, path);
    return absolute.startsWith(this.root + sep) ? absolute : null;
  }

  private mustResolve(path: string) {
    const absolute = this.absolutePath(path);
    if (!absolute) throw new Error('Invalid file path');
    return absolute;
  }

  async put(path: string, data: Buffer) {
    const absolute = this.mustResolve(path);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, data);
  }

  async read(path: string) {
    return readFile(this.mustResolve(path));
  }

  async url(path: string) {
    return `/api/files/${path.split('/').map(encodeURIComponent).join('/')}`;
  }
}
