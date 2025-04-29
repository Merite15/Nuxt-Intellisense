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
    }

    /**
     * Initialise le service de composants une seule fois
     */
    public async initialize(): Promise<void> {
        if (this.initialized) {
            return;
        }

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
                this.referenceCache.delete(key);
            });
        }
    }

    async provideCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
        // S'assurer que l'initialisation est faite
        await this.initialize();

        const lenses: vscode.CodeLens[] = [];

        const fileName = path.basename(document.fileName);

        if (fileName === 'app.vue' || fileName === 'error.vue') {
            return [];
        }

        // Utiliser la version mise en cache des répertoires
        const allComponentDirs = await this.getCachedComponentDirs();

        // Obtenir le nom du composant Nuxt à partir du cache
        let nuxtComponentName = this.getCachedComponentName(document.uri.fsPath);

        if (!nuxtComponentName) {
            // On ne l'a pas encore dans le cache, le calculer
            for (const dir of allComponentDirs) {
                if (document.uri.fsPath.startsWith(dir)) {
                    nuxtComponentName = this.getNuxtComponentName(document.uri.fsPath, dir);
                    // Mettre en cache pour une utilisation future
                    this.componentNameCache.set(document.uri.fsPath, nuxtComponentName);
                    break;
                }
            }
        } else {
        }

        const text = document.getText();

        const isPagesComponents = document.fileName.includes(`${path.sep}pages${path.sep}`) &&
            document.fileName.includes(`${path.sep}components${path.sep}`);

        if (!isPagesComponents && document.fileName.includes(`${path.sep}layouts${path.sep}`)) {
            return [];
        }

        let hasAddedLens = false;

        // Générer une clé unique pour ce composant dans ce document
        const documentCacheKey = document.uri.toString();

        // 2.1 Pour les composants avec <script setup>
        const scriptSetupRegex = /<script\s+[^>]*setup[^>]*>/g;

        let match: RegExpExecArray | null;

        while ((match = scriptSetupRegex.exec(text))) {
            const pos = document.positionAt(match.index);
            const range = new vscode.Range(pos.line, 0, pos.line, 0);

            const cacheKey = `${documentCacheKey}:${nuxtComponentName}:setup`;
            const references = await this.getCachedReferences(cacheKey, String(nuxtComponentName));

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
            const defineComponentRegex = /defineComponent\s*\(/g;

            while ((match = defineComponentRegex.exec(text))) {
                const pos = document.positionAt(match.index);
                const range = new vscode.Range(pos.line, 0, pos.line, 0);

                const cacheKey = `${documentCacheKey}:${nuxtComponentName}:defineComponent`;
                const references = await this.getCachedReferences(cacheKey, String(nuxtComponentName));

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
            const defineNuxtComponentRegex = /defineNuxtComponent\s*\(/g;

            while ((match = defineNuxtComponentRegex.exec(text))) {
                const pos = document.positionAt(match.index);
                const range = new vscode.Range(pos.line, 0, pos.line, 0);

                const cacheKey = `${documentCacheKey}:${nuxtComponentName}:defineNuxtComponent`;
                const references = await this.getCachedReferences(cacheKey, String(nuxtComponentName));
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
            const templateRegex = /<template[^>]*>/g;

            match = templateRegex.exec(text);

            if (match) {
                const pos = document.positionAt(match.index);
                const range = new vscode.Range(pos.line, 0, pos.line, 0);

                const cacheKey = `${documentCacheKey}:${nuxtComponentName}:template`;
                const references = await this.getCachedReferences(cacheKey, String(nuxtComponentName));

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
            return cachedData.references;
        }

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
            return this.componentDirsCache.dirs;
        }

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
        if (!componentName) {
            return [];
        }

        const kebab = PathUtils.pascalToKebabCase(componentName);

        const results: vscode.Location[] = [];

        const uris = await vscode.workspace.findFiles(
            '**/*.vue',
            '{**/node_modules/**,**/.nuxt/**,**/.output/**,**/dist/**,**/utils/**,**/lib/**,**/helpers/**,**/constants/**,**/shared/**, **/public/**,**/config/**, **/assets/**}'
        );

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
                    return;
                }

                const searchPatterns = [
                    new RegExp(`<${componentName}(\\s[\\s\\S]*?)?\\s*(/?)>`, 'gs'),
                    new RegExp(`<${kebab}(\\s[\\s\\S]*?)?\\s*(/?)>`, 'gs')
                ];

                for (const regex of searchPatterns) {
                    let match;
                    while ((match = regex.exec(content)) !== null) {
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
        const dirs: string[] = [];

        if (!this.nuxtProjectRoot) {
            return dirs;
        }

        const recurse = (dir: string) => {
            try {
                const entries = fs.readdirSync(dir, { withFileTypes: true });

                for (const entry of entries) {
                    const fullPath = path.join(dir, entry.name);

                    // Utiliser la nouvelle fonction de vérification
                    if (this.shouldIgnorePath(fullPath)) {
                        continue;
                    }

                    if (entry.isDirectory()) {
                        if (entry.name === 'components') {
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

        return dirs;
    }

    private getNuxtComponentName(filePath: string, componentsDir: string): string {
        let relPath = path.relative(componentsDir, filePath).replace(/\.vue$/, '');

        const parts = relPath.split(path.sep);

        if (parts[parts.length - 1].toLowerCase() === 'index') {
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

        return result;
    }

    async scanComponentsDirectory(dir: string): Promise<void> {
        if (!fs.existsSync(dir)) {
            return;
        }

        const componentInfos: NuxtComponentInfo[] = [];

        const files = await vscode.workspace.findFiles(
            '**/*.vue',
            '{**/node_modules/**,**/.nuxt/**,**/.output/**,**/dist/**,**/utils/**,**/lib/**,**/helpers/**,**/constants/**,**/shared/**, **/public/**,**/config/**, **/assets/**}',
        );

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
     * Invalide le cache complètement (à utiliser avec parcimonie)
     */
    public invalidateAllCaches(): void {
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