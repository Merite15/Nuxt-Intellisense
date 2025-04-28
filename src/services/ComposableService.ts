import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { TextUtils } from '../utils/textUtils';
import type { NuxtComponentInfo } from '../types';

export class ComposableService {
    constructor(private autoImportCache: Map<string, NuxtComponentInfo[]>) {
        console.log('[ComposableService] Initialized with autoImportCache size:', autoImportCache.size);
    }

    async provideCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
        console.log('[provideCodeLenses] Starting analysis for document:', document.uri.toString());
        const lenses: vscode.CodeLens[] = [];
        const text = document.getText();
        const composableRegex = /export\s+(const|function|async function)\s+(\w+)/g;
        let match: RegExpExecArray | null;

        while ((match = composableRegex.exec(text))) {
            const funcType = match[1];
            const name = match[2];
            console.log('[provideCodeLenses] Found composable:', { type: funcType, name: name });

            const pos = document.positionAt(match.index);
            const range = new vscode.Range(pos.line, 0, pos.line, 0);

            const references = await this.findAllReferences(document, name, pos);
            const referenceCount = references.length;
            console.log('[provideCodeLenses] Found references for', name, ':', referenceCount);

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

        console.log('[provideCodeLenses] Returning total lenses:', lenses.length);
        return lenses;
    }

    private async findAllReferences(document: vscode.TextDocument, name: string, position: vscode.Position): Promise<vscode.Location[]> {
        console.log('[findAllReferences] Starting search for:', name);
        try {
            const results: vscode.Location[] = [];

            console.log('[findAllReferences] Executing reference provider for:', name);
            const references = await vscode.commands.executeCommand<vscode.Location[]>(
                'vscode.executeReferenceProvider',
                document.uri,
                new vscode.Position(position.line, position.character + name.length - 1)
            ) || [];
            console.log('[findAllReferences] Initial references found:', references.length);

            // Filtrer les fichiers générés
            for (const ref of references) {
                if (!ref.uri.fsPath.includes('.nuxt') &&
                    !(ref.uri.fsPath === document.uri.fsPath && ref.range.start.line === position.line)) {
                    results.push(ref);
                }
            }
            console.log('[findAllReferences] Filtered references:', results.length);

            // Recherche de fichiers
            console.log('[findAllReferences] Searching for additional files');
            const uris = await vscode.workspace.findFiles(
                '**/*.{vue,js,ts}',
                '{**/node_modules/**,**/.nuxt/**,**/.output/**,**/dist/**}'
            );
            console.log('[findAllReferences] Found files to analyze:', uris.length);

            for (const uri of uris) {
                if (uri.fsPath === document.uri.fsPath) {
                    continue;
                }

                let content: string;
                try {
                    content = fs.readFileSync(uri.fsPath, 'utf-8');
                } catch (error) {
                    console.log('[findAllReferences] Error reading file:', uri.fsPath, error);
                    continue;
                }

                const usageRegex = new RegExp(`\\b(${name}\\s*\\(|${name}\\s*<)`, 'g');
                let match;

                while ((match = usageRegex.exec(content)) !== null) {
                    console.log('[findAllReferences] Found usage in file:', uri.fsPath);
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
            }

            console.log('[findAllReferences] Total references found:', results.length);
            return results;
        } catch (e) {
            console.error('[findAllReferences] Error finding references:', e);
            return [];
        }
    }

    async scanComposablesDirectory(dir: string): Promise<void> {
        console.log('[scanComposablesDirectory] Starting scan of directory:', dir);

        if (!fs.existsSync(dir)) {
            console.log('[scanComposablesDirectory] Directory does not exist:', dir);
            return;
        }

        const composableInfos: NuxtComponentInfo[] = [];

        console.log('[scanComposablesDirectory] Searching for files');
        const files = await vscode.workspace.findFiles(
            '**/*.{ts,js}',
            '{**/node_modules/**,**/.nuxt/**,**/.output/**,**/dist/**}'
        );
        console.log('[scanComposablesDirectory] Found files:', files.length);

        for (const file of files) {
            try {
                const content = fs.readFileSync(file.fsPath, 'utf-8');

                if (!file.fsPath.includes(path.sep + 'composables' + path.sep)) {
                    console.log('[scanComposablesDirectory] Skipping non-composable file:', file.fsPath);
                    continue;
                }

                if (content.includes('defineStore')) {
                    console.log('[scanComposablesDirectory] Skipping store file:', file.fsPath);
                    continue;
                }

                const exportRegex = /export\s+(const|function|async function)\s+(\w+)/g;
                let match: RegExpExecArray | null;

                while ((match = exportRegex.exec(content))) {
                    const name = match[2];
                    console.log('[scanComposablesDirectory] Found composable:', name, 'in file:', file.fsPath);
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

        console.log('[scanComposablesDirectory] Total composables found:', composableInfos.length);
        this.autoImportCache.set('composables', composableInfos);
        console.log('[scanComposablesDirectory] Updated autoImportCache');
    }
}