import * as vscode from 'vscode';

export class TextUtils {
    /**
       * Converts a character index in a string to a VSCode Position
       */
    static indexToPosition(content: string, index: number): vscode.Position {
        const before = content.slice(0, index);
        const line = before.split('\n').length - 1;
        const lineStartIndex = before.lastIndexOf('\n') + 1;
        const character = index - lineStartIndex;
        return new vscode.Position(line, character);
    }

    /**
     * Find all matches for a regex in content starting from a specific position
     */
    static findMatches(content: string, regex: RegExp, startPos: number = 0): vscode.Range[] {
        const ranges: vscode.Range[] = [];
        const matches = content.slice(startPos).matchAll(regex);

        for (const match of matches) {
            if (match.index !== undefined) {
                const realIndex = startPos + match.index;
                const start = this.indexToPosition(content, realIndex);
                const end = this.indexToPosition(content, realIndex + match[0].length);
                ranges.push(new vscode.Range(start, end));
            }
        }

        return ranges;
    }
}