import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

/**
 * @author Merite15
 * @created 2025-04-26 07:15:08
 */
export class FileUtils {
    /**
     * Find all directories with a specific name in the project
     */
    static async findAllDirsByName(rootDir: string, dirName: string): Promise<string[]> {
        const dirs: string[] = [];

        // Vérifier si le répertoire racine existe
        if (!fs.existsSync(rootDir)) {
            return dirs;
        }

        // Chemins standards Nuxt
        const searchPaths = [
            rootDir,
            path.join(rootDir, 'src'),
            path.join(rootDir, 'app')
        ];

        // Rechercher dans chaque chemin
        for (const searchPath of searchPaths) {
            if (!fs.existsSync(searchPath)) continue;

            const entries = await vscode.workspace.findFiles(
                new vscode.RelativePattern(searchPath, `**/${dirName}`)
            );

            dirs.push(...entries.map(entry => path.dirname(entry.fsPath)));
        }

        return [...new Set(dirs)]; // Éliminer les doublons
    }

    /**
     * Check if a file should be skipped during search
     */
    static shouldSkipFile(fsPath: string): boolean {
        return fsPath.includes('node_modules') ||
            fsPath.includes('.nuxt') ||
            fsPath.includes('.output') ||
            fsPath.includes('dist');
    }
}