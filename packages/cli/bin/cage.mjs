#!/usr/bin/env node
// Runs the TypeScript sources through tsx; no build step.
import { register } from 'tsx/esm/api';

register();
await import('../src/main.ts');
