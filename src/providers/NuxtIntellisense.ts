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

        // Pour le debugging
        console.log(`[NuxtIntellisense] Recherche du projet Nuxt en partant de: ${currentDir}`);

        // Variables pour stocker les résultats intermédiaires
        let firstNuxtConfigFound: string | null = null;
        let potentialRootWithPackageJson: string | null = null;

        while (currentDir !== root) {
            const nuxtConfigPath = path.join(currentDir, 'nuxt.config.ts');
            const nuxtConfigJsPath = path.join(currentDir, 'nuxt.config.js');
            const packageJsonPath = path.join(currentDir, 'package.json');

            try {
                // Vérifier si un nuxt.config existe
                const hasNuxtConfig = fs.existsSync(nuxtConfigPath) || fs.existsSync(nuxtConfigJsPath);

                // Stocker le premier nuxt.config trouvé
                if (hasNuxtConfig && !firstNuxtConfigFound) {
                    firstNuxtConfigFound = currentDir;
                    console.log(`[NuxtIntellisense] Premier nuxt.config trouvé dans: ${currentDir}`);
                }

                // Vérifier si ce répertoire contient un package.json
                if (fs.existsSync(packageJsonPath)) {
                    try {
                        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

                        // Si le package.json contient nuxt comme dépendance, c'est un bon candidat
                        if (packageJson.dependencies &&
                            (packageJson.dependencies.nuxt ||
                                packageJson.dependencies['nuxt3'] ||
                                packageJson.devDependencies?.nuxt ||
                                packageJson.devDependencies?.['nuxt3'])) {

                            potentialRootWithPackageJson = currentDir;
                            console.log(`[NuxtIntellisense] package.json avec Nuxt trouvé dans: ${currentDir}`);

                            // Si ce répertoire contient aussi un nuxt.config ET des layers ou extends
                            if (hasNuxtConfig) {
                                const configPath = fs.existsSync(nuxtConfigPath) ? nuxtConfigPath : nuxtConfigJsPath;
                                const configContent = fs.readFileSync(configPath, 'utf8');

                                // Vérifier si ce nuxt.config contient des extensions ou layers
                                if (configContent.includes('extends:') ||
                                    configContent.includes('layers:') ||
                                    configContent.includes('modules:')) {

                                    console.log(`[NuxtIntellisense] Racine principale de projet Nuxt détectée avec extensions dans: ${currentDir}`);
                                    return currentDir; // C'est probablement la racine principale
                                }
                            }
                        }
                    } catch (parseError) {
                        // Ignorer les erreurs de parsing du package.json
                    }
                }

                // Vérifier la structure pour voir si c'est la racine principale
                // Chercher des indices d'une racine principale comme:
                // - présence d'un dossier "layers" ou "app"
                // - présence de plusieurs sous-dossiers ayant chacun un nuxt.config
                const layersDirPath = path.join(currentDir, 'layers');
                const appDirPath = path.join(currentDir, 'app');

                if (fs.existsSync(layersDirPath) && fs.statSync(layersDirPath).isDirectory()) {
                    console.log(`[NuxtIntellisense] Structure de layers détectée dans: ${currentDir}`);
                    return currentDir;
                }

                // Vérifier si le dossier app contient plusieurs sous-dossiers avec nuxt.config
                if (fs.existsSync(appDirPath) && fs.statSync(appDirPath).isDirectory()) {
                    const appSubDirs = fs.readdirSync(appDirPath);

                    let nuxtConfigSubDirsCount = 0;

                    for (const subdir of appSubDirs) {
                        const fullSubdirPath = path.join(appDirPath, subdir);
                        if (fs.statSync(fullSubdirPath).isDirectory()) {
                            const hasNuxtConfigInSubdir =
                                fs.existsSync(path.join(fullSubdirPath, 'nuxt.config.ts')) ||
                                fs.existsSync(path.join(fullSubdirPath, 'nuxt.config.js'));

                            if (hasNuxtConfigInSubdir) {
                                nuxtConfigSubDirsCount++;
                            }
                        }
                    }

                    if (nuxtConfigSubDirsCount > 1) {
                        console.log(`[NuxtIntellisense] Structure multi-layer détectée avec ${nuxtConfigSubDirsCount} layers dans: ${currentDir}`);
                        return currentDir;
                    }
                }
            } catch (e) {
                console.error(`[NuxtIntellisense] Erreur lors de la vérification du répertoire ${currentDir}:`, e);
            }

            currentDir = path.dirname(currentDir);
        }

        // Si nous n'avons pas trouvé de racine principale évidente,
        // on retourne par ordre de priorité:

        // 1. Le répertoire avec package.json contenant nuxt
        if (potentialRootWithPackageJson) {
            console.log(`[NuxtIntellisense] Utilisation du répertoire avec package.json comme racine: ${potentialRootWithPackageJson}`);
            return potentialRootWithPackageJson;
        }

        // 2. Le premier nuxt.config trouvé
        if (firstNuxtConfigFound) {
            console.log(`[NuxtIntellisense] Utilisation du premier nuxt.config trouvé comme racine: ${firstNuxtConfigFound}`);
            return firstNuxtConfigFound;
        }

        console.log(`[NuxtIntellisense] Aucune racine de projet Nuxt trouvée`);
        return null;
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