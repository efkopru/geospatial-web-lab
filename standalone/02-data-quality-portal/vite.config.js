import {fileURLToPath} from 'node:url';
import {standaloneConfig} from '../vite.shared.js';
export default standaloneConfig(fileURLToPath(new URL('.',import.meta.url)),{port:5272,cesium:false});
