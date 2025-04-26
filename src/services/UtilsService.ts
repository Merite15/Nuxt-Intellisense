import * as vscode from 'vscode';
import * as fs from 'fs';
import { FileUtils } from '../utils/fileUtils';
import { PathUtils } from '../utils/pathUtils';
import { TextUtils } from '../utils/textUtils';

export class UtilsService {
    constructor(private nuxtProjectRoot: string) { }

    async findUtilsReferences(document: vscode.TextDocument, name: string, position: vscode.Position): Promise<vscode.Location[]> {
        try {
            const results: vscode.Location[] = [];

            // 1. Utiliser d'abord le provider de références natif de VS Code
            const nativeReferences = await vscode.commands.executeCommand<vscode.Location[]>(
                'vscode.executeReferenceProvider',
                document.uri,
                new vscode.Position(position.line, position.character + name.length - 1)
            ) || [];

            // Filtrer les références natives
            for (const ref of nativeReferences) {
                if (!FileUtils.shouldSkipFile(ref.uri.fsPath) &&
                    !(ref.uri.fsPath === document.uri.fsPath && ref.range.start.line === position.line)) {
                    results.push(ref);
                }
            }

            // 2. Recherche personnalisée dans tous les fichiers du workspace
            const uris = await vscode.workspace.findFiles('**/*.{vue,js,ts}');

            for (const uri of uris) {
                // Exclure les fichiers non pertinents
                if (FileUtils.shouldSkipFile(uri.fsPath) || uri.fsPath === document.uri.fsPath) {
                    continue;
                }

                let content: string;
                try {
                    content = fs.readFileSync(uri.fsPath, 'utf-8');
                } catch {
                    continue;
                }

                const seen = new Set<string>();

                // 3. Détecter les différents types d'utilisation
                await this.findTypeUsages(content, uri, name, seen, results);
                await this.findJavaScriptUsages(content, uri, name, seen, results);
                await this.findTemplateUsages(content, uri, name, seen, results);
                await this.findImportUsages(content, uri, name, document.uri.fsPath, seen, results);
            }

            return results;
        } catch (e) {
            console.error('Error finding utils references:', e);
            return [];
        }
    }

    private async findTypeUsages(
        content: string,
        uri: vscode.Uri,
        name: string,
        seen: Set<string>,
        results: vscode.Location[]
    ): Promise<void> {
        // Pour les types / génériques : <MyComponent<MyType>>
        const typeUsageRegex = new RegExp(`[:<]\\s*${name}(\\[\\])?\\b`, 'g');
        let match;

        while ((match = typeUsageRegex.exec(content))) {
            const matchStart = match.index + match[0].indexOf(name);
            this.addLocationIfNotSeen(content, uri, matchStart, name.length, seen, results);
        }
    }

    private async findJavaScriptUsages(
        content: string,
        uri: vscode.Uri,
        name: string,
        seen: Set<string>,
        results: vscode.Location[]
    ): Promise<void> {
        // Pour les usages JS classiques (évite les strings/HTML)
        const usageRegex = new RegExp(`(?<!['"\`<>])\\b${name}\\b(?!\\s*:)`, 'g');
        let match;

        while ((match = usageRegex.exec(content))) {
            const matchStart = match.index + (match[0].length - name.length);

            // Vérifier le contexte pour éviter les faux positifs
            const lineStart = content.lastIndexOf('\n', matchStart) + 1;
            const lineEnd = content.indexOf('\n', matchStart);
            const line = content.substring(
                lineStart,
                lineEnd !== -1 ? lineEnd : content.length
            );

            if (this.isValidJavaScriptUsage(line, name)) {
                this.addLocationIfNotSeen(content, uri, matchStart, name.length, seen, results);
            }
        }
    }

    private isValidJavaScriptUsage(line: string, name: string): boolean {
        // Ignorer si dans un HTML ou dans une string
        return !(
            line.includes('<') && line.includes('>') || // HTML
            line.includes(`'${name}'`) ||
            line.includes(`"${name}"`) ||
            line.includes(`\`${name}\``)
        );
    }

    private async findTemplateUsages(
        content: string,
        uri: vscode.Uri,
        name: string,
        seen: Set<string>,
        results: vscode.Location[]
    ): Promise<void> {
        // Pour les bindings dans les templates Vue
        const patterns = [
            new RegExp(`[:@]\\w+=['"]\\s*[^'"]*\\b${name}\\b[^'"]*['"]`, 'g'), // Directives
            new RegExp(`{{\\s*[^}]*\\b${name}\\b[^}]*}}`, 'g'), // Interpolations
            new RegExp(`v-[^=]+=(['"])[^'"]*\\b${name}\\b[^'"]*\\1`, 'g') // v-directives
        ];

        for (const regex of patterns) {
            let match;
            while ((match = regex.exec(content))) {
                const matchText = match[0];
                const nameIndex = matchText.indexOf(name);
                if (nameIndex !== -1) {
                    this.addLocationIfNotSeen(
                        content,
                        uri,
                        match.index + nameIndex,
                        name.length,
                        seen,
                        results
                    );
                }
            }
        }
    }

    private async findImportUsages(
        content: string,
        uri: vscode.Uri,
        name: string,
        targetFile: string,
        seen: Set<string>,
        results: vscode.Location[]
    ): Promise<void> {
        // Rechercher les imports
        const importRegex = new RegExp(
            `import\\s+{[^}]*\\b${name}\\b[^}]*}\\s+from\\s+(['"\`][^'\`"]*['"\`])`,
            'g'
        );

        let match;
        while ((match = importRegex.exec(content))) {
            const importPath = match[1].slice(1, -1); // Enlever les guillemets

            // Vérifier si l'import pointe vers notre fichier
            if (PathUtils.isImportPointingToFile(importPath, uri.fsPath, targetFile, this.nuxtProjectRoot)) {
                const nameIndex = content.indexOf(name, match.index);
                if (nameIndex !== -1) {
                    this.addLocationIfNotSeen(
                        content,
                        uri,
                        nameIndex,
                        name.length,
                        seen,
                        results
                    );
                }
            }
        }
    }

    private addLocationIfNotSeen(
        content: string,
        uri: vscode.Uri,
        startIndex: number,
        length: number,
        seen: Set<string>,
        results: vscode.Location[]
    ): void {
        const start = TextUtils.indexToPosition(content, startIndex);
        const end = TextUtils.indexToPosition(content, startIndex + length);

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