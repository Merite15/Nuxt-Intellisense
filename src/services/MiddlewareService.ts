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
        const uris = await vscode.workspace.findFiles(
            '**/pages/**/*.vue',
            '{**/node_modules/**,**/.nuxt/**,**/.output/**,**/dist/**}'
        );

        const results: vscode.Location[] = [];

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

        return results;
    }
}