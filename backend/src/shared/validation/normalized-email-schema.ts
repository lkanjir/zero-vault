import * as z from 'zod';

export const normalizedEmailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());
