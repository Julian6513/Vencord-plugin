/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Julian6513
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export interface Server {
    id: string;
    name: string;
    memberCount?: number;
}

export interface ResultRow {
    id: string;
    username: string;
    displayName: string;
    seedNickname: string;
    targetNickname: string;
    avatar?: string;
}

export interface Chunk {
    guildId: string;
    nonce?: string;
    members?: Array<{ user?: { id: string; }; userId?: string; }>;
    notFound?: string[];
}

export interface Client {
    memberIds(guildId: string): string[];
    isMember(guildId: string, userId: string): boolean;
    row(userId: string, seedId: string, targetId: string): ResultRow;
    canAccess(guildId: string): boolean;
    request(guildId: string, userIds: string[], nonce: string): void;
    subscribe(callback: (chunks: Chunk[]) => void): () => void;
}

export interface Report {
    seed: Server;
    target: Server;
    candidates: number;
    requested: number;
    matched: number;
    notFound: number;
    unresolved: number;
    status: "ready" | "running" | "finished" | "cancelled" | "stopped";
    message: string;
    rows: ResultRow[];
    startedAt: string;
    updatedAt: string;
    // Member count equality is not evidence of an authoritative roster snapshot.
    exhaustive: false;
}

export const BATCH_SIZE = 100;
export const REQUEST_INTERVAL_MS = 5000;
export const RESPONSE_TIMEOUT_MS = 15000;

function countHint(server: Server, loaded: number) {
    return server.memberCount && server.memberCount > 0 ? server.memberCount : loaded;
}

export function chooseOrder(a: Server, b: Server, aLoaded: number, bLoaded: number) {
    return countHint(a, aLoaded) <= countHint(b, bLoaded) ? [a, b] : [b, a];
}

function wait(ms: number, signal: AbortSignal) {
    return new Promise<void>(resolve => {
        if (signal.aborted) return resolve();
        const done = () => {
            clearTimeout(timer);
            signal.removeEventListener("abort", done);
            resolve();
        };
        const timer = setTimeout(done, ms);
        signal.addEventListener("abort", done, { once: true });
    });
}

