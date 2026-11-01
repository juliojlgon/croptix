# CrOptix

A fork of [stratumadev/croptix](https://github.com/stratumadev/croptix) for Chrome/Chromium desktop: player controls, quality selection, soft subtitles, playback speeds, optional design changes, and optional AniList Trending. Licensed under AGPL-3.0; original attribution is preserved.

## Settings

Open the extension popup:

- **Design changes**: enabled by default; changes apply to open tabs.
- **Player enhancements**: enabled by default; reload Crunchyroll after changing it.
- **AniList Trending**: off by default, including upgrades without an explicit preference. Enable it to replace popularity order with public AniList rankings. AniList receives your IP/connection metadata, but no account data, authorization, viewing history, credentials, or page referrer. Disabling stops new requests and clears cached rankings.

Preferences stay in local extension storage. AniList errors or timeouts preserve Crunchyroll's original results. See [PRIVACY.md](PRIVACY.md) and the [data-flow review](docs/DATA_FLOW.md).

Fetch-based browsing waits up to five seconds for rankings. XHR is never delayed: a cold request can show Crunchyroll's original popularity until the ranking cache is ready. Disabling AniList does not require a reload.

## Build and install

Use **Bun 1.4.4** and **Node 26.12.0** (the CI versions). Install Bun from its official distribution, then:

```sh
bun install --frozen-lockfile
bun run build:v3
```

The unpacked Chrome extension is in `dist/`; the unsigned ZIP is in `build/` with a `-chrome.zip` suffix. Builds do not format or rewrite source. Packages contain sorted files and fixed ZIP timestamps for reproducible archives; signing keys are never generated or packaged.

In normal Chrome, open the Extensions page, enable Developer mode, choose **Load unpacked**, and select `dist`. Disable other CrOptix installations to avoid duplicate patches. A ZIP is an archive for inspection/distribution, not a signed Chrome Web Store installation.

Firefox targets remain available via `bun run build:amo` (MV3) and `bun run build:v2` (MV2). The first-version support and acceptance target is Chrome desktop. Rebuilding another target replaces `dist`, so rebuild Chrome before its browser tests.

## Checks

```sh
bun run format:check
bun run typecheck
bun run test
bun run build:v3
bunx playwright install chromium
bun run test:browser
```

Use `bun run pretty` explicitly when formatting changes. PR CI runs checks, compares two Chrome ZIP builds byte-for-byte, and tests the installed extension.

The browser suite uses Playwright's bundled Chromium with a persistent context and the production manifest. Synthetic Crunchyroll-shaped pages and API responses are supplied from disk before any request goes to the network; AniList is mocked and unexpected requests fail the test. This does not need access to live Crunchyroll or hide browser automation. Packaged subtitle worker/WASM/font behavior is tested separately from live account/DRM behavior.

Local results and the package checksum are recorded in [VALIDATION.md](docs/VALIDATION.md).

## Live acceptance and rollback

Live Crunchyroll is unavailable in the developer browser. Follow [the normal-Chrome acceptance record](docs/ACCEPTANCE.md) before declaring a release verified. It covers playback/DRM, episode navigation, controls, captions, progress/session requests, and destination/initiator comparisons with the extension disabled. Do not upload unredacted HARs, tokens, cookies, account data, or signed media URLs.

Rollback: disable this unpacked extension, reload Crunchyroll tabs, and re-enable the previously installed version if needed.

## Work tracking

[Implementation tracker](https://github.com/juliojlgon/croptix/issues/8): build/CI, opt-in privacy, offline browser testing, safe interception, controls/settings, permissions/data-flow audit, and normal-Chrome acceptance. Luna performed exploration; implementation is divided among build, privacy, and test agents with coordinator integration.
