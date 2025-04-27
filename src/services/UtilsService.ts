import * as vscode from 'vscode';
import * as fs from 'fs';
import { FileUtils } from '../utils/fileUtils';
import { PathUtils } from '../utils/pathUtils';
import { TextUtils } from '../utils/textUtils';
import * as path from 'path';
import type { NuxtComponentInfo } from '../types';

export class UtilsService {
    constructor(
        private autoImportCache: Map<string, NuxtComponentInfo[]>,
        private nuxtProjectRoot: string
    ) { }

    async findUtilsReferences(document: vscode.TextDocument, name: string, position: vscode.Position): Promise<vscode.Location[]> {
        try {
            const results: vscode.Location[] = [];

            const uris = await vscode.workspace.findFiles(
                '**/*.{vue,js,ts}',
                '{**/node_modules/**,**/.nuxt/**,**/.output/**,**/dist/**}'
            );

            // Première passe : utiliser le provider de références natif de VS Code
            const nativeReferences = await vscode.commands.executeCommand<vscode.Location[]>(
                'vscode.executeReferenceProvider',
                document.uri,
                new vscode.Position(position.line, position.character + name.length - 1)
            ) || [];

            // Ajouter les références natives filtrées
            for (const ref of nativeReferences) {
                if (!(ref.uri.fsPath === document.uri.fsPath && ref.range.start.line === position.line) &&
                    !ref.uri.fsPath.includes('/.nuxt/') &&
                    !ref.uri.fsPath.includes('\\.nuxt\\')) {
                    results.push(ref);
                }
            }

            // Deuxième passe : recherche dans tous les fichiers du workspace
            for (const uri of uris) {
                if (uri.fsPath === document.uri.fsPath) continue;

                let content: string;
                try {
                    content = fs.readFileSync(uri.fsPath, 'utf-8');
                } catch {
                    continue;
                }

                const importRegex = new RegExp(`import\\s+{[^}]*\\b${name}\\b[^}]*}\\s+from\\s+(['"\`][^'\`"]*['"\`])`, 'g');

                let match;

                while ((match = importRegex.exec(content)) !== null) {
                    const importPath = match[1].slice(1, -1); // Enlever les guillemets

                    if (PathUtils.isImportPointingToFile(importPath, uri.fsPath, document.uri.fsPath, this.nuxtProjectRoot)) {
                        const nameIndex = content.indexOf(name, match.index);

                        if (nameIndex !== -1) {
                            const start = TextUtils.indexToPosition(content, nameIndex);

                            const end = TextUtils.indexToPosition(content, nameIndex + name.length);

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

                const typeUsageRegex = new RegExp(`[:<]\\s*${name}(\\[\\])?\\b`, 'g');

                const usageRegex = new RegExp(`(?<!['"\`<>])\\b${name}\\b(?!\\s*:)`, 'g');

                const templateBindingRegex = new RegExp(`[:@\\w\\-]+=['"]\\s*[^'"]*\\b${name}\\b[^'"]*['"]`, 'g');

                const seen = new Set<string>();

                while ((match = typeUsageRegex.exec(content)) !== null) {
                    const matchStart = match.index + match[0].indexOf(name);
                    const start = TextUtils.indexToPosition(content, matchStart);
                    const end = TextUtils.indexToPosition(content, matchStart + name.length);

                    const locationKey = `${uri.fsPath}:${start.line}:${start.character}`;
                    if (!seen.has(locationKey)) {
                        seen.add(locationKey);
                        results.push(new vscode.Location(
                            uri,
                            new vscode.Range(
                                new vscode.Position(start.line, start.character),
                                new vscode.Position(end.line, end.character)
                            )
                        ));
                    }
                }


                while ((match = usageRegex.exec(content)) !== null) {
                    const matchStart = match.index + (match[0].length - name.length);

                    const lineStart = content.lastIndexOf('\n', matchStart) + 1;

                    const lineEnd = content.indexOf('\n', matchStart);

                    const line = content.substring(lineStart, lineEnd !== -1 ? lineEnd : content.length);

                    if (
                        line.includes('<') && line.includes('>') || // HTML
                        line.includes(`'${name}'`) || line.includes(`"${name}"`) || line.includes(`\`${name}\``)
                    ) {
                        continue;
                    }

                    const start = TextUtils.indexToPosition(content, matchStart);

                    const end = TextUtils.indexToPosition(content, matchStart + name.length);

                    const locationKey = `${uri.fsPath}:${start.line}:${start.character}`;
                    if (!seen.has(locationKey)) {
                        seen.add(locationKey);

                        results.push(new vscode.Location(
                            uri,
                            new vscode.Range(
                                new vscode.Position(start.line, start.character),
                                new vscode.Position(end.line, end.character)
                            )
                        ));
                    }
                }

                while ((match = templateBindingRegex.exec(content)) !== null) {
                    const matchStart = match.index + match[0].indexOf(name);

                    const start = TextUtils.indexToPosition(content, matchStart);

                    const end = TextUtils.indexToPosition(content, matchStart + name.length);

                    const locationKey = `${uri.fsPath}:${start.line}:${start.character}`;
                    if (!seen.has(locationKey)) {
                        seen.add(locationKey);
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

            return results;
        } catch (e) {
            console.error('Error finding utils references:', e);
            return [];
        }
    }

    async scanUtilsDirectories(): Promise<void> {
        const utilsDirNames = ['utils', 'helpers', 'lib', 'constants', 'schemas', 'validationSchemas'];

        const utilsInfos: NuxtComponentInfo[] = [];

        for (const dirName of utilsDirNames) {
            const dirs = await FileUtils.findAllDirsByName(this.nuxtProjectRoot, dirName);

            for (const dir of dirs) {
                if (!fs.existsSync(dir)) continue;

                const relativePattern = new vscode.RelativePattern(dir, '**/*.{ts,js}');

                const files = await vscode.workspace.findFiles(relativePattern);

                for (const file of files) {
                    try {
                        const content = fs.readFileSync(file.fsPath, 'utf-8');

                        // Éviter de scanner les fichiers qui contiennent des définitions de store ou de composables
                        if (content.includes('defineStore') ||
                            file.fsPath.includes(path.sep + 'composables' + path.sep) ||
                            file.fsPath.includes(path.sep + 'stores' + path.sep)) {
                            continue;
                        }

                        // Détecter les exports
                        const exportRegex = /export\s+(const|function|async function|interface|type|enum|class)\s+(\w+)/g;
                        let match: RegExpExecArray | null;

                        while ((match = exportRegex.exec(content))) {
                            const exportType = match[1];
                            const name = match[2];

                            utilsInfos.push({
                                name: name,
                                path: file.fsPath,
                                isAutoImported: false, // Les utilitaires ne sont généralement pas auto-importés par défaut
                                exportType: exportType // Stocker le type d'export pour différencier
                            });
                        }
                    } catch (e) {
                        console.error(`Error scanning utils file ${file.fsPath}:`, e);
                    }
                }
            }
        }

        this.autoImportCache.set('utils', utilsInfos);
    }
}