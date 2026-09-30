import type { SaveError } from "./save";

export type SaveResult = { ok: true; version: number } | { ok: false; reason: SaveError | "invalid"; message: string };
export type RemoveResult = { ok: true } | { ok: false; message: string };
