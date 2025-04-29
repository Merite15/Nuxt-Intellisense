import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { PathUtils } from '../utils/pathUtils';
import { NuxtComponentInfo } from '../types';

interface ReferenceCache {
    references: vscode.Location[];
    timestamp: number;
}

interface ComponentDirsCache {
    dirs: string[];
    timestamp: number;
}

export class ComponentService {
    private referenceCache: Map<string, ReferenceCache> = new Map();
    private componentDirsCache: ComponentDirsCache | null = null;
    private componentNameCache: Map<string, string> = new Map(); // Cache pour les noms de composants par chemin
    private referenceCacheTTL: number = 300000; // 5 minutes
    private dirsCacheTTL: number = 600000; // 10 minutes
    private fileWatcher: vscode.FileSystemWatcher | undefined;
    private initialized: boolean = false;

    constructor(
        private autoImportCache: Map<string, NuxtComponentInfo[]>,
        private nuxtProjectRoot: string
    ) {
        console.log('[ComponentService] Initializing with nuxtProjectRoot:', nuxtProjectRoot);
    }

    /**
     * Initialise le service de composants une seule fois
     */
    public async initialize(): Promise<void> {
        if (this.initialized) {
            return;
        }

        console.log('[ComponentService] Running initialization tasks');

        // Précharger les répertoires de composants (coûteux)
        await this.getCachedComponentDirs();

        // Mettre en place un watcher ciblé pour les fichiers Vue
        this.setupFileWatcher();

        this.initialized = true;
    }

    private setupFileWatcher() {
        // Surveiller uniquement les fichiers Vue dans les répertoires de composants
        this.fileWatcher = vscode.workspace.createFileSystemWatcher(
            '**/components/**/*.vue',
            false, // Ne pas ignorer les créations
            false, // Ne pas ignorer les changements
            false  // Ne pas ignorer les suppressions
        );

        // Lors d'un changement de fichier, invalider seulement le cache spécifique
        this.fileWatcher.onDidChange(uri => this.invalidateSpecificCache(uri.fsPath));
        this.fileWatcher.onDidCreate(uri => this.invalidateSpecificCache(uri.fsPath));
        this.fileWatcher.onDidDelete(uri => this.invalidateSpecificCache(uri.fsPath));

        // S'assurer que le watcher est disposé lorsqu'il n'est plus nécessaire
        vscode.Disposable.from(this.fileWatcher);
    }

    /**
     * Invalide seulement les entrées de cache liées à un fichier spécifique
     */
    private invalidateSpecificCache(filePath: string): void {
        console.log('[invalidateSpecificCache] Invalidating cache for file:', filePath);

        // Si le fichier est un composant, invalider son propre cache
        const nuxtComponentName = this.getCachedComponentName(filePath);
        if (nuxtComponentName) {
            // Supprimer toutes les entrées de cache qui contiennent ce nom de composant
            const keysToRemove: string[] = [];
            for (const cacheKey of this.referenceCache.keys()) {
                if (cacheKey.includes(nuxtComponentName)) {
                    keysToRemove.push(cacheKey);
                }
            }

            keysToRemove.forEach(key => {
                console.log('[invalidateSpecificCache] Removing cache entry:', key);
                this.referenceCache.delete(key);
            });
        }

        // Pour un fichier quelconque, on doit invalider les références qui peuvent l'utiliser
        // Mais nous conservons cette logique simple pour l'instant
    }

    async provideCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
        // S'assurer que l'initialisation est faite
        await this.initialize();

        console.log('[provideCodeLenses] Starting for document:', document.fileName);
        const lenses: vscode.CodeLens[] = [];

        const fileName = path.basename(document.fileName);
        console.log('[provideCodeLenses] Processing file:', fileName);

        if (fileName === 'app.vue' || fileName === 'error.vue') {
            console.log('[provideCodeLenses] Skipping app.vue or error.vue file');
            return [];
        }

        // Utiliser la version mise en cache des répertoires
        const allComponentDirs = await this.getCachedComponentDirs();

        // Obtenir le nom du composant Nuxt à partir du cache
        let nuxtComponentName = this.getCachedComponentName(document.uri.fsPath);

        if (!nuxtComponentName) {
            console.log('[provideCodeLenses] Component name not in cache, calculating it now');
            // On ne l'a pas encore dans le cache, le calculer
            for (const dir of allComponentDirs) {
                if (document.uri.fsPath.startsWith(dir)) {
                    nuxtComponentName = this.getNuxtComponentName(document.uri.fsPath, dir);
                    console.log('[provideCodeLenses] Found component name:', nuxtComponentName);
                    // Mettre en cache pour une utilisation future
                    this.componentNameCache.set(document.uri.fsPath, nuxtComponentName);
                    break;
                }
            }
        } else {
            console.log('[provideCodeLenses] Using cached component name:', nuxtComponentName);
        }

