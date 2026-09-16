import {
  GetObjectCommand,
  GetPublicAccessBlockCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  contentDisposition,
  type DocumentStorage,
  type DownloadInput,
  type DownloadTarget,
  type StoredDocument,
  validateDocumentKey,
} from "./document_storage.ts";

export class DocumentStorageConfigurationError extends Error {}

export class S3DocumentStorage implements DocumentStorage {
  readonly provider = "s3";

  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
    private readonly sign: typeof getSignedUrl = getSignedUrl,
  ) {}

  async validateConfiguration(): Promise<void> {
    try {
      await this.client.config.credentials();
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      const { PublicAccessBlockConfiguration: block } = await this.client.send(
        new GetPublicAccessBlockCommand({ Bucket: this.bucket }),
      );
      if (
        !block?.BlockPublicAcls || !block.IgnorePublicAcls ||
        !block.BlockPublicPolicy || !block.RestrictPublicBuckets
      ) {
        throw new Error("Bucket must block all public access");
      }
    } catch {
      // Do not expose SDK errors that could contain credentials or request URLs.
      throw new DocumentStorageConfigurationError(
        "S3 document storage configuration failed: verify credentials, region, bucket access and all four bucket Block Public Access settings.",
      );
    }
  }

  async put(input: {
    key: string;
    data: Uint8Array;
    contentType: string;
  }): Promise<StoredDocument> {
    validateDocumentKey(input.key);
    const result = await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: input.key,
        Body: input.data,
        ContentType: input.contentType,
        IfNoneMatch: "*",
      }),
    );
    return {
      storageProvider: this.provider,
      storageKey: input.key,
      etag: result.ETag ?? null,
    };
  }

  async getDownloadTarget(input: DownloadInput): Promise<DownloadTarget> {
    validateDocumentKey(input.key);
    const url = await this.sign(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: input.key,
        ResponseContentType: "application/pdf",
        ResponseCacheControl: "private, no-store",
        ResponseContentDisposition: contentDisposition(input),
      }),
      { expiresIn: 300 },
    );
    return { kind: "redirect", url };
  }
}
