import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      [{ language: 'vue' }, { language: 'typescript' }],
      new VueCodeLensProvider()
    )
  );
}

class VueCodeLensProvider implements vscode.CodeLensProvider {
  async provideCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
    const lenses: vscode.CodeLens[] = [];

    const regex = /export function (\w+)|defineComponent\((\{[\s\S]*?\})\)/g;

    const text = document.getText();

    let match: RegExpExecArray | null;

    while ((match = regex.exec(text))) {
      const name = match[1] || 'default';

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
          title: `${referenceCount} reference${referenceCount === 1 ? '' : 's'}`,
          command: 'editor.action.showReferences',
          arguments: [
            document.uri,
            new vscode.Position(pos.line, match[0].indexOf(name)),
            locations || []
          ]
        })
      );
    }

    return lenses;
  }
}

export function deactivate() { }
