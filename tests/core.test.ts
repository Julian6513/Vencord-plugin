import assert from "node:assert/strict";
import { test } from "node:test";

import { BATCH_SIZE, chooseOrder, createComparison, exportCsv, exportJson, filterRows, requestBatch } from "../src/userplugins/mutualServerFinder/core.ts";
import type { Chunk, Client, Server } from "../src/userplugins/mutualServerFinder/core.ts";

const small: Server = { id: "small", name: "Small", memberCount: 2000 };
const large: Server = { id: "large", name: "Large", memberCount: 40000 };

function fixture(count = 201) {
    const ids = Array.from({ length: count }, (_, i) => String(i + 1));
    const seed = new Set(ids);
    const target = new Set<string>();
    const listeners = new Set<(chunks: Chunk[]) => void>();
    const calls: Array<{ guildId: string; ids: string[]; nonce: string; time: number; }> = [];
    const emit = (chunks: Chunk[]) => listeners.forEach(callback => callback(chunks));
    const client: Client = {
        memberIds: guildId => [...(guildId === small.id ? seed : target)],
        isMember: (guildId, id) => (guildId === small.id ? seed : target).has(id),
        canAccess: () => true,
        row: id => ({ id, username: `user${id}`, displayName: `User ${id}`, seedNickname: "", targetNickname: "" }),
        request(guildId, requestIds, nonce) {
            calls.push({ guildId, ids: requestIds, nonce, time: Date.now() });
            queueMicrotask(() => emit([{
                guildId, nonce,
                members: requestIds.filter(id => Number(id) % 2 === 0).map(id => ({ user: { id } })),
                notFound: requestIds.filter(id => Number(id) % 2 !== 0)
            }]));
        },
        subscribe(callback) {
            listeners.add(callback);
            return () => { listeners.delete(callback); };
        }
    };
    return { client, seed, target, listeners, calls, emit };
}

test("2k vs 40k starts with the smaller roster regardless of picker order", async () => {
    const f = fixture(2000);
    const comparison = createComparison(f.client, large, small);
    assert.equal(comparison.snapshot().seed.id, small.id);
    await comparison.run(new AbortController().signal, () => {}, { interval: 0, timeout: 30 });
    const report = comparison.snapshot();
    assert.equal(f.calls.length, 20);
    assert.ok(f.calls.every(call => call.guildId === large.id && call.ids.length <= BATCH_SIZE));
    assert.equal(new Set(f.calls.flatMap(call => call.ids)).size, 2000);
    assert.equal(report.matched, 1000);
    assert.equal(report.notFound, 1000);
    assert.equal(report.unresolved, 0);
    assert.equal(report.status, "finished");
    assert.equal(report.exhaustive, false);
    assert.equal(f.listeners.size, 0);
});

test("cache matches are retained and never requested", async () => {
    const f = fixture(9);
    f.target.add("1");
    f.target.add("2");
    const comparison = createComparison(f.client, small, large);
    assert.equal(comparison.snapshot().matched, 2);
    await comparison.run(new AbortController().signal, () => {}, { interval: 0, timeout: 30 });
    assert.deepEqual(f.calls[0].ids, ["3", "4", "5", "6", "7", "8", "9"]);
    assert.equal(comparison.snapshot().matched, 5);
});

test("unrelated guilds/nonces/IDs cannot prove membership or absence", async () => {
    const f = fixture(3);
    f.client.request = (guildId, ids, nonce) => queueMicrotask(() => f.emit([
        { guildId, nonce: "other", notFound: ids },
        { guildId: "other", nonce, notFound: ids },
        { guildId, nonce, members: [{ user: { id: "999" } }, { userId: "1" }], notFound: ["2", "999"] }
    ]));
    const result = await requestBatch(f.client, large.id, ["1", "2", "3"], new AbortController().signal, 10);
    assert.deepEqual([...result.present], ["1"]);
    assert.deepEqual([...result.absent], ["2"]);
    assert.equal(result.complete, false);
    assert.equal(f.listeners.size, 0);
});

test("partial response stops the whole scan without retrying or treating omissions as absence", async () => {
    const f = fixture(250);
    f.client.request = (guildId, ids, nonce) => {
        f.calls.push({ guildId, ids, nonce, time: Date.now() });
        queueMicrotask(() => f.emit([{ guildId, nonce, members: [{ user: { id: ids[0] } }] }]));
    };
    const comparison = createComparison(f.client, small, large);
    await comparison.run(new AbortController().signal, () => {}, { interval: 0, timeout: 10 });
    const report = comparison.snapshot();
    assert.equal(f.calls.length, 1);
    assert.equal(report.status, "stopped");
    assert.equal(report.matched, 1);
    assert.equal(report.notFound, 0);
    assert.equal(report.unresolved, 249);
    assert.equal(f.listeners.size, 0);
});

