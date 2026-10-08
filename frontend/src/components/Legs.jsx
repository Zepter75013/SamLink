import { useEffect, useId, useRef, useState } from 'react'
import { ord } from './Ord.jsx'

// Borne kilométrique : kakemono du club (bandes en diagonale, « N Km », logo, « SAM PARIS 12 »).
// Grisé tant qu'il n'est pas la borne en cours, aux couleurs du club quand il l'est.
export function Borne({ n }) {
  // 4 bandes diagonales égales (même largeur, même écart), assez courtes pour ne pas toucher le texte du bas.
  const bandes = [0, 1, 2, 3].map((k) => {
    const c1 = 2 + 4.8 * k
    const c2 = c1 + 2.4
    return `M0 ${c1} L${(c1 / 0.6).toFixed(1)} 0 L${(c2 / 0.6).toFixed(1)} 0 L0 ${c2} Z`
  })
  const bande = bandes.map((d) => <path key={d} className="borne-red" d={d} />)
  return (
    <svg className="borne" viewBox="0 0 100 158" role="img" aria-label={`Kilomètre ${n}`}>
      <defs>
        <clipPath id="borne-clip"><rect x="2" y="5" width="96" height="141" /></clipPath>
      </defs>
      <rect className="borne-bar" x="0" y="0" width="100" height="5" rx="1.5" />
      <rect className="borne-panel" x="2" y="5" width="96" height="141" />
      <g clipPath="url(#borne-clip)">
        <g transform="translate(2 5)">{bande}</g>
        <g transform="translate(98 146) rotate(180)">{bande}</g>
      </g>
      <text className="borne-num" x="50" y="68">
        <tspan className="borne-n">{n}</tspan>
        <tspan className="borne-unit" dx="3">Km</tspan>
      </text>
      <image className="borne-logo" href="/logo.png" x="29" y="76" width="42" height="37.5" />
      <rect className="borne-red" x="22" y="119" width="56" height="2" />
      <text className="borne-club" x="50" y="135" textLength="60" lengthAdjust="spacingAndGlyphs">SAM PARIS 12</text>
      <rect className="borne-bar" x="0" y="146" width="100" height="6" rx="1.5" />
      <rect className="borne-bar" x="22" y="152" width="14" height="4" rx="1" />
      <rect className="borne-bar" x="64" y="152" width="14" height="4" rx="1" />
    </svg>
  )
}

// Petit coureur en maillot SAM (blanc à rayures rouges) qui court de borne en borne quand on fait défiler.
// Il suit la route : tout droit le long d'une borne, puis une courbe vers la suivante.
const PEAUX = ['#f1c7a1', '#8a5a3c'] // claire, foncée
const CHEVEUX_CLAIRS = ['#3a2a1d', '#d9b36a', '#1c1917', '#8a3b1d']

// Au hasard à chaque visite : homme ou femme, peau claire ou foncée.
export function tirerCoureur() {
  const pick = (a) => a[Math.floor(Math.random() * a.length)]
  const foncee = Math.random() < 0.5
  return { femme: Math.random() < 0.5, peau: PEAUX[foncee ? 1 : 0], cheveux: foncee ? '#1a1512' : pick(CHEVEUX_CLAIRS) }
}

