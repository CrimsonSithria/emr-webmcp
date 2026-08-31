import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      specifier.endsWith('.js') &&
      context.parentURL !== undefined &&
      !specifier.startsWith('node:')
    ) {
      const parentDir = path.dirname(fileURLToPath(context.parentURL));
      const jsPath = path.resolve(parentDir, specifier);
      const tsPath = path.resolve(parentDir, specifier.replace(/\.js$/u, '.ts'));
      if (!existsSync(jsPath) && existsSync(tsPath)) {
        return nextResolve(specifier.replace(/\.js$/u, '.ts'), context);
      }
    }
    return nextResolve(specifier, context);
  },
});
