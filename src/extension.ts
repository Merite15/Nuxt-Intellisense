import * as vscode from 'vscode';
import { Nuxt3CodeLensProvider } from './providers/nuxtCodeLensProvider';

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      [
        { language: 'vue' },
        { language: 'typescript' },
        { language: 'javascript' }
      ],
      new Nuxt3CodeLensProvider()
    )
  );

  console.log('Extension "nuxt3-codelens" est maintenant active!');
}

export function deactivate() { }