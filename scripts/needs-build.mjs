// Used by start.bat: exits 0 when the production build is missing or older than the source, 1 when it is current.
import fs from "node:fs";
import path from "node:path";

let built;
try {
  built = fs.statSync(".next/BUILD_ID").mtimeMs;
} catch {
  process.exit(0);
}

const roots = ["src", "public", "skills", "package.json", "pnpm-lock.yaml", "next.config.ts", "tsconfig.json"];
function newer(p) {
  let st;
  try {
    st = fs.statSync(p);
  } catch {
    return false;
  }
  if (!st.isDirectory()) return st.mtimeMs > built;
  return fs.readdirSync(p).some((f) => newer(path.join(p, f)));
}
process.exit(roots.some(newer) ? 0 : 1);
