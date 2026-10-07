/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Julian6513
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, ApplicationCommandOptionType, sendBotMessage } from "@api/Commands";
import { isPluginEnabled } from "@api/PluginManager";
import { Button } from "@components/Button";
import definePlugin from "@utils/types";
import { Menu, SelectedGuildStore } from "@webpack/common";

import { cancelCheck, getServers } from "./client";
import { openFinder } from "./FinderModal";

function resolveServer(input: string) {
    const needle = input.trim().toLocaleLowerCase();
    const servers = getServers();
    const byId = servers.find(server => server.id === input.trim());
    if (byId) return byId;
    const exact = servers.filter(server => server.name.toLocaleLowerCase() === needle);
    if (exact.length === 1) return exact[0];
    if (exact.length) throw new Error("Several servers have that name. Use the server ID or the picker.");
    const partial = servers.filter(server => server.name.toLocaleLowerCase().includes(needle));
    if (partial.length === 1) return partial[0];
    throw new Error(partial.length ? "That server name is ambiguous. Use the picker or server ID." : "Server not found. Choose one you belong to.");
}

export default definePlugin({
    name: "MutualServerFinder",
    description: "Find shared members of two servers with a searchable picker, paced client checks, and exports.",
    authors: [{ name: "Julian6513", id: 0n }],
    // Nonces correlate responses without changing membership access or gateway limits.
    // These are the same nonce-forwarding patches as Vencord's ImplicitRelationships.
    // When that plugin is enabled it already supplies them.
    patches: [
        {
            find: ".REQUEST_GUILD_MEMBERS,",
            predicate: () => !isPluginEnabled("ImplicitRelationships"),
            replacement: { match: /\.REQUEST_GUILD_MEMBERS,{/, replace: "$&nonce:arguments[1]?.nonce," }
        },
        {
            find: "GUILD_MEMBERS_REQUEST:",
            predicate: () => !isPluginEnabled("ImplicitRelationships"),
            replacement: { match: /presences:!!(\i)\.presences/, replace: "$&,nonce:$1.nonce" }
        },
        {
            find: ".not_found",
            predicate: () => !isPluginEnabled("ImplicitRelationships"),
            replacement: { match: /notFound:(\i)\.not_found/, replace: "$&,nonce:$1.nonce" }
        }
    ],
    commands: [{
        name: "mutualservers",
        description: "Open the mutual server member finder.",
        inputType: ApplicationCommandInputType.BUILT_IN,
        options: ["server-a", "server-b"].map(name => ({
            name, description: "Optional server name or ID", type: ApplicationCommandOptionType.STRING, required: false
        })),
        execute(args, ctx) {
            try {
                const a = args.find(arg => arg.name === "server-a")?.value as string | undefined;
                const b = args.find(arg => arg.name === "server-b")?.value as string | undefined;
                openFinder(a?.trim() ? resolveServer(a).id : SelectedGuildStore.getGuildId() ?? undefined, b?.trim() ? resolveServer(b).id : undefined);
            } catch (error) {
                sendBotMessage(ctx.channel.id, { content: error instanceof Error ? error.message : "Unable to open the finder." });
            }
        }
    }],
    settingsAboutComponent: () => <Button onClick={() => openFinder(SelectedGuildStore.getGuildId() ?? undefined)}>Open Mutual Server Finder</Button>,
    toolboxActions: { "Find mutual server members": () => openFinder(SelectedGuildStore.getGuildId() ?? undefined) },
    contextMenus: {
        "guild-context"(children, { guild }) {
            if (!guild) return;
            children.push(<Menu.MenuItem key="mutual-server-finder" id="mutual-server-finder" label="Find mutual members" action={() => openFinder(guild.id)} />);
        }
    },
    flux: {
        LOGOUT: cancelCheck,
        CONNECTION_CLOSED: cancelCheck,
        GUILD_DELETE: cancelCheck
    },
    stop: cancelCheck
});
