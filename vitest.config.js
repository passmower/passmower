import { defineConfig } from 'vitest/config'

// Two backend projects:
//  - unit:        pure logic, no I/O, fast (this is what `npm test` runs)
//  - integration: HTTP-level flows needing real Redis + fake kube + mock IdP
// The frontend (Vue) has its own vitest config under frontend/.
export default defineConfig({
    test: {
        projects: [
            {
                test: {
                    name: 'unit',
                    include: ['test/unit/**/*.test.js'],
                    environment: 'node',
                    setupFiles: ['test/setup/env.js'],
                },
            },
            {
                test: {
                    name: 'integration',
                    include: ['test/integration/**/*.test.js'],
                    environment: 'node',
                    setupFiles: ['test/setup/env.js'],
                    // Integration tests share a Redis instance; keep them serial
                    // and give flows room to complete.
                    fileParallelism: false,
                    testTimeout: 20000,
                    hookTimeout: 20000,
                },
            },
        ],
    },
})
