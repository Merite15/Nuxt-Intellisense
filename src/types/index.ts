/**
 * @author Merite15
 * @created 2025-04-26 07:17:12
 */

/**
 * Represents information about a Nuxt component
 */
export interface NuxtComponentInfo {
    name: string;
    path: string;
    isAutoImported: boolean;
    exportType?: string;
}