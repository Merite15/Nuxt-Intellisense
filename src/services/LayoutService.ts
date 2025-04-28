import * as vscode from 'vscode';
import * as fs from 'fs';
import { TextUtils } from '../utils/textUtils';
import * as path from 'path';

export class LayoutService {
    constructor() {
        console.log('[LayoutService] Service initialized');
    }

    async provideCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
        console.log('[provideCodeLenses] Starting analysis for document:', document.uri.toString());
        const lenses: vscode.CodeLens[] = [];
        const text = document.getText();
        const layoutSetupRegex = /<script\s+setup[^>]*>|<template>/g;
        let match: RegExpExecArray | null;

        if ((match = layoutSetupRegex.exec(text))) {
            console.log('[provideCodeLenses] Found layout setup or template tag at position:', match.index);
            const pos = document.positionAt(match.index);
            const range = new vscode.Range(pos.line, 0, pos.line, 0);

            // Layout name based on file name
            const layoutName = path.basename(document.fileName, '.vue');
            console.log('[provideCodeLenses] Analyzing layout:', layoutName);

            // Find references
            const references = await this.findLayoutReferences(layoutName);
            const referenceCount = references.length;
            console.log('[provideCodeLenses] Found', referenceCount, 'references for layout:', layoutName);

            if (layoutName === 'default') {
                console.log('[provideCodeLenses] Adding lens for default layout');
                lenses.push(
                    new vscode.CodeLens(range, {
                        title: `🖼️ Default Layout`,
                        command: ''
                    })
                );
            } else {
                console.log('[provideCodeLenses] Adding lens with reference count:', referenceCount);
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
        } else {
            console.log('[provideCodeLenses] No layout setup or template tag found in document');
        }

        console.log('[provideCodeLenses] Returning', lenses.length, 'lenses');
        return lenses;
    }

    /**
     * Find references for a layout
     */
    private async findLayoutReferences(layoutName: string): Promise<vscode.Location[]> {
        console.log('[findLayoutReferences] Starting search for layout:', layoutName);
        const results: vscode.Location[] = [];

        // Find explicit references in Vue files
        console.log('[findLayoutReferences] Searching Vue files');
        const vueFiles = await vscode.workspace.findFiles(
            '**/*.vue',
            '{**/node_modules/**,**/.nuxt/**,**/.output/**,**/dist/**}'
        );
        console.log('[findLayoutReferences] Found', vueFiles.length, 'Vue files to analyze');

        for (const uri of vueFiles) {
            try {
                console.log('[findLayoutReferences] Analyzing Vue file:', uri.fsPath);
                const content = fs.readFileSync(uri.fsPath, 'utf-8');

                // Regular expression to match layout: 'layoutName'
                const regex = new RegExp(`layout\\s*:\\s*(['"\`])${layoutName}\\1`, 'g');
                let match;

                while ((match = regex.exec(content)) !== null) {
                    console.log('[findLayoutReferences] Found layout reference in:', uri.fsPath);
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
                console.error('[findLayoutReferences] Error analyzing Vue file:', uri.fsPath, e);
                continue;
            }
        }

        // Find references in Nuxt config files
        console.log('[findLayoutReferences] Searching Nuxt config files');
        const configFiles = await vscode.workspace.findFiles(
            '**/nuxt.config.{js,ts}',
            '{**/node_modules/**,**/.nuxt/**,**/.output/**,**/dist/**}'
        );
        console.log('[findLayoutReferences] Found', configFiles.length, 'config files to analyze');

        for (const uri of configFiles) {
            try {
                console.log('[findLayoutReferences] Analyzing config file:', uri.fsPath);
                const content = fs.readFileSync(uri.fsPath, 'utf-8');

                // Recherche spécifique de layout: 'layoutName' dans les hooks de configuration
                const layoutInHookRegex = new RegExp(`layout\\s*:\\s*(['"\`])${layoutName}\\1`, 'g');
                let layoutMatch;

                while ((layoutMatch = layoutInHookRegex.exec(content)) !== null) {
                    console.log('[findLayoutReferences] Found potential layout reference in config');
                    // Vérifier que ce layout est dans un hook pages:extend
                    const previousContent = content.substring(0, layoutMatch.index);

                    if (previousContent.lastIndexOf('pages:extend') !== -1) {
                        console.log('[findLayoutReferences] Confirmed layout reference in pages:extend hook');
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
                console.error('[findLayoutReferences] Error analyzing config file:', uri.fsPath, e);
                continue;
            }
        }

        console.log('[findLayoutReferences] Total references found:', results.length);
        return results;
    }
}