// Le coureur lui-même (dessin SVG), utilisé par le petit coureur du défilement et par le mini-jeu.
export function RunnerFigure({ look, flag = true, walk = false }) {
  const cid = `rt${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  return (
    <svg viewBox="0 0 40 56" width="60" height="84">
      <defs>
        <clipPath id={cid}><path d="M14 14 L28 14 L27 33 L15 33 Z" /></clipPath>
      </defs>
      <ellipse className="runner-shadow" cx="20" cy="54" rx="11" ry="2" />
      <g className="runner-body">
        {flag && (
          <g className="runner-flame">
            <path className="runner-pole" d="M12.6 34 L11 -4" />
            <path className="runner-flag" d="M-8 -18 Q9 -19 11 -4 L11 22 L-7 25 Z" />
            <path className="runner-binding" d="M-8 -18 Q9 -19 11 -4 L11 22" />
            <text className="runner-flag-text" x="1.5" y="2" transform="rotate(-90 1.5 -4)">50</text>
            <text className="runner-flag-min" x="1.5" y="17.2" transform="rotate(-90 1.5 14)">min</text>
          </g>
        )}
        <g className="runner-arm runner-arm--b"><path d="M20 17 L13 26 L16 33" /><path className="runner-sleeve" d="M20 17 L16.8 21" /><path className="runner-cuff" d="M16.9 20.8 L16.1 21.8" /></g>
        <g className="runner-leg runner-leg--b"><path d="M20 35 L18 45 L21 53" /><path className="runner-shoe" d="M19 53 H25" /></g>
        <path className="runner-torso" d="M14 14 L28 14 L27 33 L15 33 Z" />
        <g clipPath={`url(#${cid})`}>
          <path className="runner-stripe" d="M12 22 L30 21 L30 24.2 L12 25.2 Z" />
          <path className="runner-stripe" d="M12 26.6 L30 25.6 L30 28.8 L12 29.8 Z" />
          <path className="runner-stripe" d="M12 31.2 L30 30.2 L30 33.4 L12 34.4 Z" />
        </g>
        <path className="runner-collar" d="M17 14.2 Q22 18 27 14.2" />
        {look.femme
          ? <path className="runner-shorts runner-skirt" d="M15.2 33 H26.8 L30.6 42.5 H11.4 Z" />
          : <path className="runner-shorts" d="M15 33 H27 L28 40.5 H14 Z" />}
        {look.femme && (
          <g className="runner-pony-g">
            <path className="runner-hair runner-pony" d="M17.4 4.2 Q7 1 8.2 13.5 Q8.8 18.4 12.4 19.6 Q12.6 11 17 7.2 Z" />
            <circle className="runner-tie" cx="15.6" cy="5.6" r="1.5" />
          </g>
        )}
        <circle className="runner-skin" cx="22" cy="8" r="5.2" />
        <path className="runner-hair" d="M16.8 8.4 Q16.4 2.6 22 2.6 Q27.8 2.6 27.2 7.6 Q23 4.6 16.8 8.4 Z" />
        <g className="runner-leg runner-leg--a"><path d="M23 35 L27 45 L23 53" /><path className="runner-shoe" d="M22 53 H28" /></g>
        <g className="runner-arm runner-arm--a"><path d="M24 17 L31 25 L28 31" /><path className="runner-sleeve" d="M24 17 L27.4 21" /><path className="runner-cuff" d="M27.2 20.8 L28 21.8" /></g>
        {walk && (
          <>
            <path className="runner-stick" d="M28 31 L37.5 54" />
            <path className="runner-stick" d="M16 33 L7.5 54" />
          </>
        )}
      </g>
    </svg>
  )
}

