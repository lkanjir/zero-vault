import express from 'express';
import { storageRouter } from './storage/storage.routes.js';

export const app = express();

app.use(express.json());
app.use('/uploads',storageRouter);