import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { getFilesRecursively } from '../utils/fileUtils';
import { pascalToKebabCase, kebabToPascalCase } from '../utils/stringUtils';

export class ReferenceService {
    constructor(private nuxtProjectRoot: string | null) { }

    /**
     * Trouver toutes les références pour un composable, y compris les auto-importations
     */
    async findAllReferences(document: vscode.TextDocument, name: string, position: vscode.Position): Promise<vscode.Location[]> {
        try {
            // Recherche standard des références via VS Code
            const references = await vscode.commands.executeCommand<vscode.Location[]>(
                'vscode.executeReferenceProvider',
                document.uri,
                new vscode.Position(position.line, position.character + name.length - 1)
            ) || [];

            // Filtrer les fichiers générés par Nuxt
            const filteredReferences = references.filter(ref => !ref.uri.fsPath.includes('.nuxt'));

            // Si nous avons un projet Nuxt, rechercher les auto-importations
            if (this.nuxtProjectRoot) {
                // Rechercher les occurrences du composable dans tous les fichiers
                const allFiles = await getFilesRecursively(this.nuxtProjectRoot, ['.vue', '.ts', '.js']);

                for (const file of allFiles) {
                    // Éviter de chercher dans le fichier courant
                    if (file === document.uri.fsPath) continue;

                    try {
                        const content = fs.readFileSync(file, 'utf-8');

                        // Chercher les utilisations du composable
                        // Ajouter une expression régulière plus précise pour trouver les utilisations
                        const usage = new RegExp(`\\b${name}\\s*\\(`, 'g');

                        if (usage.test(content)) {
                            const uri = vscode.Uri.file(file);
                            const pos = new vscode.Position(0, 0);
                            filteredReferences.push(new vscode.Location(uri, pos));
                        }
                    } catch (e) {
                        // Ignorer les erreurs
                    }
                }
            }

            return filteredReferences;
        } catch (e) {
            return [];
        }
    }

    /**
     * Trouver toutes les références pour un composant
     */
    async findComponentReferences(document: vscode.TextDocument, componentName: string): Promise<vscode.Location[]> {
        try {
            // Recherche standard des références via VS Code
            const pos = new vscode.Position(0, 0);
            const references = await vscode.commands.executeCommand<vscode.Location[]>(
                'vscode.executeReferenceProvider',
                document.uri,
                pos
            ) || [];

            // Filtrer les fichiers générés par Nuxt, app.vue et error.vue
            const filteredReferences = references.filter(ref => {
                const fileName = path.basename(ref.uri.fsPath);
                return !ref.uri.fsPath.includes('.nuxt') &&
                    fileName !== 'app.vue' &&
                    fileName !== 'error.vue';
            });

            // Si nous avons un projet Nuxt, rechercher les auto-importations
            if (this.nuxtProjectRoot) {
                // Chercher les utilisations comme balises HTML (ex: <MyComponent />)
                const tagReferences = await this.findTagReferences(componentName);
                // Filtrer pour supprimer app.vue et error.vue
                const filteredTagReferences = tagReferences.filter(ref => {
                    const fileName = path.basename(ref.uri.fsPath);
                    return fileName !== 'app.vue' && fileName !== 'error.vue';
                });
                filteredReferences.push(...filteredTagReferences);

                // Chercher les auto-importations
                const autoImportRefs = await this.findAutoImportReferences(componentName, 'component');
                // Filtrer pour supprimer app.vue et error.vue
                const filteredAutoImportRefs = autoImportRefs.filter(ref => {
                    const fileName = path.basename(ref.uri.fsPath);
                    return fileName !== 'app.vue' && fileName !== 'error.vue';
                });
                filteredReferences.push(...filteredAutoImportRefs);
            }

            return filteredReferences;
        } catch (e) {
            return [];
        }
    }

    /**
     * Trouver les références pour un plugin
     */
    async findPluginReferences(pluginName: string): Promise<vscode.Location[]> {
        // Pour les plugins, vérifier principalement le nuxt.config.ts
        if (!this.nuxtProjectRoot) {
            return [];
        }

        const nuxtConfigPath = path.join(this.nuxtProjectRoot, 'nuxt.config.ts');
        const nuxtConfigJsPath = path.join(this.nuxtProjectRoot, 'nuxt.config.js');

        const configPath = fs.existsSync(nuxtConfigPath) ? nuxtConfigPath :
            (fs.existsSync(nuxtConfigJsPath) ? nuxtConfigJsPath : null);

        if (!configPath) {
            return [];
        }

        try {
            const content = fs.readFileSync(configPath, 'utf-8');
            const pluginRegex = new RegExp(`plugins\\s*:\\s*\\[([^\\]]*${pluginName}[^\\]]*)\\]`, 'g');

            if (pluginRegex.test(content)) {
                const uri = vscode.Uri.file(configPath);
                const pos = new vscode.Position(0, 0);
                return [new vscode.Location(uri, pos)];
            }
        } catch (e) {
            // Ignorer les erreurs
        }

        return [];
    }

    /**
     * Trouver les références pour un middleware
     */
    async findMiddlewareReferences(middlewareName: string): Promise<vscode.Location[]> {
        if (!this.nuxtProjectRoot) {
            return [];
        }

        const references: vscode.Location[] = [];

        // Rechercher dans les fichiers de pages
        const pagesDir = path.join(this.nuxtProjectRoot, 'pages');
        if (fs.existsSync(pagesDir)) {
            const pageFiles = await getFilesRecursively(pagesDir, ['.vue']);

            for (const pageFile of pageFiles) {
                try {
                    const content = fs.readFileSync(pageFile, 'utf-8');

                    // Vérifier les utilisations definePageMeta({ middleware: ['middlewareName'] })
                    const middlewareRegex = new RegExp(`definePageMeta\\s*\\(\\s*\\{[^}]*middleware\\s*:\\s*\\[?[^\\]]*['"]${middlewareName}['"][^\\]]*\\]?`, 'g');

                    if (middlewareRegex.test(content)) {
                        const uri = vscode.Uri.file(pageFile);
                        const pos = new vscode.Position(0, 0);
                        references.push(new vscode.Location(uri, pos));
                    }
                } catch (e) {
                    // Ignorer les erreurs
                }
            }
        }

        return references;
    }

