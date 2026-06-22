import { randomUUID } from "node:crypto";
import type { CreateUploadParams } from "./ObjectStorage.js";
import type { S3ObjectStorage } from "./S3ObjectStorage.js";

export class StorageService{
    constructor(private readonly storage: S3ObjectStorage){}

    async createUpload(params: CreateUploadParams) : Promise<string> {
        const objectKey = `uploads/${randomUUID()}-${params.fileName}`

        const uploadUrl = await this.storage.createPresignedUrl({
            objectKey: objectKey,
            contentType: params.contentType,
            expiresInSeconds: 60
        });

        return uploadUrl;
    }
}