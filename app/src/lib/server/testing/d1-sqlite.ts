import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

/**
 * Test-only D1 stand-in backed by Node's built-in SQLite, so the real SQL
 * (conditional upserts, compare-and-set updates) is exercised, not mocked.
 */
export function createTestD1(migrationDirs: string[]): D1Database {
	const db = new DatabaseSync(':memory:');
	for (const dir of migrationDirs) {
		for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
			db.exec(readFileSync(join(dir, file), 'utf8'));
		}
	}
	return {
		prepare(sql: string) {
			let args: SQLInputValue[] = [];
			const stmt = {
				bind(...values: unknown[]) {
					args = values.map((v) => (v === undefined ? null : v)) as SQLInputValue[];
					return stmt;
				},
				async run() {
					const r = db.prepare(sql).run(...args);
					return { success: true, meta: { changes: Number(r.changes) } };
				},
				async first<T>() {
					return (db.prepare(sql).get(...args) as T | undefined) ?? null;
				},
				async all<T>() {
					return { success: true, results: db.prepare(sql).all(...args) as T[] };
				}
			};
			return stmt;
		}
	} as unknown as D1Database;
}

/** The app's migrations, including the local mirror of the shared phygital-wallet tables. */
export const MIGRATIONS = new URL('../../../../migrations', import.meta.url).pathname;
