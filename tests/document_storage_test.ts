import {
  GetObjectCommand,
  GetPublicAccessBlockCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { createDocumentStorage } from "@/services/storage/storage_factory.ts";
import { LocalDocumentStorage } from "@/services/storage/local_document_storage.ts";
import {
  DocumentStorageConfigurationError,
  S3DocumentStorage,
} from "@/services/storage/s3_document_storage.ts";

function assert(value: unknown, message = "Assertion failed"): asserts value {
  if (!value) throw new Error(message);
}

async function rejects(
  action: () => Promise<unknown>,
  errorType: new (...args: never[]) => Error = Error,
) {
  try {
    await action();
  } catch (error) {
    assert(error instanceof errorType);
    return error;
  }
  throw new Error("Expected rejection");
}

const privateBlock = {
  BlockPublicAcls: true,
  IgnorePublicAcls: true,
  BlockPublicPolicy: true,
  RestrictPublicBuckets: true,
};

function mockClient(
  options: {
    invalidCredentials?: boolean;
    unavailable?: boolean;
    publicBucket?: boolean;
    publicAccessBlockDenied?: boolean;
  } = {},
) {
  const calls: unknown[] = [];
  let credentialsResolved = false;
  const client = {
    config: {
      credentials: () => {
        credentialsResolved = true;
        return options.invalidCredentials
          ? Promise.reject(new Error("secret must not escape"))
          : Promise.resolve({
            accessKeyId: "temporary",
            secretAccessKey: "temporary",
            sessionToken: "temporary",
          });
      },
    },
    send: (command: unknown) => {
      calls.push(command);
      if (options.unavailable) return Promise.reject(new Error("Unavailable"));
      if (
        options.publicAccessBlockDenied &&
        command instanceof GetPublicAccessBlockCommand
      ) {
        return Promise.reject(
          Object.assign(new Error("secret must not escape"), {
            $metadata: { httpStatusCode: 403 },
          }),
        );
      }
      return Promise.resolve(
        command instanceof GetPublicAccessBlockCommand
          ? {
            PublicAccessBlockConfiguration: options.publicBucket
              ? {}
              : privateBlock,
          }
          : { ETag: '"test-etag"' },
      );
    },
    destroy() {},
  } as unknown as S3Client;
  return { client, calls, resolved: () => credentialsResolved };
}

Deno.test("document factory uses local default/path without requesting credentials", async () => {
  const storage = await createDocumentStorage(() => undefined, () => {
    throw new Error("AWS must not be used");
  });
  assert(storage instanceof LocalDocumentStorage);
  assert(storage.root.endsWith("/data/documents"));
  const custom = await createDocumentStorage((name) =>
    name === "LOCAL_STORAGE_PATH" ? "/tmp/custom-documents" : undefined
  );
  assert(
    custom instanceof LocalDocumentStorage &&
      custom.root === "/tmp/custom-documents",
  );
});

Deno.test("document factory resolves provider credentials without static AWS keys and prefers S3_REGION", async () => {
  const mock = mockClient();
  const env: Record<string, string> = {
    S3_BUCKET: "private-bucket",
    S3_REGION: "eu-central-1",
    AWS_REGION: "us-east-1",
  };
  const storage = await createDocumentStorage((name) => env[name], (region) => {
    assert(region === "eu-central-1");
    return mock.client;
  });
  assert(storage instanceof S3DocumentStorage && mock.resolved());
  assert(mock.calls[0] instanceof HeadBucketCommand);
  assert(mock.calls[1] instanceof GetPublicAccessBlockCommand);
  delete env.S3_REGION;
  await createDocumentStorage((name) => env[name], (region) => {
    assert(region === "us-east-1");
    return mock.client;
  });
});

for (
  const failure of [
    "invalidCredentials",
    "unavailable",
    "publicBucket",
    "publicAccessBlockDenied",
  ] as const
) {
  Deno.test(`document factory rejects ${failure} without local fallback`, async () => {
    const mock = mockClient({ [failure]: true });
    const error = await rejects(
      () =>
        createDocumentStorage(
          (name) =>
            ({ S3_BUCKET: "private-bucket", AWS_REGION: "eu-central-1" })[name],
          () => mock.client,
        ),
      DocumentStorageConfigurationError,
    );
    const expectedStage = {
      invalidCredentials: "credentials",
      unavailable: "HeadBucket",
      publicBucket: "BlockPublicAccess settings",
      publicAccessBlockDenied: "GetPublicAccessBlock (HTTP 403)",
    }[failure];
    assert(error.message.includes(`failed at ${expectedStage}:`));
    assert(!error.message.includes("secret must not escape"));
    assert(error.cause === undefined);
  });
}

Deno.test("document factory rejects missing S3 region", async () => {
  await rejects(
    () =>
      createDocumentStorage((name) =>
        name === "S3_BUCKET" ? "bucket" : undefined
      ),
    DocumentStorageConfigurationError,
  );
});

Deno.test("S3 upload is private, immutable and carries PDF metadata", async () => {
  const mock = mockClient();
  const data = new TextEncoder().encode("%PDF-1.7");
  const storage = new S3DocumentStorage(mock.client, "private-bucket");
  const stored = await storage.put({
    key: "invoices/org/invoice/uuid.pdf",
    data,
    contentType: "application/pdf",
  });
  const command = mock.calls[0];
  assert(command instanceof PutObjectCommand);
  assert(
    command.input.ContentType === "application/pdf" &&
      command.input.Body === data,
  );
  assert(
    command.input.Bucket === "private-bucket" &&
      command.input.Key === stored.storageKey,
  );
  assert(command.input.ACL === undefined && command.input.IfNoneMatch === "*");
  assert(stored.storageProvider === "s3" && stored.etag === '"test-etag"');
});

Deno.test("S3 signing uses 300 seconds, PDF headers and a sanitized filename", async () => {
  const mock = mockClient();
  let signed = false;
  const storage = new S3DocumentStorage(
    mock.client,
    "private-bucket",
    (_client, command, options) => {
      assert(command instanceof GetObjectCommand);
      assert(command.input.Key === "invoices/org/invoice/uuid.pdf");
      assert(command.input.ResponseContentType === "application/pdf");
      assert(
        command.input.ResponseContentDisposition ===
          'inline; filename="faktura-2026--X-Evil--.pdf"',
      );
      assert(options?.expiresIn === 300);
      signed = true;
      return Promise.resolve("https://example.test/signed");
    },
  );
  const target = await storage.getDownloadTarget({
    key: "invoices/org/invoice/uuid.pdf",
    filename: 'faktura-2026\r\nX-Evil:".pdf',
  });
  assert(signed && target.kind === "redirect");
});

Deno.test("local document storage round-trips, refuses overwrites and rejects traversal", async () => {
  const root = await Deno.makeTempDir();
  try {
    const storage = new LocalDocumentStorage(root);
    const input = {
      key: "invoices/org/invoice/uuid.pdf",
      data: new Uint8Array([1, 2, 3]),
      contentType: "application/pdf",
    };
    const stored = await storage.put(input);
    assert(stored.storageProvider === "local" && stored.etag === null);
    await rejects(() => storage.put({ ...input, data: new Uint8Array([4]) }));
    const target = await storage.getDownloadTarget({
      key: input.key,
      filename: "faktura-2026-0042.pdf",
      disposition: "attachment",
    });
    assert(target.kind === "local" && target.data.join() === "1,2,3");
    assert(
      target.contentDisposition ===
        'attachment; filename="faktura-2026-0042.pdf"',
    );
    for (
      const key of [
        "../outside.pdf",
        "/outside.pdf",
        "invoices/../../outside.pdf",
      ]
    ) {
      await rejects(() => storage.put({ ...input, key }));
      await rejects(() =>
        storage.getDownloadTarget({ key, filename: "test.pdf" })
      );
    }
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
