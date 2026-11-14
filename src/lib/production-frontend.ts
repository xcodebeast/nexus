import tailwind from "bun-plugin-tailwind";
import { basename } from "node:path";

/** Bundle once in memory with separate lazy chunks; no generated files or extra server. */
export async function buildProductionFrontend(): Promise<
  Record<string, Response>
> {
  const result = await Bun.build({
    entrypoints: [new URL("../index.html", import.meta.url).pathname],
    plugins: [tailwind],
    target: "browser",
    minify: true,
    splitting: true,
    publicPath: "/",
    env: "BUN_PUBLIC_*",
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
  });
  if (!result.success)
    throw new AggregateError(result.logs, "Frontend build failed");

  const routes: Record<string, Response> = {};
  for (const artifact of result.outputs) {
    const isHtml = artifact.path.endsWith(".html");
    const response = new Response(artifact, {
      headers: {
        "Content-Type": artifact.type,
        "Cache-Control": isHtml
          ? "no-cache, max-age=0, must-revalidate"
          : "public, max-age=31536000, immutable",
      },
    });
    routes[`/${basename(artifact.path)}`] = response;
    if (isHtml) routes["/*"] = response.clone();
  }
  return routes;
}
