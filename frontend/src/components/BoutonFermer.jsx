// Bouton rond rouge à croix blanche : le même partout pour fermer une fenêtre.
// `coin` le place en haut à droite de la fenêtre (le parent doit être en position relative).
export default function BoutonFermer({ onClick, label = 'Fermer', coin = false, className = '', ...reste }) {
  return (
    <button type="button" className={`btn-fermer${coin ? ' btn-fermer--coin' : ''}${className ? ` ${className}` : ''}`} onClick={onClick} aria-label={label} title={label} {...reste}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="12" fill="var(--vermilion)" />
        <path d="M8.2 8.2l7.6 7.6M15.8 8.2l-7.6 7.6" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" fill="none" />
      </svg>
    </button>
  )
}
