export type CursorPage<T> = {
  items: T[];
  page: {
    limit: number;
    nextCursor: string | null;
    hasMore: boolean;
  };
};

export type CursorPageQuery = {
  cursor: string | null;
  limit: number;
};
