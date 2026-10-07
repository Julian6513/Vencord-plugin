import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { test } from "node:test";

test("Mac installer handles paths with spaces, upgrades the prototype, and refuses dirty checkouts", () => {
    const base = mkdtempSync(join(tmpdir(), "msf-mac-test-"));
    const bin = join(base, "mock tools");
    const destination = join(base, "Build with spaces", "Vencord");
    const log = join(base, "commands.log");
    mkdirSync(bin);
    const mocks = {
        uname: 'printf "Darwin\\n"',
        "xcode-select": 'exit 0',
        node: 'printf "%s\\n" "${MSF_MOCK_NODE_MAJOR:-24}"',
        npx: 'printf "%s\\n" "$*" >> "$MSF_MOCK_LOG"',
        git: `
if [ "$1" = "clone" ]; then /bin/mkdir -p "$3/.git"; exit 0; fi
checkout="$2"
shift 2
case "$1" in
    rev-parse) printf '%s\\n' "$checkout" ;;
    remote) printf 'https://github.com/Vendicated/Vencord.git\\n' ;;
    diff) exit "\${MSF_MOCK_DIRTY:-0}" ;;
    cat-file|checkout|fetch) exit 0 ;;
    *) exit 1 ;;
esac
`
    };
    for (const [name, body] of Object.entries(mocks)) writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
    const run = extra => spawnSync("bash", [resolve("scripts/install-macos.sh")], {
        input: "\n", encoding: "utf8",
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, MSF_VENCORD_DIR: destination, MSF_MOCK_LOG: log, ...extra }
    });
    try {
        const syntax = spawnSync("bash", ["-n", "scripts/install-macos.sh"], { encoding: "utf8" });
        assert.equal(syntax.status, 0, syntax.stderr);
        const install = run();
        assert.equal(install.status, 0, install.stderr);
        const plugin = join(destination, "src/userplugins/mutualServerFinder");
        assert.equal(readFileSync(join(plugin, "index.tsx"), "utf8"), readFileSync("src/userplugins/mutualServerFinder/index.tsx", "utf8"));
        assert.deepEqual(readFileSync(log, "utf8").trim().split("\n"), [
            "--yes pnpm@11.9.0 install --frozen-lockfile", "--yes pnpm@11.9.0 build", "--yes pnpm@11.9.0 inject"
        ]);
        const otherPlugin = join(destination, "src/userplugins/other.ts");
        writeFileSync(otherPlugin, "keep me");
        writeFileSync(join(plugin, "index.ts"), "old prototype");
        assert.equal(run().status, 0);
        assert.equal(readFileSync(otherPlugin, "utf8"), "keep me");
        assert.throws(() => readFileSync(join(plugin, "index.ts")));

        const before = readFileSync(log, "utf8");
        const dirty = run({ MSF_MOCK_DIRTY: "1" });
        assert.equal(dirty.status, 1);
        assert.match(dirty.stderr, /changes to tracked files/);
        assert.equal(readFileSync(log, "utf8"), before);
        const oldNode = run({ MSF_MOCK_NODE_MAJOR: "22" });
        assert.equal(oldNode.status, 1);
        assert.match(oldNode.stderr, /Node.js 24 or newer/);
    } finally {
        rmSync(base, { recursive: true, force: true });
    }
});
