# Normal-Chrome release acceptance

Status: **NOT RUN**. Crunchyroll is unavailable through the developer browser. Automated fixture results do not complete this gate.

Use a normal Chrome profile where Crunchyroll already works. Load the exact unpacked build from `dist` through Chrome's Extensions page with Developer mode enabled. Do not disable site protections or copy account credentials into test fixtures.

## Record

- Commit / working-tree patch identifier:
- ZIP filename and SHA-256:
- Chrome version / OS:
- Date / tester:
- Account/playback test region (no account identifier):

## Procedure

1. With the extension disabled, open DevTools Network, preserve the log, and establish a baseline: home, popularity browsing, playback, seeking, captions, episode change, and watch-progress resume. Note destinations and initiators, without saving account headers or signed URLs in this record.
2. Enable the extension, reload, and confirm AniList remains off on first install and on upgrade from the upstream build. Repeat the baseline flow. There must be no AniList or extension-added analytics request.
3. Enable AniList. Open popularity browsing and verify ordering, pagination, locale/audio selection, and same-origin catalog lookups. Inspect the AniList payload and headers locally: fixed query/pagination only, no authorization/cookies/referrer or viewing/account data.
4. Disable AniList while browsing. Confirm no new ranking requests, original popularity results, and no stale ranking applied by late responses. Repeat across two open tabs and a reload.
5. Check playback start, DRM, quality, speed, seeking, subtitle switching/rendering, fullscreen, next episode, watch progress, and playback keepalive. Type in search/input fields and confirm shortcuts do not steal input focus.
6. Turn design changes off/on. Turn player enhancements off and reload. Verify native playback still works; re-enable and reload. Record any fallback warning and compare resulting traffic with the disabled-extension baseline.
7. Inspect Mux/Litix/EEC and other third-party destinations by initiator. The fork must add no analytics traffic. Distinguish original-site traffic from extension/replacement-player traffic; if attribution is unclear, leave the gate incomplete.

## Results

| Scenario                                      | Pass/fail | Redacted observations |
| --------------------------------------------- | --------- | --------------------- |
| Extension-disabled baseline                   | Not run   |                       |
| AniList default off / upgrade / multiple tabs | Not run   |                       |
| AniList opt-in / request metadata             | Not run   |                       |
| AniList off / cancellation / stale responses  | Not run   |                       |
| Playback / DRM / quality / speed / seek       | Not run   |                       |
| Captions / fonts / fullscreen / next episode  | Not run   |                       |
| Focus / settings / native playback / fallback | Not run   |                       |
| Progress / session keepalive                  | Not run   |                       |
| No added analytics / destination attribution  | Not run   |                       |

Do not publish raw HAR files, cookies, tokens, account identifiers, or signed media URLs. Keep only redacted destination/initiator summaries. A failed or incomplete row blocks release acceptance.

## Rollback

Disable the unpacked fork in Chrome's Extensions page and reload all Crunchyroll tabs. If needed, remove it and return to the previously installed extension/version. Do not leave two CrOptix copies enabled at once.
