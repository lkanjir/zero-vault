export type User = {
  id: number;
  publicId: string;
  issuer: string;
  subject: string;
  username: string | null;
  email: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
};
