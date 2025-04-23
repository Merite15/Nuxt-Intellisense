import * as vscode from 'vscode';

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
}

class Nuxt3CodeLensProvider implements vscode.CodeLensProvider {
  async provideCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
    const lenses: vscode.CodeLens[] = [];

    // Détection des composables (fonctions exportées dans fichiers .ts)
    const composableRegex = /export\s+(const|function)\s+(\w+)/g;

    // Détection des composants Vue (defineComponent ou <script setup>)
    const componentRegex = /defineComponent\s*\(\s*\{[\s\S]*?\}\s*\)|<script\s+setup[\s\S]*?>/g;

    // Détection des composants Nuxt spécifiques
    const nuxtComponentRegex = /defineNuxtComponent\s*\(/g;

    const text = document.getText();

    // Traitement des composables
    let match: RegExpExecArray | null;
    while ((match = composableRegex.exec(text))) {
      const name = match[2];
      const pos = document.positionAt(match.index);
      const range = new vscode.Range(pos.line, 0, pos.line, 0);

      const locations = await vscode.commands.executeCommand<vscode.Location[]>(
        'vscode.executeReferenceProvider',
        document.uri,
        new vscode.Position(pos.line, match[0].indexOf(name))
      );

      const referenceCount = locations?.length || 0;

      lenses.push(
        new vscode.CodeLens(range, {
          title: `📊 ${referenceCount} référence${referenceCount === 1 ? '' : 's'}`,
          command: 'editor.action.showReferences',
          arguments: [
            document.uri,
            new vscode.Position(pos.line, match[0].indexOf(name)),
            locations || []
          ]
        })
      );
    }

    // Traitement des composants Vue
    while ((match = componentRegex.exec(text))) {
      const pos = document.positionAt(match.index);
      const range = new vscode.Range(pos.line, 0, pos.line, 0);

      // Essayer de trouver le nom du composant (peut être dans un fichier .vue)
      const fileName = document.fileName.split('/').pop()?.split('.')[0] || 'Component';

      const locations = await vscode.commands.executeCommand<vscode.Location[]>(
        'vscode.executeReferenceProvider',
        document.uri,
        new vscode.Position(pos.line, 0)
      );

      const referenceCount = locations?.length || 0;

      lenses.push(
        new vscode.CodeLens(range, {
          title: `🧩 ${referenceCount} utilisation${referenceCount === 1 ? '' : 's'} du composant`,
          command: 'editor.action.showReferences',
          arguments: [
            document.uri,
            new vscode.Position(pos.line, 0),
            locations || []
          ]
        })
      );
    }

    // Traitement des composants Nuxt
    while ((match = nuxtComponentRegex.exec(text))) {
      const pos = document.positionAt(match.index);
      const range = new vscode.Range(pos.line, 0, pos.line, 0);

      const locations = await vscode.commands.executeCommand<vscode.Location[]>(
        'vscode.executeReferenceProvider',
        document.uri,
        new vscode.Position(pos.line, 0)
      );

      const referenceCount = locations?.length || 0;

      lenses.push(
        new vscode.CodeLens(range, {
          title: `⚡ ${referenceCount} utilisation${referenceCount === 1 ? '' : 's'} du composant Nuxt`,
          command: 'editor.action.showReferences',
          arguments: [
            document.uri,
            new vscode.Position(pos.line, 0),
            locations || []
          ]
        })
      );
    }

    return lenses;
  }
}

export function deactivate() { }