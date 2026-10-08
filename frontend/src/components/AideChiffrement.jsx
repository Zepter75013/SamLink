// Aide « Messages privés chiffrés » (reprise du chapitre de l'aide de SamParis12, adaptée à Sam Link).
export default function AideChiffrement() {
  return (
    <div className="samlink-aide">
      <p>
        Tes <b>messages privés</b> sont <b>chiffrés de bout en bout automatiquement</b>, sans rien à activer : seuls toi et ton
        interlocuteur pouvez les lire. Ni le serveur, ni le bureau, ni l'administrateur de la base n'y ont accès. Les photos,
        vidéos et documents envoyés en privé sont chiffrés aussi. Les <b>salons</b> (Tous les adhérents, Running…) ne sont pas chiffrés.
      </p>

      <h3>Le bouton 🔒</h3>
      <p>
        En haut de la liste des discussions, à côté du <b>＋</b>. Il ouvre les réglages du chiffrement. Une pastille te signale
        quand il y a quelque chose à faire :
      </p>
      <ul>
        <li><b>orange</b> : note ta clé de récupération ;</li>
        <li><b>rouge</b> : cet appareil est verrouillé, il faut le déverrouiller pour lire tes messages privés.</li>
      </ul>

      <h3>1. Noter ta clé de récupération (une seule fois)</h3>
      <p>
        À ta première connexion, Sam Link crée tes clés. Touche 🔒 › <b>Afficher ma clé de récupération</b>, note-la en lieu
        sûr (elle ressemble à XXXX-XXXX-XXXX-XXXX-XXXX), coche la case puis <b>Terminé</b>.
        <b> Personne ne peut la retrouver pour toi</b>, pas même le bureau.
      </p>

      <h3>2. Utiliser Sam Link sur un autre appareil</h3>
      <p>Sur un nouveau téléphone, ordinateur ou navigateur, la pastille est rouge. Deux possibilités :</p>
      <ol>
        <li>
          <b>Avec un appareil déjà déverrouillé</b> (le plus simple) : sur le <b>nouvel appareil</b>, 🔒 ›
          <b> Obtenir un code de liaison</b>. Un code s'affiche. Sur l'<b>ancien appareil</b>, 🔒 › <b>Lier un nouvel appareil</b>,
          puis saisis ce code (valable 5 minutes). Le nouvel appareil se déverrouille tout seul.
        </li>
        <li>
          <b>Avec ta clé de récupération</b> : sur le nouvel appareil, 🔒, puis tape ta clé (majuscules et tirets se mettent tout seuls).
        </li>
      </ol>
      <p className="samlink-aide__note">
        Les deux appareils doivent être connectés au même Sam Link (https://samlink.juliotte-app.fr).
      </p>

      <h3>3. Le cadenas d'une discussion privée</h3>
      <ul>
        <li>🔒 <b>Chiffré</b> : tout va bien.</li>
        <li>🔓 <b>Non chiffré</b> : ton interlocuteur ne s'est pas encore connecté à Sam Link ; vos messages restent en clair jusque-là.</li>
        <li>⚠️ <b>Clé modifiée</b> : sa clé a changé (nouvel appareil remis à zéro…). Vérifie-la avant d'écrire.</li>
        <li>🔒 <b>Verrouillé</b> : déverrouille cet appareil (voir 2).</li>
      </ul>
      <p>
        Touche le cadenas pour comparer l'<b>empreinte</b> (20 chiffres) avec celle de ton interlocuteur, de vive voix : si elles
        sont identiques, personne ne s'interpose. Sinon, touchez <b>Actualiser les clés</b> tous les deux.
      </p>

      <h3>4. En cas de problème</h3>
      <ul>
        <li>
          <b>Clé de récupération perdue</b>, mais un appareil encore déverrouillé : 🔒 › <b>Générer une nouvelle clé de récupération</b>.
          Tes messages sont conservés, l'ancienne clé ne marche plus.
        </li>
        <li>
          <b>Ni appareil déverrouillé, ni clé</b> : 🔒 › « Je n'ai ni autre appareil, ni clé de récupération » ›
          <b> Repartir de zéro</b>. Tes anciens messages chiffrés seront perdus ; tes interlocuteurs verront « Clé modifiée ».
        </li>
        <li><b>Ordinateur partagé</b> : avant de partir, 🔒 › <b>Effacer la clé de cet appareil</b>.</li>
      </ul>
      <p className="samlink-aide__note">
        Les notifications affichent « Message chiffré » sans le contenu. Les sondages et événements ne sont pas disponibles
        dans une discussion chiffrée.
      </p>
    </div>
  )
}
