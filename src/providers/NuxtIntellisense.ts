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

    private componentService?: ComponentService;

    private composableService?: ComposableService;

    private pluginService?: PluginService;

    private middlewareService?: MiddlewareService;

    private layoutService?: LayoutService;

    private storeService?: StoreService;

    private utilsService?: UtilsService;

    private initializeServices() {
        if (this.nuxtProjectRoot) {
            this.componentService = new ComponentService(this.autoImportCache, this.nuxtProjectRoot);
            this.composableService = new ComposableService(this.autoImportCache);
            this.pluginService = new PluginService();
            this.middlewareService = new MiddlewareService();
            this.layoutService = new LayoutService();
            this.storeService = new StoreService(this.autoImportCache);
            this.utilsService = new UtilsService(this.autoImportCache, this.nuxtProjectRoot);
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

        const fileInfo = this.getFileInfo(document);

        await this.updateAutoImportCacheIfNeeded(fileInfo);

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
        let bestCandidate: string | null = null;

        while (currentDir !== root) {
            const nuxtConfigTsPath = path.join(currentDir, 'nuxt.config.ts');
            const nuxtConfigJsPath = path.join(currentDir, 'nuxt.config.js');

            const hasNuxtConfig = fs.existsSync(nuxtConfigTsPath) || fs.existsSync(nuxtConfigJsPath);
            const hasPackageJson = fs.existsSync(path.join(currentDir, 'package.json'));
            const hasGit = fs.existsSync(path.join(currentDir, '.git'));
            const hasPnpmWorkspace = fs.existsSync(path.join(currentDir, 'pnpm-workspace.yaml'));

            if (hasNuxtConfig) {
                // On marque ce dossier comme un candidat potentiel
                if (hasPackageJson || hasGit || hasPnpmWorkspace) {
                    return currentDir; // Racine trouvée avec certitude
                }

                // Sinon on garde en mémoire comme fallback
                bestCandidate = currentDir;
            }

            currentDir = path.dirname(currentDir);
        }

        // Si aucun dossier avec git/package.json mais un layer avec nuxt.config trouvé
        return bestCandidate;
    }


    private async updateAutoImportCacheIfNeeded(fileInfo: any): Promise<void> {
        const now = Date.now();

        if (now - this.lastCacheUpdate < this.cacheUpdateInterval) {
            return;
        }

        if (fileInfo.isComponent && this.componentService) {
            const componentDirs = await FileUtils.findAllDirsByName(this.nuxtProjectRoot!, 'components');

            for (const dir of componentDirs) {
                await this.componentService.scanComponentsDirectory(dir);
            }
        }

        if (fileInfo.isComposable && this.composableService) {
            const composablesDirs = await FileUtils.findAllDirsByName(this.nuxtProjectRoot!, 'composables');

            for (const dir of composablesDirs) {
                await this.composableService.scanComposablesDirectory(dir);
            }
        }

        if (fileInfo.isStore && this.storeService) {
            const storeDirs = await FileUtils.findAllDirsByName(this.nuxtProjectRoot!, 'stores');

            for (const dir of storeDirs) {
                await this.storeService.scanStoresDirectory(dir);
            }
        }

        if (fileInfo.isUtil && this.utilsService) {
            await this.utilsService.scanUtilsDirectories();
        }

        this.lastCacheUpdate = now;
    }
}