export type CursorPage<T> = {
  items: T[];
  page: {
    limit: number;
    nextCursor: string | null;
    hasMore: boolean;
  };
};
