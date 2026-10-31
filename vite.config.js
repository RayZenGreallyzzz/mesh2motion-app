import {defineConfig} from 'vite';
import {resolve} from 'node:path';
import fs from 'node:fs';
export default defineConfig({
 root:'src',base:'./',publicDir:false,
 define:{'PROCESS_ENV.WORKERS_CI_COMMIT_SHA':JSON.stringify('rig80'),'PROCESS_ENV.WORKERS_CI_BRANCH':JSON.stringify('combined-regression')},
 plugins:[{name:'preserve-legacy-styles',closeBundle(){const p=resolve('built/create.html');if(fs.existsSync(p))fs.writeFileSync(p,fs.readFileSync(p,'utf8').replace(/<!--LEGACY_STYLE:([^>]+)-->/g,'<link rel="stylesheet" href="$1">'))}}],
 build:{outDir:'../built',emptyOutDir:true,sourcemap:true,rollupOptions:{input:{my_rigs:resolve('src/my-rigs/index.html'),create:resolve('src/create.html')}}},
 server:{host:'127.0.0.1'}
});
