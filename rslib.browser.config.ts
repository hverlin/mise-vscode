import { defineConfig } from '@rslib/core';
import { pluginNodePolyfill } from '@rsbuild/plugin-node-polyfill';

export default defineConfig({
    lib: [
        {
            syntax: ['es2021'],
            source: {
                entry: {
                    browser: './src/browser.ts',
                },
            },
            plugins: [pluginNodePolyfill()],
            format: 'cjs',
            output: {
                target: 'web',
                externals: {
                    vscode: 'commonjs vscode'
                },
                distPath: {
                    root: './dist/browser',
                },
                sourceMap: process.env.SOURCEMAP === 'true',
            },
            tools: {
                rspack: {
                    output: {
                        devtoolModuleFilenameTemplate: '[absolute-resource-path]',
                    },
                },
            },
        },
    ],
});