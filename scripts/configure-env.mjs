import fs from 'node:fs';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
for (const project of fs.readdirSync(root).filter(name => /^0[1-5]-/.test(name))) {
 const target = resolve(root, project, '.env');
 const exists = fs.existsSync(target);
 let source = fs.readFileSync(exists ? target : `${target}.example`, 'utf8');
 // Never rotate established secrets. Add a new app password to older configs
 // and replace only explicit template placeholders.
 source = source.replace('replace-with-a-random-128-character-value', randomBytes(64).toString('hex'))
  .replace('replace-with-random-admin-password', randomBytes(32).toString('hex'))
  .replace('replace-with-random-app-password', randomBytes(32).toString('hex'));
 if (!/^APP_DATABASE_PASSWORD=/m.test(source)) source += `\nAPP_DATABASE_PASSWORD=${randomBytes(32).toString('hex')}\n`;
 fs.writeFileSync(target, source, {mode: 0o600});
 console.log(`${project}: ${exists ? 'preserved existing secrets and completed environment' : 'generated database and session secrets'}`);
}
