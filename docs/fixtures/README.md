# Photos de test

Premières pièces du jeu d'évaluation prévu au point 1 de la feuille de route.
Chaque photo vient avec sa vérité terrain, relevée sur les étiquettes du
rayon, pour qu'un résultat puisse être jugé au lieu d'être admiré.

Toutes sont à la résolution que le navigateur envoie réellement : le client
redimensionne à 2000 px maximum avant l'analyse.

## `rayon-chips-fr.jpg` — France, 2000×563

Rayon chips Bret's d'un supermarché français.
Photo de **XIIIfromTOKYO**, 29 janvier 2025, **CC BY-SA 4.0**,
recadrée depuis l'original 4624×3472.
<https://commons.wikimedia.org/wiki/File:Chips_Bret%27s_20250129.jpg>

Neuf facings pour **cinq références**.

| Produit Bret's | Prix | Quantité | €/kg attendu |
|---|---|---|---|
| Au Bleu d'Auvergne AOP | 2,09 € | 125 g | 16,72 |
| Saveur Camembert | 1,64 € | 125 g | 13,12 |
| Chèvre piment d'Espelette | 1,19 € | 125 g | 9,52 |
| Saveur Cèpes | *aucune étiquette* | — | — |
| Fromage du Jura | 1,08 € | 125 g | 8,64 |

Meilleur prix attendu : **Fromage du Jura, 8,64 €/kg**.

Ce que cette photo met à l'épreuve :

1. **Regroupement** — le Camembert occupe trois sachets, le Bleu d'Auvergne
   et le Chèvre deux chacun.
2. **Étiquette décalée** — celle du Fromage du Jura est posée sous le sachet
   *Cèpes*, alors que son libellé dit « CHIPS FROMAGE JURA 125G ». Le prompt
   demande d'associer au produit « directement au-dessus **ou désigné par son
   libellé** » : une association par simple position se trompera.
3. **Produit sans prix** — les Cèpes n'ont aucune étiquette. Attendu :
   `price: null` et un signalement, jamais une valeur supposée.
4. **Rangées voisines** — le haut et le bas de l'image montrent d'autres
   sachets avec leurs propres étiquettes, qui ne doivent pas être comptés.

C'est la seule photo en euros, et la seule dont les marques soient bien
couvertes par Open Food Facts : elle est donc la seule à pouvoir exercer
l'enrichissement nutritionnel, et avec lui les catégories « meilleure
composition » et « meilleur compromis ».

## `rayon-cereales-no.jpg` — Norvège, 1560×540

Rayon petit-déjeuner d'un SPAR à Tjøme.
Photo de **Wolfmann**, 31 août 2023, **CC BY-SA 4.0**, recadrée depuis
l'original 5770×7694.
<https://commons.wikimedia.org/wiki/File:SPAR_kolonial_mat_varehandel_hyller_(Supermarket_interior_GROCERY_store_aisle_shelves)_Frokostblandinger_gryn_gr%C3%B8t_kjeks_m%C3%BCsli_Axa_(cereals_oatmeal_biscuits,_muesli)_etc_Tj%C3%B8me_NORWAY_2023-08-31_IMG_1093.jpg>

Sept facings pour **trois références**. Les étiquettes portent le prix au
kilo, ce qui permet de vérifier le calcul de l'application.

| Produit AXA | Prix | Pr/KG affiché | Quantité déduite |
|---|---|---|---|
| Müsli Blåbær | 49,90 | 79,21 | 630 g |
| Gold Berries Müsli | 79,90 | 110,21 | 725 g |
| Müsli Hasselnøtt | 34,90 | 58,17 | 600 g |

**Limite** : prix en couronnes, alors que le prompt demande une photo
française et que l'interface affiche « € ». La mécanique se teste
entièrement, l'unité monétaire affichée est fausse. Les marques nordiques ne
trouvent pas de correspondance Open Food Facts, donc aucun score de
composition.

### Résultat mesuré le 2026-09-23 (`gpt-4.1-mini`, 8,5 s)

Réussi : regroupement 7 → 3 facings, identification 3/3, lecture des trois
prix 3/3, association 3/3 malgré un « Gold Müsli Energi » au nom très proche
sur la rangée du dessous, promotion « NYHET! » captée.

Une erreur : quantité du Blåbær lue à **790 g** au lieu de 630 g — les
chiffres du Pr/KG 79,21 de la même étiquette, confondus avec la contenance.

Cette erreur en révèle une autre, de conception : le prix au kilo est
recalculé depuis prix ÷ quantité dès que les deux existent, ce qui a écarté
le 79,21 correct lu sur l'étiquette au profit d'un 63,16 dérivé d'une
quantité fausse — **20 % d'écart, avec une confiance de 0,9 et aucun
signalement**. Une incohérence entre le prix au kilo lu et le prix au kilo
calculé devrait déclencher une vérification.

## `rayon-cereales-no-complet.jpg` — Norvège, 1920×2560

Le rayon entier dont la photo précédente est un recadrage. Cas difficile,
**hors du périmètre documenté** : beaucoup plus de huit références, étiquettes
plus petites. Sert à observer comment la chaîne se dégrade quand le cadrage
ne respecte pas la consigne, pas à mesurer une réussite.

## Réutilisation

Les trois photos sont sous **CC BY-SA 4.0**. Toute reproduction doit citer
l'auteur et conserver la licence. Elles ne sont ici que comme matériel de
test ; elles ne font pas partie de l'application distribuée.
