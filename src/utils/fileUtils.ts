import * as fs from 'fs';
import * as path from 'path';

export class FileUtils {
    static async findAllDirsByName(rootDir: string, dirName: string): Promise<string[]> {
        const dirs: string[] = [];

        if (!fs.existsSync(rootDir)) return dirs;

        const initialDirs = [
            rootDir,
            path.join(rootDir, 'app'),
            path.join(rootDir, 'app', 'base'),
            path.join(rootDir, 'app', 'modules')
        ].filter(dir => fs.existsSync(dir));

        for (const initialDir of initialDirs) {
            await this.recursiveDirSearch(initialDir, dirName, dirs);
        }

        return dirs;
    }

    static async recursiveDirSearch(dir: string, targetDirName: string, results: string[]): Promise<void> {
        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });

            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    if (entry.name === targetDirName) {
                        results.push(fullPath);
                    }
                    if (!this.shouldSkipDirectory(entry.name)) {
                        await this.recursiveDirSearch(fullPath, targetDirName, results);
                    }
                }
            }
        } catch (e) {
            console.error(`Error searching directory ${dir}:`, e);
        }
    }

    static shouldSkipDirectory(dirName: string): boolean {
        return ['node_modules', '.nuxt', '.output', 'dist'].includes(dirName);
    }

    static shouldSkipFile(fsPath: string): boolean {
        return fsPath.includes('node_modules') ||
            fsPath.includes('.nuxt') ||
            fsPath.includes('.output') ||
            fsPath.includes('dist');
    }
}