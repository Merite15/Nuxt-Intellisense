import * as vscode from 'vscode';
import { NuxtIntellisense } from './providers/NuxtIntellisense';

/**
 * @author Merite15
 * @created 2025-04-26
 *
 * Cette fonction est appelée quand votre extension est activée
 * Votre extension est activée la première fois que la commande est exécutée
 */
export function activate(context: vscode.ExtensionContext) {
  const codeLensProvider = new NuxtIntellisense();

  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      [
        { language: 'vue' },
        { language: 'typescript' },
        { language: 'javascript' }
      ],
      codeLensProvider
    )
  );

  // Enregistrer les commandes personnalisées si nécessaire
  const disposableCommands = [
    vscode.commands.registerCommand('nuxt-intellisense.refreshCodeLens', () => {
      vscode.commands.executeCommand('editor.action.triggerParameterHints');
    }),

    vscode.commands.registerCommand('nuxt-intellisense.showDocumentation', () => {
      vscode.env.openExternal(
        vscode.Uri.parse('https://github.com/Merite15/Nuxt-Intellisense#readme')
      );
    })
  ];

  // Ajouter les commandes aux abonnements
  context.subscriptions.push(...disposableCommands);

  // Configuration de l'extension
  const config = vscode.workspace.getConfiguration('nuxt-intellisense');

  const showWelcomeMessage = config.get('showWelcomeMessage', true);
  if (showWelcomeMessage) {
    vscode.window.showInformationMessage(
      'Nuxt Intellisense is now active! Start working with your Nuxt project references.',
      'Show Documentation',
      'Don\'t Show Again'
    ).then(selection => {
      if (selection === 'Show Documentation') {
        vscode.commands.executeCommand('nuxt-intellisense.showDocumentation');
      } else if (selection === 'Don\'t Show Again') {
        config.update('showWelcomeMessage', false, true);
      }
    });
  }

  // Log d'activation
  console.log('Extension "nuxt-intellisense" is now active!');
}

/**
 * Cette méthode est appelée quand votre extension est désactivée
 */
export function deactivate() {
  console.log('Extension "nuxt-intellisense" is now deactivated!');
}

// Exporter les types nécessaires
export { NuxtComponentInfo } from './types';