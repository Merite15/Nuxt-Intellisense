import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Obtenir tous les fichiers récursivement dans un répertoire
 */
export async function getFilesRecursively(dir: string, extensions: string[]): Promise<string[]> {
    const files: string[] = [];

    if (!fs.existsSync(dir)) {
        return files;
    }

    const dirEntries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of dirEntries) {
        const entryPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
            const subFiles = await getFilesRecursively(entryPath, extensions);
            files.push(...subFiles);
        } else if (extensions.includes(path.extname(entry.name))) {
            files.push(entryPath);
        }
    }

    return files;
}

/**
 * Trouver la racine du projet Nuxt
 */
export async function findNuxtProjectRoot(uri: vscode.Uri): Promise<string | null> {
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

/**
 * Calculer le chemin de la route à partir du chemin du fichier
 */
export function calculateRoutePath(filePath: string, nuxtProjectRoot: string | null): string {
    if (!nuxtProjectRoot) {
        return path.basename(filePath, '.vue');
    }

    const pagesDir = path.join(nuxtProjectRoot, 'pages');
    const relativePath = path.relative(pagesDir, filePath);

    // Supprimer l'extension
    let routePath = relativePath.replace(/\.vue$/, '');

    // Gérer les fichiers index
    routePath = routePath.replace(/\/index$/, '/');
    if (routePath === 'index') {
        routePath = '/';
    }

    // Gérer les paramètres (fichiers avec [param])
    routePath = routePath.replace(/\[([^\]]+)\]/g, ':$1');

    // Ajouter un '/' au début si nécessaire
    if (!routePath.startsWith('/')) {
        routePath = '/' + routePath;
    }

    return routePath;
}