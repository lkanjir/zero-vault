export type FolderUploadFile = {
  file: File;
  folderPath: string;
  relativePath: string;
};

export type FolderUploadBatch = {
  rootName: string;
  folderPaths: readonly string[];
  files: readonly FolderUploadFile[];
};

export type ScannedDropPayload = {
  folders: readonly FolderUploadBatch[];
  looseFiles: readonly File[];
};

export type DropFileSystemEntry = {
  readonly isFile: boolean;
  readonly isDirectory: boolean;
  readonly name: string;
};

export type DropFileSystemFileEntry = DropFileSystemEntry & {
  readonly isFile: true;
  file(successCallback: (file: File) => void, errorCallback?: (error: DOMException) => void): void;
};

export type DropFileSystemDirectoryReader = {
  readEntries(
    successCallback: (entries: readonly DropFileSystemEntry[]) => void,
    errorCallback?: (error: DOMException) => void,
  ): void;
};

export type DropFileSystemDirectoryEntry = DropFileSystemEntry & {
  readonly isDirectory: true;
  createReader(): DropFileSystemDirectoryReader;
};

export type ExtractedDropItems = {
  readonly entries: readonly DropFileSystemEntry[];
  readonly fallbackFiles: readonly File[];
};

type MutableBatch = {
  rootName: string;
  folderPaths: Set<string>;
  files: FolderUploadFile[];
};

export function scanDirectoryInputFiles(files: readonly File[]): FolderUploadBatch[] {
  const batchesByRoot = new Map<string, MutableBatch>();

  for (const file of files) {
    const rawRelativePath = file.webkitRelativePath;
    if (!rawRelativePath) {
      continue;
    }

    const segments = rawRelativePath
      .split('/')
      .map((segment) => segment.trim())
      .filter((segment) => segment.length > 0);

    if (segments.length < 2) {
      continue;
    }

    const folderSegments = segments.slice(0, -1);
    const rootName = folderSegments[0];
    const folderPath = folderSegments.join('/');
    const fileName = segments[segments.length - 1];

    let batch = batchesByRoot.get(rootName);
    if (!batch) {
      batch = {
        rootName,
        folderPaths: new Set<string>(),
        files: [],
      };
      batchesByRoot.set(rootName, batch);
    }

    for (let depth = 1; depth <= folderSegments.length; depth += 1) {
      batch.folderPaths.add(folderSegments.slice(0, depth).join('/'));
    }

    batch.files.push({
      file,
      folderPath,
      relativePath: `${folderPath}/${fileName}`,
    });
  }

  return Array.from(batchesByRoot.values()).map((batch) => ({
    rootName: batch.rootName,
    folderPaths: sortFolderPathsByDepth(batch.folderPaths),
    files: batch.files,
  }));
}

export function extractDropItems(dataTransfer: DataTransfer | null): ExtractedDropItems {
  if (!dataTransfer) {
    return { entries: [], fallbackFiles: [] };
  }

  if (dataTransfer.items && dataTransfer.items.length > 0) {
    const entries: DropFileSystemEntry[] = [];
    const fallbackFiles: File[] = [];

    for (const item of Array.from(dataTransfer.items)) {
      if (item.kind !== 'file') {
        continue;
      }

      if (typeof item.webkitGetAsEntry === 'function') {
        const entry = item.webkitGetAsEntry() as DropFileSystemEntry | null;
        if (entry !== null) {
          entries.push(entry);
          continue;
        }
      }

      const file = item.getAsFile();
      if (file !== null) {
        fallbackFiles.push(file);
      }
    }

    return { entries, fallbackFiles };
  }

  return {
    entries: [],
    fallbackFiles: Array.from(dataTransfer.files ?? []),
  };
}

export async function scanDroppedEntries(
  extracted: ExtractedDropItems,
): Promise<ScannedDropPayload> {
  const looseFiles: File[] = [...extracted.fallbackFiles];
  const folders: FolderUploadBatch[] = [];

  for (const entry of extracted.entries) {
    if (isFileEntry(entry)) {
      const file = await readFileEntry(entry);
      looseFiles.push(file);
      continue;
    }

    if (isDirectoryEntry(entry)) {
      const rootName = entry.name.trim() || entry.name;
      const folderPaths = new Set<string>([rootName]);
      const files: FolderUploadFile[] = [];

      await walkDirectoryEntry(entry, rootName, folderPaths, files);

      folders.push({
        rootName,
        folderPaths: sortFolderPathsByDepth(folderPaths),
        files,
      });
    }
  }

  return { folders, looseFiles };
}

async function walkDirectoryEntry(
  directoryEntry: DropFileSystemDirectoryEntry,
  currentFolderPath: string,
  folderPaths: Set<string>,
  files: FolderUploadFile[],
): Promise<void> {
  const children = await readAllDirectoryEntries(directoryEntry);

  for (const child of children) {
    if (isFileEntry(child)) {
      const file = await readFileEntry(child);
      const fileName = file.name.trim() || child.name.trim() || file.name;
      files.push({
        file,
        folderPath: currentFolderPath,
        relativePath: `${currentFolderPath}/${fileName}`,
      });
      continue;
    }

    if (isDirectoryEntry(child)) {
      const childName = child.name.trim() || child.name;
      const childPath = `${currentFolderPath}/${childName}`;
      folderPaths.add(childPath);
      await walkDirectoryEntry(child, childPath, folderPaths, files);
    }
  }
}

async function readAllDirectoryEntries(
  directoryEntry: DropFileSystemDirectoryEntry,
): Promise<DropFileSystemEntry[]> {
  const reader = directoryEntry.createReader();
  const collected: DropFileSystemEntry[] = [];

  for (;;) {
    const batch = await readNextDirectoryBatch(reader);
    if (batch.length === 0) {
      break;
    }

    collected.push(...batch);
  }

  return collected;
}

function readNextDirectoryBatch(
  reader: DropFileSystemDirectoryReader,
): Promise<readonly DropFileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    reader.readEntries(
      (entries) => resolve(entries),
      (error) => reject(error),
    );
  });
}

function readFileEntry(fileEntry: DropFileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => {
    fileEntry.file(
      (file) => resolve(file),
      (error) => reject(error),
    );
  });
}

function isFileEntry(entry: DropFileSystemEntry): entry is DropFileSystemFileEntry {
  return entry.isFile;
}

function isDirectoryEntry(entry: DropFileSystemEntry): entry is DropFileSystemDirectoryEntry {
  return entry.isDirectory;
}

function sortFolderPathsByDepth(paths: Iterable<string>): string[] {
  return Array.from(paths).sort((left, right) => {
    const depthDiff = left.split('/').length - right.split('/').length;
    if (depthDiff !== 0) {
      return depthDiff;
    }

    return left.localeCompare(right);
  });
}
