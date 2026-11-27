import z from 'zod';
import { entryNameSchema } from '../entry/validation-schemas.js';

export const MAX_FOLDER_TREE_DEPTH = 64;
export const MAX_FOLDER_TREE_PATHS = 1000;
export const MAX_FOLDER_TREE_NODES = 2000;

export const createFolderBodySchema = z.object({
  parentId: z
    .uuid()
    .nullable()
    .optional()
    .transform((val) => val ?? null),
  name: entryNameSchema,
});

export type CreateFolderRequestBody = z.infer<typeof createFolderBodySchema>;

export const ensureFolderTreeBodySchema = z
  .object({
    parentId: z
      .uuid()
      .nullable()
      .optional()
      .transform((val) => val ?? null),
    paths: z
      .array(z.string().min(1, { error: 'Putanja direktorija ne smije biti prazna.' }))
      .min(1, { error: 'Potrebno je navesti barem jednu putanju direktorija.' })
      .max(MAX_FOLDER_TREE_PATHS, {
        error: `Moguće je poslati najviše ${MAX_FOLDER_TREE_PATHS} putanja direktorija odjednom.`,
      }),
  })
  .superRefine((body, ctx) => {
    const uniqueCanonicalNodes = new Set<string>();

    for (let index = 0; index < body.paths.length; index += 1) {
      const rawPath = body.paths[index]!;

      if (rawPath.startsWith('/') || rawPath.endsWith('/')) {
        ctx.addIssue({
          code: 'custom',
          path: ['paths', index],
          message: 'Putanja direktorija ne smije počinjati niti završavati znakom /.',
        });
        continue;
      }

      const rawSegments = rawPath.split('/');
      if (rawSegments.length > MAX_FOLDER_TREE_DEPTH) {
        ctx.addIssue({
          code: 'custom',
          path: ['paths', index],
          message: `Dubina stabla direktorija ne smije prelaziti ${MAX_FOLDER_TREE_DEPTH} razina.`,
        });
        continue;
      }

      const canonicalSegments: string[] = [];
      let pathInvalid = false;

      for (const rawSegment of rawSegments) {
        const parsedSegment = entryNameSchema.safeParse(rawSegment);
        if (!parsedSegment.success) {
          ctx.addIssue({
            code: 'custom',
            path: ['paths', index],
            message:
              parsedSegment.error.issues[0]?.message ??
              'Naziv direktorija u putanji nije ispravan.',
          });
          pathInvalid = true;
          break;
        }

        canonicalSegments.push(parsedSegment.data.toLowerCase());
      }

      if (pathInvalid) {
        continue;
      }

      for (let depth = 1; depth <= canonicalSegments.length; depth += 1) {
        uniqueCanonicalNodes.add(canonicalSegments.slice(0, depth).join('/'));
      }
    }

    if (uniqueCanonicalNodes.size > MAX_FOLDER_TREE_NODES) {
      ctx.addIssue({
        code: 'custom',
        path: ['paths'],
        message: `Stablo direktorija prelazi najveći dopušteni broj direktorija (${MAX_FOLDER_TREE_NODES}).`,
      });
    }
  })
  .transform((body) => {
    const uniquePaths: string[] = [];
    const seen = new Set<string>();

    for (const rawPath of body.paths) {
      const normalizedPath = rawPath
        .split('/')
        .map((segment) => segment.trim())
        .join('/');

      if (!seen.has(normalizedPath)) {
        seen.add(normalizedPath);
        uniquePaths.push(normalizedPath);
      }
    }

    return {
      parentId: body.parentId,
      paths: uniquePaths,
    };
  });

export type EnsureFolderTreeRequestBody = z.output<typeof ensureFolderTreeBodySchema>;