        const text = document.getText();

        const isPagesComponents = document.fileName.includes(`${path.sep}pages${path.sep}`) &&
            document.fileName.includes(`${path.sep}components${path.sep}`);
        console.log('[provideCodeLenses] isPagesComponents:', isPagesComponents);

        if (!isPagesComponents && document.fileName.includes(`${path.sep}layouts${path.sep}`)) {
            console.log('[provideCodeLenses] Skipping layouts component');
            return [];
        }

        let hasAddedLens = false;

        // Générer une clé unique pour ce composant dans ce document
        const documentCacheKey = document.uri.toString();

        // 2.1 Pour les composants avec <script setup>
        const scriptSetupRegex = /<script\s+[^>]*setup[^>]*>/g;
        console.log('[provideCodeLenses] Searching for script setup');

        let match: RegExpExecArray | null;

        while ((match = scriptSetupRegex.exec(text))) {
            console.log('[provideCodeLenses] Found script setup at index:', match.index);
            const pos = document.positionAt(match.index);
            const range = new vscode.Range(pos.line, 0, pos.line, 0);

            const cacheKey = `${documentCacheKey}:${nuxtComponentName}:setup`;
            const references = await this.getCachedReferences(cacheKey, String(nuxtComponentName));

            console.log('[provideCodeLenses] Found references count:', references.length);

            const referenceCount = references.length;

            lenses.push(
                new vscode.CodeLens(range, {
                    title: `🧩 ${referenceCount} reference${referenceCount > 1 ? 's' : ''} | ${nuxtComponentName}`,
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

        // 2.2 Pour les composants avec defineComponent
        if (!hasAddedLens) {
            console.log('[provideCodeLenses] Searching for defineComponent');
            const defineComponentRegex = /defineComponent\s*\(/g;

            while ((match = defineComponentRegex.exec(text))) {
                console.log('[provideCodeLenses] Found defineComponent at index:', match.index);
                const pos = document.positionAt(match.index);
                const range = new vscode.Range(pos.line, 0, pos.line, 0);

                const cacheKey = `${documentCacheKey}:${nuxtComponentName}:defineComponent`;
                const references = await this.getCachedReferences(cacheKey, String(nuxtComponentName));
                console.log('[provideCodeLenses] Found references count:', references.length);

                const referenceCount = references.length;

                lenses.push(
                    new vscode.CodeLens(range, {
                        title: `🧩 ${referenceCount} reference${referenceCount > 1 ? 's' : ''} | ${nuxtComponentName}`,
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

        // 2.3 Pour les composants Nuxt spécifiques
        if (!hasAddedLens) {
            console.log('[provideCodeLenses] Searching for defineNuxtComponent');
            const defineNuxtComponentRegex = /defineNuxtComponent\s*\(/g;

            while ((match = defineNuxtComponentRegex.exec(text))) {
                console.log('[provideCodeLenses] Found defineNuxtComponent at index:', match.index);
                const pos = document.positionAt(match.index);
                const range = new vscode.Range(pos.line, 0, pos.line, 0);

                const cacheKey = `${documentCacheKey}:${nuxtComponentName}:defineNuxtComponent`;
                const references = await this.getCachedReferences(cacheKey, String(nuxtComponentName));
                console.log('[provideCodeLenses] Found references count:', references.length);
                const referenceCount = references.length;

                lenses.push(
                    new vscode.CodeLens(range, {
                        title: `⚡ ${referenceCount} reference${referenceCount > 1 ? 's' : ''} | ${nuxtComponentName}`,
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
            console.log('[provideCodeLenses] Searching for template tag');
            const templateRegex = /<template[^>]*>/g;

            match = templateRegex.exec(text);

            if (match) {
                console.log('[provideCodeLenses] Found template tag at index:', match.index);
                const pos = document.positionAt(match.index);
                const range = new vscode.Range(pos.line, 0, pos.line, 0);

                const cacheKey = `${documentCacheKey}:${nuxtComponentName}:template`;
                const references = await this.getCachedReferences(cacheKey, String(nuxtComponentName));
                console.log('[provideCodeLenses] Found references count:', references.length);

                const referenceCount = references.length;

                lenses.push(
                    new vscode.CodeLens(range, {
                        title: `🧩 ${referenceCount} reference${referenceCount > 1 ? 's' : ''} | ${nuxtComponentName}`,
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

        console.log('[provideCodeLenses] Returning lenses count:', lenses.length);
        return lenses;
    }

    /**
     * Récupère le nom du composant depuis le cache
     */
    private getCachedComponentName(filePath: string): string | undefined {
        return this.componentNameCache.get(filePath);
    }

    /**
     * Récupère des références mises en cache ou les calcule si nécessaire
     */
    private async getCachedReferences(
        cacheKey: string,
        componentName: string
    ): Promise<vscode.Location[]> {
        const now = Date.now();
        const cachedData = this.referenceCache.get(cacheKey);

        // Retourner les références en cache si elles sont toujours valides
        if (cachedData && (now - cachedData.timestamp < this.referenceCacheTTL)) {
            console.log('[getCachedReferences] Using cached references for:', componentName);
            return cachedData.references;
        }

        // Sinon, trouver toutes les références et les mettre en cache
        console.log('[getCachedReferences] Cache miss, finding references for:', componentName);

        const references = await this.findComponentReferences(componentName);

        this.referenceCache.set(cacheKey, {
            references,
            timestamp: now
        });

        return references;
    }

    /**
     * Récupère les répertoires de composants mis en cache ou les calcule si nécessaire
     */
    private async getCachedComponentDirs(): Promise<string[]> {
        const now = Date.now();

        // Retourner les répertoires en cache s'ils sont toujours valides
        if (this.componentDirsCache && (now - this.componentDirsCache.timestamp < this.dirsCacheTTL)) {
            console.log('[getCachedComponentDirs] Using cached component directories');
            return this.componentDirsCache.dirs;
        }

        // Sinon, trouver tous les répertoires et les mettre en cache
        console.log('[getCachedComponentDirs] Cache miss, finding component directories');
        const dirs = await this.findAllComponentsDirs();

        this.componentDirsCache = {
            dirs,
            timestamp: now
        };

        return dirs;
    }

    /**
     * Recherche les références d'un composant spécifique
     */
    async findComponentReferences(
        componentName: string
    ): Promise<vscode.Location[]> {
        console.log('[findComponentReferences] Starting for component:', componentName);

        if (!componentName) {
            console.log('[findComponentReferences] No component name provided, returning empty array');
            return [];
        }

        const kebab = PathUtils.pascalToKebabCase(componentName);
        console.log('[findComponentReferences] Kebab case name:', kebab);

        const results: vscode.Location[] = [];

        const uris = await vscode.workspace.findFiles(
            '**/*.vue',
            '{**/node_modules/**,**/.nuxt/**,**/.output/**,**/dist/**,**/utils/**,**/lib/**,**/helpers/**,**/constants/**,**/shared/**, **/public/**,**/config/**, **/assets/**}'
        );

        console.log('[findComponentReferences] Found files to search:', uris.length);

        // Traiter les fichiers par lots pour éviter les problèmes de mémoire
        const batchSize = 50;
        for (let i = 0; i < uris.length; i += batchSize) {
            const batch = uris.slice(i, i + batchSize);
            const batchPromises = batch.map(async (uri) => {
                if (path.basename(uri.fsPath) === 'app.vue' ||
                    path.basename(uri.fsPath) === 'error.vue') {
                    return;
                }

                let content: string;
                try {
                    content = fs.readFileSync(uri.fsPath, 'utf-8');
                } catch (error) {
                    console.log('[findComponentReferences] Error reading file:', uri.fsPath, error);
                    return;
                }

                const searchPatterns = [
                    new RegExp(`<${componentName}(\\s[\\s\\S]*?)?\\s*(/?)>`, 'gs'),
                    new RegExp(`<${kebab}(\\s[\\s\\S]*?)?\\s*(/?)>`, 'gs')
                ];

                for (const regex of searchPatterns) {
                    let match;
                    while ((match = regex.exec(content)) !== null) {
                        console.log('[findComponentReferences] Found reference in file:', uri.fsPath);
                        const matchText = match[0];
                        const index = match.index;

                        const before = content.slice(0, index);
                        const line = before.split('\n').length - 1;
                        const lineStartIndex = before.lastIndexOf('\n') + 1;
                        const col = index - lineStartIndex;

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
            });

            await Promise.all(batchPromises);
        }

        console.log('[findComponentReferences] Total references found:', results.length);
        return results;
    }

    // Fonction pour vérifier si un chemin doit être ignoré
    private shouldIgnorePath(fullPath: string): boolean {
        const baseIgnoredDirs = new Set([
            // Dossiers système
            'node_modules',
            '.nuxt',
            '.output',
            'dist',
            '.git',
            '.github',
            'public',
            'config',

            // Dossiers utilitaires
            'utils',
            'lib',
            'helpers',
            'constants',
            'shared',

            // Dossiers de stores
            'store',
            'stores',

            'assets',

            // nuxt server
            'server'
        ]);

        const pathSegments = fullPath.split(path.sep);

        // Vérifier chaque segment du chemin
        for (const segment of pathSegments) {
            // Si un segment du chemin correspond à un dossier ignoré
            if (baseIgnoredDirs.has(segment)) {
                return true;
            }

            // Vérifier les patterns de layers (par exemple: admin/stores, client/utils, etc.)
            if (segment.endsWith('/store') ||
                segment.endsWith('/stores') ||
                segment.endsWith('/utils') ||
                segment.endsWith('/lib') ||
                segment.endsWith('/helpers') ||
                segment.endsWith('/constants') ||
                segment.endsWith('/shared') ||
                segment.endsWith('/public') ||
                segment.endsWith('/config')) {
                return true;
            }
        }

        return false;
    }

    async findAllComponentsDirs(): Promise<string[]> {
        console.log('[findAllComponentsDirs] Starting search in:', this.nuxtProjectRoot);
        const dirs: string[] = [];

        if (!this.nuxtProjectRoot) {
            console.log('[findAllComponentsDirs] No project root specified');
            return dirs;
        }

        const recurse = (dir: string) => {
            console.log('[findAllComponentsDirs] Searching directory:', dir);

            try {
                const entries = fs.readdirSync(dir, { withFileTypes: true });

                for (const entry of entries) {
                    const fullPath = path.join(dir, entry.name);

                    // Utiliser la nouvelle fonction de vérification
                    if (this.shouldIgnorePath(fullPath)) {
                        console.log('[findAllComponentsDirs] Skipping ignored path:', fullPath);
                        continue;
                    }

                    if (entry.isDirectory()) {
                        if (entry.name === 'components') {
                            console.log('[findAllComponentsDirs] Found components directory:', fullPath);
                            dirs.push(fullPath);
                        }
                        recurse(fullPath);
                    }
                }
            } catch (error) {
                console.error('[findAllComponentsDirs] Error reading directory:', dir, error);
            }
        };

        recurse(this.nuxtProjectRoot);
        console.log('[findAllComponentsDirs] Found directories:', dirs);
        return dirs;
    }

    private getNuxtComponentName(filePath: string, componentsDir: string): string {
        console.log('[getNuxtComponentName] Processing file:', filePath);
        console.log('[getNuxtComponentName] Components directory:', componentsDir);

        let relPath = path.relative(componentsDir, filePath).replace(/\.vue$/, '');
        console.log('[getNuxtComponentName] Relative path:', relPath);

        const parts = relPath.split(path.sep);

        if (parts[parts.length - 1].toLowerCase() === 'index') {
            console.log('[getNuxtComponentName] Removing index from parts');
            parts.pop();
        }

        const result = parts
            .filter(Boolean)
            .map(part =>
                part
                    .split('-')
                    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
                    .join('')
            )
            .join('');

        console.log('[getNuxtComponentName] Generated component name:', result);
        return result;
    }

    async scanComponentsDirectory(dir: string): Promise<void> {
        console.log('[scanComponentsDirectory] Starting scan of directory:', dir);

        if (!fs.existsSync(dir)) {
            console.log('[scanComponentsDirectory] Directory does not exist:', dir);
            return;
        }

        const componentInfos: NuxtComponentInfo[] = [];

        const files = await vscode.workspace.findFiles(
            '**/*.vue',
            '{**/node_modules/**,**/.nuxt/**,**/.output/**,**/dist/**,**/utils/**,**/lib/**,**/helpers/**,**/constants/**,**/shared/**, **/public/**,**/config/**, **/assets/**}',
        );

        console.log('[scanComponentsDirectory] Found files:', files.length);

        for (const file of files) {
            const componentName = path.basename(file.fsPath, '.vue');
            console.log('[scanComponentsDirectory] Processing component:', componentName);

            componentInfos.push({
                name: componentName,
                path: file.fsPath,
                isAutoImported: true
            });
        }

        console.log('[scanComponentsDirectory] Total components found:', componentInfos.length);
        this.autoImportCache.set('components', componentInfos);
    }

    /**
     * Invalide le cache complètement (à utiliser avec parcimonie)
     */
    public invalidateAllCaches(): void {
        console.log('[invalidateAllCaches] Clearing all caches');
        this.referenceCache.clear();
        this.componentDirsCache = null;
        this.componentNameCache.clear();
    }

    // S'assurer que les ressources sont libérées lorsqu'elles ne sont plus nécessaires
    public dispose(): void {
        if (this.fileWatcher) {
            this.fileWatcher.dispose();
        }
    }
}