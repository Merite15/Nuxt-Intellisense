import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ComponentService } from '../services/ComponentService';
import { ComposableService } from '../services/ComposableService';
import { PluginService } from '../services/PluginService';
import { MiddlewareService } from '../services/MiddlewareService';
import { LayoutService } from '../services/LayoutService';
import { StoreService } from '../services/StoreService';
import { UtilsService } from '../services/UtilsService';
import { FileUtils } from '../utils/fileUtils';
import { NuxtComponentInfo } from '../types';

export class NuxtIntellisense implements vscode.CodeLensProvider {
    private nuxtProjectRoot: string | null = null;
    private autoImportCache: Map<string, NuxtComponentInfo[]> = new Map();
    private lastCacheUpdate: number = 0;
    private cacheUpdateInterval: number = 30000;

    // Services
    private componentService?: ComponentService;
    private composableService?: ComposableService;
    private pluginService?: PluginService;
    private middlewareService?: MiddlewareService;
    private layoutService?: LayoutService;
    private storeService?: StoreService;
    private utilsService?: UtilsService;

    private initializeServices() {
        if (this.nuxtProjectRoot) {
            this.componentService = new ComponentService(this.nuxtProjectRoot);
            this.composableService = new ComposableService(this.nuxtProjectRoot);
            this.pluginService = new PluginService(this.nuxtProjectRoot);
            this.middlewareService = new MiddlewareService(this.nuxtProjectRoot);
            this.layoutService = new LayoutService(this.nuxtProjectRoot);
            this.storeService = new StoreService(this.nuxtProjectRoot);
            this.utilsService = new UtilsService(this.nuxtProjectRoot);
        }
    }

    async provideCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
        const lenses: vscode.CodeLens[] = [];

        // Trouver la racine du projet Nuxt si pas encore fait
        if (!this.nuxtProjectRoot) {
            this.nuxtProjectRoot = await this.findNuxtProjectRoot(document.uri);
            this.initializeServices();
        }

        if (!this.nuxtProjectRoot) {
            return [];
        }

        await this.updateAutoImportCacheIfNeeded();

        const fileInfo = this.getFileInfo(document);

        // Déléguer aux services appropriés
        try {
            if (fileInfo.isComponent && this.componentService) {
                const componentLenses = await this.componentService.provideCodeLenses(document);
                lenses.push(...componentLenses);
            }

            if (fileInfo.isComposable && this.composableService) {
                const composableLenses = await this.composableService.provideCodeLenses(document);
                lenses.push(...composableLenses);
            }

            if (fileInfo.isPlugin && this.pluginService) {
                const pluginLenses = await this.pluginService.provideCodeLenses(document);
                lenses.push(...pluginLenses);
            }

            if (fileInfo.isMiddleware && this.middlewareService) {
                const middlewareLenses = await this.middlewareService.provideCodeLenses(document);
                lenses.push(...middlewareLenses);
            }

            if (fileInfo.isLayout && this.layoutService) {
                const layoutLenses = await this.layoutService.provideCodeLenses(document);
                lenses.push(...layoutLenses);
            }

            if (fileInfo.isStore && this.storeService) {
                const storeLenses = await this.storeService.provideCodeLenses(document);
                lenses.push(...storeLenses);
            }

            if (fileInfo.isUtil && this.utilsService) {
                const text = document.getText();
                const utilsRegex = /export\s+(const|function|async function|interface|type|enum|class)\s+(\w+)/g;
                let match: RegExpExecArray | null;

                while ((match = utilsRegex.exec(text))) {
                    const exportType = match[1];
                    const name = match[2];
                    const pos = document.positionAt(match.index);
                    const range = new vscode.Range(pos.line, 0, pos.line, 0);

                    // Type d'emoji et libellé selon le type d'export
                    let emoji = '🔧'; // Par défaut pour les utilitaires
                    let typeLabel = 'utilitaire';

                    if (exportType === 'interface' || exportType === 'type') {
                        emoji = '📝';
                        typeLabel = exportType === 'interface' ? 'interface' : 'type';
                    } else if (exportType === 'const') {
                        emoji = '📊';
                        typeLabel = 'constante';
                    } else if (exportType === 'class') {
                        emoji = '🏛️';
                        typeLabel = 'classe';
                    }

                    // Rechercher les références
                    const references = await this.utilsService.findUtilsReferences(document, name, pos);
                    const referenceCount = references.length;

                    lenses.push(
                        new vscode.CodeLens(range, {
                            title: `${emoji} ${referenceCount} reference${referenceCount > 1 ? 's' : ''}`,
                            command: 'editor.action.showReferences',
                            arguments: [
                                document.uri,
                                new vscode.Position(pos.line, match[0].indexOf(name)),
                                references
                            ]
                        })
                    );
                }
            }
        } catch (error) {
            console.error('Error providing code lenses:', error);
        }

