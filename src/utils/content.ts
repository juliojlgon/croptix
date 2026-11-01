import browser from './browser'

type PageSettings = { aniListEnabled: boolean; playerEnabled: boolean }
let page_settings: PageSettings | null = null
let settings_revision = 0
let crunchyroll_observer: MutationObserver | null = null
let mutation_timer: ReturnType<typeof setTimeout> | null = null
let focused_player_element: HTMLElement | null = null
const added_tabindexes = new Set<HTMLElement>()
const ani_list_requests = new Map<string, AbortController>()
const ani_list_query = `query ($firstPage: Int!, $secondPage: Int!) {
    first: Page(page: $firstPage, perPage: 50) {
        media(type: ANIME, sort: TRENDING_DESC, isAdult: false) { externalLinks { url } }
    }
    second: Page(page: $secondPage, perPage: 50) {
        media(type: ANIME, sort: TRENDING_DESC, isAdult: false) { externalLinks { url } }
    }
}`

function cancel_ani_list_requests() {
    for (const controller of ani_list_requests.values()) controller.abort()
    ani_list_requests.clear()
}

function send_ani_list_result(id: string, ok: boolean, data?: unknown) {
    document.dispatchEvent(new CustomEvent('croptix:anilist-response', { detail: { id, ok, ...(ok ? { data } : {}) } }))
}

function valid_request_id(id: unknown): id is string {
    return typeof id === 'string' && /^[\w-]{1,64}$/.test(id)
}

// MAIN-world events are public. Only isolated-world storage can grant consent;
// callers cannot choose a URL, query, headers, credentials or request body.
document.addEventListener('croptix:anilist-request', (event) => {
    const detail = (event as CustomEvent).detail
    const id: unknown = detail?.id
    if (!valid_request_id(id)) return
    const firstPage: unknown = detail?.firstPage
    const secondPage: unknown = detail?.secondPage
    if (
        !page_settings?.aniListEnabled ||
        ani_list_requests.size !== 0 ||
        typeof firstPage !== 'number' ||
        !Number.isInteger(firstPage) ||
        firstPage < 1 ||
        firstPage > 10 ||
        typeof secondPage !== 'number' ||
        !Number.isInteger(secondPage) ||
        secondPage < 1 ||
        secondPage > 10
    ) {
        send_ani_list_result(id, false)
        return
    }
    const controller = new AbortController()
    ani_list_requests.set(id, controller)
    const timer = setTimeout(() => controller.abort(), 5000)
    void (async () => {
        try {
            const settings = await browser.storage.local.get('aniListEnabled')
            if (settings.aniListEnabled !== true || !page_settings?.aniListEnabled || controller.signal.aborted) throw new Error('Disabled')
            const response = await fetch('https://graphql.anilist.co', {
                method: 'POST',
                credentials: 'omit',
                referrerPolicy: 'no-referrer',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ query: ani_list_query, variables: { firstPage, secondPage } }),
                signal: controller.signal
            })
            if (!response.ok) throw new Error('Unavailable')
            const json = await response.json()
            if (json.errors?.length || controller.signal.aborted || !page_settings?.aniListEnabled) throw new Error('Unavailable')
            const cleanPage = (page: unknown) => {
                const media = (page as { media?: unknown })?.media
                if (!Array.isArray(media) || media.length > 50) throw new Error('Invalid ranking')
                return {
                    media: media.map((item) => ({
                        externalLinks: Array.isArray(item?.externalLinks)
                            ? item.externalLinks
                                  .slice(0, 100)
                                  .filter((link: { url?: unknown }) => typeof link?.url === 'string' && link.url.length <= 2048)
                                  .map((link: { url: string }) => ({ url: link.url }))
                            : []
                    }))
                }
            }
            send_ani_list_result(id, true, { first: cleanPage(json.data?.first), second: cleanPage(json.data?.second) })
        } catch {
            send_ani_list_result(id, false)
        } finally {
            clearTimeout(timer)
            if (ani_list_requests.get(id) === controller) ani_list_requests.delete(id)
        }
    })()
})
document.addEventListener('croptix:anilist-cancel', (event) => {
    const id: unknown = (event as CustomEvent).detail?.id
    if (valid_request_id(id)) ani_list_requests.get(id)?.abort()
})

function publish_settings() {
    if (page_settings) document.dispatchEvent(new CustomEvent('croptix:settings', { detail: { ...page_settings } }))
}

// MAIN-world scripts may start before or after extension storage resolves.
document.addEventListener('croptix:settings-request', publish_settings)

