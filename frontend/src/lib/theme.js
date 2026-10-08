const STORAGE_KEY = 'samlink_theme'

export function getTheme() {
  try {
    return localStorage.getItem(STORAGE_KEY) || 'system'
  } catch {
    return 'system'
  }
}

export function applyTheme(theme) {
  if (theme === 'dark' || theme === 'light') {
    document.documentElement.setAttribute('data-theme', theme)
  } else {
    document.documentElement.removeAttribute('data-theme')
  }
}

export function setTheme(theme) {
  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    // stockage indisponible (navigation privée, etc.) : le thème reste appliqué pour la session en cours
  }
  applyTheme(theme)
}

export function initTheme() {
  applyTheme(getTheme())
}
