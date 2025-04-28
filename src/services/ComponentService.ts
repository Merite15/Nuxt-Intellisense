import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { PathUtils } from '../utils/pathUtils';
import { NuxtComponentInfo } from '../types';

export class ComponentService {
    constructor(
        private autoImportCache: Map<string, NuxtComponentInfo[]>,
        private nuxtProjectRoot: string
    ) {
        console.log('[ComponentService] Initializing with nuxtProjectRoot:', nuxtProjectRoot);
    }

    async provideCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
        console.log('[provideCodeLenses] Starting for document:', document.fileName);
        const lenses: vscode.CodeLens[] = [];

        const fileName = path.basename(document.fileName);
        console.log('[provideCodeLenses] Processing file:', fileName);

        if (fileName === 'app.vue' || fileName === 'error.vue') {
            console.log('[provideCodeLenses] Skipping app.vue or error.vue file');
            return [];
        }

        const allComponentDirs = await this.findAllComponentsDirs();
        console.log('[provideCodeLenses] Found component directories:', allComponentDirs);

        let nuxtComponentName = '';

        for (const dir of allComponentDirs) {
            if (document.uri.fsPath.startsWith(dir)) {
                nuxtComponentName = this.getNuxtComponentName(document.uri.fsPath, dir);
                console.log('[provideCodeLenses] Found component name:', nuxtComponentName);
                break;
            }
        }

        const text = document.getText();

        const isPagesComponents = document.fileName.includes(`${path.sep}pages${path.sep}`) &&
            document.fileName.includes(`${path.sep}components${path.sep}`);
        console.log('[provideCodeLenses] isPagesComponents:', isPagesComponents);

        if (!isPagesComponents && document.fileName.includes(`${path.sep}layouts${path.sep}`)) {
            console.log('[provideCodeLenses] Skipping layouts component');
            return [];
        }

        let hasAddedLens = false;

        // 2.1 Pour les composants avec <script setup>
        const scriptSetupRegex = /<script\s+[^>]*setup[^>]*>/g;
        console.log('[provideCodeLenses] Searching for script setup');

        let match: RegExpExecArray | null;

