// Genres de la base LaunchBox (en anglais) traduits pour l'affichage. Un genre absent
// de la table s'affiche tel quel.
const GENRE_LABELS = {
  Action: 'Action',
  Adventure: 'Aventure',
  "Beat 'em Up": 'Beat them all',
  'Board Game': 'Jeu de plateau',
  Casino: 'Casino',
  Compilation: 'Compilation',
  'Construction and Management Simulation': 'Gestion',
  Education: 'Éducatif',
  Fighting: 'Combat',
  'Flight Simulator': 'Simulation de vol',
  Horror: 'Horreur',
  'Life Simulation': 'Simulation de vie',
  MMO: 'MMO',
  Music: 'Musique',
  Other: 'Autre',
  Party: 'Party game',
  Pinball: 'Flipper',
  Platform: 'Plates-formes',
  Puzzle: 'Réflexion',
  Quiz: 'Quiz',
  Racing: 'Course',
  'Role-Playing': 'RPG',
  Sandbox: 'Bac à sable',
  Shooter: 'Tir',
  Sports: 'Sport',
  Stealth: 'Infiltration',
  Strategy: 'Stratégie',
  'Visual Novel': 'Visual novel'
}

export function genreLabel(genre) {
  return GENRE_LABELS[genre] || genre
}

// Genres présents dans la bibliothèque, avec leur nombre de jeux, triés par libellé.
// byGame : { <id du jeu>: { genres: [...] } }.
export function genreOptions(games, byGame) {
  const counts = new Map()
  for (const game of games) {
    for (const genre of byGame[game.id]?.genres || []) {
      counts.set(genre, (counts.get(genre) || 0) + 1)
    }
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, label: genreLabel(value), count }))
    .sort((a, b) => a.label.localeCompare(b.label, 'fr'))
}
