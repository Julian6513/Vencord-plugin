/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Julian6513
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { FluxDispatcher, GuildMemberCountStore, GuildMemberStore, GuildStore, UserStore } from "@webpack/common";

import type { Chunk, Client, Server } from "./core";

export function getServers(): Server[] {
    return Object.values(GuildStore.getGuilds())
        .filter(guild => client.canAccess(guild.id))
        .map(guild => ({ id: guild.id, name: guild.name, memberCount: GuildMemberCountStore.getMemberCount(guild.id) || undefined }))
        .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

export const client: Client = {
    memberIds: guildId => GuildMemberStore.getMemberIds(guildId),
    isMember: (guildId, userId) => !!GuildMemberStore.getMember(guildId, userId)
        && !GuildMemberStore.isGuestOrLurker(guildId, userId),
    canAccess: guildId => !!GuildStore.getGuild(guildId) && !GuildMemberStore.isCurrentUserGuest(guildId),
    row(id, seedId, targetId) {
        const user = UserStore.getUser(id);
        return {
            id,
            username: user?.username ?? "",
            displayName: user?.globalName ?? user?.username ?? "Unknown user",
            seedNickname: GuildMemberStore.getNick(seedId, id) ?? "",
            targetNickname: GuildMemberStore.getNick(targetId, id) ?? "",
            avatar: user?.getAvatarURL(undefined, 64, false)
        };
    },
    request(guildId, userIds, nonce) {
        // Same dispatcher path used by ServerInfo / ImplicitRelationships.
        // Discord owns the gateway connection and access checks. No REST or token access.
        FluxDispatcher.dispatch({ type: "GUILD_MEMBERS_REQUEST", guildIds: [guildId], userIds, presences: false, nonce });
    },
    subscribe(callback) {
        const handler = ({ chunks }: { chunks?: Chunk[]; }) => callback(chunks ?? []);
        FluxDispatcher.subscribe("GUILD_MEMBERS_CHUNK_BATCH", handler);
        return () => FluxDispatcher.unsubscribe("GUILD_MEMBERS_CHUNK_BATCH", handler);
    }
};

let active: AbortController | undefined;

export function beginCheck() {
    if (active) throw new Error("A member check is already running. Stop it before starting another.");
    active = new AbortController();
    return active;
}

export function endCheck(controller: AbortController) {
    if (active === controller) active = undefined;
}

export function cancelCheck() {
    active?.abort();
}
