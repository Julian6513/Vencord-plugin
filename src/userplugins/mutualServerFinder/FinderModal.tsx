/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Julian6513
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { copyToClipboard } from "@utils/clipboard";
import { saveFile } from "@utils/web";
import type { RenderModalProps } from "@vencord/discord-types";
import { GuildMemberCountStore, GuildMemberStore, GuildStore, Modal, openModal, openUserProfileModal, useEffect, useRef, useState, useStateFromStores } from "@webpack/common";

import { beginCheck, client, endCheck, getServers } from "./client";
import { createComparison, exportCsv, exportJson, filterRows, type Report, type Server } from "./core";

const PAGE_SIZE = 100;

function ServerPicker({ label, servers, value, onChange, disabled }: {
    label: string; servers: Server[]; value: string; onChange: (id: string) => void; disabled: boolean;
}) {
    const [search, setSearch] = useState("");
    const needle = search.trim().toLocaleLowerCase();
    const choices = servers.filter(server => server.id === value || `${server.name} ${server.id}`.toLocaleLowerCase().includes(needle));
    return (
        <label className="msf-picker">
            <span>{label}</span>
            <input aria-label={`Search ${label.toLowerCase()}`} placeholder="Search name or server ID" value={search}
                disabled={disabled} onChange={event => setSearch(event.target.value)} />
            <select aria-label={label} value={value} disabled={disabled} onChange={event => onChange(event.target.value)}>
                <option value="">Choose a server</option>
                {choices.map(server => <option key={server.id} value={server.id}>
                    {server.name} · {server.memberCount?.toLocaleString() ?? "unknown"} members · {server.id}
                </option>)}
            </select>
        </label>
    );
}

