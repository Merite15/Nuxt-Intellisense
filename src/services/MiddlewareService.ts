import * as vscode from 'vscode';
import * as fs from 'fs';
import { TextUtils } from '../utils/textUtils';
import path from 'path';

export class MiddlewareService {
    constructor() {
        console.log('[MiddlewareService] Service initialized');
    }

    async provideCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
        console.log('[provideCodeLenses] Starting analysis for document:', document.uri.toString());
        const lenses: vscode.CodeLens[] = [];
        const text = document.getText();
        const defineNuxtMiddlewareRegex = /defineNuxtRouteMiddleware\s*\(/g;
        let match: RegExpExecArray | null;

        while ((match = defineNuxtMiddlewareRegex.exec(text))) {
            console.log('[provideCodeLenses] Found middleware definition at position:', match.index);
            const pos = document.positionAt(match.index);
            const range = new vscode.Range(pos.line, 0, pos.line, 0);
            const middlewareName = path.basename(document.fileName, path.extname(document.fileName));
            const isGlobal = document.fileName.includes('.global.');

            console.log('[provideCodeLenses] Middleware details:', {
                name: middlewareName,
                isGlobal,
                position: pos.line
            });

            if (isGlobal) {
                console.log('[provideCodeLenses] Adding global middleware lens');
                lenses.push(
                    new vscode.CodeLens(range, {
                        title: `🌍 Global Middleware`,
                        command: ''
                    })
                );
            } else {
                console.log('[provideCodeLenses] Searching references for middleware:', middlewareName);
                const references = await this.findMiddlewareReferences(middlewareName);
                const referenceCount = references.length;
                console.log('[provideCodeLenses] Found', referenceCount, 'references');

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

        console.log('[provideCodeLenses] Returning', lenses.length, 'lenses');
        return lenses;
    }

    async findMiddlewareReferences(middlewareName: string): Promise<vscode.Location[]> {
        console.log('[findMiddlewareReferences] Starting search for middleware:', middlewareName);
        const results: vscode.Location[] = [];

        console.log('[findMiddlewareReferences] Searching Vue files');
        await this.findVueFileReferences(middlewareName, results);
        console.log('[findMiddlewareReferences] Vue file search complete, found:', results.length, 'references');

        console.log('[findMiddlewareReferences] Searching Nuxt config files');
        await this.findNuxtConfigReferences(middlewareName, results);
        console.log('[findMiddlewareReferences] Config file search complete, total references:', results.length);

        return results;
    }

    private async findVueFileReferences(middlewareName: string, results: vscode.Location[]): Promise<void> {
        console.log('[findVueFileReferences] Starting Vue file analysis for:', middlewareName);
        const uris = await vscode.workspace.findFiles(
            '**/pages/**/*.vue',
            '{**/node_modules/**,**/.nuxt/**,**/.output/**,**/dist/**}'
        );
        console.log('[findVueFileReferences] Found', uris.length, 'Vue files to analyze');

        for (const uri of uris) {
            console.log('[findVueFileReferences] Analyzing file:', uri.fsPath);
            let content: string;
            try {
                content = fs.readFileSync(uri.fsPath, 'utf-8');
            } catch (e) {
                console.error('[findVueFileReferences] Error reading file:', uri.fsPath, e);
                continue;
            }

            const definePageMetaRegex = /definePageMeta\s*\(\s*\{[^}]*\}/g;
            let metaMatch;

            while ((metaMatch = definePageMetaRegex.exec(content)) !== null) {
                console.log('[findVueFileReferences] Found definePageMeta at position:', metaMatch.index);
                const metaContent = metaMatch[0];
                const metaStartIndex = metaMatch.index;

                // Recherche middleware unique
                const singleMiddlewareRegex = new RegExp(`middleware\\s*:\\s*(['"\`])(${middlewareName})\\1`, 'g');
                let singleMatch;

                while ((singleMatch = singleMiddlewareRegex.exec(metaContent)) !== null) {
                    console.log('[findVueFileReferences] Found single middleware reference');
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

                // Recherche middleware en tableau
                const arrayMiddlewareRegex = /middleware\s*:\s*\[([^\]]*)\]/g;
                let arrayMatch;

                while ((arrayMatch = arrayMiddlewareRegex.exec(metaContent)) !== null) {
                    console.log('[findVueFileReferences] Found middleware array');
                    const arrayContent = arrayMatch[1];
                    const itemRegex = new RegExp(`(['"\`])(${middlewareName})\\1`, 'g');
                    let itemMatch;

                    while ((itemMatch = itemRegex.exec(arrayContent)) !== null) {
                        console.log('[findVueFileReferences] Found middleware in array');
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
        console.log('[findVueFileReferences] Vue file analysis complete');
    }

    private async findNuxtConfigReferences(middlewareName: string, results: vscode.Location[]): Promise<void> {
        console.log('[findNuxtConfigReferences] Starting config file analysis for:', middlewareName);
        const configFiles = await vscode.workspace.findFiles(
            '**/nuxt.config.{js,ts}',
            '{**/node_modules/**,**/.nuxt/**,**/.output/**,**/dist/**}'
        );
        console.log('[findNuxtConfigReferences] Found', configFiles.length, 'config files to analyze');

        for (const uri of configFiles) {
            console.log('[findNuxtConfigReferences] Analyzing config file:', uri.fsPath);
            try {
                const content = fs.readFileSync(uri.fsPath, 'utf-8');

                // Recherche middleware unique
                const singleMiddlewareRegex = new RegExp(`middleware\\s*:\\s*(['"\`])(${middlewareName})\\1`, 'g');
                let singleMatch;

                while ((singleMatch = singleMiddlewareRegex.exec(content)) !== null) {
                    console.log('[findNuxtConfigReferences] Found potential single middleware reference');
                    const previousContent = content.substring(0, singleMatch.index);
                    if (previousContent.lastIndexOf('pages:extend') !== -1) {
                        console.log('[findNuxtConfigReferences] Confirmed middleware in pages:extend context');
                        const middlewareValueIndex = content.indexOf(singleMatch[1] + middlewareName + singleMatch[1], singleMatch.index);
                        const exactIndex = middlewareValueIndex + 1;

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

                // Recherche dans les hooks pages:extend
                const pagesExtendRegex = /'pages:extend'[\s\S]*?{[\s\S]*?}/g;
                let pagesExtendMatch;

                while ((pagesExtendMatch = pagesExtendRegex.exec(content)) !== null) {
                    console.log('[findNuxtConfigReferences] Found pages:extend hook');
                    const hookContent = pagesExtendMatch[0];

                    const arrayMiddlewareRegex = /middleware\s*:\s*\[([^\]]*)\]/g;
                    let arrayMatch;

                    while ((arrayMatch = arrayMiddlewareRegex.exec(hookContent)) !== null) {
                        console.log('[findNuxtConfigReferences] Found middleware array in hook');
                        const arrayContent = arrayMatch[1];
                        const itemRegex = new RegExp(`(['"\`])(${middlewareName})\\1`, 'g');
                        let itemMatch;

                        while ((itemMatch = itemRegex.exec(arrayContent)) !== null) {
                            console.log('[findNuxtConfigReferences] Found middleware in array');
                            const hookStartIndex = pagesExtendMatch.index;
                            const arrayStartIndex = hookContent.indexOf(arrayContent, arrayMatch.index);
                            const middlewareInArrayIndex = arrayContent.indexOf(itemMatch[0]);
                            const exactIndex = hookStartIndex + arrayStartIndex + middlewareInArrayIndex + 1;

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
                console.error('[findNuxtConfigReferences] Error analyzing config file:', uri.fsPath, e);
                continue;
            }
        }
        console.log('[findNuxtConfigReferences] Config file analysis complete');
    }
}