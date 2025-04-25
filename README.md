# Nuxt Intellisense

🌟 A Visual Studio Code extension for Nuxt 3 that **automatically displays the number of references** to your components, functions, and composables — directly in your editor.

## ✨ Features

- 📌 Displays `X references` above exported functions and `defineComponent()` declarations
- 📂 Supports both `.vue` and `.ts` files
- 🗁 Clickable — jump to all references in the built-in VS Code references panel
- 🧠 Tailored for Nuxt 3 projects, modular architecture, and clean composable usage
- ⚡️ Lightweight and non-intrusive — works seamlessly as you code

## 🧪 How It Works

This extension parses your Nuxt 3 codebase and provides **inline reference counts** for key exports:

- `export const myComposable = ...`
- `export default defineComponent({ ... })`
- `defineComponent(() => { ... })`

Each count links to the built-in **"Find References"** functionality of VS Code, making it easier to navigate large codebases with composables and components split across modules.

## 🚀 Installation (Development)

1. Clone this repository:

   ```bash
   git clone https://github.com/merite15/nuxt-intellisense
   cd nuxt-intellisense
   ```

2. Open the folder in **Visual Studio Code**.

3. Press `F5` to launch the extension in a new **Extension Development Host** window.

4. Open a `.vue` or `.ts` file and export a function or component to see reference counts in action.

## 📆 Packaging

To package the extension for distribution:

```bash
npm install -g vsce
vsce package
```

This will generate a `.vsix` file that you can install or share.

## 💲 Publishing to the Marketplace

1. Make sure you’ve created a **publisher** on the [Visual Studio Marketplace](https://marketplace.visualstudio.com/manage).

2. Login using `vsce`:

   ```bash
   vsce login <publisher-name>
   ```

3. Publish the extension:
   ```bash
   vsce publish
   ```

## 📚 Example Use Case

Here's an example of how it looks in your editor:

```ts
// 1 utilisation du composable
export const useDriver = () => { ... }
```

```vue
<script setup lang="ts">
const driver = useDriver();
</script>
```

You’ll instantly see where `useDriver` is used, right from the definition.

## 🛠 Tech Stack

- TypeScript
- VS Code Extension API

## 💡 Why?

In large Nuxt 3 codebases, especially with modular architecture and heavy use of composables, tracking references becomes hard. This tool bridges that gap, giving you **context-aware visibility** at a glance.

## 📬 Feedback & Contributions

We welcome contributions, suggestions, and feedback! Feel free to open issues or submit pull requests.
