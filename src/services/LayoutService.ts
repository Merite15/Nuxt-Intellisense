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

            // Nom du layout basé sur le nom de fichier
            const layoutName = path.basename(document.fileName, '.vue');

            // Rechercher les références
            const references = await this.findLayoutReferences(layoutName);
            const referenceCount = references.length;

            if (layoutName === 'default') {
                lenses.push(
                    new vscode.CodeLens(range, {
                        title: `🖼️ Default Layout`,
                        command: ''
                    })
                );
            } else if (referenceCount > 0) {
                lenses.push(
                    new vscode.CodeLens(range, {
                        title: `🖼️ ${referenceCount} reference${referenceCount > 1 ? 's' : ''}`,
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

    /**
     * Trouver les références pour un layout
     */
    private async findLayoutReferences(layoutName: string): Promise<vscode.Location[]> {
        const uris = await vscode.workspace.findFiles('**/*.vue');
        const results: vscode.Location[] = [];

        for (const uri of uris) {
            // Utilise la lecture de fichier Node
            let content: string;
            try {
                content = fs.readFileSync(uri.fsPath, 'utf-8');
            } catch {
                continue;
            }

            const regex = new RegExp(`layout\\s*:\\s*(['"\`])${layoutName}\\1`, 'g');
            let match;
            while ((match = regex.exec(content)) !== null) {
                // Calcul position à la main
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
        }

        return results;
    }
}