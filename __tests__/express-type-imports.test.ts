import { rewriteExpressImportsToTypeOnly } from '../src/lib/express-type-imports';

describe('rewriteExpressImportsToTypeOnly', () => {
  it('turns a type-only express import into `import type`', () => {
    const input = "import { NextFunction, Request, Response } from 'express';\n";
    expect(rewriteExpressImportsToTypeOnly(input)).toBe(
      "import type { NextFunction, Request, Response } from 'express';\n",
    );
  });

  // nest-server 11.42.4 started importing the body parsers as values
  // (core-body-parser.initializer.ts). Turning them into `import type` broke the
  // build of every generated vendor-mode project with TS1361.
  it('keeps runtime exports as value imports', () => {
    const input = "import { json, urlencoded } from 'express';\n";
    expect(rewriteExpressImportsToTypeOnly(input)).toBe(input);
  });

  it('marks only the type names in a mixed import', () => {
    const input = "import { json, Request, Router, urlencoded } from 'express';\n";
    expect(rewriteExpressImportsToTypeOnly(input)).toBe(
      "import { json, type Request, Router, urlencoded } from 'express';\n",
    );
  });

  it('decides on the imported name, not the alias', () => {
    const input = "import { json as jsonParser, Request as ExpressRequest } from 'express';\n";
    expect(rewriteExpressImportsToTypeOnly(input)).toBe(
      "import { json as jsonParser, type Request as ExpressRequest } from 'express';\n",
    );
  });

  it('normalises names that already carry an inline `type` modifier', () => {
    const input = "import { type Request, type Response } from 'express';\n";
    expect(rewriteExpressImportsToTypeOnly(input)).toBe("import type { Request, Response } from 'express';\n");
  });

  it('leaves an existing `import type` and other modules untouched', () => {
    const input = [
      "import type { NextFunction, Request } from 'express';",
      "import { Injectable } from '@nestjs/common';",
      '',
    ].join('\n');
    expect(rewriteExpressImportsToTypeOnly(input)).toBe(input);
  });

  it('handles double quotes and a missing semicolon', () => {
    const input = 'import { Request } from "express"\n';
    expect(rewriteExpressImportsToTypeOnly(input)).toBe("import type { Request } from 'express';\n");
  });
});
