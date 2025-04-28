import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { TextUtils } from '../utils/textUtils';

interface ReferenceCache {
    references: vscode.Location[];
    timestamp: number;
}

export class PluginService {
    private referenceCache: Map<string, ReferenceCache> = new Map();
    private referenceCacheTTL: number = 300000; // 5 minutes
    private fileWatcher: vscode.FileSystemWatcher | undefined;

    constructor() {
        console.log('[PluginService] Service initialized');
        this.setupFileWatcher();
    }

    private setupFileWatcher() {
        this.fileWatcher = vscode.workspace.createFileSystemWatcher(
            '**/*.{vue,js,ts}',
            false, // Ne pas ignorer les créations
            false, // Ne pas ignorer les changements
            false  // Ne pas ignorer les suppressions
        );

        this.fileWatcher.onDidChange(() => this.invalidateReferenceCache());
        this.fileWatcher.onDidCreate(() => this.invalidateReferenceCache());
        this.fileWatcher.onDidDelete(() => this.invalidateReferenceCache());

        vscode.Disposable.from(this.fileWatcher);
    }

    async provideCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
        console.log('[provideCodeLenses] Starting analysis for document:', document.uri.toString());
        const lenses: vscode.CodeLens[] = [];
        const text = document.getText();

        const defineNuxtPluginRegex = /defineNuxtPlugin\s*\(/g;
        let match: RegExpExecArray | null;

        while ((match = defineNuxtPluginRegex.exec(text))) {
            console.log('[provideCodeLenses] Found plugin definition at position:', match.index);
            const pos = document.positionAt(match.index);
            const range = new vscode.Range(pos.line, 0, pos.line, 0);
            const pluginName = path.basename(document.fileName, path.extname(document.fileName));

            console.log('[provideCodeLenses] Analyzing plugin:', pluginName);

            // Use cache for references
            const cacheKey = `${document.uri.toString()}:${pluginName}`;
            const references = await this.getCachedReferences(cacheKey, pluginName);
            const referenceCount = references.length;
            console.log('[provideCodeLenses] Found', referenceCount, 'references for plugin:', pluginName);

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

        console.log('[provideCodeLenses] Returning', lenses.length, 'lenses');
        return lenses;
    }

    private async getCachedReferences(cacheKey: string, pluginName: string): Promise<vscode.Location[]> {
        const now = Date.now();
        const cachedData = this.referenceCache.get(cacheKey);

        // Retourner les références en cache si elles sont encore valides
        if (cachedData && (now - cachedData.timestamp < this.referenceCacheTTL)) {
            console.log('[getCachedReferences] Using cached references for:', pluginName);
            return cachedData.references;
        }

        // Sinon, rechercher les références et les stocker dans le cache
        console.log('[getCachedReferences] Cache miss, finding references for:', pluginName);
        const references = await this.findPluginReferences(pluginName);

        this.referenceCache.set(cacheKey, {
            references,
            timestamp: now
        });

        return references;
    }

    async findPluginReferences(pluginName: string): Promise<vscode.Location[]> {
        console.log('[findPluginReferences] Starting search for plugin:', pluginName);
        const references: vscode.Location[] = [];
        const addedReferences = new Set<string>();

        console.log('[findPluginReferences] Searching for plugin file');
        const pluginUris = await vscode.workspace.findFiles(
            `**/plugins/${pluginName}.{js,ts}`,
            '{**/node_modules/**,**/.nuxt/**,**/.output/**,**/dist/**}'
        );

        if (pluginUris.length === 0) {
            console.log('[findPluginReferences] Plugin file not found');
            return references;
        }

        const pluginPath = pluginUris[0].fsPath;
        console.log('[findPluginReferences] Found plugin file:', pluginPath);

        let pluginContent: string;
        try {
            pluginContent = fs.readFileSync(pluginPath, 'utf-8');
            console.log('[findPluginReferences] Successfully read plugin file');
        } catch (e) {
            console.error('[findPluginReferences] Error reading plugin file:', e);
            return references;
        }

        let provides: string[] = [];
        let hasDirectives: boolean = false;
        let directives: string[] = [];

        try {
            console.log('[findPluginReferences] Analyzing plugin content for provides and directives');

            // Classic provide detection
            const provideRegex = /nuxtApp\.provide\s*\(\s*['\"`]([$\w]+)['\"`]/g;
            let match: RegExpExecArray | null;
            while ((match = provideRegex.exec(pluginContent))) {
                console.log('[findPluginReferences] Found classic provide:', match[1]);
                provides.push(match[1]);
            }

            // Advanced provide detection
            const provideObjectRegex = /provide\s*:\s*\{([\s\S]*?)\}/g;
            const keyRegex = /(?:['\"`]?([$\w]+)['\"`]?\s*:|(\\b[$\w]+),)/g;

            let provideObjectMatch: RegExpExecArray | null;
            while ((provideObjectMatch = provideObjectRegex.exec(pluginContent))) {
                console.log('[findPluginReferences] Found provide object');
                const keysBlock = provideObjectMatch[1];
                let keyMatch: RegExpExecArray | null;
                while ((keyMatch = keyRegex.exec(keysBlock))) {
                    const key = keyMatch[1] || keyMatch[2];
                    if (key) {
                        console.log('[findPluginReferences] Found object provide key:', key);
                        provides.push(key);
                    }
                }
            }

            provides = [...new Set(provides)];
            console.log('[findPluginReferences] Total unique provides:', provides.length);

            // Directive detection
            const directiveRegex = /nuxtApp\.vueApp\.directive\s*\(\s*['\"`]([\w-]+)['\"`]/g;
            while ((match = directiveRegex.exec(pluginContent))) {
                hasDirectives = true;
                console.log('[findPluginReferences] Found directive:', match[1]);
                directives.push(match[1]);
            }

            directives = [...new Set(directives)];
            console.log('[findPluginReferences] Total unique directives:', directives.length);

        } catch (e) {
            console.error('[findPluginReferences] Error analyzing plugin content:', e);
            return references;
        }

        console.log('[findPluginReferences] Searching for usage in project files');
        const allFileUris = await vscode.workspace.findFiles(
            '**/*.{vue,js,ts}',
            '**/node_modules/**'
        );
        console.log('[findPluginReferences] Found', allFileUris.length, 'files to analyze');

        for (const uri of allFileUris) {
            if (uri.fsPath.includes('.nuxt') || uri.fsPath === pluginPath) {
                console.log('[findPluginReferences] Skipping file:', uri.fsPath);
                continue;
            }

            try {
                console.log('[findPluginReferences] Analyzing file:', uri.fsPath);
                const fileContent = fs.readFileSync(uri.fsPath, 'utf-8');

                // Check provides usage
                for (const key of provides) {
                    console.log('[findPluginReferences] Searching for provide usage:', key);
                    const patterns = [
                        new RegExp(`useNuxtApp\\(\\)\\s*\\.\\s*\\$${key}\\b`, 'g'),
                        new RegExp(`(const|let|var)\\s+\\{[^}]*\\$${key}\\b[^}]*\\}\\s*=\\s*(useNuxtApp\\(\\)|nuxtApp)`, 'g'),
                        new RegExp(`nuxtApp\\s*\\.\\s*\\$${key}\\b`, 'g'),
                        new RegExp(`Vue\\.prototype\\.\\$${key}\\b`, 'g'),
                        new RegExp(`app\\.\\$${key}\\b`, 'g'),
                        new RegExp(`this\\.\\$${key}\\b`, 'g'),
                        new RegExp(`const\\s+nuxtApp\\s*=\\s*useNuxtApp\\(\\)[^]*?\\{[^}]*\\$${key}\\b[^}]*\\}\\s*=\\s*nuxtApp`, 'gs'),
                        new RegExp(`const\\s*\\{\\s*\\$${key}\\s*\\}\\s*=\\s*useNuxtApp\\(\\)`, 'g')
                    ];

                    for (const regex of patterns) {
                        let match: RegExpExecArray | null;
                        while ((match = regex.exec(fileContent))) {
                            const refKey = `${uri.fsPath}:${match.index}`;
                            if (!addedReferences.has(refKey)) {
                                console.log('[findPluginReferences] Found new reference for key:', key);
                                addedReferences.add(refKey);
                                const start = TextUtils.indexToPosition(fileContent, match.index);
                                const end = TextUtils.indexToPosition(fileContent, match.index + match[0].length);
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

                // Check directives usage
                if (hasDirectives) {
                    for (const directive of directives) {
                        console.log('[findPluginReferences] Searching for directive usage:', directive);
                        const directiveRegex = new RegExp(`\\sv-${directive}\\b|\\s:v-${directive}\\b`, 'g');
                        let match: RegExpExecArray | null;

                        while ((match = directiveRegex.exec(fileContent))) {
                            const refKey = `${uri.fsPath}:${match.index}`;
                            if (!addedReferences.has(refKey)) {
                                console.log('[findPluginReferences] Found new directive reference:', directive);
                                addedReferences.add(refKey);
                                const start = TextUtils.indexToPosition(fileContent, match.index);
                                const end = TextUtils.indexToPosition(fileContent, match.index + match[0].length);
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

                // Check direct imports
                console.log('[findPluginReferences] Checking for direct imports');
                const importRegex = new RegExp(`import\\s+[^;]*['"\`]~/plugins/${pluginName}['"\`]`, 'g');
                let match: RegExpExecArray | null;

                while ((match = importRegex.exec(fileContent))) {
                    const refKey = `${uri.fsPath}:${match.index}`;
                    if (!addedReferences
                        .has(refKey)) {
                        console.log('[findPluginReferences] Found new import reference');
                        addedReferences.add(refKey);
                        const start = TextUtils.indexToPosition(fileContent, match.index);
                        const end = TextUtils.indexToPosition(fileContent, match.index + match[0].length);
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
                console.error('[findPluginReferences] Error analyzing file:', uri.fsPath, e);
            }
        }

        console.log('[findPluginReferences] Analysis complete. Total references found:', references.length);
        return references;
    }

    public invalidateReferenceCache(): void {
        console.log('[invalidateReferenceCache] Clearing reference cache');
        this.referenceCache.clear();
    }

    public dispose(): void {
        if (this.fileWatcher) {
            this.fileWatcher.dispose();
        }
    }
}