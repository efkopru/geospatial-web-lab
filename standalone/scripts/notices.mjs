import { cp, mkdir, readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));

export async function copyNotices(destination) {
  await mkdir(destination, { recursive: true });
  await cp(join(root, 'THIRD_PARTY_NOTICES.md'), join(destination, 'THIRD_PARTY_NOTICES.md'));
  await cp(join(root, 'licenses'), join(destination, 'licenses'), { recursive: true, force: true });
}

export function noticesPlugin() {
  let output;
  return {
    name: 'standalone-third-party-notices',
    configResolved(config) { if (config.command === 'build') output = resolve(config.root, config.build.outDir); },
    async configureServer(server) {
      const licenseNames = new Set(await readdir(join(root, 'licenses')));
      server.middlewares.use(async (request, response, next) => {
        const pathname = new URL(request.url, 'http://standalone.invalid').pathname;
        let source;
        if (pathname === '/THIRD_PARTY_NOTICES.md') source = join(root, 'THIRD_PARTY_NOTICES.md');
        else if (pathname.startsWith('/licenses/') && licenseNames.has(pathname.slice('/licenses/'.length))) source = join(root, 'licenses', pathname.slice('/licenses/'.length));
        if (!source) return next();
        try {
          const content = await readFile(source);
          response.statusCode = 200;
          response.setHeader('Content-Type', source.endsWith('.json') ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8');
          response.end(content);
        } catch (error) { next(error); }
      });
    },
    async closeBundle() { if (output) await copyNotices(output); }
  };
}
