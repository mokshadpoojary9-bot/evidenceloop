import type { SupabaseClient } from '@supabase/supabase-js';
import type { Db, TableName, Tables } from './db.js';

// The application uses camelCase fields; Postgres columns are snake_case.
// Only top-level keys are converted — jsonb column contents stay as written.
const toSnake = (key: string) => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const toCamel = (key: string) => key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

const mapKeys = (row: object, convert: (key: string) => string) =>
  Object.fromEntries(Object.entries(row).map(([key, value]) => [convert(key), value]));

export class SupabaseDb implements Db {
  constructor(private readonly client: SupabaseClient) {}

  async insert<T extends TableName>(table: T, rows: Tables[T] | Tables[T][]) {
    const list = Array.isArray(rows) ? rows : [rows];
    if (list.length === 0) return;
    const { error } = await this.client.from(table).insert(list.map((r) => mapKeys(r, toSnake)));
    if (error) throw new Error(`Supabase insert into ${table} failed: ${error.message}`);
  }

  async update<T extends TableName>(table: T, id: string, patch: Partial<Tables[T]>) {
    const { error } = await this.client.from(table).update(mapKeys(patch, toSnake)).eq('id', id);
    if (error) throw new Error(`Supabase update of ${table} failed: ${error.message}`);
  }

  async delete<T extends TableName>(table: T, where: Partial<Tables[T]>) {
    if (Object.keys(where).length === 0) throw new Error('Refusing to delete without a condition');
    const { error } = await this.client.from(table).delete().match(mapKeys(where, toSnake));
    if (error) throw new Error(`Supabase delete from ${table} failed: ${error.message}`);
  }

  async get<T extends TableName>(table: T, id: string) {
    const { data, error } = await this.client.from(table).select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(`Supabase read from ${table} failed: ${error.message}`);
    return data ? (mapKeys(data, toCamel) as unknown as Tables[T]) : null;
  }

  async list<T extends TableName>(
    table: T,
    where: Partial<Tables[T]> = {},
    orderBy?: keyof Tables[T] & string,
  ) {
    let query = this.client.from(table).select('*').match(mapKeys(where, toSnake));
    if (orderBy) query = query.order(toSnake(orderBy), { ascending: true });
    const { data, error } = await query;
    if (error) throw new Error(`Supabase read from ${table} failed: ${error.message}`);
    return (data ?? []).map((row) => mapKeys(row, toCamel) as unknown as Tables[T]);
  }
}
