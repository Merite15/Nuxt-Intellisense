import * as path from 'path';
import * as fs from 'fs';

export class PathUtils {
    static pascalToKebabCase(str: string): string {
        return str
            .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
            .replace(/([A-Z])([A-Z])(?=[a-z])/g, '$1-$2')
            .toLowerCase();
    }

    static resolveWithExtension(filePath: string, nuxtRoot: string): string {
        const extensions = ['.ts', '.js', '.vue'];

        console.log(nuxtRoot);

        if (extensions.includes(path.extname(filePath))) {
            return filePath;
        }

        for (const ext of extensions) {
            const pathWithExt = filePath + ext;
            if (fs.existsSync(pathWithExt)) {
                return pathWithExt;
            }
        }

        for (const ext of extensions) {
            const indexPath = path.join(filePath, `index${ext}`);
            if (fs.existsSync(indexPath)) {
                return indexPath;
            }
        }

        return filePath;
    }

    static isImportPointingToFile(importPath: string, importingFile: string, targetFile: string, nuxtRoot: string): boolean {
        if (importPath.startsWith('./') || importPath.startsWith('../')) {
            const importingDir = path.dirname(importingFile);
            const resolvedPath = path.resolve(importingDir, importPath);
            const resolvedWithExt = this.resolveWithExtension(resolvedPath, nuxtRoot);
            return resolvedWithExt === targetFile;
        }

        if (importPath.startsWith('~/') || importPath.startsWith('@/')) {
            const aliasPath = importPath.substring(2);
            const resolvedPath = path.join(nuxtRoot, aliasPath);
            const resolvedWithExt = this.resolveWithExtension(resolvedPath, nuxtRoot);
            return resolvedWithExt === targetFile;
        }

        return false;
    }
}