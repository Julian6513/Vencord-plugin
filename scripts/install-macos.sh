#!/usr/bin/env bash
set -euo pipefail

# Run from a downloaded source ZIP or a Git checkout. No GitHub credentials needed.
fail() {
    printf '\n%s\n' "$*" >&2
    exit 1
}

[[ "$(uname -s)" == "Darwin" ]] || fail "This installer is for macOS."

if ! xcode-select -p >/dev/null 2>&1; then
    xcode-select --install || true
    fail "Finish installing Apple's Command Line Tools, then run this command again."
fi
command -v git >/dev/null 2>&1 || fail "Git is missing. Install Apple's Command Line Tools, then try again."
command -v node >/dev/null 2>&1 || fail "Install Node.js 24 or newer from https://nodejs.org/en/download, reopen Terminal, then run this command again."
command -v npx >/dev/null 2>&1 || fail "npx is missing. Reinstall Node.js from https://nodejs.org/en/download."
node_major="$(node -p 'Number(process.versions.node.split(".")[0])')"
[[ "$node_major" -ge 24 ]] || fail "Node.js 24 or newer is required. Update Node.js, reopen Terminal, and try again."

repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
plugin_source="$repo_dir/src/userplugins/mutualServerFinder"
[[ -f "$plugin_source/index.tsx" ]] || fail "Plugin files are missing. Download and unzip the complete repository, then try again."

# Keep the checkout outside Documents, which may be managed by iCloud Drive.
vencord_dir="${MSF_VENCORD_DIR:-$HOME/Library/Application Support/MutualServerFinder/Vencord}"
revision="718c867256a9d181edc7a534afb296b9bb41ab58"
pnpm_version="11.9.0"

printf '\nPreparing Vencord in %s\n' "$vencord_dir"
if [[ ! -e "$vencord_dir" ]]; then
    mkdir -p -- "$(dirname -- "$vencord_dir")"
    git clone https://github.com/Vendicated/Vencord.git "$vencord_dir"
fi

[[ -d "$vencord_dir" ]] || fail "The destination is not a folder. Set MSF_VENCORD_DIR to a different location."
vencord_dir="$(cd -- "$vencord_dir" && pwd -P)"
printf 'Checking checkout location…\n'
checkout_root="$(git -C "$vencord_dir" rev-parse --show-toplevel 2>/dev/null)" || fail "The destination already exists but is not a Vencord checkout. Choose a different MSF_VENCORD_DIR."
[[ "$checkout_root" == "$vencord_dir" ]] || fail "The destination belongs to another Git checkout. Choose a different MSF_VENCORD_DIR."
printf 'Checking checkout origin…\n'
origin="$(git -C "$vencord_dir" remote get-url origin)"
case "$origin" in
    https://github.com/Vendicated/Vencord|https://github.com/Vendicated/Vencord.git|git@github.com:Vendicated/Vencord.git) ;;
    *) fail "The existing checkout has an unexpected origin. Choose a different MSF_VENCORD_DIR." ;;
esac
printf 'Checking for local changes. Git may take a while to read an existing checkout…\n'
git -C "$vencord_dir" diff --quiet && git -C "$vencord_dir" diff --cached --quiet || fail "The Vencord checkout has changes to tracked files. Save those changes or choose a different MSF_VENCORD_DIR."

printf 'Selecting the tested Vencord revision…\n'
if ! git -C "$vencord_dir" cat-file -e "$revision^{commit}" 2>/dev/null; then
    git -C "$vencord_dir" fetch --depth 1 origin "$revision"
fi
git -C "$vencord_dir" checkout --detach "$revision"

plugin_destination="$vencord_dir/src/userplugins/mutualServerFinder"
[[ ! -L "$vencord_dir/src/userplugins" && ! -L "$plugin_destination" ]] || fail "The plugin destination is a symbolic link. Use a normal folder instead."
mkdir -p -- "$plugin_destination"
cp -R "$plugin_source/." "$plugin_destination/"
# The first prototype used index.ts; leaving both entry points breaks plugin discovery.
if [[ -f "$plugin_destination/index.ts" ]]; then
    rm -- "$plugin_destination/index.ts"
fi

cd -- "$vencord_dir"
printf '\nInstalling dependencies and building MutualServerFinder…\n'
npx --yes "pnpm@$pnpm_version" install --frozen-lockfile
npx --yes "pnpm@$pnpm_version" build

printf '\nQuit Discord completely with Command-Q.\n'
read -r -p "Press Return to open the Vencord installer: " installer_ready
npx --yes "pnpm@$pnpm_version" inject

printf '\nAfter the installer reports success:\n'
printf '1. Open Discord → User Settings → Vencord → Plugins.\n'
printf '2. Enable MutualServerFinder, then quit and reopen Discord.\n'
printf '3. Run /mutualservers in a server channel to open the picker.\n'
