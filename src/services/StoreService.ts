import * as vscode from 'vscode';
import * as fs from 'fs';
import { FileUtils } from '../utils/fileUtils';
import { TextUtils } from '../utils/textUtils';
import type { NuxtComponentInfo } from '../types';

export class StoreService {
    constructor(private autoImportCache: Map<string, NuxtComponentInfo[]>) { }

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

            const uniqueReferences = TextUtils.removeDuplicateReferences(preciseReferences);

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

    async findStoreReferences(storeName: string): Promise<vscode.Location[]> {
        try {
            // Rechercher à la fois par le nom du hook et le nom du store dans defineStore
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
                // Gérer aussi le cas où storeName est au singulier mais défini au pluriel
                `${storeName}s`,
                `${storeName.replace(/-/g, ' ')}s`,
                `${storeName.replace(/-/g, '_')}s`
            ];

            const uris = await vscode.workspace.findFiles(
                '**/*.{vue,js,ts}',
                '{**/node_modules/**,**/.nuxt/**,**/.output/**,**/dist/**}'
            );

            const results: vscode.Location[] = [];
            const storeDefinitions: Map<string, string> = new Map(); // Pour stocker les id -> hookName
            const storeDefinitionFiles: Set<string> = new Set(); // Pour stocker les chemins des fichiers de définition de store

            // Première passe: trouver toutes les définitions de store
            for (const uri of uris) {
                if (FileUtils.shouldSkipFile(uri.fsPath)) continue;

                let content: string;
                try {
                    content = fs.readFileSync(uri.fsPath, 'utf-8');
                } catch {
                    continue;
                }

                // Chercher les définitions de store
                const defineStoreRegex = /defineStore\s*\(\s*['"]([^'"]+)['"]/g;
                let defineMatch;

                while ((defineMatch = defineStoreRegex.exec(content)) !== null) {
                    const storeId = defineMatch[1];

                    // Vérifier si ce fichier définit un des stores que nous recherchons
                    if (possibleStoreIds.includes(storeId)) {
                        storeDefinitionFiles.add(uri.fsPath);
                    }

                    // Trouver le nom du hook associé à cette définition
                    const hookNameRegex = /const\s+(\w+)\s*=\s*defineStore\s*\(\s*['"]([^'"]+)['"]/g;
                    hookNameRegex.lastIndex = 0; // Réinitialiser l'index

                    let hookMatch;
                    while ((hookMatch = hookNameRegex.exec(content)) !== null) {
                        if (hookMatch[2] === storeId) {
                            storeDefinitions.set(storeId, hookMatch[1]);
                            break;
                        }
                    }
                }
            }

            // Deuxième passe: chercher les références, mais exclure les fichiers de définition
            for (const uri of uris) {
                if (FileUtils.shouldSkipFile(uri.fsPath)) continue;

                // Exclure les fichiers de définition du store
                if (storeDefinitionFiles.has(uri.fsPath)) continue;

                let content: string;
                try {
                    content = fs.readFileSync(uri.fsPath, 'utf-8');
                } catch {
                    continue;
                }

                // Chercher les usages du hook par nom conventionnel
                const hookRegex = new RegExp(`\\b${storeHookName}\\b`, 'g');
                TextUtils.findMatches(hookRegex, content, uri, results);

                // Chercher aussi les usages par ID de store (pour la forme `const store = useStore('store-id')`)
                for (const storeId of possibleStoreIds) {
                    const storeIdRegex = new RegExp(`useStore\\s*\\(\\s*['"]${storeId}['"]\\s*\\)`, 'g');
                    TextUtils.findMatches(storeIdRegex, content, uri, results);

                    // Chercher les usages des hooks associés aux IDs trouvés dans la première passe
                    if (storeDefinitions.has(storeId)) {
                        const hookName = storeDefinitions.get(storeId);
                        const customHookRegex = new RegExp(`\\b${hookName}\\b`, 'g');
                        TextUtils.findMatches(customHookRegex, content, uri, results);
                    }
                }
            }

            return results;
        } catch (e) {
            console.error('Error:', e);
            return [];
        }
    }

    async scanStoresDirectory(dir: string): Promise<void> {
        if (!fs.existsSync(dir)) return;

        const storeInfos: NuxtComponentInfo[] = [];

        const files = await vscode.workspace.findFiles(
            '**/*.{ts,js}',
            '{**/node_modules/**,**/.nuxt/**,**/.output/**,**/dist/**}'
        );

        for (const file of files) {
            try {
                const content = fs.readFileSync(file.fsPath, 'utf-8');

                const defineStoreRegex = /defineStore\s*\(\s*(['"`])(.*?)\1/g;

                let match: RegExpExecArray | null;

                while ((match = defineStoreRegex.exec(content))) {
                    storeInfos.push({
                        name: match[2],
                        path: file.fsPath,
                        isAutoImported: true
                    });
                }
            } catch (e) {
                console.error(`Error reading store file ${file.fsPath}:`, e);
            }
        }

        this.autoImportCache.set('stores', storeInfos);
    }
}