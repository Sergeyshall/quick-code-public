import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { ChatMessage } from "../llm/types";
import { ensureSubdir, writeFileAtomic } from "./dataDir";

/** What the UI shows for a saved conversation; banners and notices are not stored. */
export type TranscriptEntry =
  | { kind: "user" | "agent" | "error"; text: string }
  | { kind: "tool"; text: string; isError: boolean };

export interface SessionMeta {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  /** Number of user prompts in the session. */
  messageCount: number;
  model: string;
}

export interface Session extends SessionMeta {
  /** The model context, replayed verbatim on resume (including provider data such as thinking blocks). */
  messages: ChatMessage[];
  transcript: TranscriptEntry[];
}

interface SessionIndex {
  version: 1;
  sessions: SessionMeta[];
}

const ID_PATTERN = /^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}(-\d+)?$/;
const TITLE_LENGTH = 60;

export function isSessionId(id: string): boolean {
  return ID_PATTERN.test(id);
}

/** `YYYY-MM-DD-HH-MM` in local time, with `-2`, `-3`, ... when that minute is already taken. */
export function sessionIdFor(date: Date, taken: ReadonlySet<string>): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const base = [date.getFullYear(), pad(date.getMonth() + 1), pad(date.getDate()), pad(date.getHours()), pad(date.getMinutes())].join("-");
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}

export function sessionTitle(prompt: string): string {
  const oneLine = prompt.replace(/\s+/g, " ").trim();
  return oneLine.length > TITLE_LENGTH ? `${oneLine.slice(0, TITLE_LENGTH - 1)}…` : oneLine;
}

/**
 * Drops a trailing assistant turn whose tool calls never got results (e.g. the app quit
 * mid-turn), so a resumed history is always valid to send.
 */
export function sanitizeHistory(messages: ChatMessage[]): ChatMessage[] {
  const out = [...messages];
  const last = out.at(-1);
  if (last?.role === "assistant" && last.toolCalls.length > 0) out.pop();
  return out;
}

/**
 * Sessions of one project: `.quick-code/sessions/index.json` lists them and each lives in
 * `session-<id>.json`. Writes are serialized so concurrent saves cannot interleave.
 */
export class SessionStore {
  private index: SessionIndex = { version: 1, sessions: [] };
  private queue: Promise<unknown> = Promise.resolve();
  /** Ids handed out by create() but not saved yet. */
  private readonly reserved = new Set<string>();

  private constructor(readonly dir: string) {}

  static async open(dataDir: string): Promise<SessionStore> {
    const store = new SessionStore(await ensureSubdir(path.join(dataDir, "sessions")));
    store.index = (await store.readIndex()) ?? (await store.rebuildIndex());
    return store;
  }

  /** Sessions, most recently updated first. */
  list(): SessionMeta[] {
    return [...this.index.sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  create(model: string, now = new Date()): Session {
    const id = sessionIdFor(now, new Set([...this.reserved, ...this.index.sessions.map((s) => s.id)]));
    // Reserve the id right away so a second session in the same minute gets a suffix.
    this.reserved.add(id);
    const at = now.toISOString();
    return { id, title: "", createdAt: at, updatedAt: at, messageCount: 0, model, messages: [], transcript: [] };
  }

  async load(id: string): Promise<Session> {
    if (!isSessionId(id)) throw new Error(`Invalid session id "${id}"`);
    const data = JSON.parse(await readFile(this.file(id), "utf8")) as Session;
    if (data.id !== id || !Array.isArray(data.messages) || !Array.isArray(data.transcript)) {
      throw new Error(`Session ${id} is malformed`);
    }
    return { ...data, messages: sanitizeHistory(data.messages) };
  }

  async latest(): Promise<Session | null> {
    for (const meta of this.list()) {
      try {
        return await this.load(meta.id);
      } catch {
        // A deleted or broken file: fall back to the next most recent session.
      }
    }
    return null;
  }

  save(session: Session): Promise<void> {
    const meta: SessionMeta = {
      id: session.id,
      title: session.title,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      messageCount: session.messageCount,
      model: session.model,
    };
    const snapshot = JSON.stringify(session, null, 2);
    this.index = {
      version: 1,
      sessions: [...this.index.sessions.filter((s) => s.id !== session.id), meta],
    };
    const index = JSON.stringify(this.index, null, 2);
    const write = this.queue.then(async () => {
      await writeFileAtomic(this.file(session.id), snapshot);
      await writeFileAtomic(path.join(this.dir, "index.json"), index);
    });
    this.queue = write.catch(() => {});
    return write;
  }

  private file(id: string): string {
    return path.join(this.dir, `session-${id}.json`);
  }

  private async readIndex(): Promise<SessionIndex | null> {
    try {
      const data = JSON.parse(await readFile(path.join(this.dir, "index.json"), "utf8")) as SessionIndex;
      return Array.isArray(data.sessions) ? { version: 1, sessions: data.sessions.filter((s) => isSessionId(s.id)) } : null;
    } catch {
      return null;
    }
  }

  /** Recreates a missing or corrupt index from the session files themselves. */
  private async rebuildIndex(): Promise<SessionIndex> {
    const sessions: SessionMeta[] = [];
    for (const name of await readdir(this.dir)) {
      const id = /^session-(.+)\.json$/.exec(name)?.[1];
      if (!id || !isSessionId(id)) continue;
      try {
        const { messages: _m, transcript: _t, ...meta } = await this.load(id);
        sessions.push(meta);
      } catch {
        // Unreadable files are skipped, not fatal.
      }
    }
    return { version: 1, sessions };
  }
}
