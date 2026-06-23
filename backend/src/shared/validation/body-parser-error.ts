export type BodyParserError = Error & {
  status?: number;
  type?: string;
};
