window.CROPTIX_BASE_URL = document.currentScript.getAttribute('data-base-url')
document.dispatchEvent(new Event('croptix:settings-request'))