        while ((match = scriptSetupRegex.exec(text))) {
            console.log('[provideCodeLenses] Found script setup at index:', match.index);
            const pos = document.positionAt(match.index);
            const range = new vscode.Range(pos.line, 0, pos.line, 0);

            const references = await this.findComponentReferences(document);
            console.log('[provideCodeLenses] Found references count:', references.length);

            const referenceCount = references.length;

            lenses.push(
                new vscode.CodeLens(range, {
                    title: `🧩 ${referenceCount} reference${referenceCount > 1 ? 's' : ''} | ${nuxtComponentName}`,
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

        // 2.2 Pour les composants avec defineComponent
        if (!hasAddedLens) {
            console.log('[provideCodeLenses] Searching for defineComponent');
            const defineComponentRegex = /defineComponent\s*\(/g;

            while ((match = defineComponentRegex.exec(text))) {
                console.log('[provideCodeLenses] Found defineComponent at index:', match.index);
                const pos = document.positionAt(match.index);
                const range = new vscode.Range(pos.line, 0, pos.line, 0);

                const references = await this.findComponentReferences(document);
                console.log('[provideCodeLenses] Found references count:', references.length);

                const referenceCount = references.length;

                lenses.push(
                    new vscode.CodeLens(range, {
                        title: `🧩 ${referenceCount} reference${referenceCount > 1 ? 's' : ''} | ${nuxtComponentName}`,
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

        // 2.3 Pour les composants Nuxt spécifiques
        if (!hasAddedLens) {
            console.log('[provideCodeLenses] Searching for defineNuxtComponent');
            const defineNuxtComponentRegex = /defineNuxtComponent\s*\(/g;

            while ((match = defineNuxtComponentRegex.exec(text))) {
                console.log('[provideCodeLenses] Found defineNuxtComponent at index:', match.index);
                const pos = document.positionAt(match.index);
                const range = new vscode.Range(pos.line, 0, pos.line, 0);

                const references = await this.findComponentReferences(document);
                console.log('[provideCodeLenses] Found references count:', references.length);
                const referenceCount = references.length;

                lenses.push(
                    new vscode.CodeLens(range, {
                        title: `⚡ ${referenceCount} reference${referenceCount > 1 ? 's' : ''} | ${nuxtComponentName}`,
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
            console.log('[provideCodeLenses] Searching for template tag');
            const templateRegex = /<template[^>]*>/g;

            match = templateRegex.exec(text);

            if (match) {
                console.log('[provideCodeLenses] Found template tag at index:', match.index);
                const pos = document.positionAt(match.index);
                const range = new vscode.Range(pos.line, 0, pos.line, 0);

                const references = await this.findComponentReferences(document);
                console.log('[provideCodeLenses] Found references count:', references.length);

                const referenceCount = references.length;

                lenses.push(
                    new vscode.CodeLens(range, {
                        title: `🧩 ${referenceCount} reference${referenceCount > 1 ? 's' : ''} | ${nuxtComponentName}`,
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

        console.log('[provideCodeLenses] Returning lenses count:', lenses.length);
        return lenses;
    }

    async findComponentReferences(document: vscode.TextDocument): Promise<vscode.Location[]> {
        console.log('[findComponentReferences] Starting for document:', document.fileName);
        const allComponentDirs = await this.findAllComponentsDirs();
        console.log('[findComponentReferences] Found component directories:', allComponentDirs);

        const filePath = document.uri.fsPath;
        let nuxtComponentName = '';

        for (const dir of allComponentDirs) {
            if (filePath.startsWith(dir)) {
                nuxtComponentName = this.getNuxtComponentName(filePath, dir);
                console.log('[findComponentReferences] Found component name:', nuxtComponentName);
                break;
            }
        }

        if (!nuxtComponentName) {
            console.log('[findComponentReferences] No component name found, returning empty array');
            return [];
        }

        const kebab = PathUtils.pascalToKebabCase(nuxtComponentName);
        console.log('[findComponentReferences] Kebab case name:', kebab);

        const results: vscode.Location[] = [];
        const uniqueRefKeys = new Set<string>();

        const uris = await vscode.workspace.findFiles(
            '**/*.vue',
            '{**/node_modules/**,**/.nuxt/**,**/.output/**,**/dist/**}'
        );

        console.log('[findComponentReferences] Found files to search:', uris.length);

        // Updated regex patterns with word boundaries to prevent partial matches
        const searchPatterns = [
            // Standard component usage with word boundaries
            new RegExp(`<${nuxtComponentName}(\\s[^>]*)?\\s*(/?)>`, 'gs'),
            new RegExp(`<${kebab}(\\s[^>]*)?\\s*(/?)>`, 'gs'),

            // Self-closing components
            new RegExp(`<${nuxtComponentName}\\s+([^>]*)/>`, 'gs'),
            new RegExp(`<${kebab}\\s+([^>]*)/>`, 'gs'),

            // Dynamic components - word boundaries for the component name
            new RegExp(`<component\\s+:is="("|')?${nuxtComponentName}("|')?[^>]*>`, 'gs'),

            // Components in resolveComponent - exact match required
            new RegExp(`resolveComponent\\(['"]${nuxtComponentName}['"]\\)`, 'gs'),

            // Import statements - with word boundaries
            new RegExp(`import\\s+${nuxtComponentName}\\s+from`, 'gs'),
            // For named imports with destructuring
            new RegExp(`import\\s+\\{[^}]*\\b${nuxtComponentName}\\b[^}]*\\}\\s+from`, 'gs')
        ];

        for (const uri of uris) {
            if (path.basename(uri.fsPath) === 'app.vue' || path.basename(uri.fsPath) === 'error.vue') {
                continue;
            }

            try {
                const content = fs.readFileSync(uri.fsPath, 'utf-8');

                for (const regex of searchPatterns) {
                    let match;
                    while ((match = regex.exec(content)) !== null) {
                        const matchText = match[0];
                        const index = match.index;

                        // Additional check for imports to ensure exact name match
                        if (matchText.includes('import')) {
                            // For import statements, ensure we're matching the exact component name
                            const importRegex = new RegExp(`\\b${nuxtComponentName}\\b`, 'g');
                            if (!importRegex.test(matchText)) {
                                continue; // Skip if not an exact match
                            }
                        }

                        // Special handling for cases like QuillyEditor
                        if (matchText.includes(nuxtComponentName)) {
                            // Check if it's an isolated component name and not part of a longer name
                            const beforeChar = content.charAt(index - 1);
                            const afterChar = content.charAt(index + matchText.length);

                            // Skip if the component name is part of a longer identifier
                            const isPartOfLargerWord =
                                (beforeChar && /[a-zA-Z0-9_]/.test(beforeChar)) ||
                                (afterChar && /[a-zA-Z0-9_]/.test(afterChar));

                            if (isPartOfLargerWord) {
                                continue;
                            }
                        }

                        const before = content.slice(0, index);
                        const line = before.split('\n').length - 1;
                        const lineStartIndex = before.lastIndexOf('\n') + 1;
                        const col = index - lineStartIndex;

                        // Create a unique key for this reference
                        const refKey = `${uri.fsPath}-${line}-${col}`;

                        // Skip if we've already found this reference
                        if (uniqueRefKeys.has(refKey)) {
                            continue;
                        }

                        uniqueRefKeys.add(refKey);
                        console.log('[findComponentReferences] Found reference in file:', uri.fsPath);

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
            } catch (error) {
                console.log('[findComponentReferences] Error reading file:', uri.fsPath, error);
                continue;
            }
        }

        console.log('[findComponentReferences] Total unique references found:', results.length);
        return results;
    }

    // Fonction pour vérifier si un chemin doit être ignoré
    private shouldIgnorePath(fullPath: string): boolean {
        const baseIgnoredDirs = new Set([
            // Only include system and build directories here
            'node_modules',
            '.nuxt',
            '.output',
            'dist',
            '.git',
            '.github',
            'public',
            'config',
            'server'
        ]);

        const pathSegments = fullPath.split(path.sep);

        // Only check for exact matches to ignore directories
        for (const segment of pathSegments) {
            if (baseIgnoredDirs.has(segment)) {
                return true;
            }
        }

        // Don't exclude stores, utils etc. when they are in application layers
        // as they might contain component imports
        return false;
    }

    async findAllComponentsDirs(): Promise<string[]> {
        console.log('[findAllComponentsDirs] Starting search in:', this.nuxtProjectRoot);
        const dirs: string[] = [];

        if (!this.nuxtProjectRoot) {
            console.log('[findAllComponentsDirs] No project root specified');
            return dirs;
        }

        // Get the parent directory of the Nuxt project root to search all layers
        const projectParent = path.dirname(this.nuxtProjectRoot);
        console.log('[findAllComponentsDirs] Searching all layers in:', projectParent);

        const recurse = (dir: string) => {
            console.log('[findAllComponentsDirs] Searching directory:', dir);

            try {
                const entries = fs.readdirSync(dir, { withFileTypes: true });

                for (const entry of entries) {
                    const fullPath = path.join(dir, entry.name);

                    // Utiliser la nouvelle fonction de vérification
                    if (this.shouldIgnorePath(fullPath)) {
                        console.log('[findAllComponentsDirs] Skipping ignored path:', fullPath);
                        continue;
                    }

                    if (entry.isDirectory()) {
                        if (entry.name === 'components') {
                            console.log('[findAllComponentsDirs] Found components directory:', fullPath);
                            dirs.push(fullPath);
                        }
                        recurse(fullPath);
                    }
                }
            } catch (error) {
                console.error('[findAllComponentsDirs] Error reading directory:', dir, error);
            }
        };

        // Search in the entire project structure
        recurse(projectParent);
        console.log('[findAllComponentsDirs] Found directories:', dirs);
        return dirs;
    }

    private getNuxtComponentName(filePath: string, componentsDir: string): string {
        console.log('[getNuxtComponentName] Processing file:', filePath);
        console.log('[getNuxtComponentName] Components directory:', componentsDir);

        let relPath = path.relative(componentsDir, filePath).replace(/\.vue$/, '');
        console.log('[getNuxtComponentName] Relative path:', relPath);

        const parts = relPath.split(path.sep);

        if (parts[parts.length - 1].toLowerCase() === 'index') {
            console.log('[getNuxtComponentName] Removing index from parts');
            parts.pop();
        }

        const result = parts
            .filter(Boolean)
            .map(part =>
                part
                    .split('-')
                    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
                    .join('')
            )
            .join('');

        console.log('[getNuxtComponentName] Generated component name:', result);
        return result;
    }

    async scanComponentsDirectory(dir: string): Promise<void> {
        console.log('[scanComponentsDirectory] Starting scan of directory:', dir);

        if (!fs.existsSync(dir)) {
            console.log('[scanComponentsDirectory] Directory does not exist:', dir);
            return;
        }

        const componentInfos: NuxtComponentInfo[] = [];

        const files = await vscode.workspace.findFiles(
            '**/*.vue',
            '{**/node_modules/**,**/.nuxt/**,**/.output/**,**/dist/**,**/store/**,**/stores/**,**/utils/**,**/lib/**,**/helpers/**,**/constants/**,**/shared/**}'
        );

        console.log('[scanComponentsDirectory] Found files:', files.length);

        for (const file of files) {
            const componentName = path.basename(file.fsPath, '.vue');
            console.log('[scanComponentsDirectory] Processing component:', componentName);

            componentInfos.push({
                name: componentName,
                path: file.fsPath,
                isAutoImported: true
            });
        }

        console.log('[scanComponentsDirectory] Total components found:', componentInfos.length);
        this.autoImportCache.set('components', componentInfos);
    }
}