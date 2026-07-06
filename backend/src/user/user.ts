export type User = {
  id: number;
  issuer: string;
  subject: string;
  username: string | null;
  createdAt: Date;
  updatedAt: Date;
};
