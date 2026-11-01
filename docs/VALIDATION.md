# Implementation validation

Validated November 1, 2026, on macOS with Node 26.12.0, Bun 1.4.4, and Playwright 1.64.1. Based on upstream `aed100f862bbe28929d9c551eb27f7bb542a7d1f`; implementation branch: `codex/privacy-reliability`.

| Check                                                    | Result                                                                                                        |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Frozen dependency installation                           | Passed without lockfile changes                                                                               |
| Formatting, type checking, JavaScript syntax, whitespace | Passed                                                                                                        |
| Node unit/contract suite                                 | 41 passed, 0 failed                                                                                           |
| Installed-extension offline Chromium suite               | 7 passed, 0 failed                                                                                            |
| Packaged subtitle worker/WASM/font                       | Rendered nontransparent pixels; worker disposal passed                                                        |
| Two consecutive Chrome builds                            | Byte-for-byte identical ZIPs                                                                                  |
| ZIP CRC/integrity and content inspection                 | Passed; 90 files, storage-only permission, no test hosts, fixtures, node_modules directories, or signing keys |
| Firefox MV3 and MV2 build smoke checks                   | Passed; Chrome remains the acceptance target                                                                  |
| Live Crunchyroll/DRM and production destination audit    | **Not run; release gate remains open**                                                                        |

The browser suite loads the production manifest, fulfills synthetic Crunchyroll-origin documents and API responses, mocks AniList, and rejects unexpected HTTP/WebSocket destinations. It verifies default-off/legacy preferences, cross-tab opt-in and disabling, forged-consent rejection, DOM focus/lifecycle, player-setting reload behavior, and real packaged subtitle rendering. It does not exercise live Crunchyroll or prove production player compatibility.

The Node suite additionally covers origin restrictions, pagination and caches, timeouts, malformed/rate-limited replies, cancellation and late results, XHR lifecycle, webpack interception, dormant analytics registration, and original-player fallback/cleanup.

## Chrome artifact

```text
build/crunchyroll_enhancer_croptix-2.0.6-chrome.zip
size: 27020492 bytes
SHA-256: 285a9c00cc35dca313a98f23faed092563c7b76bef99e456be6e8fe2774e6b66
```

The artifact is unsigned and stays outside Git. Rebuild it using the README instructions. Follow [ACCEPTANCE.md](ACCEPTANCE.md) in normal Chrome before declaring live playback or production privacy verification complete. GitHub-hosted workflow results are separate from the local results above.
