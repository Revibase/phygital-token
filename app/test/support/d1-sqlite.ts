import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

export function createTestD1(): D1Database {
	const db = new DatabaseSync(':memory:');
	db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
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
		},
		// Like D1: the statements run in order, each result as from `all()`.
		async batch(statements: { all: () => Promise<unknown> }[]) {
			const results = [];
			for (const statement of statements) results.push(await statement.all());
			return results;
		}
	} as unknown as D1Database;
}
