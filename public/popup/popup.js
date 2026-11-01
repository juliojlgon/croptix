const ext = typeof browser !== 'undefined' ? browser : chrome
const status = document.getElementById('settingsStatus')
const controls = [
    { element: document.getElementById('toggleDesign'), key: 'designEnabled', defaultValue: true },
    { element: document.getElementById('togglePlayer'), key: 'playerEnabled', defaultValue: true },
    { element: document.getElementById('toggleAniList'), key: 'aniListEnabled', defaultValue: false }
]

async function loadSettings() {
    try {
        const result = await ext.storage.local.get(controls.map(({ key }) => key))
        for (const { element, key, defaultValue } of controls) {
            element.checked = defaultValue ? result[key] !== false : result[key] === true
            element.disabled = false
        }
    } catch {
        status.textContent = 'Settings could not be loaded. Reopen this popup to retry.'
    }
}

for (const { element, key } of controls) {
    element.addEventListener('change', async () => {
        const previous = !element.checked
        element.disabled = true
        try {
            await ext.storage.local.set({ [key]: element.checked })
            status.textContent = key === 'playerEnabled' ? 'Saved. Reload Crunchyroll to apply player changes.' : 'Saved.'
        } catch {
            element.checked = previous
            status.textContent = 'Settings could not be saved. Try again.'
        } finally {
            element.disabled = false
        }
    })
}
void loadSettings()
