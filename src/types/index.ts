/**
 * @author Merite15
 * @created 2025-04-26 07:17:12
 */

/**
 * Represents information about a Nuxt component
 */
export interface NuxtComponentInfo {
    /** The name of the component */
    name: string;
    /** The full path to the component file */
    path: string;
    /** Whether the component is auto-imported by Nuxt */
    isAutoImported: boolean;
    /** The type of export (component, layout, etc.) */
    exportType?: string;
}