export function Runner() {
  const ref = useRef(null)
  const [look] = useState(tirerCoureur)

  useEffect(() => {
    const el = ref.current
    const box = el && el.parentElement
    if (!box) return undefined
    let raf = 0
    let stopTimer = 0
    let faceLeft = false
    let last = null

    const place = () => {
      raf = 0
      const markers = [...box.querySelectorAll('.leg__marker')]
      const legs = [...box.querySelectorAll('.leg')]
      if (markers.length < 2 || el.offsetParent === null) return
      const c = box.getBoundingClientRect()
      const cx = markers.map((m) => { const r = m.getBoundingClientRect(); return r.left + r.width / 2 - c.left })
      const cy = markers.map((m) => { const r = m.getBoundingClientRect(); return r.top + r.height / 2 - c.top })
      // Repère de lecture : le milieu de l'écran, qui descend vers la dernière borne quand on arrive en bas de page,
      // pour que le coureur l'atteigne même si la page ne peut pas défiler davantage.
      const vh = window.innerHeight
      const maxScroll = document.documentElement.scrollHeight - vh
      let frac = 0.5
      if (maxScroll > 0) {
        const fEnd = Math.min(Math.max((c.top + window.scrollY + cy[cy.length - 1] - maxScroll) / vh, 0.5), 0.92)
        const w = Math.min(Math.max((window.scrollY - (maxScroll - vh)) / vh, 0), 1)
        frac = 0.5 + (fEnd - 0.5) * (w * w * (3 - 2 * w))
      }
      const y = Math.min(Math.max(vh * frac - c.top, cy[0]), cy[cy.length - 1])
      let i = 0
      while (i < cy.length - 2 && y > cy[i + 1]) i += 1
      const bottom = legs[i].getBoundingClientRect().bottom - c.top
      const t = Math.min(Math.max((y - (bottom - 40)) / 80, 0), 1)
      const x = cx[i] + (cx[i + 1] - cx[i]) * (t * t * (3 - 2 * t))
      if (last !== null && Math.abs(x - last) > 0.4) faceLeft = x < last
      last = x
      // À hauteur d'une borne, le coureur se range à sa droite pour ne pas la cacher.
      const near = Math.min(...cy.map((v) => Math.abs(y - v)))
      const k = Math.min(Math.max(near / 80, 0), 1)
      const side = 52 * (1 - k * k * (3 - 2 * k))
      el.style.transform = `translate(${x + side - 30}px, ${y - 81}px)`
      el.classList.toggle('is-left', faceLeft)
    }

    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(place)
      el.classList.add('is-running')
      clearTimeout(stopTimer)
      stopTimer = setTimeout(() => el.classList.remove('is-running'), 180)
    }
    const onResize = () => { if (!raf) raf = requestAnimationFrame(place) }

    place()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onResize)
    const late = setTimeout(place, 600) // une fois polices et photos en place
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onResize)
      clearTimeout(stopTimer)
      clearTimeout(late)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [])

  return (
    <div
      className={`runner runner--page${look.femme ? ' is-woman' : ''}`}
      ref={ref}
      style={{ '--skin': look.peau, '--hair': look.cheveux }}
      onClick={() => window.dispatchEvent(new Event('sam-game'))}
      aria-hidden="true"
    >
      <RunnerFigure look={look} />
    </div>
  )
}

// Met en avant (calotte rouge) la borne la plus proche du milieu de l'écran.
export function useActiveLegs() {
  useEffect(() => {
    const legs = document.querySelectorAll('.leg')
    if (!('IntersectionObserver' in window) || legs.length === 0) return undefined

    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            legs.forEach((l) => l.classList.remove('is-active'))
            entry.target.classList.add('is-active')
          }
        })
      },
      { rootMargin: '-45% 0px -45% 0px' },
    )
    legs.forEach((l) => obs.observe(l))
    return () => obs.disconnect()
  }, [])
}

// Parcours de bornes : une section par borne, numérotées dans l'ordre.
// sections : [{ id?, eyebrow?, title?, wide?, children }]
export function Legs({ sections }) {
  useActiveLegs()
  return (
    <div className="shell legs legs--page">
      <div className="course-line" aria-hidden="true" />
      <Runner />
      {sections.map((s, i) => (
        <section className="leg" id={s.id} key={s.id ?? s.title ?? i}>
          <div className="leg__marker"><Borne n={i + 1} /></div>
          <div className={`leg__body${s.wide ? ' leg__body--wide' : ''}`}>
            {s.eyebrow && <p className="eyebrow">{s.eyebrow}</p>}
            {s.title && <h2>{ord(s.title)}</h2>}
            {s.children}
          </div>
        </section>
      ))}
    </div>
  )
}

// Découpe des blocs de texte en sections, à chaque titre du niveau demandé.
// Les blocs qui précèdent le premier titre forment une section d'introduction,
// titrée par le titre de tête s'il y en a un ; une introduction réduite à un
// titre est ignorée.
export function sectionsFromBlocks(blocks, level) {
  const sections = []
  let cur = null
  const intro = []
  for (const b of blocks) {
    if (b.t === level) {
      cur = { title: b.text, blocks: [] }
      sections.push(cur)
    } else if (cur) {
      cur.blocks.push(b)
    } else {
      intro.push(b)
    }
  }
  if (intro.length > 0) {
    const [head, ...rest] = intro
    const titled = head.t === 'h2' || head.t === 'h3'
    const body = titled ? rest : intro
    if (body.length > 0) sections.unshift({ title: titled ? head.text : undefined, blocks: body })
  }
  return sections
}
