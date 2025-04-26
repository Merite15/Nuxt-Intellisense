import * as vscode from 'vscode';
import * as fs from 'fs';
import { FileUtils } from '../utils/fileUtils';
import { TextUtils } from '../utils/textUtils';

export class StoreService {
    constructor(private nuxtProjectRoot: string) { }

    async provideCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
        const lenses: vscode.CodeLens[] = [];
        const text = document.getText();

        const defineStoreRegex = /defineStore\s*\(\s*(['"`])(.*?)\1/g;
        let match: RegExpExecArray | null;

        while ((match = defineStoreRegex.exec(text))) {
            const storeName = match[2];
            const pos = document.positionAt(match.index);
            const range = new vscode.Range(pos.line, 0, pos.line, 0);

            // Obtenir les références PRÉCISES
            const preciseReferences = await this.findStoreReferences(storeName);
            const uniqueReferences = this.removeDuplicateReferences(preciseReferences);
            const referenceCount = uniqueReferences.length;

            lenses.push(
                new vscode.CodeLens(range, {
                    title: `🗃️ ${referenceCount} reference${referenceCount > 1 ? 's' : ''}`,
                    command: 'editor.action.showReferences',
                    arguments: [
                        document.uri,
                        new vscode.Position(pos.line, match[0].indexOf(storeName)),
                        uniqueReferences
                    ]
                })
            );
        }

        return lenses;
    }

    private removeDuplicateReferences(references: vscode.Location[]): vscode.Location[] {
        const uniqueRefs: vscode.Location[] = [];
        const seen = new Set<string>();

        for (const ref of references) {
            const key = `${ref.uri.fsPath}:${ref.range.start.line}:${ref.range.start.character}`;
            if (!seen.has(key)) {
                seen.add(key);
                uniqueRefs.push(ref);
            }
        }

        return uniqueRefs;
    }

    async findStoreReferences(storeName: string): Promise<vscode.Location[]> {
        try {
            // Normaliser le nom pour le hook
            const normalizedName = storeName
                .split(/[-_\s]/)
                .map(s => s.charAt(0).toUpperCase() + s.slice(1))
                .join('');

            const storeHookName = `use${normalizedName}Store`;
            // Support pour différentes variations de nommage du store
            const possibleStoreIds = [
                storeName,
                storeName.replace(/-/g, ' '),
                storeName.replace(/-/g, '_'),
                `${storeName}s`,
                `${storeName.replace(/-/g, ' ')}s`,
                `${storeName.replace(/-/g, '_')}s`
            ];

            const uris = await vscode.workspace.findFiles('**/*.{vue,js,ts}');
            const results: vscode.Location[] = [];
            const storeDefinitions: Map<string, string> = new Map();
            const storeDefinitionFiles: Set<string> = new Set();

            // Première passe: trouver toutes les définitions de store
            for (const uri of uris) {
                if (FileUtils.shouldSkipFile(uri.fsPath)) continue;

                let content: string;
                try {
                    content = fs.readFileSync(uri.fsPath, 'utf-8');
                } catch {
                    continue;
                }

                const defineStoreRegex = /defineStore\s*\(\s*['"]([^'"]+)['"]/g;
                let defineMatch;

                while ((defineMatch = defineStoreRegex.exec(content))) {
                    const storeId = defineMatch[1];

                    if (possibleStoreIds.includes(storeId)) {
                        storeDefinitionFiles.add(uri.fsPath);
                    }

                    const hookNameRegex = /const\s+(\w+)\s*=\s*defineStore\s*\(\s*['"]([^'"]+)['"]/g;
                    hookNameRegex.lastIndex = 0;

                    let hookMatch;
                    while ((hookMatch = hookNameRegex.exec(content))) {
                        if (hookMatch[2] === storeId) {
                            storeDefinitions.set(storeId, hookMatch[1]);
                            break;
                        }
                    }
                }
            }

            // Deuxième passe: chercher les références
            for (const uri of uris) {
                if (FileUtils.shouldSkipFile(uri.fsPath) || storeDefinitionFiles.has(uri.fsPath)) continue;

                let content: string;
                try {
                    content = fs.readFileSync(uri.fsPath, 'utf-8');
                } catch {
                    continue;
                }

                // Chercher les usages du hook par nom conventionnel
                const hookRegex = new RegExp(`\\b${storeHookName}\\b`, 'g');
                this.findMatches(hookRegex, content, uri, results);

                // Chercher les usages par ID de store
                for (const storeId of possibleStoreIds) {
                    const storeIdRegex = new RegExp(`useStore\\s*\\(\\s*['"]${storeId}['"]\\s*\\)`, 'g');
                    this.findMatches(storeIdRegex, content, uri, results);

                    if (storeDefinitions.has(storeId)) {
                        const hookName = storeDefinitions.get(storeId);
                        const customHookRegex = new RegExp(`\\b${hookName}\\b`, 'g');
                        this.findMatches(customHookRegex, content, uri, results);
                    }
                }
            }

            return results;
        } catch (e) {
            console.error('Error:', e);
            return [];
        }
    }

    private findMatches(regex: RegExp, content: string, uri: vscode.Uri, results: vscode.Location[]): void {
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
    }
}