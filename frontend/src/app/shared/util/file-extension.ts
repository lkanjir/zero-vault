export function fileExtension(fileName: string): string | null {
  const separatorIndex = fileName.lastIndexOf('.');

  if (separatorIndex <= 0 || separatorIndex === fileName.length - 1) {
    return null;
  }

  return fileName.slice(separatorIndex + 1).toLowerCase();
}
