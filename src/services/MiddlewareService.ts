import * as vscode from 'vscode';
import * as fs from 'fs';
import { TextUtils } from '../utils/textUtils';
import type { NuxtComponentInfo } from '../types';
import path from 'path';

export class MiddlewareService {
    constructor(private nuxtProjectRoot: string) { }

    async provideCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
        const lenses: vscode.CodeLens[] = [];
        const text = document.getText();

        const defineNuxtMiddlewareRegex = /defineNuxtRouteMiddleware\s*\(/g;
        let match: RegExpExecArray | null;

        while ((match = defineNuxtMiddlewareRegex.exec(text))) {
            const pos = document.positionAt(match.index);
            const range = new vscode.Range(pos.line, 0, pos.line, 0);

            // Nom du middleware basé sur le nom de fichier
            const middlewareName = path.basename(document.fileName, path.extname(document.fileName));

            // Vérifier si c'est un middleware global
            const isGlobal = document.fileName.includes('.global.');

            if (isGlobal) {
                lenses.push(
                    new vscode.CodeLens(range, {
                        title: `🌍 Global Middleware`,
                        command: ''
                    })
                );
            } else {
                // Rechercher les références seulement si ce n'est pas un middleware global
                const references = await this.findMiddlewareReferences(middlewareName);
                const referenceCount = references.length;

                lenses.push(
                    new vscode.CodeLens(range, {
                        title: `🔗 ${referenceCount} reference${referenceCount > 1 ? 's' : ''}`,
                        command: 'editor.action.showReferences',
                        arguments: [
                            document.uri,
                            pos,
                            references
                        ]
                    })
                );
            }
        }

        return lenses;
    }

    async findMiddlewareReferences(middlewareName: string): Promise<vscode.Location[]> {
        // Utiliser findFiles pour trouver toutes les pages Vue du projet
        const uris = await vscode.workspace.findFiles('**/pages/**/*.vue');
        const results: vscode.Location[] = [];

        for (const uri of uris) {
            let content: string;
            try {
                content = fs.readFileSync(uri.fsPath, 'utf-8');
            } catch {
                continue;
            }

            // Rechercher les blocs definePageMeta
            const definePageMetaRegex = /definePageMeta\s*\(\s*\{[^}]*\}/g;
            let metaMatch;

            while ((metaMatch = definePageMetaRegex.exec(content))) {
                const metaContent = metaMatch[0];
                const metaStartIndex = metaMatch.index;

                // Cas 1: middleware en tant que chaîne unique - middleware: 'chat'
                const singleMiddlewareRegex = new RegExp(`middleware\\s*:\\s*(['"\`])(${middlewareName})\\1`, 'g');
                let singleMatch;

                while ((singleMatch = singleMiddlewareRegex.exec(metaContent))) {
                    // Calculer la position exacte pour le middleware
                    const middlewareValueIndex = metaContent.indexOf(singleMatch[1] + middlewareName + singleMatch[1], singleMatch.index);
                    const exactIndex = metaStartIndex + middlewareValueIndex + 1; // +1 pour sauter le guillemet d'ouverture

                    // Calculer la position à la main
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

                // Cas 2: middleware en tant que tableau - middleware: ['mobile-only', 'chat']
                const arrayMiddlewareRegex = /middleware\s*:\s*\[([^\]]*)\]/g;
                let arrayMatch;

                while ((arrayMatch = arrayMiddlewareRegex.exec(metaContent))) {
                    const arrayContent = arrayMatch[1];
                    const itemRegex = new RegExp(`(['"\`])(${middlewareName})\\1`, 'g');
                    let itemMatch;

                    while ((itemMatch = itemRegex.exec(arrayContent))) {
                        // Calculer la position exacte dans le tableau
                        const arrayStartIndex = metaContent.indexOf(arrayContent, arrayMatch.index);
                        const middlewareInArrayIndex = arrayContent.indexOf(itemMatch[0]);
                        const exactIndex = metaStartIndex + arrayStartIndex + middlewareInArrayIndex + 1; // +1 pour sauter le guillemet d'ouverture

                        // Calculer la position à la main
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

        return results;
    }

    async scanMiddlewareDirectory(dir: string): Promise<NuxtComponentInfo[]> {
        if (!fs.existsSync(dir)) {
            return [];
        }

        const middlewareInfos: NuxtComponentInfo[] = [];
        const relativePattern = new vscode.RelativePattern(dir, '**/*.{js,ts}');
        const files = await vscode.workspace.findFiles(relativePattern);

        for (const file of files) {
            try {
                const content = fs.readFileSync(file.fsPath, 'utf-8');
                const isGlobal = file.fsPath.includes('.global.');
                const middlewareName = path
                    .basename(file.fsPath)
                    .replace(/\.(js|ts)$/, '');

                // Vérifier si le fichier contient une définition de middleware
                if (content.includes('defineNuxtRouteMiddleware')) {
                    middlewareInfos.push({
                        name: middlewareName,
                        path: file.fsPath,
                        isAutoImported: !isGlobal, // Les middlewares globaux ne sont pas auto-importés
                        exportType: isGlobal ? 'global' : 'middleware'
                    });
                }
            } catch (error) {
                console.error(`Error scanning middleware file ${file.fsPath}:`, error);
            }
        }

        return middlewareInfos;
    }
}