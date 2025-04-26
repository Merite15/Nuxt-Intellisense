import type { NuxtComponentInfo } from '../types';

/**
 * @author Merite15
 * @created 2025-04-26 07:15:08
 */
export class Constants {
    static nuxtProjectRoot: string | null = null;

    static autoImportCache: Map<string, NuxtComponentInfo[]> = new Map();

    static lastCacheUpdate: number = 0;

    static cacheUpdateInterval: number = 30000;

}