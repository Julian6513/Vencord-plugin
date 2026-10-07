# MutualServerFinder

Find people shared by two Discord servers you belong to. A custom Vencord userplugin with a searchable server picker, member results, progress reporting, and JSON/CSV exports.

## Use

Enable **MutualServerFinder** in Vencord's plugin settings, then restart Discord so its response-correlation patches can load.

Open it with any of these:

- `/mutualservers` — opens the picker without sending a message to the server.
- `/mutualservers server-a:<name or ID> server-b:<name or ID>` — optional preselected servers. Ambiguous names produce a local error; use IDs or the picker.
- Right-click a server and choose **Find mutual members**.
- The **Open Mutual Server Finder** button in the plugin settings, or Vencord Toolbox if enabled.

Pick two different servers, then choose **Find mutual members**. The plugin uses Discord's reported member counts to select the smaller server, regardless of picker order. If a count is unavailable, it falls back to loaded member counts.

For a 2,000-member server compared with a 40,000-member server, it starts with the smaller server's **currently loaded** member IDs. It checks the larger server's cache first, then asks Discord about the missing candidates in batches of up to 100. A fully loaded 2,000-member seed requires at most 20 targeted requests. The larger server's full roster is never requested. Requests start at least five seconds apart, with one request in flight. A missing or incomplete response stops the check after 15 seconds, without automatic retries.

**Compare cache only** makes no member requests. **Stop check** cancels future requests and keeps the results received so far. Closing the modal, disabling the plugin, logging out, losing the gateway connection, or receiving a guild-deletion event also cancels a running check.

Results include avatars when loaded, usernames, global display names, both server nicknames, and user IDs. Click **View profile** below a result's username to open Discord's normal profile window in the smaller server's context. Profiles are opened only when clicked, using Discord's existing profile UI. Search any of the result text fields. Results are paginated at 100 rows per page. Click an ID to copy it, or use **Copy IDs**, **Copy results**, **Export JSON**, and **Export CSV**. Copy/export includes all filtered matches across pages, not just the visible page. JSON includes the server IDs, check status, timestamp, candidate coverage, and caveats. CSV contains the member rows; import its user-ID column as text to avoid spreadsheet rounding.

## What completeness means

The report separates:

| Field | Meaning |
| --- | --- |
| Loaded candidates / reported members | The smaller server's cached roster compared with Discord's member-count estimate. |
| Matches | Positive membership evidence in both servers, from the cache or a correlated Discord member response. |
| Not found by Discord | A `notFound` response for a requested ID with the correct guild and request nonce. |
| Unresolved | Candidates Discord has not answered about, including unsent IDs after a stop. These are **not** classified as nonmembers. |
| Finished | Every loaded candidate was checked. It does **not** certify a complete server roster. |

Discord does not guarantee that a user's client has every member cached. Offline or otherwise unloaded members of the smaller server may be missing entirely. Open that server and load members through Discord's normal UI before starting a new check to include more candidates. This plugin does not scroll channels automatically, enumerate hidden members, sweep search prefixes, or claim a complete roster based on count equality. Every report and JSON export marks roster completeness as unverified (`exhaustive: false`). Even zero matches cannot prove the servers have no overlap.

Checks are snapshots rather than an atomic view: people can join or leave while a check is running. A `notFound` response describes the requested check, not a permanent membership status.

## Client mechanisms

Uses Vencord's `GuildStore`, `GuildMemberCountStore`, `GuildMemberStore`, and `UserStore`, plus the normal `GUILD_MEMBERS_REQUEST` → `GUILD_MEMBERS_CHUNK_BATCH` dispatcher path already used by Vencord's ServerInfo, PermissionsViewer, and ImplicitRelationships plugins.

The three small nonce-forwarding patches come from Vencord's existing ImplicitRelationships approach. They preserve request nonces so responses can be correlated; they do not change permissions, transport limits, or membership access. When ImplicitRelationships is enabled, its existing patches are used instead. Restart after changing either plugin's enabled state.

