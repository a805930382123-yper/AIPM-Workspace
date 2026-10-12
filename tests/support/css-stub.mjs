// Test-only loader: product components import CSS for Vite, which Node cannot load.
// Registered with `node --import ./tests/support/css-stub.mjs` for the DOM interaction tests.
import { register } from 'node:module';

register('./css-stub-hooks.mjs', import.meta.url);
