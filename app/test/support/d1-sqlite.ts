import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

export function createTestD1(): D1Database {
	const db = new DatabaseSync(':memory:');
	db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
	return {
		prepare(sql: string) {
			// Like D1, `bind` returns a new statement, so one prepared statement can be bound many times.
			const statement = (args: SQLInputValue[]) => ({
				bind: (...values: unknown[]) =>
					statement(values.map((v) => (v === undefined ? null : v)) as SQLInputValue[]),
				async run() {
					const r = db.prepare(sql).run(...args);
					return { success: true, meta: { changes: Number(r.changes) } };
				},
				async first<T>() {
					return (db.prepare(sql).get(...args) as T | undefined) ?? null;
				},
				async all<T>() {
					const results = db.prepare(sql).all(...args) as T[];
					const { c } = db.prepare('SELECT changes() AS c').get() as { c: number };
					return { success: true, results, meta: { changes: Number(c) } };
				}
			});
			return statement([]);
		},
		// Like D1: the statements run in order, each result as from `all()`.
		async batch(statements: { all: () => Promise<unknown> }[]) {
			const results = [];
			for (const statement of statements) results.push(await statement.all());
			return results;
		}
	} as unknown as D1Database;
}
