import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { TABLE_NAMES, type Db, type TableName, type Tables } from './db.js';

type Data = { [T in TableName]: Tables[T][] };

const emptyData = (): Data =>
  Object.fromEntries(TABLE_NAMES.map((name) => [name, []])) as unknown as Data;

/**
 * Local-development database used when Supabase is not configured.
 * Kept in memory and, when `filePath` is given, mirrored to a JSON file so data
 * survives the dev server restarting. Not for production use.
 */
export class LocalDb implements Db {
  private data: Data = emptyData();

  constructor(private readonly filePath?: string) {
    if (filePath && existsSync(filePath)) {
      this.data = { ...emptyData(), ...(JSON.parse(readFileSync(filePath, 'utf8')) as Data) };
    }
  }

  private save() {
    if (!this.filePath) return;
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.data));
  }

  async insert<T extends TableName>(table: T, rows: Tables[T] | Tables[T][]) {
    this.data[table].push(...structuredClone(Array.isArray(rows) ? rows : [rows]));
    this.save();
  }

  async update<T extends TableName>(table: T, id: string, patch: Partial<Tables[T]>) {
    const row = this.data[table].find((candidate) => candidate.id === id);
    if (!row) throw new Error(`${table}: row ${id} not found`);
    Object.assign(row, structuredClone(patch));
    this.save();
  }

  async delete<T extends TableName>(table: T, where: Partial<Tables[T]>) {
    const conditions = Object.entries(where) as [keyof Tables[T], unknown][];
    if (conditions.length === 0) throw new Error('Refusing to delete without a condition');
    this.data[table] = this.data[table].filter(
      (row) => !conditions.every(([column, value]) => row[column] === value),
    ) as Data[T];
    this.save();
  }

  async get<T extends TableName>(table: T, id: string) {
    const row = this.data[table].find((candidate) => candidate.id === id);
    return row ? structuredClone(row) : null;
  }

  async list<T extends TableName>(
    table: T,
    where: Partial<Tables[T]> = {},
    orderBy?: keyof Tables[T] & string,
  ) {
    const conditions = Object.entries(where) as [keyof Tables[T], unknown][];
    const rows = this.data[table].filter((row) =>
      conditions.every(([column, value]) => row[column] === value),
    );
    if (orderBy) {
      // Array.prototype.sort is stable, so ties keep insertion order.
      rows.sort((a, b) => (a[orderBy] < b[orderBy] ? -1 : a[orderBy] > b[orderBy] ? 1 : 0));
    }
    return structuredClone(rows);
  }
}