        return lenses;
    }

    private getFileInfo(document: vscode.TextDocument) {
        const fileDir = path.dirname(document.fileName);
        const fileExtension = path.extname(document.fileName);

        return {
            isVueFile: fileExtension === '.vue',
            isComponent: fileDir.includes('components'),
            isComposable: fileDir.includes('composables'),
            isPlugin: fileDir.includes('plugins'),
            isMiddleware: fileDir.includes('middleware'),
            isLayout: fileDir.includes('layouts'),
            isStore: fileDir.includes('stores') || fileDir.includes('store'),
            isUtil: fileDir.includes('utils') ||
                fileDir.includes('lib') ||
                fileDir.includes('services') ||
                fileDir.includes('types') ||
                fileDir.includes('helpers') ||
                fileDir.includes('constants') ||
                fileDir.includes('schemas') ||
                fileDir.includes('validationSchemas')
        };
    }

    private async findNuxtProjectRoot(uri: vscode.Uri): Promise<string | null> {
        let currentDir = path.dirname(uri.fsPath);
        const root = path.parse(currentDir).root;

        while (currentDir !== root) {
            const nuxtConfigPath = path.join(currentDir, 'nuxt.config.ts');
            const nuxtConfigJsPath = path.join(currentDir, 'nuxt.config.js');

            try {
                if (fs.existsSync(nuxtConfigPath) || fs.existsSync(nuxtConfigJsPath)) {
                    return currentDir;
                }
            } catch (e) {
                // Ignorer les erreurs
            }

            currentDir = path.dirname(currentDir);
        }

        return null;
    }

    private async updateAutoImportCacheIfNeeded(): Promise<void> {
        const now = Date.now();
        if (now - this.lastCacheUpdate < this.cacheUpdateInterval) {
            return;
        }

        this.lastCacheUpdate = now;
        await this.updateAutoImportCache();
    }

    private async updateAutoImportCache(): Promise<void> {
        if (!this.nuxtProjectRoot) {
            return;
        }

        // Réinitialiser le cache
        this.autoImportCache.clear();

        try {
            // Mettre à jour le cache pour chaque type
            if (this.componentService) {
                const componentDirs = await FileUtils.findAllDirsByName(this.nuxtProjectRoot, 'components');
                for (const dir of componentDirs) {
                    const components = await this.componentService.scanComponentsDirectory(dir);
                    if (components) {
                        this.autoImportCache.set('components', components);
                    }
                }
            }

            if (this.utilsService) {
                // Scanner tous les répertoires d'utilitaires
                const utilsDirNames = ['utils', 'helpers', 'lib', 'constants', 'services', 'types', 'schemas', 'validationSchemas'];

                for (const dirName of utilsDirNames) {
                    const dirs = await FileUtils.findAllDirsByName(this.nuxtProjectRoot, dirName);
                    for (const dir of dirs) {
                        const utilsFiles = await vscode.workspace.findFiles(
                            new vscode.RelativePattern(dir, '**/*.{ts,js}')
                        );

                        const utilsInfos: NuxtComponentInfo[] = [];
                        for (const file of utilsFiles) {
                            try {
                                const content = fs.readFileSync(file.fsPath, 'utf-8');
                                const exportRegex = /export\s+(const|function|async function|interface|type|enum|class)\s+(\w+)/g;
                                let match;

                                while ((match = exportRegex.exec(content))) {
                                    utilsInfos.push({
                                        name: match[2],
                                        path: file.fsPath,
                                        isAutoImported: false,
                                        exportType: match[1]
                                    });
                                }
                            } catch (error) {
                                console.error(`Error scanning utils file ${file.fsPath}:`, error);
                            }
                        }

                        this.autoImportCache.set(`utils_${dirName}`, utilsInfos);
                    }
                }
            }

            // Vous pouvez ajouter d'autres mises à jour de cache ici...

        } catch (error) {
            console.error('Error updating auto-import cache:', error);
        }
    }
}