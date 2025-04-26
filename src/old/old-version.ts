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
            new NuxtIntellisense()
        )
    );

    console.log('Extension "nuxt intellisense" activate!');
}

interface NuxtComponentInfo {
    name: string;
    path: string;
    isAutoImported: boolean;
    exportType?: string;
}

class NuxtIntellisense implements vscode.CodeLensProvider {
    private nuxtProjectRoot: string | null = null;

    private autoImportCache: Map<string, NuxtComponentInfo[]> = new Map();

    private lastCacheUpdate: number = 0;

    private cacheUpdateInterval: number = 30000;

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
                        title: `🔄 ${referenceCount} reference${referenceCount > 1 ? 's' : ''}`,
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

            const isPagesComponents = document.fileName.includes(`${path.sep}pages${path.sep}`) && document.fileName.includes(`${path.sep}components${path.sep}`);

            if ((!isPages || isPagesComponents) && !isLayout) {
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
                            title: `🧩 ${referenceCount} reference${referenceCount > 1 ? 's' : ''}`,
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
                                title: `🧩 ${referenceCount} reference${referenceCount > 1 ? 's' : ''}`,
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
                                title: `⚡ ${referenceCount} reference${referenceCount > 1 ? 's' : ''}`,
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
                                title: `🧩 ${referenceCount} reference${referenceCount > 1 ? 's' : ''}`,
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
                        title: `🔌 ${referenceCount} reference${referenceCount > 1 ? 's' : ''}`,
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
                            title: `🌍 Global Middleware`,
                            command: ''
                        })
                    );
                } else {
                    // Rechercher les références seulement si ce n'est pas un middleware global
                    const references = await this.findMiddlewareReferences(middlewareName);
                    const referenceCount = references.length;

                    lenses.push(
                        new vscode.CodeLens(range, {
                            title: `🔗 ${referenceCount} reference${referenceCount > 1 ? 's' : ''}`,
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

        // 5. Détection des layouts Nuxt (dans /layouts/*.vue)
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

                if (layoutName === 'default') {
                    lenses.push(
                        new vscode.CodeLens(range, {
                            title: `🖼️ Default Layout`,
                            command: ''
                        })
                    );
                } else if (referenceCount > 0) {
                    lenses.push(
                        new vscode.CodeLens(range, {
                            title: `🖼️ ${referenceCount} reference${referenceCount > 1 ? 's' : ''}`,
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

        // 6. Détection des stores Pinia (dans /stores/*.ts)
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
                            title: `🗃️ ${referenceCount} reference${referenceCount > 1 ? 's' : ''}`,
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

        // 7. Détection des imports de fichiers (dans /utils/*.ts)
        const isUtils = fileDir.includes('utils') ||
            fileDir.includes('constants') ||
            fileDir.includes('schemas') ||
            fileDir.includes('validationSchemas') ||
            fileDir.includes('helpers') ||
            fileDir.includes('lib');

        if (isUtils && !isComposable && !isStore) {
            const utilsRegex = /export\s+(const|function|async function|interface|type|enum|class)\s+(\w+)/g;
            let match: RegExpExecArray | null;

            while ((match = utilsRegex.exec(text))) {
                const exportType = match[1];
                const name = match[2];
                const pos = document.positionAt(match.index);
                const range = new vscode.Range(pos.line, 0, pos.line, 0);

                // Type d'emoji et libellé selon le type d'export
                let emoji = '🔧'; // Par défaut pour les utilitaires
                let typeLabel = 'utilitaire';

                if (exportType === 'interface' || exportType === 'type') {
                    emoji = '📝';
                    typeLabel = exportType === 'interface' ? 'interface' : 'type';
                } else if (exportType === 'const') {
                    emoji = '📊';
                    typeLabel = 'constante';
                } else if (exportType === 'class') {
                    emoji = '🏛️';
                    typeLabel = 'classe';
                }

                // Rechercher les références
                const references = await this.findUtilsReferences(document, name, pos);
                const referenceCount = references.length;

                lenses.push(
                    new vscode.CodeLens(range, {
                        title: `${emoji} ${referenceCount} reference${referenceCount > 1 ? 's' : ''}`,
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

        // Analyser les utilitaires et constantes
        await this.scanUtilsDirectories();
    }

    /**
     * Analyser le répertoire des composants
     */
    private async scanComponentsDirectory(dir: string): Promise<void> {
        if (!fs.existsSync(dir)) {
            return;
        }

        const componentInfos: NuxtComponentInfo[] = [];
        const relativePattern = new vscode.RelativePattern(dir, '**/*.vue');
        const files = await vscode.workspace.findFiles(relativePattern);

        for (const file of files) {
            const componentName = path.basename(file.fsPath, '.vue');
            componentInfos.push({
                name: componentName,
                path: file.fsPath,
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
        const relativePattern = new vscode.RelativePattern(dir, '**/*.{ts,js}');
        const files = await vscode.workspace.findFiles(relativePattern);

        for (const file of files) {
            try {
                const content = fs.readFileSync(file.fsPath, 'utf-8');
                // Ignorer complètement les fichiers qui ne sont pas dans le dossier composables
                if (!file.fsPath.includes(path.sep + 'composables' + path.sep)) {
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
                        path: file.fsPath,
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
        const relativePattern = new vscode.RelativePattern(dir, '**/*.{ts,js}');
        const files = await vscode.workspace.findFiles(relativePattern);

        for (const file of files) {
            try {
                const content = fs.readFileSync(file.fsPath, 'utf-8');
                const defineStoreRegex = /defineStore\s*\(\s*(['"`])(.*?)\1/g;
                let match: RegExpExecArray | null;

                while ((match = defineStoreRegex.exec(content))) {
                    storeInfos.push({
                        name: match[2],
                        path: file.fsPath,
                        isAutoImported: true
                    });
                }
            } catch (e) {
                console.error(`Error reading store file ${file.fsPath}:`, e);
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
            const results: vscode.Location[] = [];

            // Recherche standard des références via VS Code
            const references = await vscode.commands.executeCommand<vscode.Location[]>(
                'vscode.executeReferenceProvider',
                document.uri,
                new vscode.Position(position.line, position.character + name.length - 1)
            ) || [];

            // Filtrer les fichiers générés
            for (const ref of references) {
                if (!ref.uri.fsPath.includes('.nuxt') &&
                    !(ref.uri.fsPath === document.uri.fsPath && ref.range.start.line === position.line)) {
                    results.push(ref);
                }
            }

            // Utiliser findFiles pour trouver tous les fichiers pertinents dans le workspace
            const uris = await vscode.workspace.findFiles('**/*.{vue,js,ts}');

            for (const uri of uris) {
                // Ignorer les fichiers générés et le fichier courant
                if (uri.fsPath.includes('node_modules') ||
                    uri.fsPath.includes('.nuxt') ||
                    uri.fsPath.includes('.output') ||
                    uri.fsPath.includes('dist') ||
                    uri.fsPath === document.uri.fsPath) {
                    continue;
                }

                let content: string;
                try {
                    content = fs.readFileSync(uri.fsPath, 'utf-8');
                } catch {
                    continue;
                }

                // Rechercher les utilisations du composable
                const usageRegex = new RegExp(`\\b(${name}\\s*\\(|${name}\\s*<)`, 'g'); // Inclut les appels avec génériques
                let match;

                while ((match = usageRegex.exec(content)) !== null) {
                    const matchText = match[1];
                    const index = match.index;

                    // Calculer la position à la main
                    const start = this.indexToPosition(content, index);
                    const end = this.indexToPosition(content, index + matchText.length);

                    results.push(new vscode.Location(
                        uri,
                        new vscode.Range(
                            new vscode.Position(start.line, start.character),
                            new vscode.Position(end.line, end.character)
                        )
                    ));
                }
            }

            return results;
        } catch (e) {
            console.error('Error finding references:', e);
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

    /**
   * Trouver les références pour composants Nuxt
   */
    private async findComponentReferences(document: vscode.TextDocument, componentName: string): Promise<vscode.Location[]> {
        if (!this.nuxtProjectRoot) return [];

        console.log(componentName);


        // Identification du nom du composant Nuxt
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

        // Version kebab-case du nom du composant
        const kebab = this.pascalToKebabCase(nuxtComponentName);
        const results: vscode.Location[] = [];

        // Utiliser findFiles pour trouver tous les fichiers pertinents dans le workspace
        const uris = await vscode.workspace.findFiles('**/*.{vue,js,ts}');

        for (const uri of uris) {
            if (uri.fsPath.includes('node_modules') ||
                uri.fsPath.includes('.nuxt') ||
                uri.fsPath.includes('.output') ||
                uri.fsPath.includes('dist') ||
                path.basename(uri.fsPath) === 'app.vue' ||
                path.basename(uri.fsPath) === 'error.vue') {
                continue;
            }

            let content: string;
            try {
                content = fs.readFileSync(uri.fsPath, 'utf-8');
            } catch {
                continue;
            }

            // Recherche des balises ouvrantes avec potentiellement plusieurs lignes
            const searchPatterns = [
                // Pour le format PascalCase
                new RegExp(`<${nuxtComponentName}(\\s[\\s\\S]*?)?\\s*(/?)>`, 'gs'),
                // Pour le format kebab-case
                new RegExp(`<${kebab}(\\s[\\s\\S]*?)?\\s*(/?)>`, 'gs')
            ];

            for (const regex of searchPatterns) {
                let match;
                while ((match = regex.exec(content)) !== null) {
                    const matchText = match[0];
                    const index = match.index;

                    // Calculer la position à la main
                    const before = content.slice(0, index);
                    const line = before.split('\n').length - 1;
                    const lineStartIndex = before.lastIndexOf('\n') + 1;
                    const col = index - lineStartIndex;

                    // Calculer la position de fin en tenant compte des sauts de ligne
                    const matchLines = matchText.split('\n');
                    const endLine = line + matchLines.length - 1;
                    const endCol = matchLines.length > 1
                        ? matchLines[matchLines.length - 1].length
                        : col + matchText.length;

                    results.push(new vscode.Location(
                        uri,
                        new vscode.Range(
                            new vscode.Position(line, col),
                            new vscode.Position(endLine, endCol)
                        )
                    ));
                }
            }
        }

        return results;
    }

    /**
     * Trouver les références pour un plugin Nuxt
     */
    private async findPluginReferences(pluginName: string): Promise<vscode.Location[]> {
        if (!this.nuxtProjectRoot) return [];

        const references: vscode.Location[] = [];
        // Utilisé pour suivre les références déjà ajoutées et éviter les duplications
        const addedReferences = new Set<string>();

        // Find the plugin file first
        const pluginUris = await vscode.workspace.findFiles(
            `**/plugins/${pluginName}.{js,ts}`,
            '**/node_modules/**'
        );

        if (pluginUris.length === 0) return references;

        const pluginPath = pluginUris[0].fsPath;
        let pluginContent: string;

        try {
            pluginContent = fs.readFileSync(pluginPath, 'utf-8');
        } catch (e) {
            return references;
        }

        // Extract provides and directives
        let provides: string[] = [];
        let hasDirectives: boolean = false;
        let directives: string[] = [];

        try {
            // 1. Classic detection via nuxtApp.provide('key', ...)
            const provideRegex = /nuxtApp\.provide\s*\(\s*['"`]([$\w]+)['"`]/g;
            let match: RegExpExecArray | null;
            while ((match = provideRegex.exec(pluginContent))) {
                provides.push(match[1]);
            }

            // 2. Advanced detection via `provide: { key: value }` including ES6 shorthand
            const provideObjectRegex = /provide\s*:\s*\{([\s\S]*?)\}/g;

            // Improved regex that captures three patterns:
            // 1. 'key': value or "key": value or `key`: value
            // 2. key: value
            // 3. key, (ES6 shorthand)
            const keyRegex = /(?:['"`]?([$\w]+)['"`]?\s*:|(\b[$\w]+),)/g;

            let provideObjectMatch: RegExpExecArray | null;
            while ((provideObjectMatch = provideObjectRegex.exec(pluginContent))) {
                const keysBlock = provideObjectMatch[1];
                let keyMatch: RegExpExecArray | null;
                while ((keyMatch = keyRegex.exec(keysBlock))) {
                    // keyMatch[1] captures the key from pattern 1 or 2
                    // keyMatch[2] captures the key from ES6 shorthand (pattern 3)
                    const key = keyMatch[1] || keyMatch[2];
                    if (key) {
                        provides.push(key);
                    }
                }
            }

            // Éliminer les doublons dans les clés fournies
            provides = [...new Set(provides)];

            // 3. Detect directives
            const directiveRegex = /nuxtApp\.vueApp\.directive\s*\(\s*['"`]([\w-]+)['"`]/g;
            while ((match = directiveRegex.exec(pluginContent))) {
                hasDirectives = true;
                directives.push(match[1]);
            }

            // Éliminer les doublons dans les directives
            directives = [...new Set(directives)];

            // 🔍 DEBUG - show detected keys in plugins
            if (provides.length === 0 && directives.length === 0) {
                console.warn(`[PluginScanner] No provide/directive detected for ${pluginName}`);
            } else {
                console.log(`[PluginScanner] Plugin "${pluginName}" exposes:`, provides, directives);
            }
        } catch (e) {
            console.error(`[PluginScanner] Error analyzing plugin ${pluginName}:`, e);
            return references;
        }

        // Find all potential files that could reference the plugin
        const allFileUris = await vscode.workspace.findFiles(
            '**/*.{vue,js,ts}',
            '**/node_modules/**'
        );

        for (const uri of allFileUris) {
            if (uri.fsPath.includes('.nuxt') || uri.fsPath === pluginPath) continue;

            try {
                const fileContent = fs.readFileSync(uri.fsPath, 'utf-8');

                // Check for provides usage
                for (const key of provides) {
                    const patterns = [
                        new RegExp(`useNuxtApp\\(\\)\\s*\\.\\s*\\$${key}\\b`, 'g'),
                        new RegExp(`(const|let|var)\\s+\\{[^}]*\\$${key}\\b[^}]*\\}\\s*=\\s*(useNuxtApp\\(\\)|nuxtApp)`, 'g'),
                        new RegExp(`nuxtApp\\s*\\.\\s*\\$${key}\\b`, 'g'),
                        new RegExp(`Vue\\.prototype\\.\\$${key}\\b`, 'g'),
                        new RegExp(`app\\.\\$${key}\\b`, 'g'),
                        new RegExp(`this\\.\\$${key}\\b`, 'g'),
                        new RegExp(`const\\s+nuxtApp\\s*=\\s*useNuxtApp\\(\\)[^]*?\\{[^}]*\\$${key}\\b[^}]*\\}\\s*=\\s*nuxtApp`, 'gs'),
                        // Ajout pour détecter la destructuration directe
                        new RegExp(`const\\s*\\{\\s*\\$${key}\\s*\\}\\s*=\\s*useNuxtApp\\(\\)`, 'g')
                    ];

                    for (const regex of patterns) {
                        let match: RegExpExecArray | null;
                        while ((match = regex.exec(fileContent))) {
                            const start = this.indexToPosition(fileContent, match.index);
                            const end = this.indexToPosition(fileContent, match.index + match[0].length);

                            // Créer une clé unique pour cette référence
                            const refKey = `${uri.fsPath}:${start.line}:${start.character}:${end.line}:${end.character}`;

                            // Vérifier si cette référence a déjà été ajoutée
                            if (!addedReferences.has(refKey)) {
                                addedReferences.add(refKey);
                                references.push(new vscode.Location(
                                    uri,
                                    new vscode.Range(
                                        new vscode.Position(start.line, start.character),
                                        new vscode.Position(end.line, end.character)
                                    )
                                ));
                            }
                        }
                    }
                }

                // Check for directives usage
                if (hasDirectives) {
                    for (const directive of directives) {
                        const directiveRegex = new RegExp(`\\sv-${directive}\\b|\\s:v-${directive}\\b`, 'g');
                        let match: RegExpExecArray | null;

                        while ((match = directiveRegex.exec(fileContent))) {
                            const start = this.indexToPosition(fileContent, match.index);
                            const end = this.indexToPosition(fileContent, match.index + match[0].length);

                            // Créer une clé unique pour cette référence
                            const refKey = `${uri.fsPath}:${start.line}:${start.character}:${end.line}:${end.character}`;

                            // Vérifier si cette référence a déjà été ajoutée
                            if (!addedReferences.has(refKey)) {
                                addedReferences.add(refKey);
                                references.push(new vscode.Location(
                                    uri,
                                    new vscode.Range(
                                        new vscode.Position(start.line, start.character),
                                        new vscode.Position(end.line, end.character)
                                    )
                                ));
                            }
                        }
                    }
                }

                // Check for direct imports of the plugin
                const importRegex = new RegExp(`import\\s+[^;]*['\`"]~/plugins/${pluginName}['\`"]`, 'g');
                let match: RegExpExecArray | null;

                while ((match = importRegex.exec(fileContent))) {
                    const start = this.indexToPosition(fileContent, match.index);
                    const end = this.indexToPosition(fileContent, match.index + match[0].length);

                    // Créer une clé unique pour cette référence
                    const refKey = `${uri.fsPath}:${start.line}:${start.character}:${end.line}:${end.character}`;

                    // Vérifier si cette référence a déjà été ajoutée
                    if (!addedReferences.has(refKey)) {
                        addedReferences.add(refKey);
                        references.push(new vscode.Location(
                            uri,
                            new vscode.Range(
                                new vscode.Position(start.line, start.character),
                                new vscode.Position(end.line, end.character)
                            )
                        ));
                    }
                }
            } catch (e) {
                // Ignore reading errors
            }
        }

        return references;
    }

    /**
     * Trouver les références pour un middleware
     */
    private async findMiddlewareReferences(middlewareName: string): Promise<vscode.Location[]> {
        // Utiliser findFiles pour trouver toutes les pages Vue du projet
        const uris = await vscode.workspace.findFiles('**/pages/**/*.vue');
        const results: vscode.Location[] = [];

        for (const uri of uris) {
            let content: string;
            try {
                content = fs.readFileSync(uri.fsPath, 'utf-8');
            } catch {
                continue;
            }

            // Rechercher les blocs definePageMeta
            const definePageMetaRegex = /definePageMeta\s*\(\s*\{[^}]*\}/g;
            let metaMatch;

            while ((metaMatch = definePageMetaRegex.exec(content)) !== null) {
                const metaContent = metaMatch[0];
                const metaStartIndex = metaMatch.index;

                // Cas 1: middleware en tant que chaîne unique - middleware: 'chat'
                const singleMiddlewareRegex = new RegExp(`middleware\\s*:\\s*(['"\`])(${middlewareName})\\1`, 'g');
                let singleMatch;

                while ((singleMatch = singleMiddlewareRegex.exec(metaContent)) !== null) {
                    // Calculer la position exacte pour le middleware
                    const middlewareValueIndex = metaContent.indexOf(singleMatch[1] + middlewareName + singleMatch[1], singleMatch.index);
                    const exactIndex = metaStartIndex + middlewareValueIndex + 1; // +1 pour sauter le guillemet d'ouverture

                    // Calculer la position à la main
                    const start = this.indexToPosition(content, exactIndex);
                    const end = this.indexToPosition(content, exactIndex + middlewareName.length);

                    results.push(new vscode.Location(
                        uri,
                        new vscode.Range(
                            new vscode.Position(start.line, start.character),
                            new vscode.Position(end.line, end.character)
                        )
                    ));
                }

                // Cas 2: middleware en tant que tableau - middleware: ['mobile-only', 'chat']
                const arrayMiddlewareRegex = /middleware\s*:\s*\[([^\]]*)\]/g;
                let arrayMatch;

                while ((arrayMatch = arrayMiddlewareRegex.exec(metaContent)) !== null) {
                    const arrayContent = arrayMatch[1];
                    const itemRegex = new RegExp(`(['"\`])(${middlewareName})\\1`, 'g');
                    let itemMatch;

                    while ((itemMatch = itemRegex.exec(arrayContent)) !== null) {
                        // Calculer la position exacte dans le tableau
                        const arrayStartIndex = metaContent.indexOf(arrayContent, arrayMatch.index);
                        const middlewareInArrayIndex = arrayContent.indexOf(itemMatch[0]);
                        const exactIndex = metaStartIndex + arrayStartIndex + middlewareInArrayIndex + 1; // +1 pour sauter le guillemet d'ouverture

                        // Calculer la position à la main
                        const start = this.indexToPosition(content, exactIndex);
                        const end = this.indexToPosition(content, exactIndex + middlewareName.length);

                        results.push(new vscode.Location(
                            uri,
                            new vscode.Range(
                                new vscode.Position(start.line, start.character),
                                new vscode.Position(end.line, end.character)
                            )
                        ));
                    }
                }
            }
        }

        return results;
    }

    /**
     * Trouver les références pour un layout
     */
    private async findLayoutReferences(layoutName: string): Promise<vscode.Location[]> {
        const uris = await vscode.workspace.findFiles('**/*.vue');
        const results: vscode.Location[] = [];

        for (const uri of uris) {
            // Utilise la lecture de fichier Node
            let content: string;
            try {
                content = fs.readFileSync(uri.fsPath, 'utf-8');
            } catch {
                continue;
            }

            const regex = new RegExp(`layout\\s*:\\s*(['"\`])${layoutName}\\1`, 'g');
            let match;
            while ((match = regex.exec(content)) !== null) {
                // Calcul position à la main
                const start = this.indexToPosition(content, match.index);
                const end = this.indexToPosition(content, match.index + match[0].length);
                results.push(new vscode.Location(
                    uri,
                    new vscode.Range(
                        new vscode.Position(start.line, start.character),
                        new vscode.Position(end.line, end.character)
                    )
                ));
            }
        }

        return results;
    }

    private indexToPosition(content: string, index: number): { line: number, character: number } {
        const lines = content.slice(0, index).split('\n');
        const line = lines.length - 1;
        const character = lines[lines.length - 1].length;
        return { line, character };
    }

    /**
     * Trouver les références pour un store
     */
    private async findStoreReferences(storeName: string): Promise<vscode.Location[]> {
        try {
            // Rechercher à la fois par le nom du hook et le nom du store dans defineStore
            const normalizedName = storeName
                .split(/[-_\s]/)
                .map(s => s.charAt(0).toUpperCase() + s.slice(1))
                .join('');

            const storeHookName = `use${normalizedName}Store`;
            // Support pour différentes variations de nommage du store
            const possibleStoreIds = [
                storeName,
                storeName.replace(/-/g, ' '),
                storeName.replace(/-/g, '_'),
                // Gérer aussi le cas où storeName est au singulier mais défini au pluriel
                `${storeName}s`,
                `${storeName.replace(/-/g, ' ')}s`,
                `${storeName.replace(/-/g, '_')}s`
            ];

            const uris = await vscode.workspace.findFiles('**/*.{vue,js,ts}');
            const results: vscode.Location[] = [];
            const storeDefinitions: Map<string, string> = new Map(); // Pour stocker les id -> hookName
            const storeDefinitionFiles: Set<string> = new Set(); // Pour stocker les chemins des fichiers de définition de store

            // Première passe: trouver toutes les définitions de store
            for (const uri of uris) {
                if (this.shouldSkipFile(uri.fsPath)) continue;

                let content: string;
                try {
                    content = fs.readFileSync(uri.fsPath, 'utf-8');
                } catch {
                    continue;
                }

                // Chercher les définitions de store
                const defineStoreRegex = /defineStore\s*\(\s*['"]([^'"]+)['"]/g;
                let defineMatch;

                while ((defineMatch = defineStoreRegex.exec(content)) !== null) {
                    const storeId = defineMatch[1];

                    // Vérifier si ce fichier définit un des stores que nous recherchons
                    if (possibleStoreIds.includes(storeId)) {
                        storeDefinitionFiles.add(uri.fsPath);
                    }

                    // Trouver le nom du hook associé à cette définition
                    const hookNameRegex = /const\s+(\w+)\s*=\s*defineStore\s*\(\s*['"]([^'"]+)['"]/g;
                    hookNameRegex.lastIndex = 0; // Réinitialiser l'index

                    let hookMatch;
                    while ((hookMatch = hookNameRegex.exec(content)) !== null) {
                        if (hookMatch[2] === storeId) {
                            storeDefinitions.set(storeId, hookMatch[1]);
                            break;
                        }
                    }
                }
            }

            // Deuxième passe: chercher les références, mais exclure les fichiers de définition
            for (const uri of uris) {
                if (this.shouldSkipFile(uri.fsPath)) continue;

                // Exclure les fichiers de définition du store
                if (storeDefinitionFiles.has(uri.fsPath)) continue;

                let content: string;
                try {
                    content = fs.readFileSync(uri.fsPath, 'utf-8');
                } catch {
                    continue;
                }

                // Chercher les usages du hook par nom conventionnel
                const hookRegex = new RegExp(`\\b${storeHookName}\\b`, 'g');
                this.findMatches(hookRegex, content, uri, results);

                // Chercher aussi les usages par ID de store (pour la forme `const store = useStore('store-id')`)
                for (const storeId of possibleStoreIds) {
                    const storeIdRegex = new RegExp(`useStore\\s*\\(\\s*['"]${storeId}['"]\\s*\\)`, 'g');
                    this.findMatches(storeIdRegex, content, uri, results);

                    // Chercher les usages des hooks associés aux IDs trouvés dans la première passe
                    if (storeDefinitions.has(storeId)) {
                        const hookName = storeDefinitions.get(storeId);
                        const customHookRegex = new RegExp(`\\b${hookName}\\b`, 'g');
                        this.findMatches(customHookRegex, content, uri, results);
                    }
                }
            }

            return results;
        } catch (e) {
            console.error('Error:', e);
            return [];
        }
    }

    private shouldSkipFile(fsPath: string): boolean {
        return fsPath.includes('node_modules') ||
            fsPath.includes('.nuxt') ||
            fsPath.includes('.output') ||
            fsPath.includes('dist');
    }

    private findMatches(regex: RegExp, content: string, uri: vscode.Uri, results: vscode.Location[]): void {
        let match;
        while ((match = regex.exec(content)) !== null) {
            const start = this.indexToPosition(content, match.index);
            const end = this.indexToPosition(content, match.index + match[0].length);

            results.push(new vscode.Location(
                uri,
                new vscode.Range(
                    new vscode.Position(start.line, start.character),
                    new vscode.Position(end.line, end.character)
                )
            ));
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

    /**
   * Analyser les répertoires d'utilitaires
   */
    private async scanUtilsDirectories(): Promise<void> {
        if (!this.nuxtProjectRoot) return;

        // Liste des dossiers potentiels à scanner
        const utilsDirNames = ['utils', 'helpers', 'lib', 'constants', 'schemas', 'validationSchemas'];
        const utilsInfos: NuxtComponentInfo[] = [];

        for (const dirName of utilsDirNames) {
            const dirs = await this.findAllDirsByName(dirName);

            for (const dir of dirs) {
                if (!fs.existsSync(dir)) continue;

                const relativePattern = new vscode.RelativePattern(dir, '**/*.{ts,js}');
                const files = await vscode.workspace.findFiles(relativePattern);

                for (const file of files) {
                    try {
                        const content = fs.readFileSync(file.fsPath, 'utf-8');

                        // Éviter de scanner les fichiers qui contiennent des définitions de store ou de composables
                        if (content.includes('defineStore') ||
                            file.fsPath.includes(path.sep + 'composables' + path.sep) ||
                            file.fsPath.includes(path.sep + 'stores' + path.sep)) {
                            continue;
                        }

                        // Détecter les exports
                        const exportRegex = /export\s+(const|function|async function|interface|type|enum|class)\s+(\w+)/g;
                        let match: RegExpExecArray | null;

                        while ((match = exportRegex.exec(content))) {
                            const exportType = match[1];
                            const name = match[2];

                            utilsInfos.push({
                                name: name,
                                path: file.fsPath,
                                isAutoImported: false, // Les utilitaires ne sont généralement pas auto-importés par défaut
                                exportType: exportType // Stocker le type d'export pour différencier
                            });
                        }
                    } catch (e) {
                        console.error(`Error scanning utils file ${file.fsPath}:`, e);
                    }
                }
            }
        }

        this.autoImportCache.set('utils', utilsInfos);
    }

    /**
   * Trouver toutes les références pour un utilitaire
   */
    private async findUtilsReferences(document: vscode.TextDocument, name: string, position: vscode.Position): Promise<vscode.Location[]> {
        try {
            const results: vscode.Location[] = [];

            const uris = await vscode.workspace.findFiles('**/*.{vue,js,ts}');

            // Première passe : utiliser le provider de références natif de VS Code
            const nativeReferences = await vscode.commands.executeCommand<vscode.Location[]>(
                'vscode.executeReferenceProvider',
                document.uri,
                new vscode.Position(position.line, position.character + name.length - 1)
            ) || [];

            // Ajouter les références natives filtrées
            for (const ref of nativeReferences) {
                if (!ref.uri.fsPath.includes('.nuxt') &&
                    !ref.uri.fsPath.includes('node_modules') &&
                    !ref.uri.fsPath.includes('.output') &&
                    !ref.uri.fsPath.includes('dist') &&
                    !(ref.uri.fsPath === document.uri.fsPath && ref.range.start.line === position.line)) {
                    results.push(ref);
                }
            }

            // Deuxième passe : recherche dans tous les fichiers du workspace
            for (const uri of uris) {
                // Exclure les fichiers non pertinents
                if (uri.fsPath.includes('node_modules') ||
                    uri.fsPath.includes('.nuxt') ||
                    uri.fsPath.includes('.output') ||
                    uri.fsPath.includes('dist')) {
                    continue;
                }

                // Ignorer le fichier source
                if (uri.fsPath === document.uri.fsPath) continue;

                let content: string;
                try {
                    content = fs.readFileSync(uri.fsPath, 'utf-8');
                } catch {
                    continue;
                }

                // Rechercher les imports
                const importRegex = new RegExp(`import\\s+{[^}]*\\b${name}\\b[^}]*}\\s+from\\s+(['"\`][^'\`"]*['"\`])`, 'g');
                let match;

                while ((match = importRegex.exec(content)) !== null) {
                    const importPath = match[1].slice(1, -1); // Enlever les guillemets

                    // Vérifier si l'import pointe vers notre fichier
                    if (this.isImportPointingToFile(importPath, uri.fsPath, document.uri.fsPath)) {
                        const nameIndex = content.indexOf(name, match.index);

                        if (nameIndex !== -1) {
                            const start = this.indexToPosition(content, nameIndex);

                            const end = this.indexToPosition(content, nameIndex + name.length);

                            results.push(new vscode.Location(
                                uri,
                                new vscode.Range(
                                    new vscode.Position(start.line, start.character),
                                    new vscode.Position(end.line, end.character)
                                )
                            ));
                        }
                    }
                }

                // Rechercher les utilisations directes (non imports)
                // 1. Pour les types / génériques : <MyComponent<MyType>>
                const typeUsageRegex = new RegExp(`[:<]\\s*${name}(\\[\\])?\\b`, 'g');

                // 2. Pour les usages JS classiques (évite les strings/HTML)
                const usageRegex = new RegExp(`(?<!['"\`<>])\\b${name}\\b(?!\\s*:)`, 'g');

                // 3. Pour les bindings dans les templates Vue
                const templateBindingRegex = new RegExp(`[:@\\w\\-]+=['"]\\s*[^'"]*\\b${name}\\b[^'"]*['"]`, 'g');

                const seen = new Set<string>();

                // Pass 1 : types
                while ((match = typeUsageRegex.exec(content)) !== null) {
                    const matchStart = match.index + match[0].indexOf(name);
                    const start = this.indexToPosition(content, matchStart);
                    const end = this.indexToPosition(content, matchStart + name.length);

                    const locationKey = `${uri.fsPath}:${start.line}:${start.character}`;
                    if (!seen.has(locationKey)) {
                        seen.add(locationKey);
                        results.push(new vscode.Location(
                            uri,
                            new vscode.Range(
                                new vscode.Position(start.line, start.character),
                                new vscode.Position(end.line, end.character)
                            )
                        ));
                    }
                }

                // Pass 2 : usages JS
                while ((match = usageRegex.exec(content)) !== null) {
                    const matchStart = match.index + (match[0].length - name.length);

                    const lineStart = content.lastIndexOf('\n', matchStart) + 1;
                    const lineEnd = content.indexOf('\n', matchStart);
                    const line = content.substring(lineStart, lineEnd !== -1 ? lineEnd : content.length);

                    if (
                        line.includes('<') && line.includes('>') || // HTML
                        line.includes(`'${name}'`) || line.includes(`"${name}"`) || line.includes(`\`${name}\``)
                    ) {
                        continue;
                    }

                    const start = this.indexToPosition(content, matchStart);
                    const end = this.indexToPosition(content, matchStart + name.length);

                    const locationKey = `${uri.fsPath}:${start.line}:${start.character}`;
                    if (!seen.has(locationKey)) {
                        seen.add(locationKey);
                        results.push(new vscode.Location(
                            uri,
                            new vscode.Range(
                                new vscode.Position(start.line, start.character),
                                new vscode.Position(end.line, end.character)
                            )
                        ));
                    }
                }

                // ✅ Pass 3 : templates Vue
                while ((match = templateBindingRegex.exec(content)) !== null) {
                    const matchStart = match.index + match[0].indexOf(name);
                    const start = this.indexToPosition(content, matchStart);
                    const end = this.indexToPosition(content, matchStart + name.length);

                    const locationKey = `${uri.fsPath}:${start.line}:${start.character}`;
                    if (!seen.has(locationKey)) {
                        seen.add(locationKey);
                        results.push(new vscode.Location(
                            uri,
                            new vscode.Range(
                                new vscode.Position(start.line, start.character),
                                new vscode.Position(end.line, end.character)
                            )
                        ));
                    }
                }

            }

            return results;
        } catch (e) {
            console.error('Error finding utils references:', e);
            return [];
        }
    }

    /**
     * Vérifie si un chemin d'import pointe vers notre fichier
     */
    private isImportPointingToFile(importPath: string, importingFile: string, targetFile: string): boolean {
        // Gérer les importations relatives et alias (~/, @/)
        if (importPath.startsWith('./') || importPath.startsWith('../')) {
            const importingDir = path.dirname(importingFile);
            const resolvedPath = path.resolve(importingDir, importPath);
            const resolvedWithExt = this.resolveWithExtension(resolvedPath);
            return resolvedWithExt === targetFile;
        } else if (importPath.startsWith('~/') || importPath.startsWith('@/')) {
            const aliasPath = importPath.substring(2); // Enlever ~/ ou @/
            const resolvedPath = path.join(this.nuxtProjectRoot!, aliasPath);
            const resolvedWithExt = this.resolveWithExtension(resolvedPath);
            return resolvedWithExt === targetFile;
        }
        return false;
    }

    /**
     * Résoudre le chemin avec l'extension correcte
     */
    private resolveWithExtension(filePath: string): string {
        const extensions = ['.ts', '.js', '.vue'];

        // Si le chemin a déjà une extension valide
        if (extensions.includes(path.extname(filePath))) {
            return filePath;
        }

        // Essayer chaque extension
        for (const ext of extensions) {
            const pathWithExt = filePath + ext;
            if (fs.existsSync(pathWithExt)) {
                return pathWithExt;
            }
        }

        // Essayer avec /index
        for (const ext of extensions) {
            const indexPath = path.join(filePath, `index${ext}`);
            if (fs.existsSync(indexPath)) {
                return indexPath;
            }
        }

        return filePath;
    }
}

export function deactivate() { }