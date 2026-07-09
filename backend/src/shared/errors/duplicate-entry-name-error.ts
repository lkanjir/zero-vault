import { AppError } from './app-error.js';

export class DuplicateEntryNameError extends AppError {
  constructor() {
    super('Entry with this name already exists in this folder', 409, 'duplicate_entry_name');
  }
}
