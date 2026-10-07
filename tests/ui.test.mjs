import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

const mockCommon = `
import React from "react";
export const {useEffect,useRef,useState}=React;
export const useStateFromStores=(_stores,read)=>read();
const f=globalThis.__discordFixture;
export const GuildStore={getGuilds:()=>f.guilds,getGuild:id=>f.guilds[id]};
export const GuildMemberCountStore={getMemberCount:id=>f.counts[id]};
export const GuildMemberStore={
getMemberIds:id=>[...f.members[id]],
getMember:(guild,id)=>f.members[guild].has(id)?{userId:id}:null,
getNick:(guild,id)=>guild==='a'?'Small nick '+id:'Big nick '+id,
isGuestOrLurker:()=>false,isCurrentUserGuest:()=>false
};
export const UserStore={getUser:id=>({id,username:'user'+id,globalName:'Person '+id,getAvatarURL:()=>undefined})};
export const FluxDispatcher={
subscribe:(_type,cb)=>f.listeners.add(cb),
unsubscribe:(_type,cb)=>f.listeners.delete(cb),
dispatch:event=>{
f.requests.push(event);
if(f.silent)return;
queueMicrotask(()=>{
const chunks=[{guildId:event.guildIds[0],nonce:event.nonce,members:event.userIds.map(id=>({userId:id})),notFound:[]}];
event.userIds.forEach(id=>f.members[event.guildIds[0]].add(id));
f.listeners.forEach(cb=>cb({chunks}));
});
}
};
export const Modal=({title,subtitle,children})=>React.createElement('section',{role:'dialog'},React.createElement('h1',null,title),React.createElement('p',null,subtitle),children);
export const openModal=()=>{};
`;
const virtualModules = {
    "@webpack/common": mockCommon,
    "@components/Button": `import React from 'react'; export const Button=({variant,size,...props})=>React.createElement('button',props);`,
    "@components/ErrorBoundary": `export default function ErrorBoundary({children}) { return children; }`,
    "@utils/clipboard": `export async function copyToClipboard(text) { if(globalThis.__discordFixture.clipboardFails) throw Error('denied'); globalThis.__discordFixture.copied=text; }`,
    "@utils/web": `export function saveFile(file) { globalThis.__discordFixture.download=file; }`
};

async function settle() {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
}

function fixture() {
    const ids = Array.from({ length: 105 }, (_, i) => String(i + 1));
    return {
        guilds: { a: { id: "a", name: "Small community" }, b: { id: "b", name: "Large community" }, c: { id: "c", name: "Third community" } },
        counts: { a: 2000, b: 40000, c: 3000 },
        members: { a: new Set(ids), b: new Set(ids.slice(0, 100)), c: new Set() },
        listeners: new Set(), requests: [], copied: "", silent: false
    };
}

test("picker, results, paging, search, copy, export and cleanup use the actual modal and client adapter", async () => {
    const dom = new JSDOM('<div id="root"></div>', { url: "https://example.test" });
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    globalThis.HTMLElement = dom.window.HTMLElement;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const { createRoot } = await import("react-dom/client");
    globalThis.__discordFixture = fixture();
    const f = globalThis.__discordFixture;
    const output = await build({
        entryPoints: ["src/userplugins/mutualServerFinder/FinderModal.tsx"],
        bundle: true, write: false, platform: "node", format: "cjs", jsx: "automatic",
        external: ["react", "react/*"],
        plugins: [{ name: "mock-discord", setup(builder) {
            builder.onResolve({ filter: /^@/ }, args => {
                if (args.path in virtualModules) return { path: args.path, namespace: "mock" };
            });
            builder.onResolve({ filter: /\.css$/ }, args => ({ path: args.path, namespace: "css" }));
            builder.onLoad({ filter: /.*/, namespace: "mock" }, args => ({ contents: virtualModules[args.path], loader: "js" }));
            builder.onLoad({ filter: /.*/, namespace: "css" }, () => ({ contents: "", loader: "js" }));
        } }]
    });
    const module = { exports: {} };
    new Function("require", "module", "exports", output.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
    const { FinderModal } = module.exports;
    const root = createRoot(document.querySelector("#root"));
    const button = text => [...document.querySelectorAll("button")].find(node => node.textContent === text);
    const click = async text => {
        const node = button(text);
        assert.ok(node, `Button ${text} exists`);
        assert.equal(node.disabled, false);
        await act(async () => { node.click(); });
        await settle();
    };
    const input = async (node, value) => {
        await act(async () => {
            // Use the native setter so React observes the input instead of its tracker.
            Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set.call(node, value);
            node.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
        });
        await settle();
    };
    const select = async (node, value) => {
        await act(async () => { node.value = value; node.dispatchEvent(new dom.window.Event("change", { bubbles: true })); });
        await settle();
    };
    try {
        await act(async () => { root.render(React.createElement(FinderModal, { initialA: "b", initialB: "a", onClose() {}, transitionState: 1 })); });
        assert.equal(document.querySelectorAll("select").length, 2);
        await click("Compare cache only");
        assert.equal(document.querySelectorAll("tbody tr").length, 100);
        assert.match(document.body.textContent, /Small community → Large community/);
        assert.match(document.body.textContent, /100 matches/);
        assert.match(document.body.textContent, /5 unresolved/);
        assert.equal(f.requests.length, 0);

        await click("Find mutual members");
        assert.equal(f.requests.length, 1);
        assert.deepEqual(f.requests[0].guildIds, ["b"]);
        assert.equal(f.requests[0].userIds.length, 5);
        assert.equal(f.listeners.size, 0);
        assert.match(document.body.textContent, /105 matches/);
        await click("Next");
        assert.equal(document.querySelectorAll("tbody tr").length, 5);
        await click("Previous");

        const search = document.querySelector(".msf-result-search input");
        await input(search, "user105");
        assert.equal(document.querySelectorAll("tbody tr").length, 1);
        await click("Copy IDs");
        assert.equal(f.copied, "105");
        await click("Copy results");
        const copied = JSON.parse(f.copied);
        assert.equal(copied.rows.length, 1);
        assert.equal(copied.exhaustive, false);
        assert.equal(copied.search, "user105");
        await click("Export JSON");
        assert.equal(JSON.parse(await f.download.text()).rows[0].id, "105");
        await click("Export CSV");
        assert.match(await f.download.text(), /"105","user105"/);
        f.clipboardFails = true;
        await click("Copy IDs");
        assert.match(document.body.textContent, /Clipboard unavailable/);
        f.clipboardFails = false;
        await input(search, "no such user");
        assert.match(document.body.textContent, /No matches for this search/);

        const pickers = document.querySelectorAll("select");
        await select(pickers[0], "a");
        assert.equal(button("Find mutual members").disabled, true);
        assert.match(document.body.textContent, /Choose two different servers/);
        await select(pickers[1], "b");
        f.members.b.clear();
        f.silent = true;
        await click("Find mutual members");
        assert.ok(button("Stop check"));
        assert.equal(f.listeners.size, 1);
        await click("Stop check");
        assert.match(document.body.textContent, /cancelled/);
        assert.equal(f.listeners.size, 0);
        await click("Find mutual members");
        assert.equal(f.listeners.size, 1);
        await act(async () => { root.unmount(); });
        await settle();
        assert.equal(f.listeners.size, 0);
    } finally {
        await act(async () => { root.unmount(); });
        dom.window.close();
        delete globalThis.__discordFixture;
    }
});
