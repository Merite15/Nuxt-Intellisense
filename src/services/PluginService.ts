import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { TextUtils } from '../utils/textUtils';

/**
 * @author Merite15
 * @created 2025-04-26 07:28:27
 */
export class PluginService {
    async provideCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
        const lenses: vscode.CodeLens[] = [];
        const text = document.getText();

        const defineNuxtPluginRegex = /defineNuxtPlugin\s*\(/g;
        let match: RegExpExecArray | null;

        while ((match = defineNuxtPluginRegex.exec(text))) {
            const pos = document.positionAt(match.index);

            const range = new vscode.Range(pos.line, 0, pos.line, 0);

            const pluginName = path.basename(document.fileName, path.extname(document.fileName));

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

    /**
     * Trouver les références pour un plugin Nuxt
     */
    async findPluginReferences(pluginName: string): Promise<vscode.Location[]> {
        const references: vscode.Location[] = [];
        // Utilisé pour suivre les références déjà ajoutées et éviter les duplications
        const addedReferences = new Set<string>();

        // Find the plugin file first
        const pluginUris = await vscode.workspace.findFiles(
            `**/plugins/${pluginName}.{js,ts}`,
            '{**/node_modules/**,**/.nuxt/**,**/.output/**,**/dist/**}'
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
                            const start = TextUtils.indexToPosition(fileContent, match.index);
                            const end = TextUtils.indexToPosition(fileContent, match.index + match[0].length);

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
                            const start = TextUtils.indexToPosition(fileContent, match.index);
                            const end = TextUtils.indexToPosition(fileContent, match.index + match[0].length);

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
                    const start = TextUtils.indexToPosition(fileContent, match.index);
                    const end = TextUtils.indexToPosition(fileContent, match.index + match[0].length);

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
}