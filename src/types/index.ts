import * as vscode from 'vscode';

export interface NuxtComponentInfo {
    name: string;
    path: string;
    isAutoImported: boolean;
    exportType?: string;
}

export interface Position {
    line: number;
    character: number;
}

export interface CodeLensResult {
    location: vscode.Location;
    title: string;
    command?: string;
    commandArgs?: any[];
}