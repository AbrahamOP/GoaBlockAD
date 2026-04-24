# Politique de confidentialité — GoaBlockAD

_Dernière mise à jour : 2026-04-24_

## En bref

**GoaBlockAD ne collecte, ne stocke et ne transmet aucune donnée personnelle à aucun serveur distant.**
Tout fonctionne 100 % localement sur votre navigateur.

## Données traitées localement

Les données suivantes sont stockées **uniquement** dans `chrome.storage.local` de votre navigateur, sur votre appareil :

| Donnée | Pourquoi | Partagée ? |
|---|---|---|
| Préférences on/off (blocage réseau, cosmétique) | Conserver votre configuration | Non |
| Compteur de publicités bloquées | Affichage statistique dans le popup | Non |
| Liste de filtres personnalisés (domaines saisis par vous) | Construire des règles `declarativeNetRequest` locales | Non |
| Whitelist de sites autorisés | Désactiver le blocage sur les sites choisis | Non |
| Top domaines bloqués | Affichage dans le dashboard | Non |
| État de pause (`pausedUntil`) | Pause temporaire de la protection | Non |

Ces données **ne quittent jamais votre navigateur**. Elles peuvent être effacées à tout moment via la désinstallation de l'extension ou le bouton *Réinitialiser* du dashboard.

## Permissions et justification

| Permission | Usage |
|---|---|
| `declarativeNetRequest` | Bloquer les requêtes publicitaires via des règles statiques et dynamiques. |
| `storage` | Enregistrer localement les préférences listées ci-dessus. |
| `alarms` | Reprendre automatiquement le blocage après une pause temporaire. |
| `activeTab` | Lire le domaine de l'onglet actif **uniquement quand vous cliquez sur l'icône** (pour proposer le bouton « Autoriser ici »). |
| `host_permissions: <all_urls>` | Appliquer les règles de blocage réseau et le nettoyage cosmétique sur tous les sites que vous visitez. Aucune donnée de navigation n'est lue, transmise ou stockée. |

## Ce que nous ne faisons PAS

- ❌ Pas de télémétrie, pas d'analytics, pas de tracking.
- ❌ Aucune requête réseau sortante vers nos serveurs (nous n'en avons pas).
- ❌ Pas d'historique de navigation collecté.
- ❌ Pas de vente ni de partage de données.
- ❌ Pas de cookies tiers implantés.

## Code open source

Le code source est entièrement auditable : https://github.com/AbrahamOP/GoaBlockAD

## Contact

Pour toute question, ouvrez une issue sur GitHub : https://github.com/AbrahamOP/GoaBlockAD/issues
