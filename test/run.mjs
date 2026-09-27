// Runs every module's selftest. Exit 1 on the first failure.
const mods = ['../bin/lib/paths.mjs', '../bin/lib/agents.mjs'];
let n = 0;
const ok = (label, cond, extra = '') => {
  if (!cond) { console.error(`  FAIL  ${label}  ${extra}`); process.exit(1); }
  n++; console.log(`  PASS  ${label}`);
};
for (const m of mods) { console.log(`\n${m}`); await (await import(m)).selftest(ok); }
console.log(`\n${n} passed`);
