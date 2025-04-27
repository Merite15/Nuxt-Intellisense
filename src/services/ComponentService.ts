import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { PathUtils } from '../utils/pathUtils';
import { NuxtComponentInfo } from '../types';

export class ComponentService {
    constructor(
        private autoImportCache: Map<string, NuxtComponentInfo[]>,
        private nuxtProjectRoot: string
    ) { }

    async provideCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
        const lenses: vscode.CodeLens[] = [];

        const fileName = path.basename(document.fileName);

        if (fileName === 'app.vue' || fileName === 'error.vue') {
            return [];
        }

        const text = document.getText();

        const isPagesComponents = document.fileName.includes(`${path.sep}pages${path.sep}`) &&
            document.fileName.includes(`${path.sep}components${path.sep}`);

        if (!isPagesComponents && document.fileName.includes(`${path.sep}layouts${path.sep}`)) {
            return [];
        }

        let hasAddedLens = false;

        // 2.1 Pour les composants avec <script setup>
        const scriptSetupRegex = /<script\s+[^>]*setup[^>]*>/g;

        let match: RegExpExecArray | null;

        // D'abord chercher le script setup
        while ((match = scriptSetupRegex.exec(text))) {
            const pos = document.positionAt(match.index);

            const range = new vscode.Range(pos.line, 0, pos.line, 0);

            // Rechercher les références, y compris les auto-importations
            const references = await this.findComponentReferences(document);

            const referenceCount = references.length;

            lenses.push(
                new vscode.CodeLens(range, {
                    title: `🧩 ${referenceCount} reference${referenceCount > 1 ? 's' : ''}`,
                    command: 'editor.action.showReferences',
                    arguments: [
                        document.uri,
                        pos,
                        references
                    ]
                })
            );
            hasAddedLens = true;
        }

