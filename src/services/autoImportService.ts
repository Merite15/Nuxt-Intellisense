import * as path from 'path';
import * as fs from 'fs';
import { NuxtComponentInfo } from '../models/nuxtComponentInfo';
import { getFilesRecursively } from '../utils/fileUtils';

export class AutoImportService {
    private autoImportCache: Map<string, NuxtComponentInfo[]> = new Map();
    private lastCacheUpdate: number = 0;
    private cacheUpdateInterval: number = 30000; // 30 secondes

    constructor(private nuxtProjectRoot: string | null) { }

    /**
     * Mettre à jour le cache des auto-importations si nécessaire
     */
    async updateAutoImportCacheIfNeeded(): Promise<void> {
        const now = Date.now();
        if (now - this.lastCacheUpdate < this.cacheUpdateInterval) {
            return;
        }

        this.lastCacheUpdate = now;
        await this.updateAutoImportCache();
    }

    /**
     * Mettre à jour le cache des auto-importations
     */
    private async updateAutoImportCache(): Promise<void> {
        if (!this.nuxtProjectRoot) {
            return;
        }

        // Réinitialiser le cache
        this.autoImportCache.clear();

        // Analyser les composants
        const componentsDir = path.join(this.nuxtProjectRoot, 'components');
        await this.scanComponentsDirectory(componentsDir);

        // Analyser les composables
        const composablesDir = path.join(this.nuxtProjectRoot, 'composables');
        await this.scanComposablesDirectory(composablesDir);
    }

    /**
     * Analyser le répertoire des composants
     */
    private async scanComponentsDirectory(dir: string): Promise<void> {
        if (!fs.existsSync(dir)) {
            return;
        }

        const componentInfos: NuxtComponentInfo[] = [];
        const files = await getFilesRecursively(dir, ['.vue']);

        for (const file of files) {
            const componentName = path.basename(file, '.vue');
            componentInfos.push({
                name: componentName,
                path: file,
                isAutoImported: true
            });
        }

        this.autoImportCache.set('components', componentInfos);
    }

    /**
     * Analyser le répertoire des composables
     */
    private async scanComposablesDirectory(dir: string): Promise<void> {
        if (!fs.existsSync(dir)) {
            return;
        }

        const composableInfos: NuxtComponentInfo[] = [];
        const files = await getFilesRecursively(dir, ['.ts', '.js']);

        for (const file of files) {
            // Lire le fichier pour trouver les fonctions exportées
            try {
                const content = fs.readFileSync(file, 'utf-8');
                // Vérifier si le fichier contient une définition de store Pinia
                if (content.includes('defineStore')) {
                    continue; // Ignorer les fichiers qui définissent des stores
                }

                const exportRegex = /export\s+(const|function|async function)\s+(\w+)/g;
                let match: RegExpExecArray | null;

                while ((match = exportRegex.exec(content))) {
                    const name = match[2];
                    composableInfos.push({
                        name: name,
                        path: file,
                        isAutoImported: true
                    });
                }
            } catch (e) {
                // Ignorer les erreurs de lecture
            }
        }

        this.autoImportCache.set('composables', composableInfos);
    }

    /**
     * Récupérer les auto-importations
     */
    getAutoImports(type: string): NuxtComponentInfo[] {
        return this.autoImportCache.get(type) || [];
    }
}