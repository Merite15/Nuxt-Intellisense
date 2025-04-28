import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { TextUtils } from '../utils/textUtils';
import type { NuxtComponentInfo } from '../types';

export class ComposableService {
    constructor(private autoImportCache: Map<string, NuxtComponentInfo[]>) { }

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

            // Rechercher les références, y compris les auto-importations
            const references = await this.findAllReferences(document, name, pos);
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

    private async findAllReferences(document: vscode.TextDocument, name: string, position: vscode.Position): Promise<vscode.Location[]> {
        try {
            const results: vscode.Location[] = [];

            // Recherche standard des références via VS Code
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

            // Utiliser findFiles pour trouver tous les fichiers pertinents dans le workspace
            const uris = await vscode.workspace.findFiles(
                '**/*.{vue,js,ts}',
                '{**/node_modules/**,**/.nuxt/**,**/.output/**,**/dist/**}'
            );

            for (const uri of uris) {
                // Ignorer le fichier courant
                if (uri.fsPath === document.uri.fsPath) {
                    continue;
                }

                let content: string;
                try {
                    content = fs.readFileSync(uri.fsPath, 'utf-8');
                } catch {
                    continue;
                }

                // Rechercher les utilisations du composable
                const usageRegex = new RegExp(`\\b(${name}\\s*\\(|${name}\\s*<)`, 'g'); // Inclut les appels avec génériques
                let match;

                while ((match = usageRegex.exec(content)) !== null) {
                    const matchText = match[1];
                    const index = match.index;

                    // Calculer la position à la main
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
            }

            return results;
        } catch (e) {
            console.error('Error finding references:', e);
            return [];
        }
    }

    /**
     * Analyser le répertoire des composables
     */
    async scanComposablesDirectory(dir: string): Promise<void> {
        if (!fs.existsSync(dir)) {
            return;
        }

        const composableInfos: NuxtComponentInfo[] = [];

        const files = await vscode.workspace.findFiles(
            '**/*.{ts,js}',
            '{**/node_modules/**,**/.nuxt/**,**/.output/**,**/dist/**}'
        );

        for (const file of files) {
            try {
                const content = fs.readFileSync(file.fsPath, 'utf-8');
                // Ignorer complètement les fichiers qui ne sont pas dans le dossier composables
                if (!file.fsPath.includes(path.sep + 'composables' + path.sep)) {
                    continue;
                }

                // Vérifier si le fichier contient une définition de store Pinia
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
                // Ignorer les erreurs de lecture
            }
        }

        this.autoImportCache.set('composables', composableInfos);
    }
}