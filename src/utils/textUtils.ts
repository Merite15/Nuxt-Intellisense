import * as vscode from 'vscode';

export class TextUtils {
    /**
       * Converts a character index in a string to a VSCode Position
       */
    static indexToPosition(content: string, index: number): { line: number, character: number } {
        const lines = content.slice(0, index).split('\n');
        const line = lines.length - 1;
        const character = lines[lines.length - 1].length;
        return { line, character };
    }

    /**
     * Find all matches for a regex in content starting from a specific position
     */
    static findMatches(regex: RegExp, content: string, uri: vscode.Uri, results: vscode.Location[]): void {
        let match;
        while ((match = regex.exec(content)) !== null) {
            const start = this.indexToPosition(content, match.index);
            const end = this.indexToPosition(content, match.index + match[0].length);

            results.push(new vscode.Location(
                uri,
                new vscode.Range(
                    new vscode.Position(start.line, start.character),
                    new vscode.Position(end.line, end.character)
                )
            ));
        }
    }

    static removeDuplicateReferences(references: vscode.Location[]): vscode.Location[] {
        const uniqueRefs: vscode.Location[] = [];
        const seen = new Set<string>();

        for (const ref of references) {
            const key = `${ref.uri.fsPath}:${ref.range.start.line}:${ref.range.start.character}`;
            if (!seen.has(key)) {
                seen.add(key);
                uniqueRefs.push(ref);
            }
        }

        return uniqueRefs;
    }
}