test("positive cache evidence survives missing nonce support, negatives remain unresolved", async () => {
    const f = fixture(2);
    f.client.request = (guildId, ids) => {
        f.target.add(ids[0]);
        queueMicrotask(() => f.emit([{ guildId, notFound: [ids[1]] }]));
    };
    const result = await requestBatch(f.client, large.id, ["1", "2"], new AbortController().signal, 10);
    assert.deepEqual([...result.present], ["1"]);
    assert.equal(result.absent.size, 0);
    assert.equal(result.complete, false);
});

test("split and duplicated chunks classify each requested ID once", async () => {
    const f = fixture(3);
    f.client.request = (guildId, ids, nonce) => queueMicrotask(() => {
        f.emit([{ guildId, nonce, members: [{ userId: "1" }], notFound: ["2", "2"] }]);
        f.emit([{ guildId, nonce, members: [{ userId: "1" }, { userId: "3" }], notFound: ["1"] }]);
    });
    const result = await requestBatch(f.client, large.id, ["1", "2", "3"], new AbortController().signal, 30);
    assert.deepEqual([...result.present], ["1", "3"]);
    assert.deepEqual([...result.absent], ["2"]);
    assert.equal(result.complete, true);
});

test("cancellation cleans subscriptions and retains partial results", async () => {
    const f = fixture();
    const controller = new AbortController();
    f.client.request = (guildId, ids, nonce) => queueMicrotask(() => {
        f.emit([{ guildId, nonce, members: [{ userId: "1" }] }]);
        controller.abort();
    });
    const comparison = createComparison(f.client, small, large);
    await comparison.run(controller.signal, () => {}, { interval: 0, timeout: 100 });
    assert.equal(comparison.snapshot().status, "cancelled");
    assert.equal(comparison.snapshot().matched, 1);
    assert.equal(f.listeners.size, 0);
});

test("a cancelled signal sends no requests", async () => {
    const f = fixture();
    const controller = new AbortController();
    controller.abort();
    const comparison = createComparison(f.client, small, large);
    await comparison.run(controller.signal, () => {});
    assert.equal(f.calls.length, 0);
    assert.equal(comparison.snapshot().status, "cancelled");
});

test("dispatch failure and lost access stop safely and clean listeners", async () => {
    const f = fixture();
    f.client.request = () => { throw new Error("Connection unavailable"); };
    const comparison = createComparison(f.client, small, large);
    await comparison.run(new AbortController().signal, () => {}, { interval: 0, timeout: 30 });
    assert.equal(comparison.snapshot().status, "stopped");
    assert.equal(f.listeners.size, 0);
    const next = createComparison(f.client, small, large);
    f.client.canAccess = () => false;
    await next.run(new AbortController().signal, () => {}, { interval: 0, timeout: 30 });
    assert.match(next.snapshot().message, /access changed/);
});

test("requests are sequential and paced even when replies arrive immediately", async () => {
    const f = fixture(201);
    const comparison = createComparison(f.client, small, large);
    await comparison.run(new AbortController().signal, () => {}, { interval: 25, timeout: 30 });
    assert.equal(f.calls.length, 3);
    assert.ok(f.calls[1].time - f.calls[0].time >= 24);
    assert.ok(f.calls[2].time - f.calls[1].time >= 24);
});

test("roster uncertainty survives a finished scan and empty cache", async () => {
    const f = fixture(0);
    const comparison = createComparison(f.client, small, large);
    await comparison.run(new AbortController().signal, () => {});
    assert.equal(comparison.snapshot().exhaustive, false);
    assert.equal(comparison.snapshot().candidates, 0);
    assert.equal(f.calls.length, 0);
    assert.deepEqual(chooseOrder({ id: "a", name: "a" }, { id: "b", name: "b" }, 10, 5).map(s => s.id), ["b", "a"]);
    assert.throws(() => createComparison(f.client, small, small), /different/);
});

test("search includes IDs and both nicknames, exports quote values and preserve metadata", () => {
    const row = { id: "123456789012345678", username: "=formula", displayName: 'A, "B"', seedNickname: "Seed", targetNickname: "Target" };
    assert.equal(filterRows([row], "tArGeT").length, 1);
    assert.equal(filterRows([row], row.id).length, 1);
    assert.equal(filterRows([row], "absent").length, 0);
    assert.match(exportCsv([row]), /"'=formula"/);
    assert.match(exportCsv([row]), /"A, ""B"""/);
    const report = createComparison(fixture(0).client, small, large).snapshot();
    const json = JSON.parse(exportJson(report, [row], "target"));
    assert.equal(json.rows[0].id, row.id);
    assert.equal(json.exhaustive, false);
    assert.equal(json.search, "target");
});
