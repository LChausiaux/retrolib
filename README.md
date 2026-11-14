# RetroLib

Bibliothèque de jeux et lanceur d'émulateurs pour une installation
[RomStation](https://www.romstation.fr/) (Windows), en Electron + Vue (electron-vite).

RetroLib lit le dossier des jeux de RomStation et les émulateurs qu'il a installés,
puis propose :

- une bibliothèque en grille, liste ou étagère de boîtes 3D, filtrable par plateforme,
  favoris et genre, avec une rubrique « Reprendre » (jeu en cours ou dernier joué, et les
  suivants) ;
- une fiche par jeu : résumé, genres, nombre de joueurs, note et date de sortie (base
  LaunchBox Games DB), temps de jeu et sessions ;
- le lancement direct dans le bon émulateur (décompression des zips RomStation à la
  demande, choix du disque pour les jeux multi-disques) ;
- la détection automatique des jeux ajoutés dans RomStation ;
- les jaquettes (recherche en ligne, dos et tranches depuis LaunchBox) ;
- des statistiques de jeu, la gestion des émulateurs et du stockage ;
- la navigation à la manette.

## Développement

```bash
npm install      # dépendances
npm run dev      # application en mode développement (rechargement à chaud)
npm test         # tests unitaires (Vitest, dossier tests/)
npm run lint     # ESLint
npm run build:win  # installeur Windows : dist/retrolib-<version>-setup.exe
```

## Organisation du code

- `src/main/` : processus principal Electron (scan des jeux et émulateurs, lancement,
  base LaunchBox, stats, réglages). Les réglages et les stats sont enregistrés dans
  `%APPDATA%/retrolib/` avec une écriture atomique et une copie de sauvegarde
  (`json-store.js`).
- `src/preload/` : API exposée à la page (`window.api`), seule passerelle vers le
  processus principal (fenêtre en bac à sable).
- `src/renderer/src/` : interface Vue. `App.vue` assemble les pages ; l'état est réparti
  dans `composables/` (bibliothèque, stats, lancement, jaquettes, fiches de jeu).
- `tests/` : tests des modules sans dépendance à Electron.

## Versions et mises à jour

Chaque modification incrémente la version de `package.json`
(`npm version <patch|minor> --no-git-tag-version`), reprise dans le nom de l'installeur.

Pour publier une version, pousser le tag correspondant (`git tag v2.4.1 && git push --tags`) :
le workflow GitHub Actions construit l'installeur et le publie dans les Releases. Les
RetroLib installées le téléchargent en arrière-plan et l'installent à la fermeture (ou
tout de suite depuis le bandeau « Redémarrer maintenant » / les Réglages).
