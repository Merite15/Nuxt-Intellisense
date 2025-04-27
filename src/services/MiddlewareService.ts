import * as vscode from 'vscode';
import * as fs from 'fs';
import { TextUtils } from '../utils/textUtils';
import path from 'path';

export class MiddlewareService {
    async provideCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
        const lenses: vscode.CodeLens[] = [];

        const text = document.getText();

        const defineNuxtMiddlewareRegex = /defineNuxtRouteMiddleware\s*\(/g;

        let match: RegExpExecArray | null;

        while ((match = defineNuxtMiddlewareRegex.exec(text))) {
            const pos = document.positionAt(match.index);

            const range = new vscode.Range(pos.line, 0, pos.line, 0);

            const middlewareName = path.basename(document.fileName, path.extname(document.fileName));

            const isGlobal = document.fileName.includes('.global.');

            if (isGlobal) {
                lenses.push(
                    new vscode.CodeLens(range, {
                        title: `🌍 Global Middleware`,
                        command: ''
                    })
                );
            } else {
                const references = await this.findMiddlewareReferences(middlewareName);

                const referenceCount = references.length;

                lenses.push(
                    new vscode.CodeLens(range, {
                        title: `🔗 ${referenceCount} reference${referenceCount > 1 ? 's' : ''}`,
                        command: referenceCount > 0 ? 'editor.action.showReferences' : '',
                        arguments: referenceCount > 0
                            ? [document.uri, pos, references]
                            : undefined
                    })
                );
            }
        }

        return lenses;
    }

    async findMiddlewareReferences(middlewareName: string): Promise<vscode.Location[]> {
        const results: vscode.Location[] = [];

        // 1. Recherche dans les pages Vue
        await this.findVueFileReferences(middlewareName, results);

        // 2. Recherche dans les configurations Nuxt
        await this.findNuxtConfigReferences(middlewareName, results);

        return results;
    }

