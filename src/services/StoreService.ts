import * as vscode from 'vscode';
import * as fs from 'fs';
import { FileUtils } from '../utils/fileUtils';
import { TextUtils } from '../utils/textUtils';
import type { NuxtComponentInfo } from '../types';

interface ReferenceCache {
    references: vscode.Location[];
    timestamp: number;
}

export class StoreService {
    private referenceCache: Map<string, ReferenceCache> = new Map();

    private referenceCacheTTL: number = 300000;

    private fileWatcher: vscode.FileSystemWatcher | undefined;

    constructor(private autoImportCache: Map<string, NuxtComponentInfo[]>) {
        this.setupFileWatcher();
    }

    private setupFileWatcher() {
        this.fileWatcher = vscode.workspace.createFileSystemWatcher(
            '**/*.{vue,ts,js}',
            false,
            false,
            false
        );

        this.fileWatcher.onDidChange(() => this.invalidateReferenceCache());

        this.fileWatcher.onDidCreate(() => this.invalidateReferenceCache());

        this.fileWatcher.onDidDelete(() => this.invalidateReferenceCache());

        vscode.Disposable.from(this.fileWatcher);
    }

    async provideCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
        const lenses: vscode.CodeLens[] = [];

        const text = document.getText();

        const defineStoreRegex = /defineStore\s*\(\s*(['"`])(.*?)\1/g;

        let match: RegExpExecArray | null;

        while ((match = defineStoreRegex.exec(text))) {
            const storeName = match[2];

            const pos = document.positionAt(match.index);

            const range = new vscode.Range(pos.line, 0, pos.line, 0);

            const cacheKey = `${document.uri.toString()}:${storeName}`;

            const preciseReferences = await this.getCachedReferences(cacheKey, storeName);

            const uniqueReferences = TextUtils.removeDuplicateReferences(preciseReferences);

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

        return lenses;
    }

    private async getCachedReferences(cacheKey: string, storeName: string): Promise<vscode.Location[]> {
        const now = Date.now();

        const cachedData = this.referenceCache.get(cacheKey);

        if (cachedData && (now - cachedData.timestamp < this.referenceCacheTTL)) {
            return cachedData.references;
        }

        const references = await this.findStoreReferences(storeName);

        this.referenceCache.set(cacheKey, {
            references,
            timestamp: now
        });

        return references;
    }

    async findStoreReferences(storeName: string): Promise<vscode.Location[]> {
        try {
            const normalizedName = storeName
                .split(/[-_\s]/)
                .map(s => s.charAt(0).toUpperCase() + s.slice(1))
                .join('');

            const storeHookName = `use${normalizedName}Store`;

            const possibleStoreIds = [
                storeName,
                storeName.replace(/-/g, ' '),
                storeName.replace(/-/g, '_'),
                `${storeName}s`,
                `${storeName.replace(/-/g, ' ')}s`,
                `${storeName.replace(/-/g, '_')}s`
            ];

            const uris = await vscode.workspace.findFiles(
                '**/*.{vue,js,ts}',
                '{**/node_modules/**,**/.nuxt/**,**/.output/**,**/dist/**,, **/utils/**,**/lib/**,**/helpers/**,**/constants/**,**/shared/**, **/public/**,**/config/**, **/assets/**}'
            );

            const results: vscode.Location[] = [];

            const storeDefinitions: Map<string, string> = new Map();

            const storeDefinitionFiles: Set<string> = new Set();

            for (const uri of uris) {
                if (FileUtils.shouldSkipFile(uri.fsPath)) {
                    continue;
                }

                let content: string;

                try {
                    content = fs.readFileSync(uri.fsPath, 'utf-8');
                } catch (e) {
                    continue;
                }

                const defineStoreRegex = /defineStore\s*\(\s*['"]([^'"]+)['"]/g;

                let defineMatch;

                while ((defineMatch = defineStoreRegex.exec(content)) !== null) {
                    const storeId = defineMatch[1];

                    if (possibleStoreIds.includes(storeId)) {
                        storeDefinitionFiles.add(uri.fsPath);
                    }

                    const hookNameRegex = /const\s+(\w+)\s*=\s*defineStore\s*\(\s*['"]([^'"]+)['"]/g;

                    hookNameRegex.lastIndex = 0;

                    let hookMatch;
                    while ((hookMatch = hookNameRegex.exec(content)) !== null) {
                        if (hookMatch[2] === storeId) {
                            storeDefinitions.set(storeId, hookMatch[1]);

                            break;
                        }
                    }
                }
            }

            for (const uri of uris) {
                if (FileUtils.shouldSkipFile(uri.fsPath) || storeDefinitionFiles.has(uri.fsPath)) {
                    continue;
                }

                let content: string;

                try {
                    content = fs.readFileSync(uri.fsPath, 'utf-8');
                } catch (e) {
                    continue;
                }

                const hookRegex = new RegExp(`\\b${storeHookName}\\b`, 'g');

                TextUtils.findMatches(hookRegex, content, uri, results);

                for (const storeId of possibleStoreIds) {
                    const storeIdRegex = new RegExp(`useStore\\s*\\(\\s*['"]${storeId}['"]\\s*\\)`, 'g');

                    TextUtils.findMatches(storeIdRegex, content, uri, results);

                    if (storeDefinitions.has(storeId)) {
                        const hookName = storeDefinitions.get(storeId)!;

                        const customHookRegex = new RegExp(`\\b${hookName}\\b`, 'g');

                        TextUtils.findMatches(customHookRegex, content, uri, results);
                    }
                }
            }

            return results;
        } catch (e) {
            return [];
        }
    }

    async scanStoresDirectory(dir: string): Promise<void> {
        if (!fs.existsSync(dir)) {
            return;
        }

        const storeInfos: NuxtComponentInfo[] = [];

        const files = await vscode.workspace.findFiles(
            '**/*.{ts,js}',
            '{**/node_modules/**,**/.nuxt/**,**/.output/**,**/dist/**,, **/utils/**,**/lib/**,**/helpers/**,**/constants/**,**/shared/**, **/public/**,**/config/**, **/assets/**}'
        );

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
            }
        }

        this.autoImportCache.set('stores', storeInfos);

        this.invalidateReferenceCache();
    }

    public invalidateReferenceCache(): void {
        this.referenceCache.clear();
    }

    public dispose(): void {
        if (this.fileWatcher) {
            this.fileWatcher.dispose();
        }
    }
}
