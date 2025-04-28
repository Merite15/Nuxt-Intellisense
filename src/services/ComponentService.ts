import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { PathUtils } from '../utils/pathUtils';
import { NuxtComponentInfo } from '../types';

interface ReferenceCache {
    references: vscode.Location[];
    timestamp: number;
}

export class ComponentService {
    private componentDirsCache: string[] | null = null;
    private referenceCache: Map<string, ReferenceCache> = new Map();
    private referenceCacheTTL: number = 300000; // 5 minutes comme fallback
    private fileWatcher: vscode.FileSystemWatcher | undefined;

    constructor(
        private autoImportCache: Map<string, NuxtComponentInfo[]>,
        private nuxtProjectRoot: string
    ) {
        console.log('[ComponentService] Initializing with nuxtProjectRoot:', nuxtProjectRoot);
        this.initializeComponentsCache();
        this.setupFileWatcher();
    }

    private setupFileWatcher() {
        // Surveiller les changements dans les fichiers Vue
        this.fileWatcher = vscode.workspace.createFileSystemWatcher(
            '**/*.vue',
            false, // Ne pas ignorer les créations
            false, // Ne pas ignorer les changements
            false  // Ne pas ignorer les suppressions
        );

        // Lors d'un changement de fichier, invalider le cache
        this.fileWatcher.onDidChange(() => this.invalidateCache());
        this.fileWatcher.onDidCreate(() => this.invalidateCache());
        this.fileWatcher.onDidDelete(() => this.invalidateCache());

        // S'assurer que le watcher est disposé lorsqu'il n'est plus nécessaire
        vscode.Disposable.from(this.fileWatcher);
    }

    private invalidateCache(): void {
        console.log('[invalidateCache] Clearing reference cache');
        this.referenceCache.clear();
    }

    private async initializeComponentsCache(): Promise<void> {
        console.log('[initializeComponentsCache] Starting initial scan of project components');
        await this.scanComponentsDirectory();
        this.componentDirsCache = await this.findAllComponentsDirs();
    }

    async provideCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
        console.log('[provideCodeLenses] Processing document:', document.fileName);
        const lenses: vscode.CodeLens[] = [];

        const fileName = path.basename(document.fileName);
        if (fileName === 'app.vue' || fileName === 'error.vue') {
            console.log('[provideCodeLenses] Skipping app.vue or error.vue file');
            return [];
        }

        // Vérifier si le fichier est dans un répertoire de layouts
        const isPagesComponents = document.fileName.includes(`${path.sep}pages${path.sep}`) &&
            document.fileName.includes(`${path.sep}components${path.sep}`);
        if (!isPagesComponents && document.fileName.includes(`${path.sep}layouts${path.sep}`)) {
            console.log('[provideCodeLenses] Skipping layouts component');
            return [];
        }

        // Obtenir le nom du composant Nuxt à partir du chemin du fichier
        const nuxtComponentName = await this.getComponentNameFromPath(document.uri.fsPath);
        if (!nuxtComponentName) {
            return [];
        }

        // Créer une clé de cache pour ce composant
        const cacheKey = `component:${nuxtComponentName}`;

        // Chercher les références du composant (en utilisant le cache)
        const references = await this.getCachedReferences(cacheKey, document, nuxtComponentName);
        const referenceCount = references.length;

        // Ajouter les CodeLens aux positions appropriées dans le document
        const text = document.getText();
        let hasAddedLens = false;

        // 1. Recherche pour <script setup>
        const scriptSetupRegex = /<script\s+[^>]*setup[^>]*>/g;
        let match: RegExpExecArray | null;
        while ((match = scriptSetupRegex.exec(text))) {
            const pos = document.positionAt(match.index);
            const range = new vscode.Range(pos.line, 0, pos.line, 0);

            lenses.push(
                new vscode.CodeLens(range, {
                    title: `🧩 ${referenceCount} reference${referenceCount > 1 ? 's' : ''} | ${nuxtComponentName}`,
                    command: 'editor.action.showReferences',
                    arguments: [document.uri, pos, references]
                })
            );
            hasAddedLens = true;
        }

