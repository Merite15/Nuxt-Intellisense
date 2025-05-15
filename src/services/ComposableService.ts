import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { TextUtils } from '../utils/textUtils';
import type { NuxtComponentInfo } from '../types';

interface ReferenceCache {
    references: vscode.Location[];
    timestamp: number;
}

interface ExposedItem {
    name: string;
    position: vscode.Position;
    type: 'variable' | 'method' | 'composable';
    composableName?: string;
}

export class ComposableService {
    private referenceCache: Map<string, ReferenceCache> = new Map();
    private referenceCacheTTL: number = 300000; // 5 minutes comme fallback
    private fileWatcher: vscode.FileSystemWatcher | undefined;
    private exposedItemsCache: Map<string, ExposedItem[]> = new Map();

    constructor(private autoImportCache: Map<string, NuxtComponentInfo[]>) {
        this.setupFileWatcher();
    }

    private setupFileWatcher() {
        // Surveiller les changements dans les fichiers Vue, TS et JS
        this.fileWatcher = vscode.workspace.createFileSystemWatcher(
            '**/*.{vue,ts,js}',
            false, // Ne pas ignorer les créations
            false, // Ne pas ignorer les changements
            false  // Ne pas ignorer les suppressions
        );

        // Lors d'un changement de fichier, invalider le cache
        this.fileWatcher.onDidChange(() => {
            this.invalidateReferenceCache();
            this.exposedItemsCache.clear();
        });
        this.fileWatcher.onDidCreate(() => {
            this.invalidateReferenceCache();
            this.exposedItemsCache.clear();
        });
        this.fileWatcher.onDidDelete(() => {
            this.invalidateReferenceCache();
            this.exposedItemsCache.clear();
        });

        // S'assurer que le watcher est disposé lorsqu'il n'est plus nécessaire
        vscode.Disposable.from(this.fileWatcher);
    }

    async provideCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
        const lenses: vscode.CodeLens[] = [];
        const text = document.getText();

        // Récupérer ou analyser les items exposés
        const exposedItems = await this.getExposedItems(document);

        for (const item of exposedItems) {
            // Générer une clé unique pour cet item dans ce document
            const cacheKey = `${document.uri.toString()}:${item.name}${item.type === 'variable' || item.type === 'method' ? `:${item.composableName}` : ''}`;

            // Trouver les références
            const references = await this.getCachedReferences(cacheKey, document, item);
            const referenceCount = references.length;

            const range = new vscode.Range(item.position.line, 0, item.position.line, 0);

            lenses.push(
                new vscode.CodeLens(range, {
                    title: `🔄 ${referenceCount} reference${referenceCount > 1 ? 's' : ''}`,
                    command: 'editor.action.showReferences',
                    arguments: [
                        document.uri,
                        item.position,
                        references
                    ]
                })
            );
        }

