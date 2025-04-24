# Nuxt Intellisense

🎯 Une extension Visual Studio Code pour Nuxt 3 qui affiche automatiquement le nombre de références à vos composants, fonctions et composables.

## ✨ Fonctionnalités

- Affiche `X references` au-dessus des fonctions `export` ou `defineComponent()`
- Supporte `.vue` et `.ts`
- Clique sur la ligne pour afficher les références dans l’explorateur
- Parfait pour les projets Nuxt 3, composables, et code en architecture modulaire

## 🔧 Installation

1. Clone ce repo
2. Ouvre dans VS Code
3. Lancer en mode debug (`F5`)
4. Sur un fichier `.vue`, ajoute une fonction exportée ou un composant

## 📦 Packaging

Pour publier :

```bash
npm install -g vsce
vsce package
```

Et pour publier sur le marketplace (besoin d’un token) :

```bash
vsce publish
```
