export type SignedUrlParams = {
    objectKey: string,
    contentType: string,
    expiresInSeconds: number
}

export type CreateUploadParams = {
    fileName: string,
    contentType: string
}