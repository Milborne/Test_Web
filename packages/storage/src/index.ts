import { CreateBucketCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";

const bucket = process.env.S3_BUCKET ?? "game2web";
export const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT ?? "http://localhost:9000",
  region: process.env.S3_REGION ?? "us-east-1",
  forcePathStyle: true,
  credentials: { accessKeyId: process.env.S3_ACCESS_KEY ?? "minioadmin", secretAccessKey: process.env.S3_SECRET_KEY ?? "minioadmin" }
});

export async function assertBucket() {
  await s3.send(new HeadBucketCommand({ Bucket: bucket }));
}

export async function ensureBucket() {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch {
    try {
      await s3.send(new CreateBucketCommand({ Bucket: bucket }));
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("BucketAlready")) throw error;
    }
  }
}

export async function putObject(key: string, body: Buffer | Readable, contentType: string) {
  await ensureBucket();
  const buffer = Buffer.isBuffer(body) ? body : await streamToBuffer(body);
  const checksum = createHash("sha256").update(buffer).digest("hex");
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: buffer, ContentType: contentType, Metadata: { sha256: checksum } }));
  return { key, size: buffer.length, checksum };
}

export async function getObject(key: string) {
  const result = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!result.Body) throw new Error(`Storage object is empty: ${key}`);
  return { body: await streamToBuffer(result.Body as Readable), contentType: result.ContentType ?? "application/octet-stream" };
}

async function streamToBuffer(stream: Readable) {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}