/** Exactly one in-flight normal client request. Only a matching nonce can prove absence. */
export function requestBatch(client: Client, guildId: string, ids: string[], signal: AbortSignal, timeout = RESPONSE_TIMEOUT_MS) {
    const nonce = `msf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    return new Promise<{ present: Set<string>; absent: Set<string>; complete: boolean; }>((resolve, reject) => {
        const requested = new Set(ids);
        const present = new Set<string>();
        const absent = new Set<string>();
        let unsubscribe = () => {};
        let settled = false;
        const cleanup = () => {
            clearTimeout(timer);
            unsubscribe();
            signal.removeEventListener("abort", finish);
        };
        const finish = () => {
            if (settled) return;
            settled = true;
            cleanup();
            // Positive cache evidence is useful even if Discord drops the nonce.
            for (const id of ids) if (client.isMember(guildId, id)) {
                present.add(id);
                absent.delete(id);
            }
            resolve({ present, absent, complete: present.size + absent.size === requested.size });
        };
        const timer = setTimeout(finish, timeout);
        if (signal.aborted) return finish();
        unsubscribe = client.subscribe(chunks => {
            for (const chunk of chunks) {
                if (chunk.guildId !== guildId || chunk.nonce !== nonce) continue;
                for (const member of chunk.members ?? []) {
                    const id = member.user?.id ?? member.userId;
                    if (id && requested.has(id)) {
                        present.add(id);
                        absent.delete(id);
                    }
                }
                for (const id of chunk.notFound ?? []) {
                    if (requested.has(id) && !present.has(id)) absent.add(id);
                }
            }
            if (present.size + absent.size === requested.size) finish();
        });
        signal.addEventListener("abort", finish, { once: true });
        try {
            client.request(guildId, ids, nonce);
        } catch (error) {
            if (settled) return;
            settled = true;
            cleanup();
            reject(error);
        }
    });
}

export function createComparison(client: Client, a: Server, b: Server) {
    if (a.id === b.id) throw new Error("Choose two different servers.");
    if (!client.canAccess(a.id) || !client.canAccess(b.id)) throw new Error("You must be a member of both servers.");
    const aIds = client.memberIds(a.id);
    const bIds = client.memberIds(b.id);
    const [seed, target] = chooseOrder(a, b, aIds.length, bIds.length);
    const ids = [...new Set(seed.id === a.id ? aIds : bIds)].filter(id => client.isMember(seed.id, id));
    const matches = new Set(ids.filter(id => client.isMember(target.id, id)));
    const absent = new Set<string>();
    const report: Report = {
        seed, target, candidates: ids.length, requested: 0,
        matched: matches.size, notFound: 0, unresolved: ids.length - matches.size,
        status: "ready", message: "Loaded candidates only. Server rosters may be incomplete.",
        rows: [], startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), exhaustive: false
    };
    const snapshot = (): Report => ({
        ...report, matched: matches.size, notFound: absent.size,
        unresolved: ids.length - matches.size - absent.size,
        updatedAt: new Date().toISOString(),
        rows: [...matches].map(id => client.row(id, seed.id, target.id))
            .sort((x, y) => x.displayName.localeCompare(y.displayName) || x.id.localeCompare(y.id))
    });
    return {
        snapshot,
        async run(signal: AbortSignal, onUpdate: (report: Report) => void, timing = { interval: REQUEST_INTERVAL_MS, timeout: RESPONSE_TIMEOUT_MS }) {
            report.status = "running";
            const pending = ids.filter(id => !matches.has(id));
            let lastRequestAt = 0;
            try {
                onUpdate(snapshot());
                for (let offset = 0; offset < pending.length; offset += BATCH_SIZE) {
                    if (lastRequestAt) await wait(Math.max(0, timing.interval - (Date.now() - lastRequestAt)), signal);
                    if (signal.aborted) break;
                    if (!client.canAccess(seed.id) || !client.canAccess(target.id)) throw new Error("Server access changed. Check stopped.");
                    const batch = pending.slice(offset, offset + BATCH_SIZE).filter(id => {
                        if (!client.isMember(target.id, id)) return true;
                        matches.add(id);
                        return false;
                    });
                    if (!batch.length) continue;
                    report.requested += batch.length;
                    report.message = "Checking loaded candidates through Discord's member requests…";
                    onUpdate(snapshot());
                    lastRequestAt = Date.now();
                    const result = await requestBatch(client, target.id, batch, signal, timing.timeout);
                    result.present.forEach(id => matches.add(id));
                    result.absent.forEach(id => absent.add(id));
                    onUpdate(snapshot());
                    if (signal.aborted) break;
                    if (!result.complete) {
                        report.status = "stopped";
                        report.message = "Discord did not resolve a batch. Stopped without retries; unanswered users remain unresolved.";
                        onUpdate(snapshot());
                        return;
                    }
                }
                report.status = signal.aborted ? "cancelled" : "finished";
                report.message = signal.aborted
                    ? "Cancelled. Results received so far are retained."
                    : ids.length
                        ? "All loaded candidates checked. This does not prove the smaller server's roster is complete."
                        : "No smaller-server members are loaded. Open that server in Discord, load members, then start a new check.";
            } catch (error) {
                report.status = "stopped";
                report.message = error instanceof Error ? error.message : "Client request failed. Check stopped without retries.";
            }
            onUpdate(snapshot());
        }
    };
}

export function filterRows(rows: ResultRow[], query: string) {
    const needle = query.trim().toLocaleLowerCase();
    return rows.filter(row => [row.id, row.username, row.displayName, row.seedNickname, row.targetNickname]
        .some(value => value.toLocaleLowerCase().includes(needle)));
}

function csvCell(value: string) {
    // Avoid spreadsheet formula execution; ID cells are strings in the JSON export.
    const safe = /^[=+@\-\t\r\n]/.test(value) ? `'${value}` : value;
    return `"${safe.replaceAll('"', '""')}"`;
}

export function exportCsv(rows: ResultRow[]) {
    return ["user_id,username,display_name,smaller_server_nickname,larger_server_nickname",
        ...rows.map(row => [row.id, row.username, row.displayName, row.seedNickname, row.targetNickname].map(csvCell).join(","))]
        .join("\r\n");
}

export function exportJson(report: Report, rows: ResultRow[], query: string) {
    return JSON.stringify({ ...report, rows, exportScope: "filtered results", search: query,
        caveat: "Snapshot of loaded candidates; not an authoritative full-server membership list. notFound is a correlated Discord response, not a permanent membership status." }, null, 2);
}
