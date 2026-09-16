// Regression check against the actual SSR bundle, with no real AWS credentials
// or external network access. Run after building, or via deno task test:startup.
const root = new URL("../", import.meta.url);
const bundle = new URL("_fresh/server.js", root);
const temporary = await Deno.makeTempDir();
const requests: string[] = [];
const server = Deno.serve(
  { hostname: "127.0.0.1", port: 0, onListen() {} },
  (req) => {
    const url = new URL(req.url);
    if (url.pathname === "/credentials") {
      requests.push("credentials");
      return Response.json({
        AccessKeyId: "synthetic-access-key",
        SecretAccessKey: "synthetic-secret-key",
        Token: "synthetic-session-token",
        Expiration: new Date(Date.now() + 3_600_000).toISOString(),
      });
    }
    if (!req.headers.get("authorization")?.includes("synthetic-access-key")) {
      return new Response(null, { status: 403 });
    }
    if (req.method === "HEAD") {
      requests.push("HeadBucket");
      return new Response(null);
    }
    if (req.method === "GET" && url.searchParams.has("publicAccessBlock")) {
      requests.push("GetPublicAccessBlock");
      return new Response(
        `<PublicAccessBlockConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
        <BlockPublicAcls>true</BlockPublicAcls>
        <IgnorePublicAcls>true</IgnorePublicAcls>
        <BlockPublicPolicy>true</BlockPublicPolicy>
        <RestrictPublicBuckets>true</RestrictPublicBuckets>
      </PublicAccessBlockConfiguration>`,
        { headers: { "Content-Type": "application/xml" } },
      );
    }
    return new Response(null, { status: 404 });
  },
);
const endpoint = `http://127.0.0.1:${server.addr.port}`;

async function check(
  name: string,
  env: Record<string, string>,
  success: boolean,
  marker: string,
) {
  const child = new Deno.Command(Deno.execPath(), {
    cwd: root,
    args: [
      // A data: entry point does not auto-discover the project's import map.
      "run",
      "--config",
      new URL("deno.json", root).pathname,
      "--cached-only",
      "--no-prompt",
      "--allow-read",
      "--allow-env",
      "--allow-sys",
      "--allow-net=127.0.0.1",
      `data:application/javascript,${
        encodeURIComponent(`await import(${JSON.stringify(bundle.href)});`)
      }`,
    ],
    clearEnv: true,
    env: {
      AWS_CONFIG_FILE: `${temporary}/missing-config`,
      AWS_SHARED_CREDENTIALS_FILE: `${temporary}/missing-credentials`,
      AWS_EC2_METADATA_DISABLED: "true",
      S3_REGION: "eu-central-1",
      ...env,
    },
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const timer = setTimeout(() => child.kill("SIGKILL"), 10_000);
  try {
    const result = await child.output();
    const output = new TextDecoder().decode(result.stdout) +
      new TextDecoder().decode(result.stderr);
    if (result.success !== success || !output.includes(marker)) {
      throw new Error(`${name} failed:\n${output}`);
    }
    console.log(`PASS: ${name}`);
  } finally {
    clearTimeout(timer);
  }
}

try {
  await check(
    "local storage startup",
    {},
    true,
    "Application startup: configured",
  );
  await check(
    "missing credentials fail explicitly without an import deadlock",
    { S3_BUCKET: "test-bucket" },
    false,
    "S3 document storage configuration failed at credentials:",
  );
  await check(
    "remote credentials and private S3 startup",
    {
      S3_BUCKET: "test-bucket",
      AWS_CONTAINER_CREDENTIALS_FULL_URI: `${endpoint}/credentials`,
      AWS_ENDPOINT_URL_S3: endpoint,
    },
    true,
    "Application startup: configured",
  );
  if (requests.join(",") !== "credentials,HeadBucket,GetPublicAccessBlock") {
    throw new Error(`Unexpected AWS requests: ${requests.join(",")}`);
  }
} finally {
  await server.shutdown();
  await Deno.remove(temporary, { recursive: true });
}