    /**
     * Trouver les références pour un layout
     */
    async findLayoutReferences(layoutName: string): Promise<vscode.Location[]> {
        if (!this.nuxtProjectRoot) {
            return [];
        }

        const references: vscode.Location[] = [];

        // Rechercher dans les fichiers de pages
        const pagesDir = path.join(this.nuxtProjectRoot, 'pages');
        if (fs.existsSync(pagesDir)) {
            const pageFiles = await getFilesRecursively(pagesDir, ['.vue']);

            for (const pageFile of pageFiles) {
                try {
                    const content = fs.readFileSync(pageFile, 'utf-8');

                    // Vérifier les utilisations definePageMeta({ layout: 'layoutName' })
                    const layoutRegex = new RegExp(`definePageMeta\\s*\\(\\s*\\{[^}]*layout\\s*:\\s*['"]${layoutName}['"]`, 'g');

                    if (layoutRegex.test(content)) {
                        const uri = vscode.Uri.file(pageFile);
                        const pos = new vscode.Position(0, 0);
                        references.push(new vscode.Location(uri, pos));
                    }
                } catch (e) {
                    // Ignorer les erreurs
                }
            }
        }

        // Vérifier le app.vue pour le layout par défaut
        const appVuePath = path.join(this.nuxtProjectRoot, 'app.vue');
        if (fs.existsSync(appVuePath) && layoutName === 'default') {
            const uri = vscode.Uri.file(appVuePath);
            const pos = new vscode.Position(0, 0);
            references.push(new vscode.Location(uri, pos));
        }

        return references;
    }

    /**
     * Trouver les références pour un store
     */
    async findStoreReferences(storeName: string): Promise<vscode.Location[]> {
        try {
            const references: vscode.Location[] = [];

            // Nous recherchons le motif "useXxxStore" où Xxx est le storeName avec une première lettre majuscule
            const storeHookName = `use${storeName.charAt(0).toUpperCase() + storeName.slice(1)}Store`;

            // Chercher dans tous les fichiers du projet
            if (this.nuxtProjectRoot) {
                const allFiles = await getFilesRecursively(this.nuxtProjectRoot, ['.vue', '.ts', '.js']);

                for (const file of allFiles) {
                    try {
                        const content = fs.readFileSync(file, 'utf-8');

                        // Chercher des utilisations du store
                        if (content.includes(storeHookName)) {
                            const uri = vscode.Uri.file(file);
                            const pos = new vscode.Position(0, 0);
                            references.push(new vscode.Location(uri, pos));
                        }
                    } catch (e) {
                        // Ignorer les erreurs
                    }
                }
            }

            return references;
        } catch (e) {
            return [];
        }
    }

    /**
     * Trouver les références aux composants utilisés comme balises HTML
     */
    async findTagReferences(componentName: string): Promise<vscode.Location[]> {
        try {
            const references: vscode.Location[] = [];

            // Construire différentes variantes de noms de balises (kebab-case, PascalCase)
            const kebabCaseName = pascalToKebabCase(componentName);
            const pascalCaseName = kebabToPascalCase(componentName);

            const searchPatterns = [
                `<${kebabCaseName}\\s`,
                `<${kebabCaseName}>`,
                `<${pascalCaseName}\\s`,
                `<${pascalCaseName}>`
            ];

            for (const pattern of searchPatterns) {
                // Utiliser la recherche globale de VS Code
                const searchResults = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
                    'vscode.executeWorkspaceSymbolProvider',
                    pattern
                );

                for (const file of searchResults.values()) {
                    references.push(file.location);
                }
            }

            return references;
        } catch (e) {
            return [];
        }
    }

    /**
     * Trouver les références aux auto-importations
     */
    async findAutoImportReferences(name: string, type: 'component' | 'composable'): Promise<vscode.Location[]> {
        try {
            const references: vscode.Location[] = [];

            if (type === 'component') {
                // Pour les composants, chercher les balises HTML
                const kebabCaseName = pascalToKebabCase(name);
                const pascalCaseName = kebabToPascalCase(name);
                const searchPatterns = [
                    `<${kebabCaseName}\\s`,
                    `<${kebabCaseName}>`,
                    `<${pascalCaseName}\\s`,
                    `<${pascalCaseName}>`
                ];

                for (const pattern of searchPatterns) {
                    const searchResults = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
                        'vscode.executeWorkspaceSymbolProvider',
                        pattern
                    );
                    for (const file of searchResults.values()) {
                        references.push(file.location);
                    }
                }
            } else if (type === 'composable') {
                // Pour les composables, rechercher uniquement les exports de fonctions
                const searchResults = await vscode.commands.executeCommand<vscode.Location[]>(
                    'vscode.executeWorkspaceSymbolProvider',
                    name
                ) || [];

                // Filtrer pour ne conserver que les fichiers contenant des exports de fonctions
                const filteredResults = searchResults.filter(ref => {
                    try {
                        const content = fs.readFileSync(ref.uri.fsPath, 'utf-8');
                        return content.includes(`export function ${name}`) || content.includes(`export const ${name}`);
                    } catch (e) {
                        return false;
                    }
                });

                for (const file of filteredResults) {
                    references.push(file);
                }
            }

            return references;
        } catch (e) {
            return [];
        }
    }
}