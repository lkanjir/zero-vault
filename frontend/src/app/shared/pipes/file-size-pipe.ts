import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'fileSize',
})
export class FileSizePipe implements PipeTransform {
  private readonly units = ['B', 'KB', 'MB', 'GB'];

  transform(value: number): string {
    if (!Number.isFinite(value) || value < 0) return '-';
    let unitIndex = 0;

    while (value >= 1024 && unitIndex < this.units.length - 1) {
      value /= 1024;
      unitIndex++;
    }

    const formattedValue = new Intl.NumberFormat('hr-HR', {
      maximumFractionDigits: value < 10 && unitIndex > 0 ? 1 : 0,
    }).format(value);

    return `${formattedValue} ${this.units[unitIndex]}`;
  }
}
