import {defineConfig} from 'vitest/config';
import {fileURLToPath} from 'node:url';
export default defineConfig({
 resolve:{alias:[{find:/^@geo\/shared$/,replacement:fileURLToPath(new URL('./shared/index.jsx',import.meta.url))}]},
 test:{environment:'jsdom',include:['tests/**/*.test.jsx'],setupFiles:['./tests/ui-setup.js']}
});