        // 2. Recherche pour defineComponent
        if (!hasAddedLens) {
            const defineComponentRegex = /defineComponent\s*\(/g;
            while ((match = defineComponentRegex.exec(text))) {
                const pos = document.positionAt(match.index);
                const range = new vscode.Range(pos.line, 0, pos.line, 0);

                lenses.push(
                    new vscode.CodeLens(range, {
                        title: `🧩 ${referenceCount} reference${referenceCount > 1 ? 's' : ''} | ${nuxtComponentName}`,
                        command: 'editor.action.showReferences',
                        arguments: [document.uri, pos, references]
                    })
                );
                hasAddedLens = true;
            }
        }

        // 3. Recherche pour defineNuxtComponent
        if (!hasAddedLens) {
            const defineNuxtComponentRegex = /defineNuxtComponent\s*\(/g;
            while ((match = defineNuxtComponentRegex.exec(text))) {
                const pos = document.positionAt(match.index);
                const range = new vscode.Range(pos.line, 0, pos.line, 0);

                lenses.push(
                    new vscode.CodeLens(range, {
                        title: `⚡ ${referenceCount} reference${referenceCount > 1 ? 's' : ''} | ${nuxtComponentName}`,
                        command: 'editor.action.showReferences',
                        arguments: [document.uri, pos, references]
                    })
                );
                hasAddedLens = true;
            }
        }

        // 4. Recherche pour template
        if (!hasAddedLens) {
            const templateRegex = /<template[^>]*>/g;
            match = templateRegex.exec(text);
            if (match) {
                const pos = document.positionAt(match.index);
                const range = new vscode.Range(pos.line, 0, pos.line, 0);

                lenses.push(
                    new vscode.CodeLens(range, {
                        title: `🧩 ${referenceCount} reference${referenceCount > 1 ? 's' : ''} | ${nuxtComponentName}`,
                        command: 'editor.action.showReferences',
                        arguments: [document.uri, pos, references]
                    })
                );
            }
        }

        return lenses;
    }

    private async getCachedReferences(
        cacheKey: string,
        document: vscode.TextDocument,
        componentName: string
    ): Promise<vscode.Location[]> {
        const now = Date.now();
        const cachedData = this.referenceCache.get(cacheKey);

        // Retourner les références en cache si elles sont toujours valides
        if (cachedData && (now - cachedData.timestamp < this.referenceCacheTTL)) {
            console.log('[getCachedReferences] Using cached references for:', componentName);
            return cachedData.references;
        }

        // Si le cache est périmé ou inexistant, recalculer les références
        console.log('[getCachedReferences] Cache miss, finding references for:', componentName);
        const references = await this.findComponentReferences(document);

        // Mettre à jour le cache
        this.referenceCache.set(cacheKey, {
            references,
            timestamp: now
        });

        return references;
    }

    async findComponentReferences(document: vscode.TextDocument): Promise<vscode.Location[]> {
        console.log('[findComponentReferences] Starting for document:', document.fileName);
        const filePath = document.uri.fsPath;
        const nuxtComponentName = await this.getComponentNameFromPath(filePath);

        if (!nuxtComponentName) {
            return [];
        }

        console.log('[findComponentReferences] Finding references for component:', nuxtComponentName);
        const kebab = PathUtils.pascalToKebabCase(nuxtComponentName);
        const results: vscode.Location[] = [];

        // Récupérer les fichiers depuis le cache des composants si possible
        let filesToSearch: vscode.Uri[] = [];

        if (this.autoImportCache.has('components')) {
            console.log('[findComponentReferences] Using component files from cache');
            const componentInfos = this.autoImportCache.get('components')!;
            filesToSearch = componentInfos.map(info => vscode.Uri.file(info.path));

            // Ajouter les pages et layouts qui pourraient utiliser le composant
            const additionalFiles = await vscode.workspace.findFiles(
                '{**/pages/**/*.vue,**/layouts/**/*.vue}',
                '{**/node_modules/**,**/.nuxt/**,**/.output/**,**/dist/**}'
            );

            filesToSearch = [...new Set([...filesToSearch, ...additionalFiles])];
        } else {
            console.log('[findComponentReferences] No cache available, searching files directly');
            filesToSearch = await vscode.workspace.findFiles(
                '**/*.vue',
                '{**/node_modules/**,**/.nuxt/**,**/.output/**,**/dist/**,**/store/**,**/stores/**,**/utils/**,**/lib/**,**/helpers/**,**/constants/**,**/shared/**}'
            );
        }

        console.log('[findComponentReferences] Searching in files count:', filesToSearch.length);

        // Traiter les fichiers par lots pour optimiser la performance
        const batchSize = 50;
        for (let i = 0; i < filesToSearch.length; i += batchSize) {
            const batchFiles = filesToSearch.slice(i, i + batchSize);
            await Promise.all(batchFiles.map(async (uri) => {
                // Ignorer le fichier actuel et les fichiers spéciaux
                if (uri.fsPath === filePath ||
                    path.basename(uri.fsPath) === 'app.vue' ||
                    path.basename(uri.fsPath) === 'error.vue') {
                    return;
                }

                try {
                    const content = fs.readFileSync(uri.fsPath, 'utf-8');
                    const searchPatterns = [
                        new RegExp(`<${nuxtComponentName}(\\s[\\s\\S]*?)?\\s*(/?)>`, 'gs'),
                        new RegExp(`<${kebab}(\\s[\\s\\S]*?)?\\s*(/?)>`, 'gs')
                    ];

                    for (const regex of searchPatterns) {
                        let match;
                        while ((match = regex.exec(content)) !== null) {
                            console.log('[findComponentReferences] Found reference in:', path.basename(uri.fsPath));
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
                } catch (error) {
                    console.log('[findComponentReferences] Error reading file:', uri.fsPath, error);
                }
            }));
        }

        console.log('[findComponentReferences] Total references found:', results.length);
        return results;
    }

    private async getComponentNameFromPath(filePath: string): Promise<string> {
        // S'assurer que le cache des répertoires de composants est initialisé
        if (!this.componentDirsCache) {
            this.componentDirsCache = await this.findAllComponentsDirs();
        }

        for (const dir of this.componentDirsCache) {
            if (filePath.startsWith(dir)) {
                return this.getNuxtComponentName(filePath, dir);
            }
        }

        return '';
    }

    async scanComponentsDirectory(specificDir?: string): Promise<void> {
        console.log('[scanComponentsDirectory] Starting scan');

        const componentInfos: NuxtComponentInfo[] = [];
        const searchDir = specificDir || this.nuxtProjectRoot;

        if (!fs.existsSync(searchDir)) {
            console.log('[scanComponentsDirectory] Directory does not exist:', searchDir);
            return;
        }

        const files = await vscode.workspace.findFiles(
            '**/*.vue',
            '{**/node_modules/**,**/.nuxt/**,**/.output/**,**/dist/**,**/store/**,**/stores/**,**/utils/**,**/lib/**,**/helpers/**,**/constants/**,**/shared/**}'
        );

        console.log('[scanComponentsDirectory] Found files:', files.length);

        // Déterminer quels fichiers sont des composants
        const componentDirs = this.componentDirsCache || await this.findAllComponentsDirs();

        for (const file of files) {
            // Vérifier si ce fichier est dans un répertoire de composants
            const isComponent = componentDirs.some(dir => file.fsPath.startsWith(dir));

            if (isComponent) {
                const componentName = path.basename(file.fsPath, '.vue');
                console.log('[scanComponentsDirectory] Adding component:', componentName);

                componentInfos.push({
                    name: componentName,
                    path: file.fsPath,
                    isAutoImported: true
                });
            }
        }

        console.log('[scanComponentsDirectory] Total components found:', componentInfos.length);
        this.autoImportCache.set('components', componentInfos);

        // Invalider le cache des références lorsque les composants changent
        this.invalidateCache();
    }

    async findAllComponentsDirs(): Promise<string[]> {
        console.log('[findAllComponentsDirs] Starting search in:', this.nuxtProjectRoot);
        const dirs: string[] = [];

        if (!this.nuxtProjectRoot) {
            console.log('[findAllComponentsDirs] No project root specified');
            return dirs;
        }

        const recurse = (dir: string) => {
            try {
                const entries = fs.readdirSync(dir, { withFileTypes: true });

                for (const entry of entries) {
                    const fullPath = path.join(dir, entry.name);

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
        console.log('[findAllComponentsDirs] Found directories:', dirs);
        return dirs;
    }

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

            // Vérifier les patterns de layers
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

    // S'assurer que les ressources sont libérées lorsqu'elles ne sont plus nécessaires
    public dispose(): void {
        if (this.fileWatcher) {
            this.fileWatcher.dispose();
        }
    }
}