// Service worker : permet l'installation de Sam Link comme application (PWA) et affiche les notifications push.
// Il ne met rien en cache : la messagerie en temps réel se comporte comme d'habitude. Seule une navigation qui
// échoue (téléphone hors connexion) affiche une courte page d'explication au lieu de l'erreur du navigateur.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

const HORS_CONNEXION = '<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sam Link</title></head>'
  + '<body style="font-family:system-ui,sans-serif;background:#17120e;color:#eee8e0;display:grid;place-items:center;min-height:100vh;margin:0;text-align:center;padding:1.5rem">'
  + '<div><h1 style="color:#f04c3e;margin:0 0 .5rem">Sam Link</h1><p>Pas de connexion pour le moment.<br>Vérifie ton réseau puis réessaie.</p>'
  + '<p><a href="/" style="color:#fff">Réessayer</a></p></div></body></html>'

self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return
  event.respondWith(fetch(event.request).catch(() => new Response(HORS_CONNEXION, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } })))
})

// Notifications push (nouveaux messages) : contenu envoyé par l'API (internal/notif).
self.addEventListener('push', (event) => {
  let d = {}
  try { d = event.data ? event.data.json() : {} } catch { d = { corps: event.data ? event.data.text() : '' } }
  event.waitUntil(self.registration.showNotification(d.titre || 'Sam Link', {
    body: d.corps || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: d.tag || undefined,       // une seule notification par discussion, remplacée à chaque message
    renotify: Boolean(d.tag),
    lang: 'fr',
    data: { url: d.url || '/' },
  }))
})

// Clic sur une notification : on réutilise l'onglet du site s'il est ouvert (sans le recharger), sinon on l'ouvre.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href
  event.waitUntil((async () => {
    const fenetres = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const site = fenetres.find((c) => new URL(c.url).origin === self.location.origin)
    if (site) {
      await site.focus()
      site.postMessage({ type: 'notification-ouvrir', url })
      return
    }
    await self.clients.openWindow(url)
  })())
})

