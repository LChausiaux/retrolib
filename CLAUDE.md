# RetroLib

Application Electron + Vue (electron-vite) : bibliothèque de jeux et lanceur d'émulateurs
au-dessus d'une installation RomStation.

## Version de l'application

**À chaque modification du code, incrémenter la version de l'application** (champ
`version` de `package.json`, reprise par electron-builder dans le nom de l'installeur :
`dist/retrolib-<version>-setup.exe`).

- Utiliser `npm version <patch|minor|major> --no-git-tag-version` : met à jour
  `package.json` ET `package-lock.json` en une fois (le tag git est posé séparément,
  seulement pour publier une version, voir « Publication »).
- Semver :
  - `patch` (1.0.0 → 1.0.1) : correction de bug, optimisation, petit ajustement ;
  - `minor` (1.0.1 → 1.1.0) : nouvelle fonctionnalité ou évolution visible ;
  - `major` : seulement sur demande explicite.
- Une seule incrémentation par demande de l'utilisateur (pas une par fichier touché).
- Indiquer la nouvelle version dans le récapitulatif de fin de tâche.

## Build

- `npm run build:win` : installeur NSIS dans `dist/`.

## Publication et mise à jour automatique

- Dépôt : https://github.com/LChausiaux/retrolib (public : les applications installées
  y lisent les mises à jour sans compte).
- Les RetroLib installées se mettent à jour via electron-updater (`src/main/updater.js`)
  depuis les Releases GitHub.
- Publier une version : committer, puis poser et pousser le tag `v<version>` identique
  à `package.json` (`git tag v2.4.1 && git push && git push --tags`). Le workflow
  `.github/workflows/release.yml` construit l'installeur et crée la release.
- Ne pas changer `appId` dans `electron-builder.yml` : les installations existantes ne
  seraient plus mises à jour par-dessus.
