import { readFile } from "node:fs/promises";
import { join } from "node:path";

const names = [
  "coston2-shadowrouter-v2.json",
  "coston2-mint-deposit-v2.json",
  "coston2-fcc-extension.json",
  "coston2-fcc-evaluation-v2.json",
  "coston2-pangolin-adapter-v2.json",
  "coston2-pangolin-execution-v2.json",
];

export default async function handler(_request, response) {
  const evidence = {};
  for (const name of names) {
    try {
      evidence[name.replace(/\.json$/, "")] = JSON.parse(
        await readFile(join(process.cwd(), "deployments", name), "utf8"),
      );
    } catch {
      // A missing optional record does not break the evidence index.
    }
  }
  response.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
  response.status(200).json(evidence);
}
