// Packs the demo actor keys in scripts/keys/ into one base64 string for the
// DEMO_ACTOR_KEYS environment variable, so a deploy built from GitHub (where
// the gitignored key files don't exist) can still wrap and unwrap keys.
//
//   node scripts/exportActorKeys.js            -> writes scripts/keys/DEMO_ACTOR_KEYS.txt
//
// Paste that file's contents into Vercel as DEMO_ACTOR_KEYS. These are demo
// keys for synthetic data only; real deployments should use a KMS.

const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, 'keys');
const files = fs.readdirSync(dir).filter((f) => /^actor-0[1-4]-.*\.(pem|key)$/.test(f));
if (!files.length) {
  console.error('No actor keys found. Run genActorKeys.js and genActorX25519Keys.js first.');
  process.exit(1);
}

const bundle = {};
files.forEach((f) => { bundle[f] = fs.readFileSync(path.join(dir, f), 'utf8'); });
const value = Buffer.from(JSON.stringify(bundle)).toString('base64');

const out = path.join(dir, 'DEMO_ACTOR_KEYS.txt');
fs.writeFileSync(out, value);
console.log(`Packed ${files.length} key files (${value.length} chars) into ${out}`);
