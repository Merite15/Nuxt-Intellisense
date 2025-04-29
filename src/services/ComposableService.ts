import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { TextUtils } from '../utils/textUtils';
import type { NuxtComponentInfo } from '../types';

interface ReferenceCache {
    references: vscode.Location[];
    timestamp: number;
}

export class ComposableService {
    private referenceCache: Map<string, ReferenceCache> = new Map();
    private referenceCacheTTL: number = 300000; // 5 minutes comme fallback
    private fileWatcher: vscode.FileSystemWatcher | undefined;

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
        this.fileWatcher.onDidChange(() => this.invalidateReferenceCache());
        this.fileWatcher.onDidCreate(() => this.invalidateReferenceCache());
        this.fileWatcher.onDidDelete(() => this.invalidateReferenceCache());

        // S'assurer que le watcher est disposé lorsqu'il n'est plus nécessaire
        vscode.Disposable.from(this.fileWatcher);
    }

    async provideCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
        const lenses: vscode.CodeLens[] = [];
        const text = document.getText();
        const composableRegex = /export\s+(const|function|async function)\s+(\w+)/g;
        let match: RegExpExecArray | null;

        while ((match = composableRegex.exec(text))) {
            const funcType = match[1];
            const name = match[2];

            const pos = document.positionAt(match.index);
            const range = new vscode.Range(pos.line, 0, pos.line, 0);

            // Générer une clé unique pour ce composable dans ce document
            const cacheKey = `${document.uri.toString()}:${name}`;

            const references = await this.getCachedReferences(cacheKey, document, name, pos);
            const referenceCount = references.length;

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

        return lenses;
    }

    private async getCachedReferences(
        cacheKey: string,
        document: vscode.TextDocument,
        name: string,
        position: vscode.Position
    ): Promise<vscode.Location[]> {
        const now = Date.now();
        const cachedData = this.referenceCache.get(cacheKey);

        // Retourner les références en cache si elles sont toujours valides
        if (cachedData && (now - cachedData.timestamp < this.referenceCacheTTL)) {
            return cachedData.references;
        }

        // Sinon, trouver toutes les références et les mettre en cache
        const references = await this.findAllReferences(document, name, position);

        this.referenceCache.set(cacheKey, {
            references,
            timestamp: now
        });

        return references;
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
            console.error('[findAllReferences] Error finding references:', e);
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
                console.error('[scanComposablesDirectory] Error processing file:', file.fsPath, e);
            }
        }

        this.autoImportCache.set('composables', composableInfos);

        // Invalider le cache des références lorsque les composables changent
        this.invalidateReferenceCache();
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