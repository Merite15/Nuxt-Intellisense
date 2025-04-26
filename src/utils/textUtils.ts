import { Position } from '../types';

export class TextUtils {
    static indexToPosition(content: string, index: number): Position {
        const lines = content.slice(0, index).split('\n');
        return {
            line: lines.length - 1,
            character: lines[lines.length - 1].length
        };
    }

    static findMatches(regex: RegExp, content: string, startPos: number = 0): Array<{ index: number, text: string }> {
        const matches = [];
        let match;

        regex.lastIndex = startPos;
        while ((match = regex.exec(content)) !== null) {
            matches.push({
                index: match.index,
                text: match[0]
            });
        }

        return matches;
    }
}