import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export function activate(context: vscode.ExtensionContext) {
  // Enregistrer le fournisseur de CodeLens
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      [
        { language: 'vue' },
        { language: 'typescript' },
        { language: 'javascript' }
      ],
      new Nuxt3CodeLensProvider()
    )
  );

  console.log('Extension "nuxt3-codelens" est maintenant active!');
}

interface NuxtComponentInfo {
  name: string;
  path: string;
  isAutoImported: boolean;
}

class Nuxt3CodeLensProvider implements vscode.CodeLensProvider {
  private nuxtProjectRoot: string | null = null;
  private autoImportCache: Map<string, NuxtComponentInfo[]> = new Map();
  private lastCacheUpdate: number = 0;
  private cacheUpdateInterval: number = 30000; // 30 secondes

  async provideCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
    const lenses: vscode.CodeLens[] = [];

    const fileName = path.basename(document.fileName);

    if (fileName === 'app.vue' || fileName === 'error.vue') {
      return [];
    }

    // Trouver la racine du projet Nuxt
    this.nuxtProjectRoot = await this.findNuxtProjectRoot(document.uri);

    // Mettre à jour le cache des auto-importations si nécessaire
    await this.updateAutoImportCacheIfNeeded();

    // Le nom du fichier actuel (pour déterminer le type)
    const fileDir = path.dirname(document.fileName);
    const fileExtension = path.extname(document.fileName);
    const isVueFile = fileExtension === '.vue';
    const isComposable = fileDir.includes('composables');
    const isComponent = fileDir.includes('components');
    const isPlugin = fileDir.includes('plugins');
    const isMiddleware = fileDir.includes('middleware');
    const isPages = fileDir.includes('pages');
    const isLayout = fileDir.includes('layouts');
    const isStore = fileDir.includes('stores') || fileDir.includes('store');

    const text = document.getText();

    // 1. Détection des composables (dans /composables/*.ts)
    if (isComposable || text.includes('export function') || text.includes('export const')) {
      const composableRegex = /export\s+(const|function|async function)\s+(\w+)/g;
      let match: RegExpExecArray | null;

      while ((match = composableRegex.exec(text))) {
        const funcType = match[1];
        const name = match[2];
        const pos = document.positionAt(match.index);
        const range = new vscode.Range(pos.line, 0, pos.line, 0);

        // Rechercher les références, y compris les auto-importations
        const references = await this.findAllReferences(document, name, pos);
        const referenceCount = references.length;

        const autoImportInfo = isComposable ? "auto-importé" : "";

        lenses.push(
          new vscode.CodeLens(range, {
            title: `🔄 ${referenceCount} référence${referenceCount === 1 ? '' : 's'} du composable${autoImportInfo ? ` (${autoImportInfo})` : ''}`,
            command: 'editor.action.showReferences',
            arguments: [
              document.uri,
              new vscode.Position(pos.line, match[0].indexOf(name)),
              references
            ]
          })
        );
      }
    }

