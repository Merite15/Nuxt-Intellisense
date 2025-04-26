import * as vscode from 'vscode';
import * as fs from 'fs';
import { FileUtils } from '../utils/fileUtils';
import { TextUtils } from '../utils/textUtils';

export class PluginService {
    constructor(private nuxtProjectRoot: string) { }

    async provideCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
        const lenses: vscode.CodeLens[] = [];
        const text = document.getText();
        const defineNuxtPluginRegex = /defineNuxtPlugin\s*\(\s*\{[^}]*\}/g;
        let match: RegExpExecArray | null;

        while ((match = defineNuxtPluginRegex.exec(text))) {
            const pos = document.positionAt(match.index);
            const range = new vscode.Range(pos.line, 0, pos.line, 0);

            // Nom du plugin basé sur le nom de fichier
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

    async findPluginReferences(pluginName: string): Promise<vscode.Location[]> {
        const references: vscode.Location[] = [];

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
        const provides: string[] = [];
        const directives: string[] = [];
        let hasDirectives = false;

        // 1. Classic detection via nuxtApp.provide('key', ...)
        const provideRegex = /nuxtApp\.provide\s*\(\s*['"`]([$\w]+)['"`]/g;
        let match: RegExpExecArray | null;
        while ((match = provideRegex.exec(pluginContent))) {
            provides.push(match[1]);
        }

        // 2. Advanced detection via `provide: { key: value }`
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

        // 3. Detect directives
        const directiveRegex = /nuxtApp\.vueApp\.directive\s*\(\s*['"`]([\w-]+)['"`]/g;
        while ((match = directiveRegex.exec(pluginContent))) {
            hasDirectives = true;
            directives.push(match[1]);
        }

        // Find all potential files that could reference the plugin
        const allFileUris = await vscode.workspace.findFiles(
            '**/*.{vue,js,ts}',
            '**/node_modules/**'
        );

        for (const uri of allFileUris) {
            if (FileUtils.shouldSkipFile(uri.fsPath) || uri.fsPath === pluginPath) continue;

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
                        new RegExp(`this\\.\\$${key}\\b`, 'g')
                    ];

                    for (const regex of patterns) {
                        let match: RegExpExecArray | null;
                        while ((match = regex.exec(fileContent))) {
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

                // Check for directives usage
                if (hasDirectives) {
                    for (const directive of directives) {
                        const directiveRegex = new RegExp(`\\sv-${directive}\\b|\\s:v-${directive}\\b`, 'g');
                        let match: RegExpExecArray | null;

                        while ((match = directiveRegex.exec(fileContent))) {
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

            } catch (e) {
                // Ignore reading errors
            }
        }

        return references;
    }
}