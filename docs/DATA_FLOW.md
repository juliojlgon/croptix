# Data-flow review

Baseline reviewed: upstream commit `aed100f862bbe28929d9c551eb27f7bb542a7d1f` (2.0.6). Luna explored both remote source and the clean local checkout. The fork's changes must also pass the automated checks described in the README.

## Destinations and purposes

| Destination | Trigger / purpose | Data boundary |
| --- | --- | --- |
| Browser local extension storage | Popup preferences | Feature booleans only; no sync or developer service |
| `graphql.anilist.co` | Explicit AniList opt-in and popularity browsing | Fixed public query and pagination; omit credentials/referrer; ordinary connection metadata is still exposed |
| `www.crunchyroll.com` | Existing site APIs; optional ranking-to-catalog lookup | Account/API headers stay on the supported Crunchyroll origin |
| Crunchyroll playhead/session services | Viewing progress and session keepalive | Necessary first-party playback behavior |
| `static.crunchyroll.com` | Localization, language ordering, skip-event metadata | Functional asset requests |
| `imgsrv.crunchyroll.com` and media/subtitle CDNs | Posters, media, previews, selected captions | URLs come from Crunchyroll media/configuration; live destinations require manual confirmation |
| Extension URLs and local blob URLs | Subtitle renderer, worker, WASM, fonts | Packaged assets; blob URLs are not remote uploads |

## Player and interception boundaries

The page scripts run in the MAIN world; the content script accesses extension storage in the isolated world. Their bridge carries feature booleans and bounded public ranking request/response messages. The host page is not a trusted security boundary: a page script can observe or spoof page-world events. The isolated broker checks the real stored AniList preference, accepts only integer pages 1–10, and fixes the destination, GraphQL query, and headers. Page-supplied settings cannot authorize networking. Do not put secrets or general privileged commands in that bridge. Player preferences still cross a public page-world event and are not protected against a hostile page script; this cannot bypass the isolated AniList consent check.

The player adaptation intercepts Next.js webpack chunks and depends on upstream module shapes. Its registered player plugins are playhead reporting and session keepalive. Mux and EEC implementations exist in the bundled source, but their creators are not registered. A string match for `litix.io` alone is not evidence of an actual transmission. Tests must guard registration and unexpected outbound attempts.

The original player is preserved for unsupported or failing patches. Native-site analytics and browser services remain outside the extension-added-traffic claim. Test both enhanced and fallback behavior against an extension-disabled baseline.

## Evidence and limits

Initial source checks confirmed the upstream AniList request path, its omitted credentials/referrer, and missing origin checks in response matching. A mocked test demonstrated that matching paths on unrelated origins were rewritten. Those checks used synthetic credentials and did not contact Crunchyroll or AniList.

Offline browser tests fulfill synthetic Crunchyroll-shaped pages/API responses before network access. They check the installed package's behavior, but cannot establish live DRM, account compatibility, current upstream module shapes, or every production CDN destination.

Chrome desktop on `www.crunchyroll.com` is the support target. Existing wildcard MAIN-world injection and the mobile user-agent workaround are retained for compatibility, but other subdomains and mobile behavior are not validated by the Chrome desktop suite. In particular, the legacy mobile workaround is independent of the new player toggle.

Live acceptance is recorded separately in [ACCEPTANCE.md](ACCEPTANCE.md). Until that record is completed, no claim of successful live playback or a complete production network audit should be made. Never upload raw account sessions or network captures to a scanning service.
