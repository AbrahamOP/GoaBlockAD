# GoaBlockAD 🛡️

**GoaBlockAD** est une extension Chrome performante et élégante pour bloquer les publicités.
Elle combine un blocage réseau efficace (Manifest V3) et un nettoyage visuel pour une expérience de navigation fluide.

![GoaBlockAD Icon](images/icon128.png)

## Fonctionnalités 🚀

*   **Blocage Réseau Avancé** : Utilise l'API `declarativeNetRequest` de Chrome pour bloquer les requêtes publicitaires avant même qu'elles ne chargent. Bloque Google, Amazon, Criteo, Taboola, et +20 autres réseaux majeurs.
*   **Nettoyage Visuel ("Cosmetic Filtering")** : Cache intelligemment les bannières vides et les espaces réservés aux publicités qui passent à travers le filtrage réseau.
*   **Design Premium** : Interface utilisateur moderne avec thème sombre, coins arrondis (Glassmorphism) et animations fluides.
*   **Statistiques en Temps Réel** : Compteur en direct des publicités bloquées directement dans l'icône et le popup.
*   **Confidentialité Totale** : Fonctionne 100% en local. Aucune donnée n'est envoyée sur des serveurs distants.

## Installation 🛠️

### Depuis le Chrome Web Store
(Lien à venir une fois publié)

### Installation Manuelle (Développement)
1.  Clonez ce dépôt :
    ```bash
    git clone https://github.com/VOTRE_PSEUDO/GoaBlockAD.git
    ```
2.  Ouvrez Google Chrome et allez sur `chrome://extensions`.
3.  Activez le **Mode développeur** (en haut à droite).
4.  Cliquez sur **Charger l'extension non empaquetée**.
5.  Sélectionnez le dossier `GoaBlockAD` cloné.

## Technologies 💻

*   **Manifest V3** : Conforme aux dernières normes de sécurité et de performance de Chrome.
*   **JavaScript (ES6+)** : Logique légère et rapide.
*   **CSS3** : Design moderne sans framework lourd.

## Publier une nouvelle version 🚀

Les releases sont **automatiques** : à chaque push/merge sur `main`, le workflow `.github/workflows/release.yml` lit la version de `manifest.json` et, si le tag `vX.Y.Z` correspondant n'existe pas encore, il :

1. Valide les JSON et la syntaxe JS.
2. Construit `GoaBlockAD-vX.Y.Z.zip` (sans `.git`, `.github`, `_metadata`).
3. Crée le tag Git + la release GitHub avec des notes auto-générées et le ZIP en asset.

**Pour publier** : bumpe le champ `version` dans `manifest.json`, commite, merge sur `main`. Terminé.

Une publication manuelle est aussi possible via **Actions → Release → Run workflow** (en précisant éventuellement une version à forcer).

## Contribuer 🤝

Les contributions sont les bienvenues ! N'hésitez pas à ouvrir une *Issue* ou une *Pull Request* pour suggérer des améliorations ou ajouter de nouvelles règles de blocage.

---
*Fait avec ❤️ et du code.*
