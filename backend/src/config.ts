import dotenv from 'dotenv';
import * as z from "zod";

dotenv.config({});

const envSchema = z.object({
    PORT: z.coerce.number().int().positive().max(65_535).default(3000),
    S3_ENDPOINT: z.url(),
    S3_REGION: z.string().min(1),
    S3_BUCKET: z.string().min(1),
    S3_ACCESS_KEY: z.string().min(1),
    S3_SECRET_KEY: z.string().min(1)
})

const result = envSchema.safeParse(process.env);

if (!result.success) {
    console.error(z.prettifyError(result.error))
    throw new Error('Invalid environment configuration')
}

const env = result.data;

export const config = {
    port: env.PORT,
    s3: {
        endpoint: env.S3_ENDPOINT,
        region: env.S3_REGION,
        bucket: env.S3_BUCKET,
        accessKey: env.S3_ACCESS_KEY,
        secretKey: env.S3_SECRET_KEY
    }
} as const;


