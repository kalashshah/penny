// Just the Node APIs the test D1 needs; the repo carries no @types/node (Workers code must not lean on Node).
declare module 'node:fs' {
  export function readdirSync(dir: URL): string[];
  export function readFileSync(file: URL, enc: 'utf8'): string;
}
declare module 'node:sqlite' {
  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): { get(...a: unknown[]): unknown; all(...a: unknown[]): unknown[]; run(...a: unknown[]): { changes: number | bigint } };
  }
}
