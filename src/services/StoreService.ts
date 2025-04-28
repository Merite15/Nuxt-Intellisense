import * as vscode from 'vscode';
import * as fs from 'fs';
import { FileUtils } from '../utils/fileUtils';
import { TextUtils } from '../utils/textUtils';
import type { NuxtComponentInfo } from '../types';

export class StoreService {
    constructor(private autoImportCache: Map<string, NuxtComponentInfo[]>) {
        console.log('[StoreService] Initialized with autoImportCache size:', autoImportCache.size);
    }

    async provideCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
        console.log('[provideCodeLenses] Starting analysis for document:', document.uri.toString());
        const lenses: vscode.CodeLens[] = [];
        const text = document.getText();

        const defineStoreRegex = /defineStore\s*\(\s*(['\"`])(.*?)\1/g;
        let match: RegExpExecArray | null;

        while ((match = defineStoreRegex.exec(text))) {
            const storeName = match[2];
            console.log('[provideCodeLenses] Found store definition:', storeName);
            const pos = document.positionAt(match.index);
            const range = new vscode.Range(pos.line, 0, pos.line, 0);

            console.log('[provideCodeLenses] Searching references for store:', storeName);
            const preciseReferences = await this.findStoreReferences(storeName);
            const uniqueReferences = TextUtils.removeDuplicateReferences(preciseReferences);
            const referenceCount = uniqueReferences.length;

            console.log('[provideCodeLenses] Found', referenceCount, 'unique references for store:', storeName);

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

        console.log('[provideCodeLenses] Returning', lenses.length, 'lenses');
        return lenses;
    }

    async findStoreReferences(storeName: string): Promise<vscode.Location[]> {
        console.log('[findStoreReferences] Starting search for store:', storeName);
        try {
            const normalizedName = storeName
                .split(/[-_\s]/)
                .map(s => s.charAt(0).toUpperCase() + s.slice(1))
                .join('');

            const storeHookName = `use${normalizedName}Store`;
            console.log('[findStoreReferences] Normalized hook name:', storeHookName);

            const possibleStoreIds = [
                storeName,
                storeName.replace(/-/g, ' '),
                storeName.replace(/-/g, '_'),
                `${storeName}s`,
                `${storeName.replace(/-/g, ' ')}s`,
                `${storeName.replace(/-/g, '_')}s`
            ];
            console.log('[findStoreReferences] Generated possible store IDs:', possibleStoreIds);

            const uris = await vscode.workspace.findFiles(
                '**/*.{vue,js,ts}',
                '{**/node_modules/**,**/.nuxt/**,**/.output/**,**/dist/**}'
            );
            console.log('[findStoreReferences] Found', uris.length, 'files to analyze');

            const results: vscode.Location[] = [];
            const storeDefinitions: Map<string, string> = new Map();
            const storeDefinitionFiles: Set<string> = new Set();

            console.log('[findStoreReferences] Starting first pass: finding store definitions');
            for (const uri of uris) {
                if (FileUtils.shouldSkipFile(uri.fsPath)) {
                    console.log('[findStoreReferences] Skipping file:', uri.fsPath);
                    continue;
                }

                let content: string;
                try {
                    content = fs.readFileSync(uri.fsPath, 'utf-8');
                } catch (e) {
                    console.error('[findStoreReferences] Error reading file:', uri.fsPath, e);
                    continue;
                }

                const defineStoreRegex = /defineStore\s*\(\s*['"]([^'"]+)['"]/g;
                let defineMatch;

                while ((defineMatch = defineStoreRegex.exec(content)) !== null) {
                    const storeId = defineMatch[1];
                    console.log('[findStoreReferences] Found store definition with ID:', storeId);

                    if (possibleStoreIds.includes(storeId)) {
                        console.log('[findStoreReferences] Matched store definition file:', uri.fsPath);
                        storeDefinitionFiles.add(uri.fsPath);
                    }

                    const hookNameRegex = /const\s+(\w+)\s*=\s*defineStore\s*\(\s*['"]([^'"]+)['"]/g;
                    hookNameRegex.lastIndex = 0;

                    let hookMatch;
                    while ((hookMatch = hookNameRegex.exec(content)) !== null) {
                        if (hookMatch[2] === storeId) {
                            console.log('[findStoreReferences] Found hook name for store:', storeId, '->', hookMatch[1]);
                            storeDefinitions.set(storeId, hookMatch[1]);
                            break;
                        }
                    }
                }
            }

            console.log('[findStoreReferences] Starting second pass: finding references');
            console.log('[findStoreReferences] Store definition files:', Array.from(storeDefinitionFiles));
            console.log('[findStoreReferences] Store definitions:', Object.fromEntries(storeDefinitions));

            for (const uri of uris) {
                if (FileUtils.shouldSkipFile(uri.fsPath)) {
                    continue;
                }

                if (storeDefinitionFiles.has(uri.fsPath)) {
                    console.log('[findStoreReferences] Skipping store definition file:', uri.fsPath);
                    continue;
                }

                let content: string;
                try {
                    content = fs.readFileSync(uri.fsPath, 'utf-8');
                } catch (e) {
                    console.error('[findStoreReferences] Error reading file:', uri.fsPath, e);
                    continue;
                }

                console.log('[findStoreReferences] Analyzing file for references:', uri.fsPath);

                const hookRegex = new RegExp(`\\b${storeHookName}\\b`, 'g');
                const initialResultsCount = results.length;
                TextUtils.findMatches(hookRegex, content, uri, results);
                if (results.length > initialResultsCount) {
                    console.log('[findStoreReferences] Found conventional hook usage in:', uri.fsPath);
                }

                for (const storeId of possibleStoreIds) {
                    const storeIdRegex = new RegExp(`useStore\\s*\\(\\s*['"]${storeId}['"]\\s*\\)`, 'g');
                    const beforeStoreId = results.length;
                    TextUtils.findMatches(storeIdRegex, content, uri, results);
                    if (results.length > beforeStoreId) {
                        console.log('[findStoreReferences] Found store ID usage in:', uri.fsPath);
                    }

                    if (storeDefinitions.has(storeId)) {
                        const hookName = storeDefinitions.get(storeId);
                        const customHookRegex = new RegExp(`\\b${hookName}\\b`, 'g');
                        const beforeCustomHook = results.length;
                        TextUtils.findMatches(customHookRegex, content, uri, results);
                        if (results.length > beforeCustomHook) {
                            console.log('[findStoreReferences] Found custom hook usage in:', uri.fsPath);
                        }
                    }
                }
            }

            console.log('[findStoreReferences] Search complete. Found', results.length, 'total references');
            return results;
        } catch (e) {
            console.error('[findStoreReferences] Error during reference search:', e);
            return [];
        }
    }

    async scanStoresDirectory(dir: string): Promise<void> {
        console.log('[scanStoresDirectory] Starting scan of directory:', dir);

        if (!fs.existsSync(dir)) {
            console.log('[scanStoresDirectory] Directory does not exist:', dir);
            return;
        }

        const storeInfos: NuxtComponentInfo[] = [];

        console.log('[scanStoresDirectory] Searching for store files');
        const files = await vscode.workspace.findFiles(
            '**/*.{ts,js}',
            '{**/node_modules/**,**/.nuxt/**,**/.output/**,**/dist/**}'
        );
        console.log('[scanStoresDirectory] Found', files.length, 'potential files');

        for (const file of files) {
            try {
                console.log('[scanStoresDirectory] Analyzing file:', file.fsPath);
                const content = fs.readFileSync(file.fsPath, 'utf-8');

                const defineStoreRegex = /defineStore\s*\(\s*(['\"`])(.*?)\1/g;
                let match: RegExpExecArray | null;

                while ((match = defineStoreRegex.exec(content))) {
                    console.log('[scanStoresDirectory] Found store:', match[2], 'in file:', file.fsPath);
                    storeInfos.push({
                        name: match[2],
                        path: file.fsPath,
                        isAutoImported: true
                    });
                }
            } catch (e) {
                console.error('[scanStoresDirectory] Error reading store file:', file.fsPath, e);
            }
        }

        console.log('[scanStoresDirectory] Updating autoImportCache with', storeInfos.length, 'stores');
        this.autoImportCache.set('stores', storeInfos);
    }
}