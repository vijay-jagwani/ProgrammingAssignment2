// Copies the pure game engine into the edge function folder so
// `supabase functions deploy` bundles it without reaching outside
// its directory. Run after changing anything in shared/src.
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'shared', 'src');
const dest = join(root, 'supabase', 'functions', 'apply-action', 'engine');

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });
writeFileSync(
  join(dest, 'GENERATED.md'),
  'Generated copy of shared/src — do not edit here. Run `node scripts/sync-shared.mjs`.\n',
);
console.log('Synced shared/src -> supabase/functions/apply-action/engine');