export function FinderModal({ initialA = "", initialB = "", ...modalProps }: RenderModalProps & { initialA?: string; initialB?: string; }) {
    const servers = useStateFromStores([GuildStore, GuildMemberCountStore, GuildMemberStore], getServers);
    const [aId, setAId] = useState(initialA);
    const [bId, setBId] = useState(initialB);
    const [report, setReport] = useState<Report>();
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState("");
    const [query, setQuery] = useState("");
    const [page, setPage] = useState(0);
    const controller = useRef<AbortController | null>(null);
    const mounted = useRef(true);
    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
            controller.current?.abort();
        };
    }, []);
    const a = servers.find(server => server.id === aId);
    const b = servers.find(server => server.id === bId);
    const filtered = filterRows(report?.rows ?? [], query);
    const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    const currentPage = Math.min(page, pages - 1);
    const visible = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

    function changeServer(update: (id: string) => void, id: string) {
        update(id);
        setReport(undefined);
        setNotice("");
        setPage(0);
    }

    async function compare(check: boolean) {
        if (!a || !b || busy) return;
        setNotice("");
        setPage(0);
        setQuery("");
        let runController: AbortController | undefined;
        try {
            const comparison = createComparison(client, a, b);
            if (check) {
                runController = beginCheck();
                controller.current = runController;
                setBusy(true);
            }
            setReport(comparison.snapshot());
            if (runController) await comparison.run(runController.signal, value => {
                if (mounted.current) setReport(value);
            });
        } catch (error) {
            if (mounted.current) setNotice(error instanceof Error ? error.message : "Unable to start the check.");
        } finally {
            if (runController) endCheck(runController);
            controller.current = null;
            if (mounted.current) setBusy(false);
        }
    }

    async function copy(text: string, description: string) {
        try {
            await copyToClipboard(text);
            if (mounted.current) setNotice(`Copied ${description}.`);
        } catch {
            if (mounted.current) setNotice("Clipboard unavailable. Use the JSON or CSV download instead.");
        }
    }

    function download(format: "json" | "csv") {
        if (!report) return;
        try {
            const content = format === "json" ? exportJson(report, filtered, query) : exportCsv(filtered);
            saveFile(new File([content], `mutual-members-${report.seed.id}-${report.target.id}.${format}`,
                { type: format === "json" ? "application/json" : "text/csv;charset=utf-8" }));
            if (format === "csv") setNotice("CSV contains the filtered matches. Use JSON to include completeness and check status. Import user IDs as text in spreadsheets.");
        } catch {
            setNotice("Download failed. Try copying results instead.");
        }
    }

    async function viewProfile(userId: string) {
        if (!report) return;
        setNotice("");
        try {
            await openUserProfileModal({ userId, guildId: report.seed.id });
        } catch {
            if (mounted.current) setNotice("Discord couldn't open that profile. You can still copy the user ID.");
        }
    }

    return (
        <Modal {...modalProps} size="xl" title="Mutual Server Finder" subtitle="Compare two servers you belong to">
            <div className="msf-body">
                <div className="msf-pickers">
                    <ServerPicker label="First server" servers={servers} value={aId} disabled={busy} onChange={id => changeServer(setAId, id)} />
                    <ServerPicker label="Second server" servers={servers} value={bId} disabled={busy} onChange={id => changeServer(setBId, id)} />
                </div>
                <p className="msf-muted">Starts with the smaller server's loaded members. Checks missing IDs in the larger server in batches of up to 100, at least 5 seconds apart. Stops on an unanswered batch.</p>
                <div className="msf-actions">
                    <Button disabled={!a || !b || aId === bId || busy} onClick={() => compare(true)}>Find mutual members</Button>
                    <Button variant="secondary" disabled={!a || !b || aId === bId || busy} onClick={() => compare(false)}>Compare cache only</Button>
                    {busy && <Button variant="dangerSecondary" onClick={() => controller.current?.abort()}>Stop check</Button>}
                </div>
                {aId && aId === bId && <p role="alert">Choose two different servers.</p>}
                {notice && <p className="msf-notice" role="status">{notice}</p>}
                {report && <>
                    <section className="msf-summary" aria-label="Completeness report">
                        <strong>{report.seed.name} → {report.target.name}</strong>
                        <p>Smaller server: {report.candidates.toLocaleString()} loaded candidates / {report.seed.memberCount?.toLocaleString() ?? "unknown"} reported members.</p>
                        <p>Larger server: {report.target.memberCount?.toLocaleString() ?? "unknown"} reported members. Its full roster is not requested.</p>
                        <div className="msf-stats">
                            <span><b>{report.matched.toLocaleString()}</b> matches</span>
                            <span><b>{report.notFound.toLocaleString()}</b> not found by Discord</span>
                            <span><b>{report.unresolved.toLocaleString()}</b> unresolved</span>
                        </div>
                        <progress aria-label="Resolved candidate checks" value={report.matched + report.notFound} max={Math.max(1, report.candidates)} />
                        <p role="status">{report.status} · {report.requested.toLocaleString()} IDs requested · {report.message}</p>
                        <p className="msf-muted">Roster completeness unverified. Unknown users are not treated as nonmembers. These are membership snapshots; people can join or leave during a check. To include more candidates, load members in the smaller server using Discord, then run a new check.</p>
                    </section>
                    <label className="msf-result-search">Search matches
                        <input placeholder="Username, display name, nickname, or user ID" value={query}
                            onChange={event => { setQuery(event.target.value); setPage(0); }} />
                    </label>
                    <div className="msf-actions">
                        <Button size="small" variant="secondary" disabled={!filtered.length} onClick={() => copy(filtered.map(row => row.id).join("\n"), `${filtered.length} user IDs`)}>Copy IDs</Button>
                        <Button size="small" variant="secondary" onClick={() => copy(exportJson(report, filtered, query), "results and completeness report")}>Copy results</Button>
                        <Button size="small" variant="secondary" onClick={() => download("json")}>Export JSON</Button>
                        <Button size="small" variant="secondary" onClick={() => download("csv")}>Export CSV</Button>
                    </div>
                    <p className="msf-muted">{filtered.length.toLocaleString()} of {report.matched.toLocaleString()} matches shown. Copy and export use the current search.</p>
                    <div className="msf-table-wrap">
                        <table className="msf-table">
                            <thead><tr><th>User</th><th>Nicknames (smaller / larger)</th><th>User ID</th></tr></thead>
                            <tbody>{visible.map(row => <tr key={row.id}>
                                <td><div className="msf-user">{row.avatar && <img src={row.avatar} alt="" width="32" height="32" loading="lazy" />}
                                    <div><strong>{row.displayName}</strong><span className="msf-muted">{row.username ? `@${row.username}` : "Username not loaded"}</span>
                                        <button className="msf-profile" aria-label={`View profile of ${row.displayName}`} onClick={() => viewProfile(row.id)}>View profile</button>
                                    </div></div></td>
                                <td><div>{row.seedNickname || "—"}</div><div className="msf-muted">{row.targetNickname || "—"}</div></td>
                                <td><button className="msf-id" title="Copy user ID" onClick={() => copy(row.id, "user ID")}>{row.id}</button></td>
                            </tr>)}</tbody>
                        </table>
                        {!visible.length && <p className="msf-empty">{query ? "No matches for this search." : "No verified matches yet. Unresolved or unloaded members may still overlap."}</p>}
                    </div>
                    <div className="msf-actions msf-pagination">
                        <Button size="small" variant="secondary" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</Button>
                        <span>Page {currentPage + 1} of {pages}</span>
                        <Button size="small" variant="secondary" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>Next</Button>
                    </div>
                </>}
            </div>
        </Modal>
    );
}

export function openFinder(initialA?: string, initialB?: string) {
    openModal(props => <ErrorBoundary><FinderModal {...props} initialA={initialA} initialB={initialB} /></ErrorBoundary>,
        { modalKey: "mutual-server-finder" });
}