    /**
     * Recherche les références au middleware dans les fichiers Vue
     */
    private async findVueFileReferences(middlewareName: string, results: vscode.Location[]): Promise<void> {
        const uris = await vscode.workspace.findFiles(
            '**/pages/**/*.vue',
            '{**/node_modules/**,**/.nuxt/**,**/.output/**,**/dist/**}'
        );

        for (const uri of uris) {
            let content: string;
            try {
                content = fs.readFileSync(uri.fsPath, 'utf-8');
            } catch {
                continue;
            }

            const definePageMetaRegex = /definePageMeta\s*\(\s*\{[^}]*\}/g;

            let metaMatch;

            while ((metaMatch = definePageMetaRegex.exec(content)) !== null) {
                const metaContent = metaMatch[0];

                const metaStartIndex = metaMatch.index;

                const singleMiddlewareRegex = new RegExp(`middleware\\s*:\\s*(['"\`])(${middlewareName})\\1`, 'g');

                let singleMatch;

                while ((singleMatch = singleMiddlewareRegex.exec(metaContent)) !== null) {
                    const middlewareValueIndex = metaContent.indexOf(singleMatch[1] + middlewareName + singleMatch[1], singleMatch.index);

                    const exactIndex = metaStartIndex + middlewareValueIndex + 1;

                    const start = TextUtils.indexToPosition(content, exactIndex);

                    const end = TextUtils.indexToPosition(content, exactIndex + middlewareName.length);

                    results.push(new vscode.Location(
                        uri,
                        new vscode.Range(
                            new vscode.Position(start.line, start.character),
                            new vscode.Position(end.line, end.character)
                        )
                    ));
                }

                const arrayMiddlewareRegex = /middleware\s*:\s*\[([^\]]*)\]/g;

                let arrayMatch;

                while ((arrayMatch = arrayMiddlewareRegex.exec(metaContent)) !== null) {
                    const arrayContent = arrayMatch[1];

                    const itemRegex = new RegExp(`(['"\`])(${middlewareName})\\1`, 'g');

                    let itemMatch;

                    while ((itemMatch = itemRegex.exec(arrayContent)) !== null) {
                        const arrayStartIndex = metaContent.indexOf(arrayContent, arrayMatch.index);

                        const middlewareInArrayIndex = arrayContent.indexOf(itemMatch[0]);

                        const exactIndex = metaStartIndex + arrayStartIndex + middlewareInArrayIndex + 1;

                        const start = TextUtils.indexToPosition(content, exactIndex);

                        const end = TextUtils.indexToPosition(content, exactIndex + middlewareName.length);

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
    }

    /**
     * Recherche les références au middleware dans les fichiers de configuration Nuxt
     */
    private async findNuxtConfigReferences(middlewareName: string, results: vscode.Location[]): Promise<void> {
        const configFiles = await vscode.workspace.findFiles(
            '**/nuxt.config.{js,ts}',
            '{**/node_modules/**,**/.nuxt/**,**/.output/**,**/dist/**}'
        );

        for (const uri of configFiles) {
            try {
                const content = fs.readFileSync(uri.fsPath, 'utf-8');

                // Recherche des middleware définis dans les hooks pages:extend
                // Recherche spécifique de middleware: 'middlewareName' dans le contenu
                const singleMiddlewareRegex = new RegExp(`middleware\\s*:\\s*(['"\`])(${middlewareName})\\1`, 'g');
                let singleMatch;

                while ((singleMatch = singleMiddlewareRegex.exec(content)) !== null) {
                    // Vérifier que c'est dans un contexte pages:extend
                    const previousContent = content.substring(0, singleMatch.index);
                    if (previousContent.lastIndexOf('pages:extend') !== -1) {
                        // Identifier la position exacte du nom du middleware
                        const middlewareValueIndex = content.indexOf(singleMatch[1] + middlewareName + singleMatch[1], singleMatch.index);
                        const exactIndex = middlewareValueIndex + 1; // +1 pour sauter la quote

                        const start = TextUtils.indexToPosition(content, exactIndex);
                        const end = TextUtils.indexToPosition(content, exactIndex + middlewareName.length);

                        results.push(new vscode.Location(
                            uri,
                            new vscode.Range(
                                new vscode.Position(start.line, start.character),
                                new vscode.Position(end.line, end.character)
                            )
                        ));
                    }
                }

                // Recherche des middleware définis comme tableau dans les hooks pages:extend
                const pagesExtendRegex = /'pages:extend'[\s\S]*?{[\s\S]*?}/g;
                let pagesExtendMatch;

                while ((pagesExtendMatch = pagesExtendRegex.exec(content)) !== null) {
                    const hookContent = pagesExtendMatch[0];

                    // Recherche des middleware en format tableau: middleware: [...]
                    const arrayMiddlewareRegex = /middleware\s*:\s*\[([^\]]*)\]/g;
                    let arrayMatch;

                    while ((arrayMatch = arrayMiddlewareRegex.exec(hookContent)) !== null) {
                        const arrayContent = arrayMatch[1];

                        // Recherche de notre middleware spécifique dans ce tableau
                        const itemRegex = new RegExp(`(['"\`])(${middlewareName})\\1`, 'g');
                        let itemMatch;

                        while ((itemMatch = itemRegex.exec(arrayContent)) !== null) {
                            // Calculer la position absolue dans le fichier
                            const hookStartIndex = pagesExtendMatch.index;
                            const arrayStartIndex = hookContent.indexOf(arrayContent, arrayMatch.index);
                            const middlewareInArrayIndex = arrayContent.indexOf(itemMatch[0]);

                            const exactIndex = hookStartIndex + arrayStartIndex + middlewareInArrayIndex + 1; // +1 pour sauter la quote

                            const start = TextUtils.indexToPosition(content, exactIndex);
                            const end = TextUtils.indexToPosition(content, exactIndex + middlewareName.length);

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
            } catch (e) {
                continue;
            }
        }
    }
}