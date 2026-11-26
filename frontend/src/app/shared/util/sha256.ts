export async function calculateBufferSha256(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer);

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function calculateSha256(blob: Blob): Promise<string> {
  const bytes = await blob.arrayBuffer();
  return calculateBufferSha256(bytes);
}
