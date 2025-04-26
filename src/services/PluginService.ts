import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

/**
 * @author Merite15
 * @created 2025-04-26 07:28:27
 */
export class PluginService {
    constructor(private nuxtProjectRoot: string) { }

    public static activate(context: vscode.ExtensionContext) {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) return;

        const nuxtProjectRoot = workspaceFolders[0].uri.fsPath;
        const pluginService = new PluginService(nuxtProjectRoot);

        // Enregistrer le provider de CodeLens
        context.subscriptions.push(
            vscode.languages.registerCodeLensProvider(
                [
                    { scheme: 'file', pattern: '**/plugins/**/*.{js,ts}' }
                ],
                {
                    provideCodeLenses: (document) => pluginService.provideCodeLenses(document)
                }
            )
        );
    }

    async provideCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
        const lenses: vscode.CodeLens[] = [];
        const text = document.getText();

        const defineNuxtPluginRegex = /defineNuxtPlugin\s*\(/g;
        let match: RegExpExecArray | null;

        while ((match = defineNuxtPluginRegex.exec(text))) {
            const pos = document.positionAt(match.index);
            const range = new vscode.Range(pos.line, 0, pos.line, 0);

            const pluginName = document.fileName.split('/').pop()?.replace(/\.(js|ts)$/, '');
            if (!pluginName) continue;

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

        return lenses;
    }

    private indexToPosition(content: string, index: number): { line: number; character: number } {
        const lines = content.slice(0, index).split('\n');
        const line = lines.length - 1;
        const character = lines[lines.length - 1].length;
        return { line, character };
    }

    /**
     * Trouver les références pour un plugin Nuxt
     */
    private async findPluginReferences(pluginName: string): Promise<vscode.Location[]> {
        if (!this.nuxtProjectRoot) return [];

        const references: vscode.Location[] = [];
        const addedReferences = new Set<string>();

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

        let provides: string[] = [];
        let hasDirectives: boolean = false;
        let directives: string[] = [];

        try {
            const provideRegex = /nuxtApp\.provide\s*\(\s*['\"`]([$\w]+)['\"`]/g;
            let match: RegExpExecArray | null;
            while ((match = provideRegex.exec(pluginContent))) {
                provides.push(match[1]);
            }

            const provideObjectRegex = /provide\s*:\s*\{([\s\S]*?)\}/g;
            const keyRegex = /(?:['\"`]?([$\w]+)['\"`]?\s*:|(\\b[$\w]+),)/g;

            let provideObjectMatch: RegExpExecArray | null;
            while ((provideObjectMatch = provideObjectRegex.exec(pluginContent))) {
                const keysBlock = provideObjectMatch[1];
                let keyMatch: RegExpExecArray | null;
                while ((keyMatch = keyRegex.exec(keysBlock))) {
                    const key = keyMatch[1] || keyMatch[2];
                    if (key) {
                        provides.push(key);
                    }
                }
            }

            provides = [...new Set(provides)];

            const directiveRegex = /nuxtApp\.vueApp\.directive\s*\(\s*['\"`]([\w-]+)['\"`]/g;
            while ((match = directiveRegex.exec(pluginContent))) {
                hasDirectives = true;
                directives.push(match[1]);
            }

            directives = [...new Set(directives)];

            if (provides.length === 0 && directives.length === 0) {
                console.warn(`[PluginScanner] No provide/directive detected for ${pluginName}`);
            } else {
                console.log(`[PluginScanner] Plugin "${pluginName}" exposes:`, provides, directives);
            }
        } catch (e) {
            console.error(`[PluginScanner] Error analyzing plugin ${pluginName}:`, e);
            return references;
        }

        const allFileUris = await vscode.workspace.findFiles(
            '**/*.{vue,js,ts}',
            '**/node_modules/**'
        );

        for (const uri of allFileUris) {
            if (uri.fsPath.includes('.nuxt') || uri.fsPath === pluginPath) continue;

            try {
                const fileContent = fs.readFileSync(uri.fsPath, 'utf-8');

                for (const key of provides) {
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
                            const start = this.indexToPosition(fileContent, match.index);
                            const end = this.indexToPosition(fileContent, match.index + match[0].length);

                            const refKey = `${uri.fsPath}:${start.line}:${start.character}:${end.line}:${end.character}`;

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

                if (hasDirectives) {
                    for (const directive of directives) {
                        const directiveRegex = new RegExp(`\\sv-${directive}\\b|\\s:v-${directive}\\b`, 'g');
                        let match: RegExpExecArray | null;

                        while ((match = directiveRegex.exec(fileContent))) {
                            const start = this.indexToPosition(fileContent, match.index);
                            const end = this.indexToPosition(fileContent, match.index + match[0].length);

                            const refKey = `${uri.fsPath}:${start.line}:${start.character}:${end.line}:${end.character}`;

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

                const importRegex = new RegExp(`import\\s+[^;]*['"\`]~/plugins/${pluginName}['"\`]`, 'g');
                let match: RegExpExecArray | null;

                while ((match = importRegex.exec(fileContent))) {
                    const start = this.indexToPosition(fileContent, match.index);
                    const end = this.indexToPosition(fileContent, match.index + match[0].length);

                    const refKey = `${uri.fsPath}:${start.line}:${start.character}:${end.line}:${end.character}`;

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
}