        return lenses;
    }

    private async getExposedItems(document: vscode.TextDocument): Promise<ExposedItem[]> {
        const cacheKey = document.uri.toString();
        if (this.exposedItemsCache.has(cacheKey)) {
            return this.exposedItemsCache.get(cacheKey)!;
        }

        const text = document.getText();
        const items: ExposedItem[] = [];

        // 1. Trouver les composables exportés
        const composableRegex = /export\s+(default\s+)?(const|function|async\s+function)\s+(\w+)/g;

        let match: RegExpExecArray | null;

        while ((match = composableRegex.exec(text))) {
            const composableName = match[3];
            const pos = document.positionAt(match.index);

            // Ajouter le composable lui-même
            items.push({
                name: composableName,
                position: new vscode.Position(pos.line, match[0].indexOf(composableName)),
                type: 'composable'
            });

            // 2. Analyser le bloc return pour trouver les variables et méthodes exposées
            // Trouver la position du return dans cette fonction
            const functionText = this.extractFunctionText(text.substring(match.index));
            if (!functionText) continue;

            const returnStatementMatch = /return\s*{([^}]*)}/s.exec(functionText);
            if (!returnStatementMatch) continue;

            const returnBlockText = returnStatementMatch[1];

            // Extraire les noms des variables/méthodes retournées
            const returnedItems = this.parseReturnItems(returnBlockText);

            for (const itemName of returnedItems) {
                // Trouver la déclaration de cette variable/méthode dans le corps de la fonction
                const declarationInfo = this.findDeclarationInFunction(functionText, itemName);

                if (declarationInfo) {
                    const { position: relativePosition, type } = declarationInfo;
                    const declarationIndex = match.index + relativePosition;
                    const itemPosition = document.positionAt(declarationIndex);

                    items.push({
                        name: itemName,
                        position: itemPosition,
                        type: type,
                        composableName
                    });
                }
            }
        }

        this.exposedItemsCache.set(cacheKey, items);
        return items;
    }

    private parseReturnItems(returnBlockText: string): string[] {
        // Nettoyage du texte pour faciliter l'analyse
        const cleanedText = returnBlockText.trim().replace(/\s+/g, ' ');
        const items: string[] = [];

        // Séparation par virgules et extraction des noms
        const parts = cleanedText.split(',').map(part => part.trim());

        for (const part of parts) {
            // Cas simple: juste le nom (error, submit)
            const simpleMatch = /^(\w+)$/.exec(part);
            if (simpleMatch) {
                items.push(simpleMatch[1]);
                continue;
            }

            // Cas avec renommage (errorValue: error)
            const renameMatch = /^(\w+):\s*(\w+)$/.exec(part);
            if (renameMatch) {
                items.push(renameMatch[2]); // On prend le nom original (après les :)
            }
        }

        return items;
    }

    private findDeclarationInFunction(functionText: string, itemName: string): { position: number, type: 'variable' | 'method' } | null {
        // Patterns de déclaration pour différents types
        const patterns = [
            // Variables
            { regex: new RegExp(`\\bconst\\s+${itemName}\\s*=`, 'g'), type: 'variable' },
            { regex: new RegExp(`\\blet\\s+${itemName}\\s*=`, 'g'), type: 'variable' },
            { regex: new RegExp(`\\bvar\\s+${itemName}\\s*=`, 'g'), type: 'variable' },

            // Fonctions classiques
            { regex: new RegExp(`\\bfunction\\s+${itemName}\\s*\\(`, 'g'), type: 'method' },
            { regex: new RegExp(`\\basync\\s+function\\s+${itemName}\\s*\\(`, 'g'), type: 'method' },

            // Fonctions fléchées
            { regex: new RegExp(`\\bconst\\s+${itemName}\\s*=\\s*\\([^)]*\\)\\s*=>`, 'g'), type: 'method' },
            { regex: new RegExp(`\\bconst\\s+${itemName}\\s*=\\s*async\\s*\\([^)]*\\)\\s*=>`, 'g'), type: 'method' }
        ];

        for (const { regex, type } of patterns) {
            regex.lastIndex = 0;
            const match = regex.exec(functionText);
            if (match) {
                return { position: match.index, type: type as 'variable' | 'method' };
            }
        }

        return null;
    }

    private extractFunctionText(text: string): string | null {
        let openBraces = 0;
        let started = false;

        for (let i = 0; i < text.length; i++) {
            if (text[i] === '{') {
                started = true;
                openBraces++;
            } else if (text[i] === '}') {
                openBraces--;
                if (started && openBraces === 0) {
                    return text.substring(0, i + 1);
                }
            }
        }

        return null;
    }

    private async getCachedReferences(
        cacheKey: string,
        document: vscode.TextDocument,
        item: ExposedItem
    ): Promise<vscode.Location[]> {
        const now = Date.now();
        const cachedData = this.referenceCache.get(cacheKey);

        // Retourner les références en cache si elles sont toujours valides
        if (cachedData && (now - cachedData.timestamp < this.referenceCacheTTL)) {
            return cachedData.references;
        }

        // Sinon, trouver toutes les références et les mettre en cache
        const references = await this.findReferencesForItem(document, item);

        this.referenceCache.set(cacheKey, {
            references,
            timestamp: now
        });

        return references;
    }

    private async findReferencesForItem(document: vscode.TextDocument, item: ExposedItem): Promise<vscode.Location[]> {
        try {
            const results: vscode.Location[] = [];

            if (item.type === 'composable') {
                // Utiliser l'approche existante pour les composables
                return this.findAllReferences(document, item.name, item.position);
            } else {
                // Pour les variables et méthodes exposées par un composable
                const uris = await vscode.workspace.findFiles(
                    '**/*.{vue,js,ts}',
                    '{**/node_modules/**,**/.nuxt/**,**/.output/**,**/dist/**, **/utils/**,**/lib/**,**/helpers/**,**/constants/**,**/shared/**, **/public/**,**/config/**, **/assets/**}'
                );

                const batchSize = 30;
                for (let i = 0; i < uris.length; i += batchSize) {
                    const batch = uris.slice(i, i + batchSize);

                    await Promise.all(batch.map(async (uri) => {
                        try {
                            // Ignorer le fichier source pour les items exposés
                            if (uri.fsPath === document.uri.fsPath &&
                                item.type !== 'composable') {
                                return;
                            }

                            const content = fs.readFileSync(uri.fsPath, 'utf-8');

                            // 1. Vérifier si le composable parent est utilisé
                            if (item.composableName) {
                                this.findItemReferencesInFile(content, uri, item, results);
                            }
                        } catch (error) {
                            // Ignorer les erreurs de lecture de fichier
                        }
                    }));
                }
            }

            return results;
        } catch (e) {
            return [];
        }
    }

    private findItemReferencesInFile(content: string, uri: vscode.Uri, item: ExposedItem, results: vscode.Location[]): void {
        if (!item.composableName) return;

        // Étape 1: Trouver les endroits où le composable est utilisé avec déstructuration
        const destructuringPatterns = [
            // const { item1, item2 } = useComposable()
            new RegExp(`const\\s*{([^}]*)}\\s*=\\s*${item.composableName}\\s*\\([^)]*\\)`, 'g'),
            // let { item1, item2 } = useComposable()
            new RegExp(`let\\s*{([^}]*)}\\s*=\\s*${item.composableName}\\s*\\([^)]*\\)`, 'g'),
            // var { item1, item2 } = useComposable()
            new RegExp(`var\\s*{([^}]*)}\\s*=\\s*${item.composableName}\\s*\\([^)]*\\)`, 'g'),
            // const result = useComposable(); const { item1, item2 } = result;
            new RegExp(`const\\s+\\w+\\s*=\\s*${item.composableName}\\s*\\([^)]*\\)[^{]*const\\s*{([^}]*)}\\s*=\\s*\\w+`, 'g'),
            // Variante avec let
            new RegExp(`let\\s+\\w+\\s*=\\s*${item.composableName}\\s*\\([^)]*\\)[^{]*const\\s*{([^}]*)}\\s*=\\s*\\w+`, 'g'),
            // Variante avec const + let
            new RegExp(`const\\s+\\w+\\s*=\\s*${item.composableName}\\s*\\([^)]*\\)[^{]*let\\s*{([^}]*)}\\s*=\\s*\\w+`, 'g')
        ];

        for (const pattern of destructuringPatterns) {
            let match;
            while ((match = pattern.exec(content)) !== null) {
                const destructuredBlock = match[1];

                // Rechercher l'item spécifique dans le bloc déstructuré
                const itemPattern = new RegExp(`\\b${item.name}\\b`, 'g');
                let itemMatch;

                while ((itemMatch = itemPattern.exec(destructuredBlock)) !== null) {
                    // Vérifier que c'est bien une déstructuration, pas un renommage côté droit
                    // ex: { newName: originalName } - on veut trouver originalName
                    const beforeItem = destructuredBlock.substring(0, itemMatch.index).trim();
                    const isRenamed = beforeItem.endsWith(':');

                    if (!isRenamed) {
                        const globalIndex = match.index + match[0].indexOf(destructuredBlock) + itemMatch.index;
                        const start = TextUtils.indexToPosition(content, globalIndex);
                        const end = TextUtils.indexToPosition(content, globalIndex + item.name.length);

                        results.push(new vscode.Location(
                            uri,
                            new vscode.Range(
                                new vscode.Position(start.line, start.character),
                                new vscode.Position(end.line, end.character)
                            )
                        ));
                    }
                }

                // Vérifier également les renommages, comme { newName: originalName }
                const renamePattern = new RegExp(`(\\w+)\\s*:\\s*${item.name}\\b`, 'g');
                let renameMatch;

                while ((renameMatch = renamePattern.exec(destructuredBlock)) !== null) {
                    const globalIndex = match.index + match[0].indexOf(destructuredBlock) + renameMatch.index + renameMatch[0].indexOf(item.name);
                    const start = TextUtils.indexToPosition(content, globalIndex);
                    const end = TextUtils.indexToPosition(content, globalIndex + item.name.length);

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

        // Étape 2: Rechercher les utilisations directes de l'item après déstructuration
        // Pour chaque zone où l'item a été déstructuré, nous devons vérifier toutes les occurrences
        // suivantes dans le fichier

        // On ne peut pas faire ça de manière 100% précise sans analyse de portée,
        // mais nous pouvons rechercher les utilisations de l'item déstructuré
        // Si le composable a été déstructuré une fois dans le fichier, nous recherchons toutes les utilisations
        const composableUsed = content.includes(`${item.composableName}(`);
        const itemHasBeenDestructured = new RegExp(`{[^}]*\\b${item.name}\\b[^}]*}\\s*=\\s*${item.composableName}`).test(content);

        if (composableUsed && itemHasBeenDestructured) {
            // Chercher toutes les utilisations de l'item en prenant soin d'éviter les faux positifs
            // Comme les déclarations de variables avec le même nom ou les propriétés d'objets
            const usagePattern = new RegExp(`\\b${item.name}\\b(?!\\s*:|\\s*=|\\s*\\()`, 'g');
            let usageMatch;

            while ((usageMatch = usagePattern.exec(content)) !== null) {
                // Vérifier que ce n'est pas une déclaration ou déstructuration
                const beforeMatch = content.substring(Math.max(0, usageMatch.index - 20), usageMatch.index);

                if (!beforeMatch.includes('const ') &&
                    !beforeMatch.includes('let ') &&
                    !beforeMatch.includes('var ') &&
                    !beforeMatch.includes('function ') &&
                    !beforeMatch.includes(':') && // Éviter les propriétés d'objets
                    !beforeMatch.includes('{')) { // Éviter les déstructurations

                    const start = TextUtils.indexToPosition(content, usageMatch.index);
                    const end = TextUtils.indexToPosition(content, usageMatch.index + item.name.length);

                    results.push(new vscode.Location(
                        uri,
                        new vscode.Range(
                            new vscode.Position(start.line, start.character),
                            new vscode.Position(end.line, end.character)
                        )
                    ));
                }
            }

            // Pour les méthodes, rechercher également les appels de fonctions
            if (item.type === 'method') {
                const functionCallPattern = new RegExp(`\\b${item.name}\\s*\\(`, 'g');
                let functionCallMatch;

                while ((functionCallMatch = functionCallPattern.exec(content)) !== null) {
                    const start = TextUtils.indexToPosition(content, functionCallMatch.index);
                    const end = TextUtils.indexToPosition(content, functionCallMatch.index + item.name.length);

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

    private async findAllReferences(document: vscode.TextDocument, name: string, position: vscode.Position): Promise<vscode.Location[]> {
        try {
            const results: vscode.Location[] = [];

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

            // Effectuer une recherche basée sur les fichiers uniquement si le fournisseur de références intégré n'a pas trouvé suffisamment de résultats
            if (results.length < 5) {
                const uris = await vscode.workspace.findFiles(
                    '**/*.{vue,js,ts}',
                    '{**/node_modules/**,**/.nuxt/**,**/.output/**,**/dist/**, **/utils/**,**/lib/**,**/helpers/**,**/constants/**,**/shared/**, **/public/**,**/config/**, **/assets/**}'
                );

                const fileReadPromises = uris.map(async (uri) => {
                    if (uri.fsPath === document.uri.fsPath) {
                        return;
                    }

                    try {
                        const content = fs.readFileSync(uri.fsPath, 'utf-8');
                        const usageRegex = new RegExp(`\\b(${name}\\s*\\(|${name}\\s*<)`, 'g');
                        let match;

                        while ((match = usageRegex.exec(content)) !== null) {
                            const matchText = match[1];
                            const index = match.index;

                            const start = TextUtils.indexToPosition(content, index);
                            const end = TextUtils.indexToPosition(content, index + matchText.length);

                            results.push(new vscode.Location(
                                uri,
                                new vscode.Range(
                                    new vscode.Position(start.line, start.character),
                                    new vscode.Position(end.line, end.character)
                                )
                            ));
                        }
                    } catch (error) {
                    }
                });

                // Traiter les fichiers par lots pour éviter les problèmes de mémoire
                const batchSize = 50;

                for (let i = 0; i < fileReadPromises.length; i += batchSize) {
                    const batch = fileReadPromises.slice(i, i + batchSize);

                    await Promise.all(batch);
                }
            }

            return results;
        } catch (e) {
            return [];
        }
    }

    async scanComposablesDirectory(dir: string): Promise<void> {
        if (!fs.existsSync(dir)) {
            return;
        }

        const composableInfos: NuxtComponentInfo[] = [];

        const files = await vscode.workspace.findFiles(
            path.join(dir, '**/*.{ts,js}').replace(/\\/g, '/'),
            '{**/node_modules/**,**/.nuxt/**,**/.output/**,**/dist/**, **/utils/**,**/lib/**,**/helpers/**,**/constants/**,**/shared/**, **/public/**,**/config/**, **/assets/**}'
        );

        for (const file of files) {
            try {
                const content = fs.readFileSync(file.fsPath, 'utf-8');

                if (content.includes('defineStore')) {
                    continue;
                }

                const exportRegex = /export\s+(default\s+)?(const|function|async\s+function)\s+(\w+)/g;

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
            }
        }

        this.autoImportCache.set('composables', composableInfos);

        // Invalider le cache des références lorsque les composables changent
        this.invalidateReferenceCache();
        this.exposedItemsCache.clear();
    }

    // Méthode pour invalider le cache pour les tests ou un rafraîchissement manuel
    public invalidateReferenceCache(): void {
        this.referenceCache.clear();
    }

    // S'assurer que les ressources sont libérées lorsqu'elles ne sont plus nécessaires
    public dispose(): void {
        if (this.fileWatcher) {
            this.fileWatcher.dispose();
        }
    }
}