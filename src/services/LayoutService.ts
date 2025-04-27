import * as vscode from 'vscode';
import * as fs from 'fs';
import { TextUtils } from '../utils/textUtils';
import * as path from 'path';

export class LayoutService {
    async provideCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
        const lenses: vscode.CodeLens[] = [];
        const text = document.getText();
        const layoutSetupRegex = /<script\s+setup[^>]*>|<template>/g;
        let match: RegExpExecArray | null;

        if ((match = layoutSetupRegex.exec(text))) {
            const pos = document.positionAt(match.index);
            const range = new vscode.Range(pos.line, 0, pos.line, 0);

            // Layout name based on file name
            const layoutName = path.basename(document.fileName, '.vue');

            // Find references
            const references = await this.findLayoutReferences(layoutName);

            const referenceCount = references.length;

            if (layoutName === 'default') {
                lenses.push(
                    new vscode.CodeLens(range, {
                        title: `🖼️ Default Layout`,
                        command: ''
                    })
                );
            } else {
                lenses.push(
                    new vscode.CodeLens(range, {
                        title: `🖼️ ${referenceCount} reference${referenceCount > 1 ? 's' : ''}`,
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

    /**
     * Find references for a layout
     */
    private async findLayoutReferences(layoutName: string): Promise<vscode.Location[]> {
        const results: vscode.Location[] = [];

        // Find explicit references in Vue files
        const vueFiles = await vscode.workspace.findFiles(
            '**/*.vue',
            '{**/node_modules/**,**/.nuxt/**,**/.output/**,**/dist/**}'
        );

        for (const uri of vueFiles) {
            try {
                const content = fs.readFileSync(uri.fsPath, 'utf-8');

                // Regular expression to match layout: 'layoutName'
                const regex = new RegExp(`layout\\s*:\\s*(['"\`])${layoutName}\\1`, 'g');
                let match;

                while ((match = regex.exec(content)) !== null) {
                    const start = TextUtils.indexToPosition(content, match.index);
                    const end = TextUtils.indexToPosition(content, match.index + match[0].length);

                    results.push(new vscode.Location(
                        uri,
                        new vscode.Range(
                            new vscode.Position(start.line, start.character),
                            new vscode.Position(end.line, end.character)
                        )
                    ));
                }
            } catch (e) {
                continue;
            }
        }

        // Find references in Nuxt config files
        const configFiles = await vscode.workspace.findFiles(
            '**/nuxt.config.{js,ts}',
            '{**/node_modules/**,**/.nuxt/**,**/.output/**,**/dist/**}'
        );

        for (const uri of configFiles) {
            try {
                const content = fs.readFileSync(uri.fsPath, 'utf-8');

                // Recherche spécifique de layout: 'layoutName' dans les hooks de configuration
                const layoutInHookRegex = new RegExp(`layout\\s*:\\s*(['"\`])${layoutName}\\1`, 'g');
                let layoutMatch;

                while ((layoutMatch = layoutInHookRegex.exec(content)) !== null) {
                    // Vérifier que ce layout est dans un hook pages:extend
                    const previousContent = content.substring(0, layoutMatch.index);

                    if (previousContent.lastIndexOf('pages:extend') !== -1) {
                        const start = TextUtils.indexToPosition(content, layoutMatch.index);
                        const end = TextUtils.indexToPosition(content, layoutMatch.index + layoutMatch[0].length);

                        results.push(new vscode.Location(
                            uri,
                            new vscode.Range(
                                new vscode.Position(start.line, start.character),
                                new vscode.Position(end.line, end.character)
                            )
                        ));
                    }
                }
            } catch (e) {
                continue;
            }
        }

        return results;
    }
}