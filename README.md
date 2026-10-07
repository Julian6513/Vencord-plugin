# MutualServerFinder

A Vencord userplugin for finding users who appear in two Discord servers that your account belongs to.

## Current prototype

The first version adds the local slash command:

`/mutualservers server-a:<name or id> server-b:<name or id>`

It intersects Discord's currently loaded member IDs using Vencord's `GuildMemberStore`. It does not call bot-only guild member endpoints, use a user token directly, or bypass Discord access controls.

### Important limitation

Large Discord guilds are not necessarily fully cached by the desktop client. The prototype therefore labels its result as based on **currently loaded member data**. A later version can add a UI and use Discord's normal client-side member loading/search mechanisms where available.

## Install as a Vencord userplugin

Copy `src/userplugins/mutualServerFinder` into the same path in a Vencord source checkout, then build/inject Vencord using the official custom-plugin workflow.

## Planned

- Server picker UI
- Searchable result modal
- Avatar/display name/user ID
- Copy/export results
- Better completeness reporting for large servers
