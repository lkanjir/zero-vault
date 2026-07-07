export type User = {
  id: number;
  publicId: string;
  issuer: string;
  subject: string;
  username: string | null;
  createdAt: Date;
  updatedAt: Date;
};
