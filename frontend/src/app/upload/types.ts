export type UploadUrlRequest = {
    fileName: string,
    contentType: string
}

export type UploadUrlResponse = {
    objectKey: string,
    uploadUrl: string,
    expiresInSeconds: number
}