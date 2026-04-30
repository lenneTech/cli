import { readFileSync, writeFileSync } from 'fs';

import { ExtendedGluegunToolbox } from '../interfaces/extended-gluegun-toolbox';

const singleComment = Symbol('singleComment');
const multiComment = Symbol('multiComment');

const stripWithoutWhitespace = () => '';
const stripWithWhitespace = (string, start?, end?) => string.slice(start, end).replace(/\S/g, ' ');

const isEscaped = (jsonString, quotePosition) => {
  let index = quotePosition - 1;
  let backslashCount = 0;

  while (jsonString[index] === '\\') {
    index -= 1;
    backslashCount += 1;
  }

  return Boolean(backslashCount % 2);
};

export interface HelpJsonDefinition {
  aliases?: string[];
  configuration?: string;
  description: string;
  name: string;
  options: HelpJsonOption[];
  propertyFlags?: HelpJsonPropertyFlags;
}

export interface HelpJsonOption {
  default?: any;
  description: string;
  flag: string;
  required?: boolean;
  type: string;
  values?: string[];
}

export interface HelpJsonPropertyFlags {
  attributes: { description: string; name: string; type: string; values?: string[] }[];
  pattern: string;
}

export class Tools {
  private hintShown = false;

  /**
   * Constructor for integration of toolbox
   */
  constructor(protected toolbox: ExtendedGluegunToolbox) {}

  /**
   * Check if --help-json flag is set; if so, print the command definition as JSON and return true.
   * Commands should call this early and return immediately when it returns true.
   *
   * @param definition - The command's help definition (name, description, options, etc.)
   * @returns true if --help-json was handled (caller should return), false otherwise
   */
  helpJson(definition: HelpJsonDefinition): boolean {
    const { parameters } = this.toolbox;
    if (!parameters.options['help-json'] && !parameters.options.helpJson) {
      return false;
    }
    console.debug(JSON.stringify(definition, null, 2));
    return true;
  }

  /**
   * Show a hint when running in non-interactive mode (no TTY)
   * Suggests using CLI parameters instead of interactive prompts.
   * Only shows once per session.
   *
   * Skipped when the caller already passed `--noConfirm` — they're
   * deliberately running headless and don't need a hint to repeat the
   * command, which would just be confusing noise (the friction-log
   * complaint that triggered this guard).
   *
   * @param usage - Example command with parameters, e.g. "lt fullstack init --name <name> --frontend <nuxt|angular> --noConfirm"
   */
  nonInteractiveHint(usage: string): void {
    if (this.hintShown || process.stdin.isTTY) {
      return;
    }
    const { parameters, print } = this.toolbox;
    const noConfirm = parameters?.options?.noConfirm;
    if (noConfirm === true || noConfirm === 'true') {
      this.hintShown = true;
      return;
    }
    this.hintShown = true;
    print.info(print.colors.yellow(`Hint: Non-interactive mode detected. Use parameters to skip prompts:`));
    print.info(print.colors.yellow(`  ${usage}`));
    print.info('');
  }

  /**
   * Strip and save JSON file
   */
  stripAndSaveJsonFile(path: string) {
    const content = this.stripJsonComments(readFileSync(path, 'utf8'));
    writeFileSync(path, content);
    return content;
  }

  /**
   * Strip JSON comments from a string
   * Inspired by https://github.com/sindresorhus/strip-json-comments/blob/main/index.js
   */
  stripJsonComments(jsonString, { trailingCommas = false, whitespace = true } = {}) {
    if (typeof jsonString !== 'string') {
      throw new TypeError(`Expected argument \`jsonString\` to be a \`string\`, got \`${typeof jsonString}\``);
    }

    const strip = whitespace ? stripWithWhitespace : stripWithoutWhitespace;

    let isInsideString = false;
    let isInsideComment: boolean | symbol = false;
    let offset = 0;
    let buffer = '';
    let result = '';
    let commaIndex = -1;

    for (let index = 0; index < jsonString.length; index++) {
      const currentCharacter = jsonString[index];
      const nextCharacter = jsonString[index + 1];

      if (!isInsideComment && currentCharacter === '"') {
        // Enter or exit string
        const escaped = isEscaped(jsonString, index);
        if (!escaped) {
          isInsideString = !isInsideString;
        }
      }

      if (isInsideString) {
        continue;
      }

      if (!isInsideComment && currentCharacter + nextCharacter === '//') {
        // Enter single-line comment
        buffer += jsonString.slice(offset, index);
        offset = index;
        isInsideComment = singleComment;
        index++;
      } else if (isInsideComment === singleComment && currentCharacter + nextCharacter === '\r\n') {
        // Exit single-line comment via \r\n
        index++;
        isInsideComment = false;
        buffer += strip(jsonString, offset, index);
        offset = index;
        continue;
      } else if (isInsideComment === singleComment && currentCharacter === '\n') {
        // Exit single-line comment via \n
        isInsideComment = false;
        buffer += strip(jsonString, offset, index);
        offset = index;
      } else if (!isInsideComment && currentCharacter + nextCharacter === '/*') {
        // Enter multiline comment
        buffer += jsonString.slice(offset, index);
        offset = index;
        isInsideComment = multiComment;
        index++;
        continue;
      } else if (isInsideComment === multiComment && currentCharacter + nextCharacter === '*/') {
        // Exit multiline comment
        index++;
        isInsideComment = false;
        buffer += strip(jsonString, offset, index + 1);
        offset = index + 1;
        continue;
      } else if (trailingCommas && !isInsideComment) {
        if (commaIndex !== -1) {
          if (currentCharacter === '}' || currentCharacter === ']') {
            // Strip trailing comma
            buffer += jsonString.slice(offset, index);
            result += strip(buffer, 0, 1) + buffer.slice(1);
            buffer = '';
            offset = index;
            commaIndex = -1;
          } else if (
            currentCharacter !== ' ' &&
            currentCharacter !== '\t' &&
            currentCharacter !== '\r' &&
            currentCharacter !== '\n'
          ) {
            // Hit non-whitespace following a comma; comma is not trailing
            buffer += jsonString.slice(offset, index);
            offset = index;
            commaIndex = -1;
          }
        } else if (currentCharacter === ',') {
          // Flush buffer prior to this point, and save new comma index
          result += buffer + jsonString.slice(offset, index);
          buffer = '';
          offset = index;
          commaIndex = index;
        }
      }
    }

    return result + buffer + (isInsideComment ? strip(jsonString.slice(offset)) : jsonString.slice(offset));
  }
}

/**
 * Extend toolbox
 */
export default (toolbox: ExtendedGluegunToolbox) => {
  toolbox.tools = new Tools(toolbox);
};
