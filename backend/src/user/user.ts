export type User = {
  id: number;
  publicId: string;
  issuer: string;
  subject: string;
  email: string;
  firstName: string;
  lastName: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
};