No token extraction, direct Discord REST requests, bot-only member-list endpoints, profile-request loops, separate gateway connection, selfbot session, access-control bypass, or rate-limit evasion. Discord still decides what the normal client request may return. A refused, dropped, or incompatible request remains unresolved and stops the run. The five-second spacing is a conservative application pace, not a promise that Discord will accept every request.

## Install on Mac with one command

Install Node.js 24 or newer, then download this repository's ZIP from GitHub and unzip it. In Terminal, from the extracted repository folder, run:

```bash
bash scripts/install-macos.sh
```

If you unzipped it in Downloads under the default folder name, you can run this from anywhere:

```bash
bash ~/Downloads/Vencord-plugin-main/scripts/install-macos.sh
```

The script checks the Mac tools, prepares the tested Vencord revision in `~/Library/Application Support/MutualServerFinder/Vencord`, copies the plugin, runs pnpm through npx, builds Vencord, and opens its installer. The build folder is outside Documents, which may be managed by iCloud Drive. An older checkout in Documents is left in place. The installer prints progress for its Git checks, including the local-change scan that can be slow on an existing checkout. It asks you to quit Discord before installing. If Apple's Command Line Tools are missing, it opens their installation prompt; finish that installation and rerun the same command. Node.js must already be installed. No global pnpm install or private-repository Git authentication is needed after downloading the ZIP.

When the installer reports success, reopen Discord, enable **MutualServerFinder** under **User Settings → Vencord → Plugins**, restart Discord, and run `/mutualservers`.

The script leaves other userplugins alone and refuses an existing Vencord checkout with changes to tracked files. To choose another build folder, set `MSF_VENCORD_DIR` before running it. This installer has been syntax-checked and tested with mocked Mac tools; it has not been run against a real Mac Discord installation.


## Install / update on Windows

This repository contains a userplugin, not a standalone Discord bot or a prebuilt Vencord installer. Use [Vencord's custom-plugin instructions](https://docs.vencord.dev/installing/custom-plugins/). Install Git, Node.js 24 or later, and pnpm first.

From the folder where you want the two checkouts, run PowerShell:

```powershell
git clone https://github.com/Vendicated/Vencord.git
git clone https://github.com/Julian6513/Vencord-plugin.git
New-Item -ItemType Directory -Force .\Vencord\src\userplugins | Out-Null
Copy-Item -Recurse -Force .\Vencord-plugin\src\userplugins\mutualServerFinder .\Vencord\src\userplugins\
Set-Location .\Vencord
pnpm install --frozen-lockfile
pnpm build
pnpm inject
```

Because this repository is private, Git may ask you to sign in to GitHub. Downloading its source ZIP while signed in is another way to get the plugin folder.

When updating an installation of the first prototype, **replace the existing `src/userplugins/mutualServerFinder` folder completely**. In particular, remove its old `index.ts`; the new entry point is `index.tsx`. Rebuild, reinject, and restart Discord. Updating the GitHub repository alone does not update your installed Vencord.

## Validation

Validated against Vencord `718c867256a9d181edc7a534afb296b9bb41ab58` (version 1.15.10) on October 7, 2026.

```sh
# In this repository: Node 24+
npm ci
npm test

# In a Vencord checkout containing the plugin
pnpm testTsc
pnpm exec eslint src/userplugins/mutualServerFinder
pnpm build
pnpm buildWeb
```

The tests cover the 2k/40k ordering and batching, cache reuse, nonce/guild filtering, split responses, positive evidence without nonce support, unanswered responses, cancellation, failures, access changes, pacing, search, and export escaping. A React/jsdom interaction test exercises the actual modal and client adapter with mocked Discord stores/dispatcher: server selection, pagination, search, copy/download, clipboard failure, stop, and unmount cleanup.

Desktop/web builds and TypeScript checks use actual Vencord sources. Discord's authenticated gateway and minified patch targets cannot be exercised by these offline tests; the nonce patterns were checked against current Vencord source, but a live Discord check is still needed after installation. If Discord changes the dispatcher or patch targets, unsupported checks stop as unresolved. CI repeats the tests and both builds against the pinned Vencord revision.