        // 2.2 Pour les composants avec defineComponent (seulement si pas de script setup trouvé)
        if (!hasAddedLens) {
            const defineComponentRegex = /defineComponent\s*\(/g;

            while ((match = defineComponentRegex.exec(text))) {
                const pos = document.positionAt(match.index);
                const range = new vscode.Range(pos.line, 0, pos.line, 0);

                // Rechercher les références, y compris les auto-importations
                const references = await this.findComponentReferences(document);

                const referenceCount = references.length;

                lenses.push(
                    new vscode.CodeLens(range, {
                        title: `🧩 ${referenceCount} reference${referenceCount > 1 ? 's' : ''}`,
                        command: 'editor.action.showReferences',
                        arguments: [
                            document.uri,
                            pos,
                            references
                        ]
                    })
                );
                hasAddedLens = true;
            }
        }

        // 2.3 Pour les composants Nuxt spécifiques (seulement si pas de script setup trouvé)
        if (!hasAddedLens) {
            const defineNuxtComponentRegex = /defineNuxtComponent\s*\(/g;

            while ((match = defineNuxtComponentRegex.exec(text))) {
                const pos = document.positionAt(match.index);
                const range = new vscode.Range(pos.line, 0, pos.line, 0);

                // Rechercher les références, y compris les auto-importations
                const references = await this.findComponentReferences(document);
                const referenceCount = references.length;

                lenses.push(
                    new vscode.CodeLens(range, {
                        title: `⚡ ${referenceCount} reference${referenceCount > 1 ? 's' : ''}`,
                        command: 'editor.action.showReferences',
                        arguments: [
                            document.uri,
                            pos,
                            references
                        ]
                    })
                );
                hasAddedLens = true;
            }
        }

        // 2.4 Si aucune des méthodes ci-dessus n'a trouvé de balise, chercher la balise template
        if (!hasAddedLens) {
            const templateRegex = /<template[^>]*>/g;

            match = templateRegex.exec(text);

            if (match) {
                const pos = document.positionAt(match.index);

                const range = new vscode.Range(pos.line, 0, pos.line, 0);

                const references = await this.findComponentReferences(document);

                const referenceCount = references.length;

                lenses.push(
                    new vscode.CodeLens(range, {
                        title: `🧩 ${referenceCount} reference${referenceCount > 1 ? 's' : ''}`,
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

    async findComponentReferences(document: vscode.TextDocument): Promise<vscode.Location[]> {
        const allComponentDirs = await this.findAllComponentsDirs();

        const filePath = document.uri.fsPath;

        let nuxtComponentName = '';

        for (const dir of allComponentDirs) {
            if (filePath.startsWith(dir)) {
                nuxtComponentName = this.getNuxtComponentName(filePath, dir);

                break;
            }
        }

        if (!nuxtComponentName) return [];

        // Version kebab-case du nom du composant
        const kebab = PathUtils.pascalToKebabCase(nuxtComponentName);

        const results: vscode.Location[] = [];

        // Utiliser findFiles pour trouver tous les fichiers pertinents dans le workspace
        const uris = await vscode.workspace.findFiles('**/*.{vue,js,ts}');

        for (const uri of uris) {
            if (uri.fsPath.includes('node_modules') ||
                uri.fsPath.includes('.nuxt') ||
                uri.fsPath.includes('.output') ||
                uri.fsPath.includes('dist') ||
                path.basename(uri.fsPath) === 'app.vue' ||
                path.basename(uri.fsPath) === 'error.vue') {
                continue;
            }

            let content: string;
            try {
                content = fs.readFileSync(uri.fsPath, 'utf-8');
            } catch {
                continue;
            }

            // Recherche des balises ouvrantes avec potentiellement plusieurs lignes
            const searchPatterns = [
                // Pour le format PascalCase
                new RegExp(`<${nuxtComponentName}(\\s[\\s\\S]*?)?\\s*(/?)>`, 'gs'),
                // Pour le format kebab-case
                new RegExp(`<${kebab}(\\s[\\s\\S]*?)?\\s*(/?)>`, 'gs')
            ];

            for (const regex of searchPatterns) {
                let match;
                while ((match = regex.exec(content)) !== null) {
                    const matchText = match[0];
                    const index = match.index;

                    // Calculer la position à la main
                    const before = content.slice(0, index);
                    const line = before.split('\n').length - 1;
                    const lineStartIndex = before.lastIndexOf('\n') + 1;
                    const col = index - lineStartIndex;

                    // Calculer la position de fin en tenant compte des sauts de ligne
                    const matchLines = matchText.split('\n');
                    const endLine = line + matchLines.length - 1;
                    const endCol = matchLines.length > 1
                        ? matchLines[matchLines.length - 1].length
                        : col + matchText.length;

                    results.push(new vscode.Location(
                        uri,
                        new vscode.Range(
                            new vscode.Position(line, col),
                            new vscode.Position(endLine, endCol)
                        )
                    ));
                }
            }
        }

        return results;
    }

    async findAllComponentsDirs(): Promise<string[]> {
        const dirs: string[] = [];

        if (!this.nuxtProjectRoot) return dirs;

        const recurse = (dir: string) => {
            const entries = fs.readdirSync(dir, { withFileTypes: true });

            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);

                if (entry.isDirectory()) {
                    if (entry.name === 'components') {
                        dirs.push(fullPath);
                    }
                    recurse(fullPath);
                }
            }
        };

        recurse(this.nuxtProjectRoot);

        return dirs;
    }

    private getNuxtComponentName(filePath: string, componentsDir: string): string {
        let relPath = path.relative(componentsDir, filePath).replace(/\.vue$/, '');

        const parts = relPath.split(path.sep);

        if (parts[parts.length - 1].toLowerCase() === 'index') {
            parts.pop();
        }

        return parts
            .filter(Boolean)
            .map(part =>
                part
                    .split('-')
                    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
                    .join('')
            )
            .join('');
    }

    async scanComponentsDirectory(dir: string): Promise<void> {
        if (!fs.existsSync(dir)) {
            return;
        }

        const componentInfos: NuxtComponentInfo[] = [];

        const relativePattern = new vscode.RelativePattern(dir, '**/*.vue');

        const files = await vscode.workspace.findFiles(relativePattern);

        for (const file of files) {
            const componentName = path.basename(file.fsPath, '.vue');

            componentInfos.push({
                name: componentName,
                path: file.fsPath,
                isAutoImported: true
            });
        }

        this.autoImportCache.set('components', componentInfos);
    }
}