import * as path from 'path';

/**
 * @author Merite15
 * @created 2025-04-26 07:13:46
 */
export class PathUtils {
    /**
     * Convert PascalCase to kebab-case
     */
    static pascalToKebabCase(str: string): string {
        return str
            .split(/(?=[A-Z])/)
            .join('-')
            .toLowerCase();
    }

    /**
     * Check if an import path points to a specific file
     */
    static isImportPointingToFile(
        importPath: string,
        sourceFilePath: string,
        targetFilePath: string,
        projectRoot: string
    ): boolean {
        // Gestion des chemins relatifs (./ ou ../)
        if (importPath.startsWith('.')) {
            const sourceDir = path.dirname(sourceFilePath);
            const resolvedPath = path.resolve(sourceDir, importPath);
            return this.matchesWithExtension(resolvedPath, targetFilePath);
        }

        // Gestion des alias Nuxt (~ ou @)
        if (importPath.startsWith('~') || importPath.startsWith('@')) {
            const withoutAlias = importPath.substring(1);
            const resolvedPath = path.join(projectRoot, withoutAlias);
            return this.matchesWithExtension(resolvedPath, targetFilePath);
        }

        return false;
    }

    /**
     * Check if a path matches a target file, considering possible extensions
     */
    private static matchesWithExtension(sourcePath: string, targetPath: string): boolean {
        if (sourcePath === targetPath) return true;

        const extensions = ['.ts', '.js', '.vue'];

        // Vérifier avec les extensions
        for (const ext of extensions) {
            if (sourcePath + ext === targetPath) return true;
        }

        // Vérifier les fichiers index
        for (const ext of extensions) {
            if (path.join(sourcePath, `index${ext}`) === targetPath) return true;
        }

        return false;
    }
}