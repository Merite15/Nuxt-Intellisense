import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { findNuxtProjectRoot } from '../utils/fileUtils';
import { AutoImportService } from '../services/autoImportService';
import { ReferenceService } from '../services/referenceService';

export class Nuxt3CodeLensProvider implements vscode.CodeLensProvider {
    private nuxtProjectRoot: string | null = null;
    private autoImportService: AutoImportService;
    private referenceService: ReferenceService;

    constructor() {
        this.autoImportService = new AutoImportService(this.nuxtProjectRoot);
        this.referenceService = new ReferenceService(this.nuxtProjectRoot);
    }

    async provideCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
        const lenses: vscode.CodeLens[] = [];

        const fileName = path.basename(document.fileName);

        if (fileName === 'app.vue' || fileName === 'error.vue') {
            return [];
        }

        // Trouver la racine du projet Nuxt
        this.nuxtProjectRoot = await findNuxtProjectRoot(document.uri);

        // Mettre à jour les services avec la racine du projet
        this.autoImportService = new AutoImportService(this.nuxtProjectRoot);
        this.referenceService = new ReferenceService(this.nuxtProjectRoot);

        // Mettre à jour le cache des auto-importations si nécessaire
        await this.autoImportService.updateAutoImportCacheIfNeeded();

        // Le nom du fichier actuel (pour déterminer le type)
        const fileDir = path.dirname(document.fileName);
        const fileExtension = path.extname(document.fileName);
        const isVueFile = fileExtension === '.vue';
        const isComposable = fileDir.includes('composables');
        const isComponent = fileDir.includes('components');
        const isPlugin = fileDir.includes('plugins');
        const isMiddleware = fileDir.includes('middleware');
        const isPages = fileDir.includes('pages');
        const isLayout = fileDir.includes('layouts');
        const isStore = fileDir.includes('stores') || fileDir.includes('store');

        const text = document.getText();

        // 1. Détection des composables (dans /composables/*.ts)
        if (isComposable || text.includes('export function') || text.includes('export const')) {
            const composableRegex = /export\s+(const|function|async function)\s+(\w+)/g;
            let match: RegExpExecArray | null;

            while ((match = composableRegex.exec(text))) {
                const funcType = match[1];
                const name = match[2];
                const pos = document.positionAt(match.index);
                const range = new vscode.Range(pos.line, 0, pos.line, 0);

                // Rechercher les références, y compris les auto-importations
                const references = await this.referenceService.findAllReferences(document, name, pos);
                const referenceCount = references.length;

                const autoImportInfo = isComposable ? "auto-importé" : "";

                lenses.push(
                    new vscode.CodeLens(range, {
                        title: `🔄 ${referenceCount} référence${referenceCount === 1 ? '' : 's'} du composable${autoImportInfo ? ` (${autoImportInfo})` : ''}`,
                        command: 'editor.action.showReferences',
                        arguments: [
                            document.uri,
                            new vscode.Position(pos.line, match[0].indexOf(name)),
                            references
                        ]
                    })
                );
            }
        }

