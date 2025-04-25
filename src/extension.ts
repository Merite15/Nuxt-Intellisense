import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export function activate(context: vscode.ExtensionContext) {
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

  console.log('Extension "nuxt intellisense" est maintenant active!');
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

    this.nuxtProjectRoot = await this.findNuxtProjectRoot(document.uri);

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
    if (isComposable) {
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
        let hasAddedLens = false;

        // 2.1 Pour les composants avec <script setup>
        const scriptSetupRegex = /<script\s+[^>]*setup[^>]*>/g;
        let match: RegExpExecArray | null;

        // D'abord chercher le script setup
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
          hasAddedLens = true;
        }

        // 2.2 Pour les composants avec defineComponent (seulement si pas de script setup trouvé)
        if (!hasAddedLens) {
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
            hasAddedLens = true;
          }
        }

        // 2.3 Pour les composants Nuxt spécifiques (seulement si pas de script setup trouvé)
        if (!hasAddedLens) {
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
            hasAddedLens = true;
          }
        }

        // 2.4 Si aucune des méthodes ci-dessus n'a trouvé de balise, chercher la balise template
        if (!hasAddedLens) {
          const templateRegex = /<template[^>]*>/g;
          match = templateRegex.exec(text);

          if (match) {
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

        // Vérifier si c'est un middleware global
        const isGlobal = document.fileName.includes('.global.');

        if (isGlobal) {
          lenses.push(
            new vscode.CodeLens(range, {
              title: `🌍 Middleware global (appliqué sur toutes les routes)`,
              command: ''
            })
          );
        } else {
          // Rechercher les références seulement si ce n'est pas un middleware global
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

        // Vérification que c'est bien un fichier de store
        if (document.uri.fsPath.includes(path.sep + 'stores' + path.sep)) {
          // Obtenir les références PRÉCISES
          const preciseReferences = await this.findStoreReferences(storeName);
          const uniqueReferences = this.removeDuplicateReferences(preciseReferences);
          const referenceCount = uniqueReferences.length;

          lenses.push(
            new vscode.CodeLens(range, {
              title: `🗃️ ${referenceCount} utilisation${referenceCount === 1 ? '' : 's'} du store`,
              command: 'editor.action.showReferences',
              arguments: [
                document.uri,
                new vscode.Position(pos.line, match[0].indexOf(storeName)),
                uniqueReferences
              ]
            })
          );
        }
      }
    }

    return lenses;
  }

  private removeDuplicateReferences(references: vscode.Location[]): vscode.Location[] {
    const uniqueRefs: vscode.Location[] = [];
    const seen = new Set<string>();

    for (const ref of references) {
      const key = `${ref.uri.fsPath}:${ref.range.start.line}:${ref.range.start.character}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueRefs.push(ref);
      }
    }

    return uniqueRefs;
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
    const componentDirs = await this.findAllDirsByName('components');

    for (const dir of componentDirs) {
      await this.scanComponentsDirectory(dir);
    }

    // Analyser les composables
    const composablesDirs = await this.findAllDirsByName('composables');

    for (const dir of composablesDirs) {
      await this.scanComposablesDirectory(dir);
    }

    // Analyser les stores
    const storeDirs = await this.findAllDirsByName('stores');
    for (const dir of storeDirs) {
      await this.scanStoresDirectory(dir);
    }
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
      try {
        const content = fs.readFileSync(file, 'utf-8');
        // Ignorer complètement les fichiers qui ne sont pas dans le dossier composables
        if (!file.includes(path.sep + 'composables' + path.sep)) {
          continue;
        }

        // Vérifier si le fichier contient une définition de store Pinia
        if (content.includes('defineStore')) {
          continue;
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
   * Analyser le répertoire des stores
   */
  private async scanStoresDirectory(dir: string): Promise<void> {
    if (!fs.existsSync(dir)) return;

    const storeInfos: NuxtComponentInfo[] = [];
    const files = await this.getFilesRecursively(dir, ['.ts', '.js']);

    for (const file of files) {
      try {
        const content = fs.readFileSync(file, 'utf-8');
        const defineStoreRegex = /defineStore\s*\(\s*(['"`])(.*?)\1/g;
        let match: RegExpExecArray | null;

        while ((match = defineStoreRegex.exec(content))) {
          storeInfos.push({
            name: match[2],
            path: file,
            isAutoImported: true
          });
        }
      } catch (e) {
        console.error(`Error reading store file ${file}:`, e);
      }
    }

    this.autoImportCache.set('stores', storeInfos);
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
        if (entry.name === 'node_modules') continue;

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

            // Chercher les utilisations du composable avec surlignage précis
            const usageRegex = new RegExp(`\\b(${name}\\s*\\()`, 'g');
            let match: RegExpExecArray | null;

            while ((match = usageRegex.exec(content))) {
              const matchText = match[1];
              const index = match.index;
              const before = content.slice(0, index);
              const line = before.split('\n').length - 1;

              // Calculer la colonne exacte
              const lineStartIndex = before.lastIndexOf('\n') + 1;
              const col = index - lineStartIndex;

              const uri = vscode.Uri.file(file);
              const range = new vscode.Range(
                new vscode.Position(line, col),
                new vscode.Position(line, col + matchText.length)
              );

              filteredReferences.push(new vscode.Location(uri, range));
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
  private getNuxtComponentName(filePath: string, componentsDir: string): string {
    let relPath = path.relative(componentsDir, filePath).replace(/\.vue$/, '');

    const parts = relPath.split(path.sep);

    if (parts[parts.length - 1].toLowerCase() === 'index') {
      parts.pop();
    }

    return parts
      .filter(Boolean)
      .map(part =>
        part
          .split('-')
          .map(w => w.charAt(0).toUpperCase() + w.slice(1))
          .join('')
      )
      .join('');
  }

  /**
 * Trouver toutes les références pour un composant avec surlignage précis
 */
  private async findAllDirsByName(dirName: string): Promise<string[]> {
    const dirs: string[] = [];

    if (!this.nuxtProjectRoot) return dirs;

    // Directories to check initially - including Nuxt 3 standard and Nuxt 4 compatibility mode
    const initialDirs = [
      this.nuxtProjectRoot,
      path.join(this.nuxtProjectRoot, 'app'),
      path.join(this.nuxtProjectRoot, 'app', 'base'),
      // Add other potential layer directories
      path.join(this.nuxtProjectRoot, 'app', 'modules')
    ].filter(dir => fs.existsSync(dir));

    for (const initialDir of initialDirs) {
      const recurse = (dir: string) => {
        try {
          const entries = fs.readdirSync(dir, { withFileTypes: true });

          for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              if (entry.name === dirName) {
                dirs.push(fullPath);
              }
              // Don't recurse into node_modules
              if (entry.name !== 'node_modules' && entry.name !== '.nuxt' && entry.name !== '.output') {
                recurse(fullPath); // continuer la récursion
              }
            }
          }
        } catch (e) {
          // Ignore errors for directories that can't be read
        }
      };

      recurse(initialDir);
    }

    return dirs;
  }


  private async findAllComponentsDirs(): Promise<string[]> {
    const dirs: string[] = [];

    if (!this.nuxtProjectRoot) return dirs;

    const recurse = (dir: string) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'components') {
            dirs.push(fullPath);
          }
          // Continue to scan subdirectories
          recurse(fullPath);
        }
      }
    };

    recurse(this.nuxtProjectRoot);
    return dirs;
  }


  private async findComponentReferences(document: vscode.TextDocument, componentName: string): Promise<vscode.Location[]> {
    if (!this.nuxtProjectRoot) return [];

    console.log(componentName);

    const allComponentDirs = await this.findAllComponentsDirs();
    const filePath = document.uri.fsPath;

    let nuxtComponentName = '';
    for (const dir of allComponentDirs) {
      if (filePath.startsWith(dir)) {
        nuxtComponentName = this.getNuxtComponentName(filePath, dir);
        break;
      }
    }

    if (!nuxtComponentName) return [];

    const allFiles = await this.getFilesRecursively(this.nuxtProjectRoot, ['.vue', '.ts', '.js']);
    const references: vscode.Location[] = [];

    for (const file of allFiles) {
      if (
        file.includes('.nuxt') ||
        path.basename(file) === 'app.vue' ||
        path.basename(file) === 'error.vue'
      ) continue;

      try {
        const content = fs.readFileSync(file, 'utf-8');
        const kebab = this.pascalToKebabCase(nuxtComponentName);
        const searchPatterns = [
          new RegExp(`<${nuxtComponentName}[\\s>]`, 'g'),
          new RegExp(`<${kebab}[\\s>]`, 'g')
        ];

        for (const regex of searchPatterns) {
          let match: RegExpExecArray | null;
          while ((match = regex.exec(content))) {
            const index = match.index;
            const before = content.slice(0, index);
            const line = before.split('\n').length - 1;
            const lineStartIndex = before.lastIndexOf('\n') + 1;
            const col = index - lineStartIndex;

            const uri = vscode.Uri.file(file);
            const range = new vscode.Range(
              new vscode.Position(line, col),
              new vscode.Position(line, col + match[0].length)
            );

            references.push(new vscode.Location(uri, range));
          }
        }
      } catch (e) {
        // ignore
      }
    }

    return references;
  }


  /**
   * Trouver les références pour un plugin
   */
  /**
   * Trouver les références pour un plugin Nuxt injecté par provide
   * - Cherche tous les usages du nom injecté dans le code utilisateur
   */
  /**
   * Trouver les références pour un plugin Nuxt
   */
  private async findPluginReferences(pluginName: string): Promise<vscode.Location[]> {
    if (!this.nuxtProjectRoot) return [];

    const references: vscode.Location[] = [];

    // Get all plugin directories
    const pluginDirs = await this.findAllDirsByName('plugins');
    let pluginPath = '';
    let pluginContent = '';

    // Try to find the plugin file in all plugin directories
    for (const dir of pluginDirs) {
      const possiblePaths = [
        path.join(dir, `${pluginName}.ts`),
        path.join(dir, `${pluginName}.js`)
      ];

      for (const filePath of possiblePaths) {
        if (fs.existsSync(filePath)) {
          pluginPath = filePath;
          pluginContent = fs.readFileSync(filePath, 'utf-8');
          break;
        }
      }

      if (pluginPath) break;
    }

    if (!pluginPath) return references;

    let provides: string[] = [];
    let hasDirectives: boolean = false;
    let directives: string[] = [];

    try {
      // 1. Détection classique via nuxtApp.provide('key', ...)
      const provideRegex = /nuxtApp\.provide\s*\(\s*['"`]([$\w]+)['"`]/g;
      let match: RegExpExecArray | null;
      while ((match = provideRegex.exec(pluginContent))) {
        provides.push(match[1]);
      }

      // 2. Détection avancée via `provide: { key: value }`
      const provideObjectRegex = /provide\s*:\s*\{([\s\S]*?)\}/g;
      const keyRegex = /['"`]?([$\w]+)['"`]?\s*:/g;

      let provideObjectMatch: RegExpExecArray | null;
      while ((provideObjectMatch = provideObjectRegex.exec(pluginContent))) {
        const keysBlock = provideObjectMatch[1];
        let keyMatch: RegExpExecArray | null;
        while ((keyMatch = keyRegex.exec(keysBlock))) {
          provides.push(keyMatch[1]);
        }
      }

      // 3. Détection des directives
      const directiveRegex = /nuxtApp\.vueApp\.directive\s*\(\s*['"`]([\w-]+)['"`]/g;
      while ((match = directiveRegex.exec(pluginContent))) {
        hasDirectives = true;
        directives.push(match[1]);
      }

      // 🔍 DEBUG - affiche les clés détectées dans les plugins
      if (provides.length === 0 && directives.length === 0) {
        console.warn(`[PluginScanner] Aucun provide/directive détecté pour ${pluginName}`);
      } else {
        console.log(`[PluginScanner] Plugin "${pluginName}" expose :`, provides, directives);
      }
    } catch (e) {
      return references;
    }

    const allFiles = await this.getFilesRecursively(this.nuxtProjectRoot, ['.vue', '.ts', '.js']);

    for (const file of allFiles) {
      if (file.includes('.nuxt') || file === pluginPath || file === pluginPath) continue;

      try {
        const fileContent = fs.readFileSync(file, 'utf-8');

        for (const key of provides) {
          const patterns = [
            new RegExp(`useNuxtApp\\(\\)\\s*\\.\\s*\\$${key}\\b`, 'g'),
            new RegExp(`(const|let|var)\\s+\\{[^}]*\\$${key}\\b[^}]*\\}\\s*=\\s*(useNuxtApp\\(\\)|nuxtApp)`, 'g'),
            new RegExp(`nuxtApp\\s*\\.\\s*\\$${key}\\b`, 'g'),
            new RegExp(`\\$${key}\\s*\\(`, 'g'),
            new RegExp(`Vue\\.prototype\\.\\$${key}\\b`, 'g'),
            new RegExp(`app\\.\\$${key}\\b`, 'g'),
            new RegExp(`this\\.\\$${key}\\b`, 'g'),
            new RegExp(`const\\s+nuxtApp\\s*=\\s*useNuxtApp\\(\\)[^]*?\\{[^}]*\\$${key}\\b[^}]*\\}\\s*=\\s*nuxtApp`, 'gs')
          ];

          for (const regex of patterns) {
            let match: RegExpExecArray | null;
            while ((match = regex.exec(fileContent))) {
              const index = match.index;
              const before = fileContent.slice(0, index);
              const line = before.split('\n').length - 1;
              const lineStartIndex = before.lastIndexOf('\n') + 1;
              const col = index - lineStartIndex;

              const uri = vscode.Uri.file(file);
              const range = new vscode.Range(
                new vscode.Position(line, col),
                new vscode.Position(line, col + match[0].length)
              );

              references.push(new vscode.Location(uri, range));
            }
          }
        }

        if (hasDirectives) {
          for (const directive of directives) {
            const directiveRegex = new RegExp(`\\sv-${directive}\\b|\\s:v-${directive}\\b`, 'g');
            let match: RegExpExecArray | null;

            while ((match = directiveRegex.exec(fileContent))) {
              const index = match.index;
              const before = fileContent.slice(0, index);
              const line = before.split('\n').length - 1;
              const lineStartIndex = before.lastIndexOf('\n') + 1;
              const col = index - lineStartIndex;

              const uri = vscode.Uri.file(file);
              const range = new vscode.Range(
                new vscode.Position(line, col),
                new vscode.Position(line, col + match[0].length)
              );

              references.push(new vscode.Location(uri, range));
            }
          }
        }

        const importRegex = new RegExp(`import\\s+[^;]*['\`"]~/plugins/${pluginName}['\`"]`, 'g');
        let match: RegExpExecArray | null;

        while ((match = importRegex.exec(fileContent))) {
          const index = match.index;
          const before = fileContent.slice(0, index);
          const line = before.split('\n').length - 1;
          const lineStartIndex = before.lastIndexOf('\n') + 1;
          const col = index - lineStartIndex;

          const uri = vscode.Uri.file(file);
          const range = new vscode.Range(
            new vscode.Position(line, col),
            new vscode.Position(line, col + match[0].length)
          );

          references.push(new vscode.Location(uri, range));
        }
      } catch (e) {
        // Ignorer les erreurs de lecture
      }
    }

    return references;
  }


  /**
   * Trouver les références pour un middleware
   */
  private async findMiddlewareReferences(middlewareName: string): Promise<vscode.Location[]> {
    if (!this.nuxtProjectRoot) {
      return [];
    }

    const references: vscode.Location[] = [];

    // Get all pages directories - supporting both structures
    const pagesDirs = await this.findAllDirsByName('pages');

    for (const pagesDir of pagesDirs) {
      if (fs.existsSync(pagesDir)) {
        const pageFiles = await this.getFilesRecursively(pagesDir, ['.vue']);

        for (const pageFile of pageFiles) {
          try {
            const content = fs.readFileSync(pageFile, 'utf-8');
            const definePageMetaRegex = /definePageMeta\s*\(\s*\{[^}]*\}/g;

            let metaMatch;
            while ((metaMatch = definePageMetaRegex.exec(content)) !== null) {
              const metaContent = metaMatch[0];
              const metaStartIndex = metaMatch.index;

              // Case 1: middleware as single string - middleware: 'chat'
              const singleMiddlewareRegex = /middleware\s*:\s*(['"`])([^'"`]*)\1/g;
              let singleMatch;

              while ((singleMatch = singleMiddlewareRegex.exec(metaContent)) !== null) {
                const foundMiddleware = singleMatch[2];
                if (foundMiddleware === middlewareName) {
                  // Calculate exact position for highlighting
                  const middlewareValueIndex = metaContent.indexOf(singleMatch[1] + middlewareName + singleMatch[1], singleMatch.index);
                  const exactIndex = metaStartIndex + middlewareValueIndex + 1; // +1 to skip the opening quote

                  const before = content.slice(0, exactIndex);
                  const line = before.split('\n').length - 1;
                  const col = exactIndex - before.lastIndexOf('\n') - 1;

                  const uri = vscode.Uri.file(pageFile);
                  const range = new vscode.Range(line, col, line, col + middlewareName.length);
                  references.push(new vscode.Location(uri, range));
                }
              }

              // Case 2: middleware as array - middleware: ['mobile-only', 'chat']
              const arrayMiddlewareRegex = /middleware\s*:\s*\[([^\]]*)\]/g;
              let arrayMatch;

              while ((arrayMatch = arrayMiddlewareRegex.exec(metaContent)) !== null) {
                const arrayContent = arrayMatch[1];
                const itemRegex = new RegExp(`(['"\`])(${middlewareName})\\1`, 'g');
                let itemMatch;

                while ((itemMatch = itemRegex.exec(arrayContent)) !== null) {
                  // Calculate the exact position within the array
                  const arrayStartIndex = metaContent.indexOf(arrayContent, arrayMatch.index);
                  const middlewareInArrayIndex = arrayContent.indexOf(itemMatch[0]);
                  const exactIndex = metaStartIndex + arrayStartIndex + middlewareInArrayIndex + 1; // +1 to skip the opening quote

                  const before = content.slice(0, exactIndex);
                  const line = before.split('\n').length - 1;
                  const col = exactIndex - before.lastIndexOf('\n') - 1;

                  const uri = vscode.Uri.file(pageFile);
                  const range = new vscode.Range(line, col, line, col + middlewareName.length);
                  references.push(new vscode.Location(uri, range));
                }
              }
            }
          } catch (e) {
            // Ignore errors
          }
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

    // Search in page files across all possible page directories
    const pagesDirs = await this.findAllDirsByName('pages');

    for (const pagesDir of pagesDirs) {
      if (fs.existsSync(pagesDir)) {
        const pageFiles = await this.getFilesRecursively(pagesDir, ['.vue']);

        for (const pageFile of pageFiles) {
          try {
            const content = fs.readFileSync(pageFile, 'utf-8');

            // Look for definePageMeta with layout property
            const layoutRegex = /definePageMeta\s*\(\s*\{[^}]*layout\s*:\s*(['"`])([^'"`]*)\1/g;
            let match;

            while ((match = layoutRegex.exec(content)) !== null) {
              const foundLayoutName = match[2];
              if (foundLayoutName === layoutName) {
                // Calculate the exact position of the layout name for highlighting
                const fullMatch = match[0];
                const layoutValueIndex = fullMatch.lastIndexOf(match[1] + layoutName + match[1]);
                const exactIndex = match.index + layoutValueIndex + 1; // +1 to skip the opening quote

                const before = content.slice(0, exactIndex);
                const line = before.split('\n').length - 1;
                const col = exactIndex - before.lastIndexOf('\n') - 1;

                const uri = vscode.Uri.file(pageFile);
                const range = new vscode.Range(line, col, line, col + layoutName.length);
                references.push(new vscode.Location(uri, range));
              }
            }
          } catch (e) {
            // Ignore errors
          }
        }
      }
    }

    // Check app.vue for default layout in possible locations
    const possibleAppVuePaths = [
      path.join(this.nuxtProjectRoot, 'app.vue'),
      path.join(this.nuxtProjectRoot, 'app', 'app.vue')
    ];

    for (const appVuePath of possibleAppVuePaths) {
      if (fs.existsSync(appVuePath) && layoutName === 'default') {
        const uri = vscode.Uri.file(appVuePath);
        const pos = new vscode.Position(0, 0);
        references.push(new vscode.Location(uri, pos));
      }
    }

    return references;
  }

  /**
   * Trouver les références pour un store
   */
  private async findStoreReferences(storeName: string): Promise<vscode.Location[]> {
    try {
      const references: vscode.Location[] = [];

      const storeHookName = `use${storeName
        .split(/[-_]/)
        .map(s => s.charAt(0).toUpperCase() + s.slice(1))
        .join('')}Store`;

      if (!this.nuxtProjectRoot) return references;

      // 1. Recherche précise dans tous les fichiers
      const allFiles = await this.getFilesRecursively(this.nuxtProjectRoot, ['.vue', '.ts', '.js']);

      for (const file of allFiles) {
        // Exclusion des dossiers spécifiques
        if (file.includes('node_modules') || file.includes('.nuxt') ||
          file.includes('.output') || file.includes('dist')) {
          continue;
        }

        try {
          const content = fs.readFileSync(file, 'utf-8');

          // 2. Pattern principal plus strict
          const mainPattern = new RegExp(
            `\\b${storeHookName}\\s*\\([^)]*\\)`,
            'g'
          );

          // 3. Recherche des matches exacts
          let match;
          while ((match = mainPattern.exec(content)) !== null) {
            // Vérification que ce n'est pas une déclaration (defineStore)
            if (content.lastIndexOf('defineStore', match.index) < match.index) {
              const index = match.index;
              const before = content.slice(0, index);
              const line = before.split('\n').length - 1;
              const lineStart = before.lastIndexOf('\n') + 1;
              const col = index - lineStart;

              references.push(new vscode.Location(
                vscode.Uri.file(file),
                new vscode.Range(
                  new vscode.Position(line, col),
                  new vscode.Position(line, col + match[0].length)
                )
              ));
            }
          }
        } catch (e) {
          console.debug(`Error reading ${file}:`, e);
        }
      }

      return references;
    } catch (e) {
      console.error('Error in findStoreReferences:', e);
      return [];
    }
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
}

export function deactivate() { }