const config = document.createElement('script')
config.src = browser.runtime.getURL('config_init.js')
config.dataset.baseUrl = browser.runtime.getURL('')
config.addEventListener('load', () => config.remove(), { once: true })
;(document.head || document.documentElement).appendChild(config)

function is_mobile_or_tablet() {
    const user_agent_data = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData
    return Boolean(
        user_agent_data?.mobile ||
        /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|Tablet/i.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
    )
}

if (is_mobile_or_tablet()) {
    const script = document.createElement('script')
    script.src = browser.runtime.getURL('mobile-fix.js')
    script.addEventListener('load', () => script.remove(), { once: true })
    ;(document.head || document.documentElement).appendChild(script)
}

function is_text_input_active() {
    const active_element = document.activeElement
    return (
        active_element instanceof HTMLInputElement ||
        active_element instanceof HTMLTextAreaElement ||
        active_element instanceof HTMLSelectElement ||
        (active_element instanceof HTMLElement && active_element.isContentEditable)
    )
}

function focus_crunchyroll_player(player_container: HTMLElement) {
    if (is_text_input_active()) return
    const focus_target = (player_container.children[1] as HTMLElement | undefined) ?? player_container
    // Preserve deliberate focus on links, buttons, dialogs and other player controls.
    const active = document.activeElement
    if (active && active !== document.body && active !== document.documentElement && active !== focused_player_element) return
    if (focused_player_element === focus_target || active === focus_target) return
    if (!focus_target.hasAttribute('tabindex')) {
        focus_target.tabIndex = -1
        added_tabindexes.add(focus_target)
    }
    focus_target.focus({ preventScroll: true })
    focused_player_element = focus_target
}

function update_player() {
    const player = document.querySelector<HTMLElement>('#player-container, .player-container')
    document.documentElement.classList.toggle('croptix-player', Boolean(player))
    for (const wrapper of document.querySelectorAll('video-player-wrapper')) {
        wrapper.classList.toggle('croptix-katamari', Boolean(player))
    }
    for (const element of added_tabindexes) {
        if (!element.isConnected) {
            element.removeAttribute('tabindex')
            added_tabindexes.delete(element)
        }
    }
    if (player) focus_crunchyroll_player(player)
    else focused_player_element = null
}

function start_observe_crunchyroll() {
    if (crunchyroll_observer) return
    update_player()
    // Coalesce bursts without dropping the final mutation.
    crunchyroll_observer = new MutationObserver(() => {
        if (mutation_timer !== null) return
        mutation_timer = setTimeout(() => {
            mutation_timer = null
            update_player()
        }, 100)
    })
    crunchyroll_observer.observe(document.documentElement, { childList: true, subtree: true })
}

function stop_observe_crunchyroll() {
    crunchyroll_observer?.disconnect()
    crunchyroll_observer = null
    if (mutation_timer !== null) clearTimeout(mutation_timer)
    mutation_timer = null
    document.documentElement.classList.remove('croptix-player')
    for (const wrapper of document.querySelectorAll('.croptix-katamari')) wrapper.classList.remove('croptix-katamari')
    for (const element of added_tabindexes) element.removeAttribute('tabindex')
    added_tabindexes.clear()
    focused_player_element = null
}

async function load_settings() {
    const revision = ++settings_revision
    try {
        const settings = await browser.storage.local.get(['designEnabled', 'aniListEnabled', 'playerEnabled'])
        if (revision !== settings_revision) return
        page_settings = {
            aniListEnabled: settings.aniListEnabled === true,
            // Replacing an active player is unsafe: changes take effect after reload.
            playerEnabled: page_settings?.playerEnabled ?? settings.playerEnabled !== false
        }
        document.documentElement.classList.toggle('croptix', settings.designEnabled !== false)
        if (settings.designEnabled !== false && page_settings.playerEnabled) start_observe_crunchyroll()
        else stop_observe_crunchyroll()
        publish_settings()
    } catch {
        // Fail closed for optional networking; retry on a later storage change.
        if (revision !== settings_revision) return
        page_settings = { aniListEnabled: false, playerEnabled: page_settings?.playerEnabled ?? false }
        cancel_ani_list_requests()
        publish_settings()
    }
}

void load_settings()
browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return
    if ('aniListEnabled' in changes && changes.aniListEnabled.newValue !== true) {
        if (page_settings) page_settings.aniListEnabled = false
        cancel_ani_list_requests()
        publish_settings()
    }
    if (['designEnabled', 'aniListEnabled', 'playerEnabled'].some((key) => key in changes)) void load_settings()
})
window.addEventListener('pagehide', () => {
    stop_observe_crunchyroll()
    cancel_ani_list_requests()
})
window.addEventListener('pageshow', () => void load_settings())