    // 2. Détection des composants Vue et Nuxt (dans /components/*.vue)
    if (isVueFile) {
      // Ne pas afficher les CodeLens pour les composants si on est dans une page
      if (!isPages) {
        // 2.1 Pour les composants avec <script setup>
        const scriptSetupRegex = /<script\s+setup[^>]*>/g;
        let match: RegExpExecArray | null;

        while ((match = scriptSetupRegex.exec(text))) {
          const pos = document.positionAt(match.index);
          const range = new vscode.Range(pos.line, 0, pos.line, 0);

          // Nom du composant basé sur le nom de fichier
          const componentName = path.basename(document.fileName, '.vue');

          // Rechercher les références, y compris les auto-importations
          const references = await this.findComponentReferences(document, componentName);
          const referenceCount = references.length;

          const autoImportInfo = isComponent ? "auto-importé" : "";

          lenses.push(
            new vscode.CodeLens(range, {
              title: `🧩 ${referenceCount} utilisation${referenceCount === 1 ? '' : 's'} du composant${autoImportInfo ? ` (${autoImportInfo})` : ''}`,
              command: 'editor.action.showReferences',
              arguments: [
                document.uri,
                pos,
                references
              ]
            })
          );
        }

        // 2.2 Pour les composants avec defineComponent
        const defineComponentRegex = /defineComponent\s*\(/g;
        while ((match = defineComponentRegex.exec(text))) {
          const pos = document.positionAt(match.index);
          const range = new vscode.Range(pos.line, 0, pos.line, 0);

          // Nom du composant basé sur le nom de fichier
          const componentName = path.basename(document.fileName, '.vue');

          // Rechercher les références, y compris les auto-importations
          const references = await this.findComponentReferences(document, componentName);
          const referenceCount = references.length;

          lenses.push(
            new vscode.CodeLens(range, {
              title: `🧩 ${referenceCount} utilisation${referenceCount === 1 ? '' : 's'} du composant`,
              command: 'editor.action.showReferences',
              arguments: [
                document.uri,
                pos,
                references
              ]
            })
          );
        }

        // 2.3 Pour les composants Nuxt spécifiques
        const defineNuxtComponentRegex = /defineNuxtComponent\s*\(/g;
        while ((match = defineNuxtComponentRegex.exec(text))) {
          const pos = document.positionAt(match.index);
          const range = new vscode.Range(pos.line, 0, pos.line, 0);

          // Nom du composant basé sur le nom de fichier
          const componentName = path.basename(document.fileName, '.vue');

          // Rechercher les références, y compris les auto-importations
          const references = await this.findComponentReferences(document, componentName);
          const referenceCount = references.length;

          lenses.push(
            new vscode.CodeLens(range, {
              title: `⚡ ${referenceCount} utilisation${referenceCount === 1 ? '' : 's'} du composant Nuxt`,
              command: 'editor.action.showReferences',
              arguments: [
                document.uri,
                pos,
                references
              ]
            })
          );
        }
      }
    }

    // 3. Détection des plugins Nuxt (dans /plugins/*.ts)
    if (isPlugin) {
      const defineNuxtPluginRegex = /defineNuxtPlugin\s*\(/g;
      let match: RegExpExecArray | null;

      while ((match = defineNuxtPluginRegex.exec(text))) {
        const pos = document.positionAt(match.index);
        const range = new vscode.Range(pos.line, 0, pos.line, 0);

        // Nom du plugin basé sur le nom de fichier
        const pluginName = path.basename(document.fileName, path.extname(document.fileName));

        // Rechercher les références
        const references = await this.findPluginReferences(pluginName);
        const referenceCount = references.length;

        lenses.push(
          new vscode.CodeLens(range, {
            title: `🔌 ${referenceCount} utilisation${referenceCount === 1 ? '' : 's'} du plugin`,
            command: 'editor.action.showReferences',
            arguments: [
              document.uri,
              pos,
              references
            ]
          })
        );
      }
    }

    // 4. Détection des middleware Nuxt (dans /middleware/*.ts)
    if (isMiddleware) {
      const defineNuxtMiddlewareRegex = /defineNuxtRouteMiddleware\s*\(/g;
      let match: RegExpExecArray | null;

      while ((match = defineNuxtMiddlewareRegex.exec(text))) {
        const pos = document.positionAt(match.index);
        const range = new vscode.Range(pos.line, 0, pos.line, 0);

        // Nom du middleware basé sur le nom de fichier
        const middlewareName = path.basename(document.fileName, path.extname(document.fileName));

        // Rechercher les références
        const references = await this.findMiddlewareReferences(middlewareName);
        const referenceCount = references.length;

        lenses.push(
          new vscode.CodeLens(range, {
            title: `🔗 ${referenceCount} utilisation${referenceCount === 1 ? '' : 's'} du middleware`,
            command: 'editor.action.showReferences',
            arguments: [
              document.uri,
              pos,
              references
            ]
          })
        );
      }
    }

    // 6. Détection des layouts Nuxt (dans /layouts/*.vue)
    if (isLayout) {
      const layoutSetupRegex = /<script\s+setup[^>]*>|<template>/g;
      let match: RegExpExecArray | null;

      if ((match = layoutSetupRegex.exec(text))) {
        const pos = document.positionAt(match.index);
        const range = new vscode.Range(pos.line, 0, pos.line, 0);

        // Nom du layout basé sur le nom de fichier
        const layoutName = path.basename(document.fileName, '.vue');

        // Rechercher les références
        const references = await this.findLayoutReferences(layoutName);
        const referenceCount = references.length;

        lenses.push(
          new vscode.CodeLens(range, {
            title: `🖼️ ${referenceCount} utilisation${referenceCount === 1 ? '' : 's'} du layout`,
            command: 'editor.action.showReferences',
            arguments: [
              document.uri,
              pos,
              references
            ]
          })
        );
      }
    }

    // 7. Détection des stores Pinia (dans /stores/*.ts)
    if (isStore) {
      const defineStoreRegex = /defineStore\s*\(\s*(['"`])(.*?)\1/g;
      let match: RegExpExecArray | null;

      while ((match = defineStoreRegex.exec(text))) {
        const storeName = match[2];
        const pos = document.positionAt(match.index);
        const range = new vscode.Range(pos.line, 0, pos.line, 0);

        // Rechercher les références
        const references = await this.findStoreReferences(storeName);
        const referenceCount = references.length;

        lenses.push(
          new vscode.CodeLens(range, {
            title: `🗃️ ${referenceCount} utilisation${referenceCount === 1 ? '' : 's'} du store`,
            command: 'editor.action.showReferences',
            arguments: [
              document.uri,
              new vscode.Position(pos.line, match[0].indexOf(storeName)),
              references
            ]
          })
        );
      }
    }

    return lenses;
  }

  /**
   * Trouvez la racine du projet Nuxt
   */
  private async findNuxtProjectRoot(uri: vscode.Uri): Promise<string | null> {
    let currentDir = path.dirname(uri.fsPath);
    const root = path.parse(currentDir).root;

    while (currentDir !== root) {
      const nuxtConfigPath = path.join(currentDir, 'nuxt.config.ts');
      const nuxtConfigJsPath = path.join(currentDir, 'nuxt.config.js');

      try {
        if (fs.existsSync(nuxtConfigPath) || fs.existsSync(nuxtConfigJsPath)) {
          return currentDir;
        }
      } catch (e) {
        // Ignorer les erreurs
      }

      currentDir = path.dirname(currentDir);
    }

    return null;
  }

  /**
   * Mettre à jour le cache des auto-importations si nécessaire
   */
  private async updateAutoImportCacheIfNeeded(): Promise<void> {
    const now = Date.now();
    if (now - this.lastCacheUpdate < this.cacheUpdateInterval) {
      return;
    }

    this.lastCacheUpdate = now;
    await this.updateAutoImportCache();
  }

  /**
   * Mettre à jour le cache des auto-importations
   */
  private async updateAutoImportCache(): Promise<void> {
    if (!this.nuxtProjectRoot) {
      return;
    }

    // Réinitialiser le cache
    this.autoImportCache.clear();

    // Analyser les composants
    const componentsDir = path.join(this.nuxtProjectRoot, 'components');
    await this.scanComponentsDirectory(componentsDir);

    // Analyser les composables
    const composablesDir = path.join(this.nuxtProjectRoot, 'composables');
    await this.scanComposablesDirectory(composablesDir);
  }

  /**
   * Analyser le répertoire des composants
   */
  private async scanComponentsDirectory(dir: string): Promise<void> {
    if (!fs.existsSync(dir)) {
      return;
    }

    const componentInfos: NuxtComponentInfo[] = [];
    const files = await this.getFilesRecursively(dir, ['.vue']);

    for (const file of files) {
      const componentName = path.basename(file, '.vue');
      componentInfos.push({
        name: componentName,
        path: file,
        isAutoImported: true
      });
    }

    this.autoImportCache.set('components', componentInfos);
  }

  /**
   * Analyser le répertoire des composables
   */
  private async scanComposablesDirectory(dir: string): Promise<void> {
    if (!fs.existsSync(dir)) {
      return;
    }
    const composableInfos: NuxtComponentInfo[] = [];
    const files = await this.getFilesRecursively(dir, ['.ts', '.js']);
    for (const file of files) {
      // Lire le fichier pour trouver les fonctions exportées
      try {
        const content = fs.readFileSync(file, 'utf-8');
        // Vérifier si le fichier contient une définition de store Pinia
        if (content.includes('defineStore')) {
          continue; // Ignorer les fichiers qui définissent des stores
        }
        const exportRegex = /export\s+(const|function|async function)\s+(\w+)/g;
        let match: RegExpExecArray | null;
        while ((match = exportRegex.exec(content))) {
          const name = match[2];
          composableInfos.push({
            name: name,
            path: file,
            isAutoImported: true
          });
        }
      } catch (e) {
        // Ignorer les erreurs de lecture
      }
    }
    this.autoImportCache.set('composables', composableInfos);
  }

  /**
   * Obtenir tous les fichiers récursivement dans un répertoire
   */
  private async getFilesRecursively(dir: string, extensions: string[]): Promise<string[]> {
    const files: string[] = [];

    if (!fs.existsSync(dir)) {
      return files;
    }

    const dirEntries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of dirEntries) {
      const entryPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        const subFiles = await this.getFilesRecursively(entryPath, extensions);
        files.push(...subFiles);
      } else if (extensions.includes(path.extname(entry.name))) {
        files.push(entryPath);
      }
    }

    return files;
  }

  /**
   * Trouver toutes les références pour un composable, y compris les auto-importations
   */
  private async findAllReferences(document: vscode.TextDocument, name: string, position: vscode.Position): Promise<vscode.Location[]> {
    try {
      // Recherche standard des références via VS Code
      const references = await vscode.commands.executeCommand<vscode.Location[]>(
        'vscode.executeReferenceProvider',
        document.uri,
        new vscode.Position(position.line, position.character + name.length - 1)
      ) || [];

      // Filtrer les fichiers générés par Nuxt
      const filteredReferences = references.filter(ref => !ref.uri.fsPath.includes('.nuxt'));

      // Si nous avons un projet Nuxt, rechercher les auto-importations
      if (this.nuxtProjectRoot) {
        // Rechercher les occurrences du composable dans tous les fichiers
        const allFiles = await this.getFilesRecursively(this.nuxtProjectRoot, ['.vue', '.ts', '.js']);

        for (const file of allFiles) {
          // Éviter de chercher dans le fichier courant
          if (file === document.uri.fsPath) continue;

          try {
            const content = fs.readFileSync(file, 'utf-8');

            // Chercher les utilisations du composable
            // Ajouter une expression régulière plus précise pour trouver les utilisations
            const usage = new RegExp(`\\b${name}\\s*\\(`, 'g');

            if (usage.test(content)) {
              const uri = vscode.Uri.file(file);
              const pos = new vscode.Position(0, 0);
              filteredReferences.push(new vscode.Location(uri, pos));
            }
          } catch (e) {
            // Ignorer les erreurs
          }
        }
      }

      return filteredReferences;
    } catch (e) {
      return [];
    }
  }
  /**
   * Trouver toutes les références pour un composant
   */
  private async findComponentReferences(document: vscode.TextDocument, componentName: string): Promise<vscode.Location[]> {
    try {
      // Recherche standard des références via VS Code
      const pos = new vscode.Position(0, 0);
      const references = await vscode.commands.executeCommand<vscode.Location[]>(
        'vscode.executeReferenceProvider',
        document.uri,
        pos
      ) || [];

      // Filtrer les fichiers générés par Nuxt, app.vue et error.vue
      const filteredReferences = references.filter(ref => {
        const fileName = path.basename(ref.uri.fsPath);
        return !ref.uri.fsPath.includes('.nuxt') &&
          fileName !== 'app.vue' &&
          fileName !== 'error.vue';
      });

      // Si nous avons un projet Nuxt, rechercher les auto-importations
      if (this.nuxtProjectRoot) {
        // Chercher les utilisations comme balises HTML (ex: <MyComponent />)
        const tagReferences = await this.findTagReferences(componentName);
        // Filtrer pour supprimer app.vue et error.vue
        const filteredTagReferences = tagReferences.filter(ref => {
          const fileName = path.basename(ref.uri.fsPath);
          return fileName !== 'app.vue' && fileName !== 'error.vue';
        });
        filteredReferences.push(...filteredTagReferences);

        // Chercher les auto-importations
        const autoImportRefs = await this.findAutoImportReferences(componentName, 'component');
        // Filtrer pour supprimer app.vue et error.vue
        const filteredAutoImportRefs = autoImportRefs.filter(ref => {
          const fileName = path.basename(ref.uri.fsPath);
          return fileName !== 'app.vue' && fileName !== 'error.vue';
        });
        filteredReferences.push(...filteredAutoImportRefs);
      }

      return filteredReferences;
    } catch (e) {
      return [];
    }
  }

  /**
   * Trouver les références pour un plugin
   */
  private async findPluginReferences(pluginName: string): Promise<vscode.Location[]> {
    // Pour les plugins, vérifier principalement le nuxt.config.ts
    if (!this.nuxtProjectRoot) {
      return [];
    }

    const nuxtConfigPath = path.join(this.nuxtProjectRoot, 'nuxt.config.ts');
    const nuxtConfigJsPath = path.join(this.nuxtProjectRoot, 'nuxt.config.js');

    const configPath = fs.existsSync(nuxtConfigPath) ? nuxtConfigPath :
      (fs.existsSync(nuxtConfigJsPath) ? nuxtConfigJsPath : null);

    if (!configPath) {
      return [];
    }

    try {
      const content = fs.readFileSync(configPath, 'utf-8');
      const pluginRegex = new RegExp(`plugins\\s*:\\s*\\[([^\\]]*${pluginName}[^\\]]*)\\]`, 'g');

      if (pluginRegex.test(content)) {
        const uri = vscode.Uri.file(configPath);
        const pos = new vscode.Position(0, 0);
        return [new vscode.Location(uri, pos)];
      }
    } catch (e) {
      // Ignorer les erreurs
    }

    return [];
  }

  /**
   * Trouver les références pour un middleware
   */
  private async findMiddlewareReferences(middlewareName: string): Promise<vscode.Location[]> {
    if (!this.nuxtProjectRoot) {
      return [];
    }

    const references: vscode.Location[] = [];

    // Rechercher dans les fichiers de pages
    const pagesDir = path.join(this.nuxtProjectRoot, 'pages');
    if (fs.existsSync(pagesDir)) {
      const pageFiles = await this.getFilesRecursively(pagesDir, ['.vue']);

      for (const pageFile of pageFiles) {
        try {
          const content = fs.readFileSync(pageFile, 'utf-8');

          // Vérifier les utilisations definePageMeta({ middleware: ['middlewareName'] })
          const middlewareRegex = new RegExp(`definePageMeta\\s*\\(\\s*\\{[^}]*middleware\\s*:\\s*\\[?[^\\]]*['"]${middlewareName}['"][^\\]]*\\]?`, 'g');

          if (middlewareRegex.test(content)) {
            const uri = vscode.Uri.file(pageFile);
            const pos = new vscode.Position(0, 0);
            references.push(new vscode.Location(uri, pos));
          }
        } catch (e) {
          // Ignorer les erreurs
        }
      }
    }

    return references;
  }

  /**
   * Trouver les références pour un layout
   */
  private async findLayoutReferences(layoutName: string): Promise<vscode.Location[]> {
    if (!this.nuxtProjectRoot) {
      return [];
    }

    const references: vscode.Location[] = [];

    // Rechercher dans les fichiers de pages
    const pagesDir = path.join(this.nuxtProjectRoot, 'pages');
    if (fs.existsSync(pagesDir)) {
      const pageFiles = await this.getFilesRecursively(pagesDir, ['.vue']);

      for (const pageFile of pageFiles) {
        try {
          const content = fs.readFileSync(pageFile, 'utf-8');

          // Vérifier les utilisations definePageMeta({ layout: 'layoutName' })
          const layoutRegex = new RegExp(`definePageMeta\\s*\\(\\s*\\{[^}]*layout\\s*:\\s*['"]${layoutName}['"]`, 'g');

          if (layoutRegex.test(content)) {
            const uri = vscode.Uri.file(pageFile);
            const pos = new vscode.Position(0, 0);
            references.push(new vscode.Location(uri, pos));
          }
        } catch (e) {
          // Ignorer les erreurs
        }
      }
    }

    // Vérifier le app.vue pour le layout par défaut
    const appVuePath = path.join(this.nuxtProjectRoot, 'app.vue');
    if (fs.existsSync(appVuePath) && layoutName === 'default') {
      const uri = vscode.Uri.file(appVuePath);
      const pos = new vscode.Position(0, 0);
      references.push(new vscode.Location(uri, pos));
    }

    return references;
  }

  /**
   * Trouver les références pour un store
   */
  private async findStoreReferences(storeName: string): Promise<vscode.Location[]> {
    try {
      const references: vscode.Location[] = [];

      // Nous recherchons le motif "useXxxStore" où Xxx est le storeName avec une première lettre majuscule
      const storeHookName = `use${storeName.charAt(0).toUpperCase() + storeName.slice(1)}Store`;

      // Chercher dans tous les fichiers du projet
      if (this.nuxtProjectRoot) {
        const allFiles = await this.getFilesRecursively(this.nuxtProjectRoot, ['.vue', '.ts', '.js']);

        for (const file of allFiles) {
          try {
            const content = fs.readFileSync(file, 'utf-8');

            // Chercher des utilisations du store
            if (content.includes(storeHookName)) {
              const uri = vscode.Uri.file(file);
              const pos = new vscode.Position(0, 0);
              references.push(new vscode.Location(uri, pos));
            }
          } catch (e) {
            // Ignorer les erreurs
          }
        }
      }

      return references;
    } catch (e) {
      return [];
    }
  }

  /**
   * Trouver les références aux composants utilisés comme balises HTML
   */
  private async findTagReferences(componentName: string): Promise<vscode.Location[]> {
    try {
      const references: vscode.Location[] = [];

      // Construire différentes variantes de noms de balises (kebab-case, PascalCase)
      const kebabCaseName = this.pascalToKebabCase(componentName);
      const pascalCaseName = this.kebabToPascalCase(componentName);

      const searchPatterns = [
        `<${kebabCaseName}\\s`,
        `<${kebabCaseName}>`,
        `<${pascalCaseName}\\s`,
        `<${pascalCaseName}>`
      ];

      for (const pattern of searchPatterns) {
        // Utiliser la recherche globale de VS Code
        const searchResults = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
          'vscode.executeWorkspaceSymbolProvider',
          pattern
        );

        for (const file of searchResults.values()) {
          references.push(file.location);
        }
      }

      return references;
    } catch (e) {
      return [];
    }
  }

  /**
   * Trouver les références aux auto-importations
   */
  private async findAutoImportReferences(name: string, type: 'component' | 'composable'): Promise<vscode.Location[]> {
    try {
      const references: vscode.Location[] = [];

      if (type === 'component') {
        // Pour les composants, chercher les balises HTML
        const kebabCaseName = this.pascalToKebabCase(name);
        const pascalCaseName = this.kebabToPascalCase(name);
        const searchPatterns = [
          `<${kebabCaseName}\\s`,
          `<${kebabCaseName}>`,
          `<${pascalCaseName}\\s`,
          `<${pascalCaseName}>`
        ];

        for (const pattern of searchPatterns) {
          const searchResults = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
            'vscode.executeWorkspaceSymbolProvider',
            pattern
          );
          for (const file of searchResults.values()) {
            references.push(file.location);
          }
        }
      } else if (type === 'composable') {
        // Pour les composables, rechercher uniquement les exports de fonctions
        const searchResults = await vscode.commands.executeCommand<vscode.Location[]>(
          'vscode.executeWorkspaceSymbolProvider',
          name
        ) || [];

        // Filtrer pour ne conserver que les fichiers contenant des exports de fonctions
        const filteredResults = searchResults.filter(ref => {
          try {
            const content = fs.readFileSync(ref.uri.fsPath, 'utf-8');
            return content.includes(`export function ${name}`) || content.includes(`export const ${name}`);
          } catch (e) {
            return false;
          }
        });

        for (const file of filteredResults) {
          references.push(file);
        }
      }

      return references;
    } catch (e) {
      return [];
    }
  }

  /**
   * Calculer le chemin de la route à partir du chemin du fichier
   */
  private calculateRoutePath(filePath: string): string {
    if (!this.nuxtProjectRoot) {
      return path.basename(filePath, '.vue');
    }

    const pagesDir = path.join(this.nuxtProjectRoot, 'pages');
    const relativePath = path.relative(pagesDir, filePath);

    // Supprimer l'extension
    let routePath = relativePath.replace(/\.vue$/, '');

    // Gérer les fichiers index
    routePath = routePath.replace(/\/index$/, '/');
    if (routePath === 'index') {
      routePath = '/';
    }

    // Gérer les paramètres (fichiers avec [param])
    routePath = routePath.replace(/\[([^\]]+)\]/g, ':$1');

    // Ajouter un '/' au début si nécessaire
    if (!routePath.startsWith('/')) {
      routePath = '/' + routePath;
    }

    return routePath;
  }

  /**
   * Convertir PascalCase en kebab-case
   */
  private pascalToKebabCase(str: string): string {
    return str
      .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
      .replace(/([A-Z])([A-Z])(?=[a-z])/g, '$1-$2')
      .toLowerCase();
  }

  /**
   * Convertir kebab-case en PascalCase
   */
  private kebabToPascalCase(str: string): string {
    return str
      .split('-')
      .map(part => part.charAt(0).toUpperCase() + part.slice(1))
      .join('');
  }
}

export function deactivate() { }