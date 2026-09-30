import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'./tests/browser',timeout:60000,expect:{timeout:15000},workers:1,reporter:[['list'],['html',{open:'never'}]],use:{browserName:'chromium',headless:true,viewport:{width:1440,height:1000},trace:'retain-on-failure',screenshot:'only-on-failure'}});
