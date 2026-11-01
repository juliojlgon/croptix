# CrOptix fork privacy policy

Effective date: November 1, 2026

This policy describes this fork's extension behavior. Crunchyroll's website and services have their own privacy policies.

## Local preferences

Design changes and player enhancements are enabled by default. AniList Trending is disabled by default, including upgrades without an explicit AniList preference. Preferences are stored in the browser's local extension storage, not browser sync. The extension does not operate a developer server or add developer analytics.

Only feature booleans are passed from extension storage into the Crunchyroll page. The isolated content script also handles fixed public ranking requests from the page, checking the stored opt-in before networking. No extension settings are included in AniList requests.

## Optional AniList Trending

When you enable **AniList Trending** in the popup, public rankings replace Crunchyroll's popularity order. AniList receives a predefined GraphQL query, pagination values, and ordinary connection metadata such as your IP address and HTTP headers. Request origin and timing may indicate that you are using Crunchyroll or CrOptix.

The extension omits credentials and page referrers. It does not send AniList your account details, authorization headers, viewing history, current title, search terms, or extension preferences. Rankings and catalog mappings are cached only in the current page's memory.

Turning AniList off prevents new ranking requests, cancels outstanding requests where possible, and clears those caches. Cancellation cannot recall a request that has already reached AniList. Crunchyroll's original popularity results are used when AniList is disabled or unavailable.

AniList processes connection information under its [privacy policy](https://www.iubenda.com/privacy-policy/909656).

## Crunchyroll playback and functional assets

Crunchyroll/Sony services and their media delivery providers remain necessary for account access, playback, DRM, subtitles, localization, images, watch progress, and playback-session management. With AniList enabled, the extension also retrieves corresponding catalog objects from Crunchyroll's official API. Existing authorization headers are reused only for supported same-origin Crunchyroll catalog requests.

Subtitle rendering code, workers, WASM, and fonts are packaged with the extension. Selected subtitles and other functional media assets use URLs supplied by Crunchyroll. These may be hosted on media CDNs.

The replacement player's registered plugins provide watch-progress reporting and playback-session keepalive. Bundled Mux/EEC code is not registered by this fork. The original Crunchyroll player may run when enhancements are disabled or a compatibility failure triggers fallback; its own network behavior remains governed by Crunchyroll.

See [the data-flow review](docs/DATA_FLOW.md) for the audit boundary and remaining live-browser verification requirements. This fork does not claim to block all tracking by the Crunchyroll website or browser itself.

## Control and retention

You can change preferences in the popup, clear extension storage, or uninstall the extension. Reload open Crunchyroll pages after uninstalling or changing player enhancements. The developer receives no server-side user record to retain, sell, or delete.

Do not attach credentials, signed media URLs, cookies, or unredacted network captures to issues. Use the fork's issue tracker for extension questions and the respective service's privacy contact for information held by Crunchyroll or AniList.