        // 2. Détection des composants Vue et Nuxt (dans /components/*.vue)
        if (isVueFile) {
            // Ne pas afficher les CodeLens pour les composants si on est dans une page
            if (!isPages) {
                // 2.1 Pour les composants avec <script setup>
                const scriptSetupRegex = /<script\s+setup[^>]*>/g;
                let match: RegExpExecArray | null;

                while ((match = scriptSetupRegex.exec(text))) {
                    const pos = document.positionAt(match.index);
                    const range = new vscode.Range(pos.line, 0, pos.line, 0);

                    // Nom du composant basé sur le nom de fichier
                    const componentName = path.basename(document.fileName, '.vue');

                    // Rechercher les références, y compris les auto-importations
                    const references = await this.referenceService.findComponentReferences(document, componentName);
                    const referenceCount = references.length;

                    const autoImportInfo = isComponent ? "auto-importé" : "";

                    lenses.push(
                        new vscode.CodeLens(range, {
                            title: `🧩 ${referenceCount} utilisation${referenceCount === 1 ? '' : 's'} du composant${autoImportInfo ? ` (${autoImportInfo})` : ''}`,
                            command: 'editor.action.showReferences',
                            arguments: [
                                document.uri,
                                pos,
                                references
                            ]
                        })
                    );
                }

                // 2.2 Pour les composants avec defineComponent
                const defineComponentRegex = /defineComponent\s*\(/g;
                while ((match = defineComponentRegex.exec(text))) {
                    const pos = document.positionAt(match.index);
                    const range = new vscode.Range(pos.line, 0, pos.line, 0);

                    // Nom du composant basé sur le nom de fichier
                    const componentName = path.basename(document.fileName, '.vue');

                    // Rechercher les références, y compris les auto-importations
                    const references = await this.referenceService.findComponentReferences(document, componentName);
                    const referenceCount = references.length;

                    lenses.push(
                        new vscode.CodeLens(range, {
                            title: `🧩 ${referenceCount} utilisation${referenceCount === 1 ? '' : 's'} du composant`,
                            command: 'editor.action.showReferences',
                            arguments: [
                                document.uri,
                                pos,
                                references
                            ]
                        })
                    );
                }

                // 2.3 Pour les composants Nuxt spécifiques
                const defineNuxtComponentRegex = /defineNuxtComponent\s*\(/g;
                while ((match = defineNuxtComponentRegex.exec(text))) {
                    const pos = document.positionAt(match.index);
                    const range = new vscode.Range(pos.line, 0, pos.line, 0);

                    // Nom du composant basé sur le nom de fichier
                    const componentName = path.basename(document.fileName, '.vue');

                    // Rechercher les références, y compris les auto-importations
                    const references = await this.referenceService.findComponentReferences(document, componentName);
                    const referenceCount = references.length;

                    lenses.push(
                        new vscode.CodeLens(range, {
                            title: `⚡ ${referenceCount} utilisation${referenceCount === 1 ? '' : 's'} du composant Nuxt`,
                            command: 'editor.action.showReferences',
                            arguments: [
                                document.uri,
                                pos,
                                references
                            ]
                        })
                    );
                }
            }
        }

        // 3. Détection des plugins Nuxt (dans /plugins/*.ts)
        if (isPlugin) {
            const defineNuxtPluginRegex = /defineNuxtPlugin\s*\(/g;
            let match: RegExpExecArray | null;

            while ((match = defineNuxtPluginRegex.exec(text))) {
                const pos = document.positionAt(match.index);
                const range = new vscode.Range(pos.line, 0, pos.line, 0);

                // Nom du plugin basé sur le nom de fichier
                const pluginName = path.basename(document.fileName, path.extname(document.fileName));

                // Rechercher les références
                const references = await this.referenceService.findPluginReferences(pluginName);
                const referenceCount = references.length;

                lenses.push(
                    new vscode.CodeLens(range, {
                        title: `🔌 ${referenceCount} utilisation${referenceCount === 1 ? '' : 's'} du plugin`,
                        command: 'editor.action.showReferences',
                        arguments: [
                            document.uri,
                            pos,
                            references
                        ]
                    })
                );
            }
        }

        // 4. Détection des middleware Nuxt (dans /middleware/*.ts)
        if (isMiddleware) {
            const defineNuxtMiddlewareRegex = /defineNuxtRouteMiddleware\s*\(/g;
            let match: RegExpExecArray | null;

            while ((match = defineNuxtMiddlewareRegex.exec(text))) {
                const pos = document.positionAt(match.index);
                const range = new vscode.Range(pos.line, 0, pos.line, 0);

                // Nom du middleware basé sur le nom de fichier
                const middlewareName = path.basename(document.fileName, path.extname(document.fileName));

                // Rechercher les références
                const references = await this.referenceService.findMiddlewareReferences(middlewareName);
                const referenceCount = references.length;

                lenses.push(
                    new vscode.CodeLens(range, {
                        title: `🔗 ${referenceCount} utilisation${referenceCount === 1 ? '' : 's'} du middleware`,
                        command: 'editor.action.showReferences',
                        arguments: [
                            document.uri,
                            pos,
                            references
                        ]
                    })
                );
            }
        }

        // 6. Détection des layouts Nuxt (dans /layouts/*.vue)
        if (isLayout) {
            const layoutSetupRegex = /<script\s+setup[^>]*>|<template>/g;
            let match: RegExpExecArray | null;

            if ((match = layoutSetupRegex.exec(text))) {
                const pos = document.positionAt(match.index);
                const range = new vscode.Range(pos.line, 0, pos.line, 0);

                // Nom du layout basé sur le nom de fichier
                const layoutName = path.basename(document.fileName, '.vue');

                // Rechercher les références
                const references = await this.referenceService.findLayoutReferences(layoutName);
                const referenceCount = references.length;

                lenses.push(
                    new vscode.CodeLens(range, {
                        title: `🖼️ ${referenceCount} utilisation${referenceCount === 1 ? '' : 's'} du layout`,
                        command: 'editor.action.showReferences',
                        arguments: [
                            document.uri,
                            pos,
                            references
                        ]
                    })
                );
            }
        }

        // 7. Détection des stores Pinia (dans /stores/*.ts)
        if (isStore) {
            const defineStoreRegex = /defineStore\s*\(\s*(['"`])(.*?)\1/g;
            let match: RegExpExecArray | null;

            while ((match = defineStoreRegex.exec(text))) {
                const storeName = match[2];
                const pos = document.positionAt(match.index);
                const range = new vscode.Range(pos.line, 0, pos.line, 0);

                // Rechercher les références
                const references = await this.referenceService.findStoreReferences(storeName);
                const referenceCount = references.length;

                lenses.push(
                    new vscode.CodeLens(range, {
                        title: `🗃️ ${referenceCount} utilisation${referenceCount === 1 ? '' : 's'} du store`,
                        command: 'editor.action.showReferences',
                        arguments: [
                            document.uri,
                            new vscode.Position(pos.line, match[0].indexOf(storeName)),
                            references
                        ]
                    })
                );
            }
        }

        return lenses;
    }
}