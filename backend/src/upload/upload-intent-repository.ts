import type { UploadIntent } from './upload-intent.js';

export class UploadIntentRepository {
  private readonly intents = new Map<string, UploadIntent>();

  findById(id: string): UploadIntent | null {
    return this.intents.get(id) ?? null;
  }

  save(intent: UploadIntent): void {
    this.intents.set(intent.id, intent);
  }

  update(intent: UploadIntent): void {
    this.intents.set(intent.id, intent);
  }

  deleteById(id: string): boolean {
    return this.intents.delete(id);
  }
}
