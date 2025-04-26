import * as fs from 'fs';
import * as path from 'path';
import { Constants } from './constants';

/**
 * @author Merite15
 * @created 2025-04-26 07:15:08
 */
export class FileUtils {
    /**
     * Find all directories with a specific name in the project
     */
    static async findAllDirsByName(dirName: string): Promise<string[]> {
        const dirs: string[] = [];

        if (!Constants.nuxtProjectRoot) return dirs;

        // Directories to check initially - including Nuxt 3 standard and Nuxt 4 compatibility mode
        const initialDirs = [
            Constants.nuxtProjectRoot,
            path.join(Constants.nuxtProjectRoot, 'app'),
            path.join(Constants.nuxtProjectRoot, 'app', 'base'),
            // Add other potential layer directories
            path.join(Constants.nuxtProjectRoot, 'app', 'modules')
        ].filter(dir => fs.existsSync(dir));

        for (const initialDir of initialDirs) {
            const recurse = (dir: string) => {
                try {
                    const entries = fs.readdirSync(dir, { withFileTypes: true });

                    for (const entry of entries) {
                        const fullPath = path.join(dir, entry.name);
                        if (entry.isDirectory()) {
                            if (entry.name === dirName) {
                                dirs.push(fullPath);
                            }
                            // Don't recurse into node_modules
                            if (entry.name !== 'node_modules' && entry.name !== '.nuxt' && entry.name !== '.output') {
                                recurse(fullPath); // continuer la récursion
                            }
                        }
                    }
                } catch (e) {
                    // Ignore errors for directories that can't be read
                }
            };

            recurse(initialDir);
        }

        return dirs;
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