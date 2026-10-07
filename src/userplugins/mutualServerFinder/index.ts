/*
 * MutualServerFinder - Vencord userplugin
 */

import { ApplicationCommandInputType, sendBotMessage } from "@api/Commands";
import definePlugin from "@utils/types";
import { GuildMemberStore, GuildStore, UserStore } from "@webpack/common";

function resolveGuild(input: string) {
    const needle = input.trim().toLowerCase();
    const guilds = Object.values(GuildStore.getGuilds());

    return guilds.find(g => g.id === input.trim())
        ?? guilds.find(g => g.name.toLowerCase() === needle)
        ?? guilds.find(g => g.name.toLowerCase().includes(needle));
}

function compareGuilds(firstId: string, secondId: string) {
    const first = new Set(GuildMemberStore.getMemberIds(firstId));
    const second = GuildMemberStore.getMemberIds(secondId);
    const mutualIds = second.filter(id => first.has(id));

    return {
        firstLoaded: first.size,
        secondLoaded: second.length,
        mutualIds
    };
}

export default definePlugin({
    name: "MutualServerFinder",
    description: "Find users present in two Discord servers you are a member of.",
    authors: [{ name: "Julian6513", id: 0n }],

    commands: [{
        name: "mutualservers",
        description: "Compare the currently loaded members of two servers.",
        inputType: ApplicationCommandInputType.BUILT_IN,
        options: [
            {
                name: "server-a",
                description: "First server name or ID",
                type: 3,
                required: true
            },
            {
                name: "server-b",
                description: "Second server name or ID",
                type: 3,
                required: true
            }
        ],

        execute: async (args, ctx) => {
            const aInput = args.find(a => a.name === "server-a")?.value as string;
            const bInput = args.find(a => a.name === "server-b")?.value as string;
            const a = resolveGuild(aInput);
            const b = resolveGuild(bInput);

            if (!a || !b) {
                sendBotMessage(ctx.channel.id, {
                    content: "I couldn't find one of those servers. Use its exact name or server ID."
                });
                return;
            }

            if (a.id === b.id) {
                sendBotMessage(ctx.channel.id, { content: "Choose two different servers." });
                return;
            }

            const result = compareGuilds(a.id, b.id);
            const names = result.mutualIds.slice(0, 40).map(id => {
                const user = UserStore.getUser(id);
                return user ? `${user.globalName ?? user.username} (@${user.username}) — ${id}` : id;
            });

            const extra = result.mutualIds.length > names.length
                ? `\n…and ${result.mutualIds.length - names.length} more.`
                : "";

            sendBotMessage(ctx.channel.id, {
                content:
                    `**${a.name} ↔ ${b.name}**\n` +
                    `Found **${result.mutualIds.length}** mutual users in Discord's currently loaded member data.\n` +
                    `Loaded: ${a.name} ${result.firstLoaded.toLocaleString()} • ${b.name} ${result.secondLoaded.toLocaleString()}\n\n` +
                    (names.length ? names.join("\n") + extra : "No matches in the currently loaded data.") +
                    "\n\n⚠️ Large-server results may be incomplete because Discord does not always load every guild member into the client."
            });
        }
    }]
});
