import * as z from 'zod';

export const createFolderDownloadParamsSchema = z.object({ folderId: z.uuid() });
